-- ============ TABLES ============
CREATE TABLE IF NOT EXISTS public.order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  method text NOT NULL,
  reference_id text,
  proof_path text,
  note text,
  status public.payment_verification_status NOT NULL DEFAULT 'submitted',
  rejection_reason text,
  submitted_by uuid REFERENCES public.profiles(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.order_payments TO authenticated;
GRANT ALL ON public.order_payments TO service_role;
ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS op_admin_all ON public.order_payments;
CREATE POLICY op_admin_all ON public.order_payments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS op_client_read ON public.order_payments;
CREATE POLICY op_client_read ON public.order_payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = order_payments.client_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS op_emp_read ON public.order_payments;
CREATE POLICY op_emp_read ON public.order_payments FOR SELECT TO authenticated
  USING (public.is_assigned_employee(order_payments.client_id));

CREATE INDEX IF NOT EXISTS idx_order_payments_order ON public.order_payments(order_id);
CREATE TRIGGER trg_order_payments_updated BEFORE UPDATE ON public.order_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.delivery_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.profiles(id),
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by uuid REFERENCES public.profiles(id),
  active boolean NOT NULL DEFAULT true,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.delivery_otps TO authenticated;
GRANT ALL ON public.delivery_otps TO service_role;
ALTER TABLE public.delivery_otps ENABLE ROW LEVEL SECURITY;

-- Only the owning client and admins may ever read the code. Employees never can.
DROP POLICY IF EXISTS otp_client_read ON public.delivery_otps;
CREATE POLICY otp_client_read ON public.delivery_otps FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = delivery_otps.client_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS otp_admin_read ON public.delivery_otps;
CREATE POLICY otp_admin_read ON public.delivery_otps FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_delivery_otps_order ON public.delivery_otps(order_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.order_payments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_otps;

-- ============ ORDER UPDATE GUARD: allow workflow routines ============
CREATE OR REPLACE FUNCTION public.enforce_orders_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  is_admin boolean := public.has_role(auth.uid(), 'admin');
  is_client_owner boolean := EXISTS (SELECT 1 FROM public.clients c WHERE c.id = NEW.client_id AND c.user_id = auth.uid());
  is_assigned_employee boolean := (OLD.employee_id = auth.uid());
BEGIN
  -- Trusted workflow routines set this flag; they do their own authorization.
  IF current_setting('app.order_workflow', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF is_admin THEN RETURN NEW; END IF;

  IF NEW.total_amount IS DISTINCT FROM OLD.total_amount
     OR NEW.client_id  IS DISTINCT FROM OLD.client_id
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.order_number IS DISTINCT FROM OLD.order_number THEN
    RAISE EXCEPTION 'Not allowed to modify protected order fields';
  END IF;

  IF is_client_owner AND NOT is_assigned_employee THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'pending' AND NEW.status = 'declined')
       AND NOT (OLD.status = 'pending_client' AND NEW.status IN ('client_approved','client_rejected')) THEN
      RAISE EXCEPTION 'Clients may only respond to orders awaiting them';
    END IF;
    IF NEW.delivery_date IS DISTINCT FROM OLD.delivery_date OR NEW.notes IS DISTINCT FROM OLD.notes THEN
      RAISE EXCEPTION 'Clients may not edit order details';
    END IF;
    RETURN NEW;
  END IF;

  IF is_assigned_employee THEN
    IF OLD.status IN ('invoiced','paid','client_approved','payment_pending','payment_submitted','payment_verified','out_for_delivery','completed') THEN
      RAISE EXCEPTION 'Order is locked';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status NOT IN ('pending','confirmed','pending_client') THEN
      RAISE EXCEPTION 'Employees may not transition to this status';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Not allowed';
END;
$function$;

-- ============ CLIENT REVIEW: approving now moves to payment_pending ============
CREATE OR REPLACE FUNCTION public.client_review_order(p_id uuid, p_action text, p_checklist jsonb DEFAULT '{}'::jsonb, p_remarks text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_o public.orders; v_status public.order_status;
BEGIN
  IF p_action NOT IN ('approve','reject') THEN RAISE EXCEPTION 'Invalid action'; END IF;
  SELECT * INTO v_o FROM public.orders WHERE id = p_id;
  IF v_o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_o.client_id AND c.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  IF v_o.status <> 'pending_client' THEN RAISE EXCEPTION 'Order is not awaiting your approval'; END IF;

  v_status := CASE p_action WHEN 'approve' THEN 'payment_pending'::public.order_status ELSE 'client_rejected'::public.order_status END;
  PERFORM set_config('app.order_workflow','on',true);
  UPDATE public.orders SET status = v_status, updated_at = now() WHERE id = p_id;
  PERFORM set_config('app.order_workflow','',true);

  INSERT INTO public.order_approvals(order_id, actor_id, action, checklist, remarks)
  VALUES (p_id, auth.uid(), p_action, COALESCE(p_checklist,'{}'::jsonb), p_remarks);

  INSERT INTO public.order_events(order_id, actor_id, event, from_status, to_status, note)
  VALUES (p_id, auth.uid(), 'client_' || p_action, 'pending_client', v_status::text, p_remarks);

  IF v_o.employee_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, message, reference_id)
    VALUES (v_o.employee_id, 'order_approval',
            CASE p_action WHEN 'approve' THEN 'Order accepted by client' ELSE 'Order rejected by client' END,
            'Order ' || v_o.order_number, p_id::text);
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, module, status, target_type, target_id, old_value, new_value, remarks)
  VALUES (auth.uid(), 'order.client_' || p_action, 'orders', 'success', 'order', p_id::text,
          jsonb_build_object('status','pending_client'),
          jsonb_build_object('status', v_status::text, 'checklist', COALESCE(p_checklist,'{}'::jsonb)), p_remarks);
END;$function$;

-- ============ CLIENT SUBMITS PAYMENT ============
CREATE OR REPLACE FUNCTION public.client_submit_payment(
  p_order_id uuid, p_amount numeric, p_method text,
  p_reference text DEFAULT NULL, p_proof_path text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_o public.orders; v_id uuid;
BEGIN
  SELECT * INTO v_o FROM public.orders WHERE id = p_order_id;
  IF v_o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_o.client_id AND c.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  IF v_o.status <> 'payment_pending' THEN
    RAISE EXCEPTION 'Payment can only be submitted after you accept the order';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_payments WHERE order_id = p_order_id AND status = 'submitted') THEN
    RAISE EXCEPTION 'A payment is already under verification for this order';
  END IF;
  IF p_method NOT IN ('upi','bank_transfer','cash','cheque','other') THEN RAISE EXCEPTION 'Invalid payment method'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;

  INSERT INTO public.order_payments(order_id, client_id, amount, method, reference_id, proof_path, note, submitted_by)
  VALUES (p_order_id, v_o.client_id, p_amount, p_method, NULLIF(p_reference,''), NULLIF(p_proof_path,''), NULLIF(p_note,''), auth.uid())
  RETURNING id INTO v_id;

  PERFORM set_config('app.order_workflow','on',true);
  UPDATE public.orders SET status = 'payment_submitted', updated_at = now() WHERE id = p_order_id;
  PERFORM set_config('app.order_workflow','',true);

  INSERT INTO public.order_events(order_id, actor_id, event, from_status, to_status, note)
  VALUES (p_order_id, auth.uid(), 'payment_submitted', 'payment_pending', 'payment_submitted', p_method);

  INSERT INTO public.notifications(user_id, type, title, message, reference_id)
  SELECT ur.user_id, 'payment', 'Payment awaiting verification',
         'Order ' || v_o.order_number || ' has a new payment proof', p_order_id::text
    FROM public.user_roles ur WHERE ur.role = 'admin';

  INSERT INTO public.audit_logs(actor_id, action, module, status, target_type, target_id, new_value)
  VALUES (auth.uid(), 'payment.submitted', 'payments', 'success', 'order', p_order_id::text,
          jsonb_build_object('amount', p_amount, 'method', p_method, 'reference', p_reference));
  RETURN v_id;
END;$function$;

-- ============ ADMIN REVIEWS PAYMENT ============
CREATE OR REPLACE FUNCTION public.admin_review_payment(p_payment_id uuid, p_action text, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_p public.order_payments; v_o public.orders; v_client_user uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not permitted'; END IF;
  IF p_action NOT IN ('approve','reject') THEN RAISE EXCEPTION 'Invalid action'; END IF;
  SELECT * INTO v_p FROM public.order_payments WHERE id = p_payment_id;
  IF v_p.id IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_p.status <> 'submitted' THEN RAISE EXCEPTION 'Payment already reviewed'; END IF;
  IF p_action = 'reject' AND COALESCE(NULLIF(trim(p_reason),''), NULL) IS NULL THEN
    RAISE EXCEPTION 'A rejection reason is required';
  END IF;
  SELECT * INTO v_o FROM public.orders WHERE id = v_p.order_id;

  UPDATE public.order_payments
     SET status = CASE p_action WHEN 'approve' THEN 'verified' ELSE 'rejected' END::public.payment_verification_status,
         rejection_reason = CASE p_action WHEN 'reject' THEN p_reason ELSE NULL END,
         reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = p_payment_id;

  PERFORM set_config('app.order_workflow','on',true);
  UPDATE public.orders
     SET status = CASE p_action WHEN 'approve' THEN 'payment_verified' ELSE 'payment_pending' END::public.order_status,
         updated_at = now()
   WHERE id = v_p.order_id;
  PERFORM set_config('app.order_workflow','',true);

  INSERT INTO public.order_events(order_id, actor_id, event, from_status, to_status, note)
  VALUES (v_p.order_id, auth.uid(), 'payment_' || p_action || 'd', 'payment_submitted',
          CASE p_action WHEN 'approve' THEN 'payment_verified' ELSE 'payment_pending' END, p_reason);

  SELECT user_id INTO v_client_user FROM public.clients WHERE id = v_p.client_id;
  IF v_client_user IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, message, reference_id)
    VALUES (v_client_user, 'payment',
            CASE p_action WHEN 'approve' THEN 'Payment verified' ELSE 'Payment rejected' END,
            CASE p_action WHEN 'approve' THEN 'Order ' || v_o.order_number || ' payment verified'
                          ELSE 'Order ' || v_o.order_number || ': ' || COALESCE(p_reason,'') END,
            v_p.order_id::text);
  END IF;
  IF v_o.employee_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, message, reference_id)
    VALUES (v_o.employee_id, 'payment',
            CASE p_action WHEN 'approve' THEN 'Payment verified — delivery unlocked' ELSE 'Payment rejected' END,
            'Order ' || v_o.order_number, v_p.order_id::text);
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, module, status, target_type, target_id, old_value, new_value, remarks)
  VALUES (auth.uid(), 'payment.' || p_action, 'payments', 'success', 'order', v_p.order_id::text,
          jsonb_build_object('status','submitted'),
          jsonb_build_object('status', CASE p_action WHEN 'approve' THEN 'verified' ELSE 'rejected' END,
                             'amount', v_p.amount, 'method', v_p.method), p_reason);
