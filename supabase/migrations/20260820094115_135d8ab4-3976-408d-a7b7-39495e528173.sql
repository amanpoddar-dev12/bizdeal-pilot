-- 1. Payment reminders ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.profiles(id),
  amount_due numeric NOT NULL DEFAULT 0,
  credit_terms integer NOT NULL DEFAULT 0,
  due_date timestamptz NOT NULL,
  stage text NOT NULL CHECK (stage IN ('created','due_soon','due_today','overdue')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, stage)
);

GRANT SELECT ON public.payment_reminders TO authenticated;
GRANT ALL ON public.payment_reminders TO service_role;

ALTER TABLE public.payment_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read all payment reminders" ON public.payment_reminders
  FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'));

CREATE POLICY "Employees read their payment reminders" ON public.payment_reminders
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT auth.uid()) OR public.is_assigned_employee(client_id));

CREATE POLICY "Clients read their payment reminders" ON public.payment_reminders
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = payment_reminders.client_id AND c.user_id = (SELECT auth.uid())));

CREATE INDEX IF NOT EXISTS idx_payment_reminders_order ON public.payment_reminders(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_client ON public.payment_reminders(client_id);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_employee ON public.payment_reminders(employee_id);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_status_due ON public.payment_reminders(status, due_date);

CREATE TRIGGER trg_payment_reminders_updated
  BEFORE UPDATE ON public.payment_reminders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Client accepts order -> processing (no payment gate) ------------------
CREATE OR REPLACE FUNCTION public.client_review_order(p_id uuid, p_action text, p_checklist jsonb DEFAULT '{}'::jsonb, p_remarks text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_o public.orders; v_status public.order_status;
BEGIN
  IF p_action NOT IN ('approve','reject') THEN RAISE EXCEPTION 'Invalid action'; END IF;
  SELECT * INTO v_o FROM public.orders WHERE id = p_id;
  IF v_o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_o.client_id AND c.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  IF v_o.status <> 'pending_client' THEN RAISE EXCEPTION 'Order is not awaiting your approval'; END IF;

  v_status := CASE p_action WHEN 'approve' THEN 'client_approved'::public.order_status ELSE 'client_rejected'::public.order_status END;
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
            CASE p_action WHEN 'approve' THEN 'Order accepted — start processing' ELSE 'Order rejected by client' END,
            'Order ' || v_o.order_number, p_id::text);
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, module, status, target_type, target_id, old_value, new_value, remarks)
  VALUES (auth.uid(), 'order.client_' || p_action, 'orders', 'success', 'order', p_id::text,
          jsonb_build_object('status','pending_client'),
          jsonb_build_object('status', v_status::text, 'checklist', COALESCE(p_checklist,'{}'::jsonb)), p_remarks);
END;$function$;

-- 3. Dispatch unlocked by client acceptance --------------------------------
CREATE OR REPLACE FUNCTION public.emp_mark_out_for_delivery(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_o public.orders; v_client_user uuid;
BEGIN
  SELECT * INTO v_o FROM public.orders WHERE id = p_order_id;
  IF v_o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR v_o.employee_id = auth.uid() OR public.is_assigned_employee(v_o.client_id)) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  -- payment_verified kept for orders created under the pre-delivery payment flow
  IF v_o.status NOT IN ('client_approved','payment_verified') THEN
    RAISE EXCEPTION 'Order must be accepted by the client before dispatch';
  END IF;

  PERFORM set_config('app.order_workflow','on',true);
  UPDATE public.orders SET status = 'out_for_delivery', updated_at = now() WHERE id = p_order_id;
  PERFORM set_config('app.order_workflow','',true);

  INSERT INTO public.order_events(order_id, actor_id, event, from_status, to_status)
  VALUES (p_order_id, auth.uid(), 'out_for_delivery', v_o.status::text, 'out_for_delivery');

  SELECT user_id INTO v_client_user FROM public.clients WHERE id = v_o.client_id;
  IF v_client_user IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, message, reference_id)
    VALUES (v_client_user, 'delivery', 'Order dispatched',
            'Order ' || v_o.order_number || ' is on the way', p_order_id::text);
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, module, status, target_type, target_id, new_value)
  VALUES (auth.uid(), 'delivery.out_for_delivery', 'delivery', 'success', 'order', p_order_id::text,
          jsonb_build_object('status','out_for_delivery'));

  PERFORM public.issue_delivery_otp(p_order_id, false);
