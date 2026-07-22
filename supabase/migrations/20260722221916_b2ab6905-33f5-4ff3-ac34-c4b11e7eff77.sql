
-- 1) signup_role_escalation: always assign 'client' on self-signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  -- Self-signup is always 'client'. Admin/employee roles are granted only by an admin.
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'client') ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

-- 2) clients_self_update: restrict which columns a non-admin owner may change
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

  -- Non-admins may only edit contact/business info on their own row.
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

DROP TRIGGER IF EXISTS trg_enforce_clients_update ON public.clients;
CREATE TRIGGER trg_enforce_clients_update
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.enforce_clients_update();

-- 3) orders_invoices_writes: gate column changes for non-admins
CREATE OR REPLACE FUNCTION public.enforce_orders_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  -- Nobody but admin can change money, assignment, or identity fields.
  IF NEW.total_amount IS DISTINCT FROM OLD.total_amount
     OR NEW.client_id  IS DISTINCT FROM OLD.client_id
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.order_number IS DISTINCT FROM OLD.order_number THEN
    RAISE EXCEPTION 'Not allowed to modify protected order fields';
  END IF;

  IF is_client_owner AND NOT is_assigned_employee THEN
    -- Client can only cancel a pending order; nothing else.
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'pending' AND NEW.status = 'cancelled') THEN
      RAISE EXCEPTION 'Clients may only cancel pending orders';
    END IF;
    IF NEW.delivery_date IS DISTINCT FROM OLD.delivery_date
       OR NEW.notes IS DISTINCT FROM OLD.notes THEN
      RAISE EXCEPTION 'Clients may not edit order details';
    END IF;
    RETURN NEW;
  END IF;

  IF is_assigned_employee THEN
    -- Employees may only tweak notes/delivery_date on their own non-invoiced orders.
    IF OLD.status IN ('invoiced', 'paid', 'cancelled') THEN
      RAISE EXCEPTION 'Order is locked';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status NOT IN ('pending', 'confirmed') THEN
      RAISE EXCEPTION 'Employees may not transition to this status';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Not allowed';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_orders_update ON public.orders;
CREATE TRIGGER trg_enforce_orders_update
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_orders_update();

CREATE OR REPLACE FUNCTION public.enforce_invoices_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  is_admin boolean := public.has_role(auth.uid(), 'admin');
BEGIN
  IF is_admin THEN
    RETURN NEW;
  END IF;

  -- Non-admins may never change money or identity fields on an invoice.
  IF NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.payment_amount IS DISTINCT FROM OLD.payment_amount
     OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
     OR NEW.penalty_amount IS DISTINCT FROM OLD.penalty_amount
     OR NEW.due_date IS DISTINCT FROM OLD.due_date
     OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
     OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.order_id  IS DISTINCT FROM OLD.order_id
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Not allowed to modify protected invoice fields';
  END IF;

  -- Clients may only accept or decline an invoice that is awaiting response.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status NOT IN ('sent') THEN
      RAISE EXCEPTION 'Invoice status is locked';
    END IF;
    IF NEW.status NOT IN ('approved', 'declined') THEN
      RAISE EXCEPTION 'Clients may only accept or decline invoices';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_invoices_update ON public.invoices;
CREATE TRIGGER trg_enforce_invoices_update
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invoices_update();

-- 4) duty_sessions_fabrication: force server-time semantics for non-admins
DROP POLICY IF EXISTS duty_own ON public.duty_sessions;

CREATE POLICY duty_own_select ON public.duty_sessions
  FOR SELECT TO authenticated
  USING (employee_id = auth.uid());

CREATE POLICY duty_own_insert ON public.duty_sessions
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid());

CREATE POLICY duty_own_update ON public.duty_sessions
  FOR UPDATE TO authenticated
  USING (employee_id = auth.uid() AND clock_out_time IS NULL)
  WITH CHECK (employee_id = auth.uid());

CREATE OR REPLACE FUNCTION public.enforce_duty_sessions_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Force server clock and open state; ignore any client-supplied values.
    NEW.clock_in_time := now();
    NEW.clock_out_time := NULL;
    NEW.duration_minutes := NULL;
    NEW.employee_id := auth.uid();
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Only closing an open session is allowed; nothing else may change.
    IF OLD.clock_out_time IS NOT NULL THEN
      RAISE EXCEPTION 'Session already closed';
    END IF;
    IF NEW.employee_id IS DISTINCT FROM OLD.employee_id
       OR NEW.clock_in_time IS DISTINCT FROM OLD.clock_in_time
       OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Not allowed to modify protected duty fields';
    END IF;
    IF NEW.clock_out_time IS NULL THEN
      RAISE EXCEPTION 'clock_out_time required';
    END IF;
    -- Force server clock; ignore backdated client values.
    NEW.clock_out_time := now();
    NEW.duration_minutes := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NEW.clock_out_time - OLD.clock_in_time)) / 60)::int);
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_duty_sessions_write ON public.duty_sessions;
CREATE TRIGGER trg_enforce_duty_sessions_write
  BEFORE INSERT OR UPDATE ON public.duty_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_duty_sessions_write();
