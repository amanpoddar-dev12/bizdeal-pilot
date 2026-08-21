CREATE TABLE public.employee_permissions (
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission text NOT NULL,
  granted_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, permission)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_permissions TO authenticated;
GRANT ALL ON public.employee_permissions TO service_role;

ALTER TABLE public.employee_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "emp_perms_admin_all" ON public.employee_permissions
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

CREATE POLICY "emp_perms_self_read" ON public.employee_permissions
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.has_employee_permission(_user_id uuid, _perm text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin')
      OR EXISTS (
        SELECT 1 FROM public.employee_permissions ep
        WHERE ep.employee_id = _user_id AND ep.permission = _perm
      );
$$;

-- Existing employees keep everything they can do today.
INSERT INTO public.employee_permissions (employee_id, permission)
SELECT ur.user_id, p.perm
FROM public.user_roles ur
CROSS JOIN (VALUES
  ('orders.view'),('orders.create'),('orders.edit'),('orders.delete'),
  ('orders.approve'),('invoices.view'),('payments.manage'),('clients.manage')
) AS p(perm)
WHERE ur.role = 'employee'
ON CONFLICT DO NOTHING;

-- ---------- RLS enforcement ----------
DROP POLICY IF EXISTS orders_emp_insert ON public.orders;
CREATE POLICY orders_emp_insert ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = (SELECT auth.uid())
    AND (SELECT public.has_role((SELECT auth.uid()), 'employee'))
    AND (SELECT public.has_employee_permission((SELECT auth.uid()), 'orders.create'))
    AND EXISTS (SELECT 1 FROM public.client_employees ce WHERE ce.client_id = orders.client_id AND ce.employee_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS oi_emp_write ON public.order_items;
CREATE POLICY oi_emp_write ON public.order_items
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.has_employee_permission((SELECT auth.uid()), 'orders.create'))
    AND order_id IN (SELECT o.id FROM public.orders o WHERE o.employee_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS clients_emp_update ON public.clients;
CREATE POLICY clients_emp_update ON public.clients
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'employee'))
    AND (SELECT public.has_employee_permission((SELECT auth.uid()), 'clients.manage'))
    AND EXISTS (SELECT 1 FROM public.client_employees ce WHERE ce.client_id = clients.id AND ce.employee_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    (SELECT public.has_role((SELECT auth.uid()), 'employee'))
    AND (SELECT public.has_employee_permission((SELECT auth.uid()), 'clients.manage'))
    AND EXISTS (SELECT 1 FROM public.client_employees ce WHERE ce.client_id = clients.id AND ce.employee_id = (SELECT auth.uid()))
  );

-- ---------- RPC enforcement ----------
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

  INSERT INTO public.client_employees (client_id, employee_id)
  VALUES (v_id, auth.uid())
  ON CONFLICT DO NOTHING;

  INSERT INTO public.audit_logs (actor_id, action, module, status, target_type, target_id, new_value)
  VALUES (auth.uid(), 'client_created', 'clients', 'success', 'client', v_id::text, p_values);

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.emp_update_order_meta(p_id uuid, p_notes text, p_delivery_date timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_employee_permission(auth.uid(), 'orders.edit') THEN
    RAISE EXCEPTION 'You do not have permission to edit orders';
  END IF;
  UPDATE public.orders o SET
    notes = COALESCE(p_notes, o.notes),
    delivery_date = COALESCE(p_delivery_date, o.delivery_date),
    updated_at = now()
   WHERE o.id = p_id
     AND o.employee_id = auth.uid()
     AND o.status NOT IN ('invoiced','paid','declined','cancelled');
  IF NOT FOUND THEN RAISE EXCEPTION 'Not permitted'; END IF;
END;$function$;

CREATE OR REPLACE FUNCTION public.submit_order_for_client(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_o public.orders; v_client_user uuid;
BEGIN
  SELECT * INTO v_o FROM public.orders WHERE id = p_id;
  IF v_o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT (public.has_role(auth.uid(), 'admin') OR v_o.employee_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  IF NOT public.has_employee_permission(auth.uid(), 'orders.approve') THEN
    RAISE EXCEPTION 'You do not have permission to submit orders for approval';
  END IF;
  IF v_o.status NOT IN ('pending','confirmed','change_requested','client_rejected') THEN
    RAISE EXCEPTION 'Order cannot be submitted from its current state';
  END IF;

  UPDATE public.orders SET status = 'pending_client', updated_at = now() WHERE id = p_id;

  INSERT INTO public.order_events(order_id, actor_id, event, from_status, to_status)
  VALUES (p_id, auth.uid(), 'submitted_for_approval', v_o.status::text, 'pending_client');

  SELECT user_id INTO v_client_user FROM public.clients WHERE id = v_o.client_id;
  IF v_client_user IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, message, reference_id)
    VALUES (v_client_user, 'order_approval', 'Order awaiting your approval',
            'Order ' || v_o.order_number || ' needs your review', p_id::text);
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, module, status, target_type, target_id, old_value, new_value)
  VALUES (auth.uid(), 'order.submitted_for_client', 'orders', 'success', 'order', p_id::text,
          jsonb_build_object('status', v_o.status), jsonb_build_object('status','pending_client'));
END;$function$;

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
  IF NOT public.has_employee_permission(auth.uid(), 'orders.approve') THEN
    RAISE EXCEPTION 'You do not have permission to dispatch orders';
  END IF;
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

CREATE OR REPLACE FUNCTION public.emp_regenerate_delivery_otp(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_o public.orders;
BEGIN
  SELECT * INTO v_o FROM public.orders WHERE id = p_order_id;
  IF v_o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR v_o.employee_id = auth.uid() OR public.is_assigned_employee(v_o.client_id)) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  IF NOT public.has_employee_permission(auth.uid(), 'orders.approve') THEN
    RAISE EXCEPTION 'You do not have permission to manage delivery';
  END IF;
  IF v_o.status <> 'out_for_delivery' THEN RAISE EXCEPTION 'Order is not out for delivery'; END IF;
  PERFORM public.issue_delivery_otp(p_order_id, true);
END;$function$;

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
  IF NOT public.has_employee_permission(auth.uid(), 'orders.approve') THEN
    RAISE EXCEPTION 'You do not have permission to verify deliveries';
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