END;$function$;

-- 4. Delivery verified -> invoice + due date + follow-up reminder ----------
CREATE OR REPLACE FUNCTION public.emp_verify_delivery_otp(p_order_id uuid, p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_o public.orders; v_otp public.delivery_otps; v_client_user uuid;
        v_terms int; v_due timestamptz; v_inv public.invoices; v_delivered timestamptz := now();
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
  UPDATE public.orders SET status = 'completed', delivery_date = COALESCE(delivery_date, v_delivered), updated_at = now()
   WHERE id = p_order_id;
  PERFORM set_config('app.order_workflow','',true);

  INSERT INTO public.order_events(order_id, actor_id, event, from_status, to_status, note)
  VALUES (p_order_id, auth.uid(), 'delivery_verified', 'out_for_delivery', 'completed', 'OTP verified');

  -- Invoice: due date = delivery completion + client credit terms
  SELECT COALESCE(credit_terms, 0), user_id INTO v_terms, v_client_user FROM public.clients WHERE id = v_o.client_id;
  v_due := v_delivered + make_interval(days => COALESCE(v_terms,0));

  SELECT * INTO v_inv FROM public.invoices WHERE order_id = p_order_id ORDER BY created_at LIMIT 1;
  IF v_inv.id IS NULL THEN
    INSERT INTO public.invoices(order_id, client_id, amount, invoice_date, due_date, status, notes)
    VALUES (p_order_id, v_o.client_id, v_o.total_amount, v_delivered, v_due, 'pending_payment',
            'Auto-generated on delivery completion')
    RETURNING * INTO v_inv;
    INSERT INTO public.order_events(order_id, actor_id, event, note)
    VALUES (p_order_id, auth.uid(), 'invoice_created',
            'Invoice ' || v_inv.invoice_number || ' — due ' || to_char(v_due, 'DD Mon YYYY'));
  END IF;

  -- Single follow-up reminder per order stage (idempotent)
  INSERT INTO public.payment_reminders(order_id, invoice_id, client_id, employee_id, amount_due, credit_terms, due_date, stage, notified_at)
  VALUES (p_order_id, v_inv.id, v_o.client_id, v_o.employee_id, v_o.total_amount, COALESCE(v_terms,0), v_due, 'created', now())
  ON CONFLICT (order_id, stage) DO NOTHING;

  IF v_client_user IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, message, reference_id)
    VALUES (v_client_user, 'delivery', 'Delivered — payment due',
            'Order ' || v_o.order_number || ' delivered. ' ||
            CASE WHEN COALESCE(v_terms,0) = 0 THEN 'Payment is due now.'
                 ELSE 'Payment due by ' || to_char(v_due, 'DD Mon YYYY') || ' (' || v_terms || '-day terms).' END,
            p_order_id::text);
  END IF;
  IF v_o.employee_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, message, reference_id)
    VALUES (v_o.employee_id, 'payment', 'Payment follow-up',
            'Order ' || v_o.order_number || ' delivered — collect payment by ' || to_char(v_due, 'DD Mon YYYY'),
            p_order_id::text);
  END IF;
  INSERT INTO public.notifications(user_id, type, title, message, reference_id)
  SELECT ur.user_id, 'delivery', 'Order delivered', 'Order ' || v_o.order_number || ' delivery verified', p_order_id::text
    FROM public.user_roles ur WHERE ur.role = 'admin';

  INSERT INTO public.audit_logs(actor_id, action, module, status, target_type, target_id, old_value, new_value)
  VALUES (auth.uid(), 'delivery.otp_verified', 'delivery', 'success', 'order', p_order_id::text,
          jsonb_build_object('status','out_for_delivery'),
          jsonb_build_object('status','completed','invoice', v_inv.invoice_number, 'due_date', v_due));
END;$function$;

