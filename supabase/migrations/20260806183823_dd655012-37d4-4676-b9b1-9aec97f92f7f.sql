-- Scope employee updates to assigned clients only
DROP POLICY IF EXISTS clients_emp_update ON public.clients;
CREATE POLICY clients_emp_update ON public.clients
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'employee')
  AND EXISTS (SELECT 1 FROM public.client_employees ce WHERE ce.client_id = clients.id AND ce.employee_id = auth.uid())
)
WITH CHECK (
  public.has_role(auth.uid(), 'employee')
  AND EXISTS (SELECT 1 FROM public.client_employees ce WHERE ce.client_id = clients.id AND ce.employee_id = auth.uid())
);

-- Employees may no longer insert clients directly; use the scoped RPC below
DROP POLICY IF EXISTS clients_emp_insert ON public.clients;

CREATE OR REPLACE FUNCTION public.emp_create_client(p_values jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'employee') THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  INSERT INTO public.clients (business_name, business_type, contact_person, email, phone, gst_number, pan, address)
  VALUES (
    NULLIF(p_values->>'business_name',''),
    NULLIF(p_values->>'business_type',''),
    NULLIF(p_values->>'contact_person',''),
    NULLIF(p_values->>'email',''),
    NULLIF(p_values->>'phone',''),
    NULLIF(p_values->>'gst_number',''),
    NULLIF(p_values->>'pan',''),
    NULLIF(p_values->>'address','')
  )
  RETURNING id INTO v_id;

  IF NULLIF(p_values->>'business_name','') IS NULL THEN
    RAISE EXCEPTION 'business_name is required';
  END IF;

  INSERT INTO public.client_employees (client_id, employee_id)
  VALUES (v_id, auth.uid())
  ON CONFLICT DO NOTHING;

  INSERT INTO public.audit_logs (actor_id, action, module, status, target_type, target_id, new_value)
  VALUES (auth.uid(), 'client_created', 'clients', 'success', 'client', v_id::text, p_values);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.emp_create_client(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emp_create_client(jsonb) TO authenticated;