END;$function$;

-- ============ OTP HELPERS ============
CREATE OR REPLACE FUNCTION public.issue_delivery_otp(p_order_id uuid, p_regenerated boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_o public.orders; v_code text; v_client_user uuid; v_recent int;
BEGIN
  SELECT * INTO v_o FROM public.orders WHERE id = p_order_id;
  SELECT count(*) INTO v_recent FROM public.delivery_otps
   WHERE order_id = p_order_id AND created_at > now() - interval '1 hour';
  IF v_recent >= 5 THEN RAISE EXCEPTION 'Too many delivery codes generated. Please try again later.'; END IF;

  UPDATE public.delivery_otps SET active = false WHERE order_id = p_order_id AND active;
  v_code := lpad(((random() * 899999)::int + 100000)::text, 6, '0');

  INSERT INTO public.delivery_otps(order_id, client_id, employee_id, code, expires_at)
  VALUES (p_order_id, v_o.client_id, v_o.employee_id, v_code, now() + interval '30 minutes');

  INSERT INTO public.order_events(order_id, actor_id, event, note)
  VALUES (p_order_id, auth.uid(), CASE WHEN p_regenerated THEN 'otp_regenerated' ELSE 'otp_generated' END,
          'Valid for 30 minutes');

  SELECT user_id INTO v_client_user FROM public.clients WHERE id = v_o.client_id;
  IF v_client_user IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, message, reference_id)
    VALUES (v_client_user, 'delivery',
            CASE WHEN p_regenerated THEN 'New delivery code issued' ELSE 'Delivery code ready' END,
            'Order ' || v_o.order_number || ' — share the code with the delivery person on arrival',
            p_order_id::text);
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, module, status, target_type, target_id, new_value)
  VALUES (auth.uid(), CASE WHEN p_regenerated THEN 'delivery.otp_regenerated' ELSE 'delivery.otp_generated' END,
          'delivery', 'success', 'order', p_order_id::text,
          jsonb_build_object('expires_in_minutes', 30));