-- 5. Client pays after delivery -------------------------------------------
CREATE OR REPLACE FUNCTION public.client_submit_payment(p_order_id uuid, p_amount numeric, p_method text, p_reference text DEFAULT NULL::text, p_proof_path text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_o public.orders; v_id uuid;
BEGIN
  SELECT * INTO v_o FROM public.orders WHERE id = p_order_id;
  IF v_o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_o.client_id AND c.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  -- payment_pending kept for orders created under the pre-delivery payment flow
  IF v_o.status NOT IN ('completed','payment_pending') THEN
    RAISE EXCEPTION 'Payment can be submitted once the order is delivered';
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
  VALUES (p_order_id, auth.uid(), 'payment_submitted', v_o.status::text, 'payment_submitted', p_method);

  INSERT INTO public.notifications(user_id, type, title, message, reference_id)
  SELECT ur.user_id, 'payment', 'Payment awaiting verification',
         'Order ' || v_o.order_number || ' has a new payment proof', p_order_id::text
    FROM public.user_roles ur WHERE ur.role = 'admin';

  INSERT INTO public.audit_logs(actor_id, action, module, status, target_type, target_id, new_value)
  VALUES (auth.uid(), 'payment.submitted', 'payments', 'success', 'order', p_order_id::text,
          jsonb_build_object('amount', p_amount, 'method', p_method, 'reference', p_reference));
  RETURN v_id;
END;$function$;

-- 6. Admin verification closes the cycle -----------------------------------
CREATE OR REPLACE FUNCTION public.admin_review_payment(p_payment_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_p public.order_payments; v_o public.orders; v_client_user uuid;
        v_inv public.invoices; v_new public.order_status; v_paid numeric; v_delivered boolean;
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
  SELECT * INTO v_inv FROM public.invoices WHERE order_id = v_p.order_id ORDER BY created_at LIMIT 1;
  v_delivered := v_inv.id IS NOT NULL;

  UPDATE public.order_payments
     SET status = CASE p_action WHEN 'approve' THEN 'verified' ELSE 'rejected' END::public.payment_verification_status,
         rejection_reason = CASE p_action WHEN 'reject' THEN p_reason ELSE NULL END,
         reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = p_payment_id;

  IF p_action = 'approve' THEN
    v_new := CASE WHEN v_delivered THEN 'paid' ELSE 'payment_verified' END::public.order_status;
  ELSE
    v_new := CASE WHEN v_delivered THEN 'completed' ELSE 'payment_pending' END::public.order_status;
  END IF;

  PERFORM set_config('app.order_workflow','on',true);
  UPDATE public.orders SET status = v_new, updated_at = now() WHERE id = v_p.order_id;
  PERFORM set_config('app.order_workflow','',true);

  INSERT INTO public.order_events(order_id, actor_id, event, from_status, to_status, note)
  VALUES (v_p.order_id, auth.uid(), 'payment_' || p_action || 'd', 'payment_submitted', v_new::text, p_reason);

  IF p_action = 'approve' AND v_inv.id IS NOT NULL THEN
    INSERT INTO public.payments(invoice_id, client_id, amount, method, notes, recorded_by)
    VALUES (v_inv.id, v_p.client_id, v_p.amount, v_p.method, 'Verified client payment', auth.uid());
    v_paid := COALESCE(v_inv.payment_amount,0) + v_p.amount;
    UPDATE public.invoices
       SET payment_amount = v_paid,
           status = CASE WHEN v_paid >= v_inv.amount THEN 'paid'::invoice_status ELSE 'partially_paid'::invoice_status END,
           payment_date = CASE WHEN v_paid >= v_inv.amount THEN now() ELSE payment_date END
     WHERE id = v_inv.id;
    IF v_paid >= v_inv.amount THEN
      UPDATE public.payment_reminders SET status = 'completed'
       WHERE order_id = v_p.order_id AND status = 'pending';
    END IF;
  END IF;

  SELECT user_id INTO v_client_user FROM public.clients WHERE id = v_p.client_id;
  IF v_client_user IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, message, reference_id)
    VALUES (v_client_user, 'payment',
            CASE p_action WHEN 'approve' THEN 'Payment completed' ELSE 'Payment rejected' END,
            CASE p_action WHEN 'approve' THEN 'Order ' || v_o.order_number || ' payment verified'
                          ELSE 'Order ' || v_o.order_number || ': ' || COALESCE(p_reason,'') END,
            v_p.order_id::text);
  END IF;
  IF v_o.employee_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, message, reference_id)
    VALUES (v_o.employee_id, 'payment',
            CASE p_action WHEN 'approve' THEN 'Payment completed' ELSE 'Payment rejected — follow up' END,
            'Order ' || v_o.order_number, v_p.order_id::text);
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, module, status, target_type, target_id, old_value, new_value, remarks)
  VALUES (auth.uid(), 'payment.' || p_action, 'payments', 'success', 'order', v_p.order_id::text,
          jsonb_build_object('status','submitted'),
          jsonb_build_object('status', CASE p_action WHEN 'approve' THEN 'verified' ELSE 'rejected' END,
                             'amount', v_p.amount, 'method', v_p.method, 'order_status', v_new::text), p_reason);
