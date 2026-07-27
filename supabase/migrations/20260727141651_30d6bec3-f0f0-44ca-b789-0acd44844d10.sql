
-- 1) Fix SUPA_authenticated_security_definer_function_executable
ALTER FUNCTION public.has_role(uuid, app_role) SECURITY INVOKER;

-- 2) Drop over-broad UPDATE/INSERT policies
DROP POLICY IF EXISTS clients_own_update ON public.clients;
DROP POLICY IF EXISTS inv_client_update ON public.invoices;
DROP POLICY IF EXISTS orders_client_update ON public.orders;
DROP POLICY IF EXISTS orders_emp_update ON public.orders;
DROP POLICY IF EXISTS duty_own_insert ON public.duty_sessions;
DROP POLICY IF EXISTS duty_own_update ON public.duty_sessions;

-- 3) Scoped SECURITY DEFINER RPCs for the specific field-limited actions
CREATE OR REPLACE FUNCTION public.client_respond_invoice(p_id uuid, p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status invoice_status;
BEGIN
  IF p_action NOT IN ('accept','decline') THEN
    RAISE EXCEPTION 'Invalid action';
  END IF;
  v_status := CASE p_action WHEN 'accept' THEN 'approved'::invoice_status ELSE 'declined'::invoice_status END;
  UPDATE public.invoices i SET status = v_status
   WHERE i.id = p_id
     AND i.status = 'sent'
     AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = i.client_id AND c.user_id = auth.uid());
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found or not modifiable'; END IF;
END;$$;

CREATE OR REPLACE FUNCTION public.client_cancel_order(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.orders o SET status = 'declined'::order_status
   WHERE o.id = p_id AND o.status = 'pending'
     AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = o.client_id AND c.user_id = auth.uid());
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found or not cancellable'; END IF;
END;$$;

CREATE OR REPLACE FUNCTION public.emp_update_order_meta(
  p_id uuid, p_notes text, p_delivery_date timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.orders o SET
    notes = COALESCE(p_notes, o.notes),
    delivery_date = COALESCE(p_delivery_date, o.delivery_date),
    updated_at = now()
   WHERE o.id = p_id
     AND o.employee_id = auth.uid()
     AND o.status NOT IN ('invoiced','paid','declined','cancelled');
  IF NOT FOUND THEN RAISE EXCEPTION 'Not permitted'; END IF;
END;$$;

CREATE OR REPLACE FUNCTION public.duty_clock_in()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE public.duty_sessions
     SET clock_out_time = now(),
         duration_minutes = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (now() - clock_in_time))/60)::int)
   WHERE employee_id = auth.uid() AND clock_out_time IS NULL;
  INSERT INTO public.duty_sessions(employee_id, clock_in_time)
       VALUES (auth.uid(), now())
    RETURNING id INTO v_id;
  RETURN v_id;
END;$$;

CREATE OR REPLACE FUNCTION public.duty_clock_out()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dur int;
BEGIN
  UPDATE public.duty_sessions
     SET clock_out_time = now(),
         duration_minutes = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (now() - clock_in_time))/60)::int)
   WHERE employee_id = auth.uid() AND clock_out_time IS NULL
  RETURNING duration_minutes INTO v_dur;
  RETURN COALESCE(v_dur, 0);
END;$$;

REVOKE ALL ON FUNCTION public.client_respond_invoice(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_cancel_order(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.emp_update_order_meta(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.duty_clock_in() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.duty_clock_out() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.client_respond_invoice(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_cancel_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.emp_update_order_meta(uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duty_clock_in() TO authenticated;
GRANT EXECUTE ON FUNCTION public.duty_clock_out() TO authenticated;