END;$function$;

CREATE OR REPLACE FUNCTION public.emp_mark_out_for_delivery(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_o public.orders; v_client_user uuid;
BEGIN
  SELECT * INTO v_o FROM public.orders WHERE id = p_order_id;
  IF v_o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR v_o.employee_id = auth.uid() OR public.is_assigned_employee(v_o.client_id)) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  IF v_o.status <> 'payment_verified' THEN
    RAISE EXCEPTION 'Payment not verified — delivery is locked';
  END IF;

  PERFORM set_config('app.order_workflow','on',true);
  UPDATE public.orders SET status = 'out_for_delivery', updated_at = now() WHERE id = p_order_id;
  PERFORM set_config('app.order_workflow','',true);

  INSERT INTO public.order_events(order_id, actor_id, event, from_status, to_status)
  VALUES (p_order_id, auth.uid(), 'out_for_delivery', 'payment_verified', 'out_for_delivery');

  SELECT user_id INTO v_client_user FROM public.clients WHERE id = v_o.client_id;
  IF v_client_user IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, message, reference_id)
    VALUES (v_client_user, 'delivery', 'Order out for delivery',
            'Order ' || v_o.order_number || ' is on the way', p_order_id::text);
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, module, status, target_type, target_id, new_value)
  VALUES (auth.uid(), 'delivery.out_for_delivery', 'delivery', 'success', 'order', p_order_id::text,
          jsonb_build_object('status','out_for_delivery'));

  PERFORM public.issue_delivery_otp(p_order_id, false);