END;$function$;

-- 7. Reminder generator (idempotent, safe to run repeatedly) ---------------
CREATE OR REPLACE FUNCTION public.generate_payment_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_stage text; v_days int; v_created int := 0; v_admin uuid;
BEGIN
  FOR r IN
    SELECT i.id AS invoice_id, i.due_date, i.amount, i.payment_amount, i.invoice_number,
           o.id AS order_id, o.order_number, o.employee_id, o.client_id, o.status AS order_status,
           c.user_id AS client_user, COALESCE(c.credit_terms,0) AS credit_terms
      FROM public.invoices i
      JOIN public.orders o ON o.id = i.order_id
      JOIN public.clients c ON c.id = o.client_id
     WHERE i.status NOT IN ('paid','declined')
       AND o.status IN ('completed','payment_pending','payment_submitted')
  LOOP
    v_days := (r.due_date::date - CURRENT_DATE);

    IF v_days < 0 THEN v_stage := 'overdue';
    ELSIF v_days = 0 THEN v_stage := 'due_today';
    ELSIF v_days <= 3 THEN v_stage := 'due_soon';
    ELSE CONTINUE;
    END IF;

    IF r.order_status = 'payment_submitted' AND v_stage <> 'overdue' THEN CONTINUE; END IF;

    INSERT INTO public.payment_reminders(order_id, invoice_id, client_id, employee_id, amount_due, credit_terms, due_date, stage, notified_at)
    VALUES (r.order_id, r.invoice_id, r.client_id, r.employee_id,
            GREATEST(r.amount - COALESCE(r.payment_amount,0), 0), r.credit_terms, r.due_date, v_stage, now())
    ON CONFLICT (order_id, stage) DO NOTHING;

    IF NOT FOUND THEN CONTINUE; END IF;
    v_created := v_created + 1;

    IF v_stage = 'overdue' AND r.due_date < now() THEN
      UPDATE public.invoices SET status = 'overdue' WHERE id = r.invoice_id AND status = 'pending_payment';
    END IF;

    IF r.client_user IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, type, title, message, reference_id)
      VALUES (r.client_user, 'payment',
              CASE v_stage WHEN 'overdue' THEN 'Payment overdue'
                           WHEN 'due_today' THEN 'Payment due today'
                           ELSE 'Payment due soon' END,
              'Order ' || r.order_number || ' — ' || to_char(GREATEST(r.amount - COALESCE(r.payment_amount,0),0), 'FM999999990.00')
              || ' due ' || to_char(r.due_date, 'DD Mon YYYY'), r.order_id::text);
    END IF;

    IF r.employee_id IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, type, title, message, reference_id)
      VALUES (r.employee_id, 'payment',
              CASE v_stage WHEN 'overdue' THEN 'Payment overdue — follow up' ELSE 'Payment follow-up due' END,
              'Order ' || r.order_number || ' — collect payment from client', r.order_id::text);
    END IF;

    IF v_stage = 'overdue' THEN
      FOR v_admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
        INSERT INTO public.notifications(user_id, type, title, message, reference_id)
        VALUES (v_admin, 'payment', 'Payment overdue',
                'Order ' || r.order_number || ' payment is past its due date', r.order_id::text);
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_created;
END;$function$;

REVOKE ALL ON FUNCTION public.generate_payment_reminders() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_payment_reminders() TO service_role;