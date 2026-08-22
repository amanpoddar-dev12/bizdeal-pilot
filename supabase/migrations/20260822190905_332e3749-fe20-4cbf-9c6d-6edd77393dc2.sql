-- 1) Client columns
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS pending_credit_limit numeric,
  ADD COLUMN IF NOT EXISTS credit_status text NOT NULL DEFAULT 'active';

DO $$ BEGIN
  ALTER TABLE public.clients ADD CONSTRAINT clients_credit_status_chk
    CHECK (credit_status IN ('active','pending_approval'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Credit limit request history
CREATE TABLE IF NOT EXISTS public.credit_limit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  requested_limit numeric NOT NULL,
  previous_limit numeric NOT NULL DEFAULT 0,
  credit_terms integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid REFERENCES public.profiles(id),
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_limit_requests_status_chk CHECK (status IN ('pending','approved','rejected'))
);

GRANT SELECT ON public.credit_limit_requests TO authenticated;
GRANT ALL ON public.credit_limit_requests TO service_role;
ALTER TABLE public.credit_limit_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clr_admin_read" ON public.credit_limit_requests;
CREATE POLICY "clr_admin_read" ON public.credit_limit_requests
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

DROP POLICY IF EXISTS "clr_employee_read" ON public.credit_limit_requests;
CREATE POLICY "clr_employee_read" ON public.credit_limit_requests
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'employee'))
    AND EXISTS (
      SELECT 1 FROM public.client_employees ce
      WHERE ce.client_id = credit_limit_requests.client_id
        AND ce.employee_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "clr_client_read" ON public.credit_limit_requests;
CREATE POLICY "clr_client_read" ON public.credit_limit_requests
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = credit_limit_requests.client_id AND c.user_id = (SELECT auth.uid())
  ));