END;$function$;

CREATE OR REPLACE FUNCTION public.emp_regenerate_delivery_otp(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_o public.orders;
BEGIN
  SELECT * INTO v_o FROM public.orders WHERE id = p_order_id;
  IF v_o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR v_o.employee_id = auth.uid() OR public.is_assigned_employee(v_o.client_id)) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  IF v_o.status <> 'out_for_delivery' THEN RAISE EXCEPTION 'Order is not out for delivery'; END IF;
  PERFORM public.issue_delivery_otp(p_order_id, true);
END;$function$;

CREATE OR REPLACE FUNCTION public.emp_verify_delivery_otp(p_order_id uuid, p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_o public.orders; v_otp public.delivery_otps; v_client_user uuid;
BEGIN
  SELECT * INTO v_o FROM public.orders WHERE id = p_order_id;
  IF v_o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR v_o.employee_id = auth.uid() OR public.is_assigned_employee(v_o.client_id)) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  IF v_o.status <> 'out_for_delivery' THEN RAISE EXCEPTION 'Order is not out for delivery'; END IF;

  SELECT * INTO v_otp FROM public.delivery_otps
   WHERE order_id = p_order_id AND active AND used_at IS NULL
   ORDER BY created_at DESC LIMIT 1;
  IF v_otp.id IS NULL THEN RAISE EXCEPTION 'No active delivery code. Please request a new one.'; END IF;
  IF v_otp.attempts >= 5 THEN
    INSERT INTO public.audit_logs(actor_id, action, module, status, target_type, target_id, remarks)
    VALUES (auth.uid(), 'delivery.otp_locked', 'delivery', 'failure', 'order', p_order_id::text, 'Too many failed attempts');
    RAISE EXCEPTION 'Too many failed attempts. Request a new delivery code.';
  END IF;
  IF v_otp.expires_at < now() THEN
    UPDATE public.delivery_otps SET active = false WHERE id = v_otp.id;
    RAISE EXCEPTION 'Delivery code expired. Please request a new one.';
  END IF;

  IF v_otp.code IS DISTINCT FROM regexp_replace(COALESCE(p_code,''), '\D', '', 'g') THEN
    UPDATE public.delivery_otps SET attempts = attempts + 1 WHERE id = v_otp.id;
    INSERT INTO public.order_events(order_id, actor_id, event, note)
    VALUES (p_order_id, auth.uid(), 'otp_failed', 'Incorrect delivery code');
    INSERT INTO public.audit_logs(actor_id, action, module, status, target_type, target_id, remarks)
    VALUES (auth.uid(), 'delivery.otp_failed', 'delivery', 'failure', 'order', p_order_id::text, 'Incorrect delivery code');
    RAISE EXCEPTION 'Invalid OTP. Please verify the code with the Client and try again.';
  END IF;

  UPDATE public.delivery_otps SET used_at = now(), used_by = auth.uid(), active = false WHERE id = v_otp.id;

  PERFORM set_config('app.order_workflow','on',true);
  UPDATE public.orders SET status = 'completed', updated_at = now() WHERE id = p_order_id;
  PERFORM set_config('app.order_workflow','',true);

  INSERT INTO public.order_events(order_id, actor_id, event, from_status, to_status, note)
  VALUES (p_order_id, auth.uid(), 'delivery_verified', 'out_for_delivery', 'completed', 'OTP verified');

  SELECT user_id INTO v_client_user FROM public.clients WHERE id = v_o.client_id;
  IF v_client_user IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, message, reference_id)
    VALUES (v_client_user, 'delivery', 'Delivery confirmed', 'Order ' || v_o.order_number || ' is completed', p_order_id::text);
  END IF;
  INSERT INTO public.notifications(user_id, type, title, message, reference_id)
  SELECT ur.user_id, 'delivery', 'Order completed', 'Order ' || v_o.order_number || ' delivery verified', p_order_id::text
    FROM public.user_roles ur WHERE ur.role = 'admin';

  INSERT INTO public.audit_logs(actor_id, action, module, status, target_type, target_id, old_value, new_value)
  VALUES (auth.uid(), 'delivery.otp_verified', 'delivery', 'success', 'order', p_order_id::text,
          jsonb_build_object('status','out_for_delivery'), jsonb_build_object('status','completed'));
END;$function$;

-- ============ EXECUTE GRANTS ============
REVOKE ALL ON FUNCTION public.issue_delivery_otp(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_submit_payment(uuid, numeric, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_review_payment(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.emp_mark_out_for_delivery(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.emp_regenerate_delivery_otp(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.emp_verify_delivery_otp(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_submit_payment(uuid, numeric, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_payment(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.emp_mark_out_for_delivery(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.emp_regenerate_delivery_otp(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.emp_verify_delivery_otp(uuid, text) TO authenticated;