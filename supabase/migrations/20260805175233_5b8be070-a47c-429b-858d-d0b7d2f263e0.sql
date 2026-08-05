-- Timeline events
CREATE TABLE public.order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id),
  event text NOT NULL,
  from_status text,
  to_status text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.order_events TO authenticated;
GRANT ALL ON public.order_events TO service_role;
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_events_read" ON public.order_events FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id = order_events.order_id AND (
    public.has_role(auth.uid(), 'admin')
    OR o.employee_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = o.client_id AND c.user_id = auth.uid())
  )
));

-- Approval records
CREATE TABLE public.order_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id),
  action text NOT NULL,
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.order_approvals TO authenticated;
GRANT ALL ON public.order_approvals TO service_role;
ALTER TABLE public.order_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_approvals_read" ON public.order_approvals FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id = order_approvals.order_id AND (
    public.has_role(auth.uid(), 'admin')
    OR o.employee_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = o.client_id AND c.user_id = auth.uid())
  )
));

CREATE INDEX idx_order_events_order ON public.order_events(order_id, created_at DESC);
CREATE INDEX idx_order_approvals_order ON public.order_approvals(order_id, created_at DESC);

-- Allow the new transitions in the column guard trigger
CREATE OR REPLACE FUNCTION public.enforce_orders_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_admin boolean := public.has_role(auth.uid(), 'admin');
  is_client_owner boolean := EXISTS (
    SELECT 1 FROM public.clients c WHERE c.id = NEW.client_id AND c.user_id = auth.uid()
  );
  is_assigned_employee boolean := (OLD.employee_id = auth.uid());
BEGIN
  IF is_admin THEN
    RETURN NEW;
  END IF;

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
    IF NEW.delivery_date IS DISTINCT FROM OLD.delivery_date
       OR NEW.notes IS DISTINCT FROM OLD.notes THEN
      RAISE EXCEPTION 'Clients may not edit order details';
    END IF;
    RETURN NEW;
  END IF;

  IF is_assigned_employee THEN
    IF OLD.status IN ('invoiced', 'paid', 'client_approved') THEN
      RAISE EXCEPTION 'Order is locked';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status NOT IN ('pending', 'confirmed', 'pending_client') THEN
      RAISE EXCEPTION 'Employees may not transition to this status';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Not allowed';
END;
$function$;

-- Employee submits an order to its client for approval
CREATE OR REPLACE FUNCTION public.submit_order_for_client(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_o public.orders; v_client_user uuid;
BEGIN
  SELECT * INTO v_o FROM public.orders WHERE id = p_id;
  IF v_o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT (public.has_role(auth.uid(), 'admin') OR v_o.employee_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted';
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
END;$$;

-- Client approves or rejects
CREATE OR REPLACE FUNCTION public.client_review_order(p_id uuid, p_action text, p_checklist jsonb DEFAULT '{}'::jsonb, p_remarks text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  UPDATE public.orders SET status = v_status, updated_at = now() WHERE id = p_id;

  INSERT INTO public.order_approvals(order_id, actor_id, action, checklist, remarks)
  VALUES (p_id, auth.uid(), p_action, COALESCE(p_checklist,'{}'::jsonb), p_remarks);

  INSERT INTO public.order_events(order_id, actor_id, event, from_status, to_status, note)
  VALUES (p_id, auth.uid(), 'client_' || p_action, 'pending_client', v_status::text, p_remarks);

  IF v_o.employee_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, message, reference_id)
    VALUES (v_o.employee_id, 'order_approval',
            CASE p_action WHEN 'approve' THEN 'Order approved by client' ELSE 'Order rejected by client' END,
            'Order ' || v_o.order_number, p_id::text);
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, module, status, target_type, target_id, old_value, new_value, remarks)
  VALUES (auth.uid(), 'order.client_' || p_action, 'orders', 'success', 'order', p_id::text,
          jsonb_build_object('status','pending_client'),
          jsonb_build_object('status', v_status::text, 'checklist', COALESCE(p_checklist,'{}'::jsonb)), p_remarks);
END;$$;

REVOKE EXECUTE ON FUNCTION public.submit_order_for_client(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.client_review_order(uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_order_for_client(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_review_order(uuid, text, jsonb, text) TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.order_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_approvals;