CREATE INDEX IF NOT EXISTS idx_clr_client ON public.credit_limit_requests(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clr_status ON public.credit_limit_requests(status, created_at DESC);

DROP TRIGGER IF EXISTS trg_clr_updated_at ON public.credit_limit_requests;
CREATE TRIGGER trg_clr_updated_at BEFORE UPDATE ON public.credit_limit_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Let the credit workflow RPCs bypass the column guard
CREATE OR REPLACE FUNCTION public.enforce_clients_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  IF coalesce(current_setting('app.credit_workflow', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.credit_limit IS DISTINCT FROM OLD.credit_limit
     OR NEW.credit_terms IS DISTINCT FROM OLD.credit_terms
     OR NEW.penalty_rate_per_day IS DISTINCT FROM OLD.penalty_rate_per_day
     OR NEW.kyc_verified IS DISTINCT FROM OLD.kyc_verified
     OR NEW.kyc_documents IS DISTINCT FROM OLD.kyc_documents
     OR NEW.active IS DISTINCT FROM OLD.active
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Not allowed to modify protected client fields';
  END IF;

  RETURN NEW;
END;
$$;

-- 4) Submit a credit limit / terms change
CREATE OR REPLACE FUNCTION public.submit_credit_limit_request(
  p_client_id uuid, p_limit numeric, p_terms integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_admin boolean;
  v_client public.clients%ROWTYPE;
  v_req_id uuid;
  v_pending boolean;
BEGIN
  v_admin := public.has_role(auth.uid(), 'admin');
  IF NOT v_admin THEN
    IF NOT (public.has_role(auth.uid(), 'employee')
            AND public.has_employee_permission(auth.uid(), 'clients.manage')) THEN
      RAISE EXCEPTION 'Not permitted';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.client_employees ce
                   WHERE ce.client_id = p_client_id AND ce.employee_id = auth.uid()) THEN
      RAISE EXCEPTION 'Not permitted';
    END IF;
  END IF;

  IF p_terms NOT IN (7, 15, 30) THEN
    RAISE EXCEPTION 'Credit terms must be 7, 15 or 30 days';
  END IF;
  IF p_limit IS NULL OR p_limit < 100000 THEN
    RAISE EXCEPTION 'Credit limit must be at least 100000';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;

  v_pending := p_limit >= 500000;
  PERFORM set_config('app.credit_workflow', 'on', true);

  INSERT INTO public.credit_limit_requests
    (client_id, requested_limit, previous_limit, credit_terms, status, requested_by, reviewed_by, reviewed_at, reason)
  VALUES (
    p_client_id, p_limit, coalesce(v_client.credit_limit, 0), p_terms,
    CASE WHEN v_pending THEN 'pending' ELSE 'approved' END,
    auth.uid(),
    CASE WHEN v_pending THEN NULL ELSE auth.uid() END,
    CASE WHEN v_pending THEN NULL ELSE now() END,
    CASE WHEN v_pending THEN NULL ELSE 'Auto-approved: below high-credit threshold' END
  )
  RETURNING id INTO v_req_id;

  IF v_pending THEN
    UPDATE public.clients
       SET pending_credit_limit = p_limit,
           credit_status = 'pending_approval',
           credit_terms = p_terms,
           updated_at = now()
     WHERE id = p_client_id;

    INSERT INTO public.notifications (user_id, type, title, message, reference_id)
    SELECT ur.user_id, 'credit_approval', 'High credit limit approval needed',
           v_client.business_name || ' requested a credit limit of ' || p_limit::text,
           v_req_id::text
      FROM public.user_roles ur WHERE ur.role = 'admin';
  ELSE
    UPDATE public.clients
       SET credit_limit = p_limit,
           credit_terms = p_terms,
           pending_credit_limit = NULL,
           credit_status = 'active',
           updated_at = now()
     WHERE id = p_client_id;
  END IF;

  PERFORM set_config('app.credit_workflow', 'off', true);

  INSERT INTO public.audit_logs (actor_id, action, module, status, target_type, target_id, old_value, new_value)
  VALUES (auth.uid(), CASE WHEN v_pending THEN 'credit_limit_requested' ELSE 'credit_limit_updated' END,
          'clients', 'success', 'client', p_client_id::text,
          jsonb_build_object('credit_limit', v_client.credit_limit, 'credit_terms', v_client.credit_terms),
          jsonb_build_object('credit_limit', p_limit, 'credit_terms', p_terms, 'pending', v_pending));

  RETURN jsonb_build_object('request_id', v_req_id, 'pending', v_pending);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_credit_limit_request(uuid, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_credit_limit_request(uuid, numeric, integer) TO authenticated;

-- 5) Admin review
CREATE OR REPLACE FUNCTION public.review_credit_limit_request(
  p_request_id uuid, p_action text, p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.credit_limit_requests%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only an admin can review credit limit requests';
  END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RAISE EXCEPTION 'Invalid action';
  END IF;

  SELECT * INTO r FROM public.credit_limit_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'This request has already been reviewed'; END IF;

  UPDATE public.credit_limit_requests
     SET status = CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
         reviewed_by = auth.uid(), reviewed_at = now(), reason = NULLIF(p_reason, '')
   WHERE id = p_request_id;

  IF p_action = 'approve' THEN
    UPDATE public.clients
       SET credit_limit = r.requested_limit, credit_terms = r.credit_terms,
           pending_credit_limit = NULL, credit_status = 'active', updated_at = now()
     WHERE id = r.client_id;
  ELSE
    UPDATE public.clients
       SET pending_credit_limit = NULL, credit_status = 'active', updated_at = now()
     WHERE id = r.client_id;
  END IF;

  IF r.requested_by IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, reference_id)
    VALUES (r.requested_by, 'credit_approval',
            'Credit limit request ' || CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
            coalesce(NULLIF(p_reason, ''), 'Reviewed by admin'), p_request_id::text);
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, module, status, target_type, target_id, new_value, remarks)
  VALUES (auth.uid(), 'credit_limit_' || p_action || 'd', 'clients', 'success', 'client', r.client_id::text,
          jsonb_build_object('requested_limit', r.requested_limit, 'request_id', p_request_id), NULLIF(p_reason, ''));
END;
$$;

REVOKE ALL ON FUNCTION public.review_credit_limit_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_credit_limit_request(uuid, text, text) TO authenticated;

-- 6) Employee client creation: mandatory phone/GST/PAN + optional coordinates
CREATE OR REPLACE FUNCTION public.emp_create_client(p_values jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'employee') THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  IF NOT public.has_employee_permission(auth.uid(), 'clients.manage') THEN
    RAISE EXCEPTION 'You do not have permission to manage client information';
  END IF;

  IF NULLIF(p_values->>'business_name','') IS NULL THEN
    RAISE EXCEPTION 'business_name is required';
  END IF;
  IF NULLIF(p_values->>'phone','') IS NULL THEN
    RAISE EXCEPTION 'Phone number is required';
  END IF;
  IF NULLIF(p_values->>'gst_number','') IS NULL THEN
    RAISE EXCEPTION 'GST number is required';
  END IF;
  IF NULLIF(p_values->>'pan','') IS NULL THEN
    RAISE EXCEPTION 'PAN number is required';
  END IF;

  INSERT INTO public.clients (business_name, business_type, contact_person, email, phone, gst_number, pan, address, latitude, longitude)
  VALUES (
    NULLIF(p_values->>'business_name',''),
    NULLIF(p_values->>'business_type',''),
    NULLIF(p_values->>'contact_person',''),
    NULLIF(p_values->>'email',''),
    NULLIF(p_values->>'phone',''),
    NULLIF(p_values->>'gst_number',''),
    NULLIF(p_values->>'pan',''),
    NULLIF(p_values->>'address',''),
    (p_values->>'latitude')::numeric,
    (p_values->>'longitude')::numeric
  )
  RETURNING id INTO v_id;

  INSERT INTO public.client_employees (client_id, employee_id)
  VALUES (v_id, auth.uid())
  ON CONFLICT DO NOTHING;

  INSERT INTO public.audit_logs (actor_id, action, module, status, target_type, target_id, new_value)
  VALUES (auth.uid(), 'client_created', 'clients', 'success', 'client', v_id::text, p_values);

  RETURN v_id;
END;
$function$;