
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin', 'employee', 'client');
CREATE TYPE public.order_status AS ENUM ('pending', 'confirmed', 'declined', 'change_requested', 'invoiced', 'paid');
CREATE TYPE public.invoice_status AS ENUM ('sent', 'approved', 'declined', 'pending_payment', 'overdue', 'paid', 'partially_paid');
CREATE TYPE public.task_status AS ENUM ('todo', 'in_progress', 'completed');
CREATE TYPE public.ledger_type AS ENUM ('order', 'invoice', 'payment', 'penalty', 'adjustment');
CREATE TYPE public.notification_channel AS ENUM ('whatsapp', 'email', 'sms', 'in_app');

-- ============ updated_at helper ============
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT,
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid()
  ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'employee' THEN 2 WHEN 'client' THEN 3 END LIMIT 1;
$$;

-- Profile policies
CREATE POLICY profiles_self_read ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY profiles_admin_read ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY profiles_admin_update ON public.profiles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY profiles_admin_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR id = auth.uid());

-- user_roles policies
CREATE POLICY user_roles_self_read ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY user_roles_admin_all ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ EMPLOYEE PROFILES ============
CREATE TABLE public.employee_profiles (
  id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  reporting_manager_id UUID REFERENCES public.profiles(id),
  territory TEXT,
  order_limit INTEGER NOT NULL DEFAULT 100,
  max_order_value NUMERIC(12,2) NOT NULL DEFAULT 100000,
  base_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission_rate NUMERIC(5,4) NOT NULL DEFAULT 0.02,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_profiles TO authenticated;
GRANT ALL ON public.employee_profiles TO service_role;
ALTER TABLE public.employee_profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_emp_updated BEFORE UPDATE ON public.employee_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY emp_self_read ON public.employee_profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY emp_admin_all ON public.employee_profiles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ CLIENTS ============
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  business_name TEXT NOT NULL,
  business_type TEXT,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  gst_number TEXT,
  pan TEXT,
  address TEXT,
  bank_account TEXT,
  credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
  credit_terms INTEGER NOT NULL DEFAULT 30,
  penalty_rate_per_day NUMERIC(6,4) NOT NULL DEFAULT 0.005,
  kyc_verified BOOLEAN NOT NULL DEFAULT FALSE,
  kyc_documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Assignment junction
CREATE TABLE public.client_employees (
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, employee_id)
);
GRANT SELECT, INSERT, DELETE ON public.client_employees TO authenticated;
GRANT ALL ON public.client_employees TO service_role;
ALTER TABLE public.client_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY ce_admin_all ON public.client_employees FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY ce_emp_read ON public.client_employees FOR SELECT TO authenticated USING (employee_id = auth.uid());

CREATE POLICY clients_admin_all ON public.clients FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY clients_own_read ON public.clients FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY clients_own_update ON public.clients FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY clients_emp_read ON public.clients FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.client_employees ce WHERE ce.client_id = clients.id AND ce.employee_id = auth.uid())
);

-- ============ ORDERS ============
CREATE SEQUENCE public.orders_seq START 1000;
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT UNIQUE NOT NULL DEFAULT ('ORD-' || nextval('public.orders_seq')::text),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  order_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_date TIMESTAMPTZ,
  status public.order_status NOT NULL DEFAULT 'pending',
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  change_request JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY orders_admin_all ON public.orders FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY orders_client_read ON public.orders FOR SELECT TO authenticated USING (
  client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid())
);
CREATE POLICY orders_client_update ON public.orders FOR UPDATE TO authenticated USING (
  client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid())
);
CREATE POLICY orders_emp_read ON public.orders FOR SELECT TO authenticated USING (
  employee_id = auth.uid() OR EXISTS (SELECT 1 FROM public.client_employees ce WHERE ce.client_id = orders.client_id AND ce.employee_id = auth.uid())
);
CREATE POLICY orders_emp_insert ON public.orders FOR INSERT TO authenticated WITH CHECK (
  employee_id = auth.uid() AND EXISTS (SELECT 1 FROM public.client_employees ce WHERE ce.client_id = orders.client_id AND ce.employee_id = auth.uid())
);
CREATE POLICY orders_emp_update ON public.orders FOR UPDATE TO authenticated USING (employee_id = auth.uid());

-- ============ ORDER ITEMS ============
CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  product_code TEXT,
  quantity NUMERIC(12,2) NOT NULL,
  rate NUMERIC(12,2) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY oi_admin_all ON public.order_items FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY oi_read ON public.order_items FOR SELECT TO authenticated USING (
  order_id IN (SELECT id FROM public.orders)
);
CREATE POLICY oi_emp_write ON public.order_items FOR INSERT TO authenticated WITH CHECK (
  order_id IN (SELECT id FROM public.orders WHERE employee_id = auth.uid())
);

-- ============ INVOICES ============
CREATE SEQUENCE public.invoices_seq START 1000;
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT UNIQUE NOT NULL DEFAULT ('INV-' || nextval('public.invoices_seq')::text),
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  invoice_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date TIMESTAMPTZ NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  status public.invoice_status NOT NULL DEFAULT 'sent',
  payment_date TIMESTAMPTZ,
  payment_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  penalty_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_inv_updated BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY inv_admin_all ON public.invoices FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY inv_client_read ON public.invoices FOR SELECT TO authenticated USING (
  client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid())
);
CREATE POLICY inv_client_update ON public.invoices FOR UPDATE TO authenticated USING (
  client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid())
);
CREATE POLICY inv_emp_read ON public.invoices FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.client_employees ce WHERE ce.client_id = invoices.client_id AND ce.employee_id = auth.uid())
);

-- ============ PAYMENTS ============
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  payment_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  method TEXT,
  notes TEXT,
  recorded_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY pay_admin_all ON public.payments FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY pay_client_read ON public.payments FOR SELECT TO authenticated USING (
  client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid())
);

-- ============ LEDGER ============
CREATE TABLE public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  type public.ledger_type NOT NULL,
  reference_id TEXT,
  amount NUMERIC(12,2) NOT NULL,
  running_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  entry_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ledger_entries TO authenticated;
GRANT ALL ON public.ledger_entries TO service_role;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY ledger_admin_all ON public.ledger_entries FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY ledger_client_read ON public.ledger_entries FOR SELECT TO authenticated USING (
  client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid())
);

-- ============ CREDIT PURSE ============
CREATE TABLE public.credit_purse (
  client_id UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
  used_credit NUMERIC(12,2) NOT NULL DEFAULT 0,
  remaining_credit NUMERIC(12,2) NOT NULL DEFAULT 0,
  utilization_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.credit_purse TO authenticated;
GRANT ALL ON public.credit_purse TO service_role;
ALTER TABLE public.credit_purse ENABLE ROW LEVEL SECURITY;
CREATE POLICY cp_admin_all ON public.credit_purse FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY cp_client_read ON public.credit_purse FOR SELECT TO authenticated USING (
  client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid())
);

CREATE OR REPLACE FUNCTION public.refresh_credit_purse(_client_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit NUMERIC; v_used NUMERIC;
BEGIN
  SELECT credit_limit INTO v_limit FROM public.clients WHERE id = _client_id;
  IF v_limit IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(amount - payment_amount), 0) INTO v_used
    FROM public.invoices WHERE client_id = _client_id AND status NOT IN ('paid', 'declined');
  INSERT INTO public.credit_purse (client_id, credit_limit, used_credit, remaining_credit, utilization_percent, last_updated)
  VALUES (_client_id, v_limit, v_used, v_limit - v_used, CASE WHEN v_limit > 0 THEN LEAST(100, (v_used / v_limit) * 100) ELSE 0 END, now())
  ON CONFLICT (client_id) DO UPDATE SET
    credit_limit = EXCLUDED.credit_limit,
    used_credit = EXCLUDED.used_credit,
    remaining_credit = EXCLUDED.remaining_credit,
    utilization_percent = EXCLUDED.utilization_percent,
    last_updated = now();
END; $$;

CREATE OR REPLACE FUNCTION public.trg_refresh_credit_purse()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.refresh_credit_purse(COALESCE(NEW.client_id, OLD.client_id));
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE TRIGGER trg_inv_refresh_credit AFTER INSERT OR UPDATE OR DELETE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_credit_purse();
CREATE TRIGGER trg_pay_refresh_credit AFTER INSERT OR UPDATE OR DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_credit_purse();
CREATE TRIGGER trg_client_refresh_credit AFTER INSERT OR UPDATE OF credit_limit ON public.clients FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_credit_purse();

-- ============ TASKS ============
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id),
  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ,
  status public.task_status NOT NULL DEFAULT 'todo',
  assigned_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_date TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY tasks_admin_all ON public.tasks FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY tasks_own_read ON public.tasks FOR SELECT TO authenticated USING (employee_id = auth.uid());
CREATE POLICY tasks_own_update ON public.tasks FOR UPDATE TO authenticated USING (employee_id = auth.uid());

CREATE TABLE public.task_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  filename TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.task_attachments TO authenticated;
GRANT ALL ON public.task_attachments TO service_role;
ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY ta_admin_all ON public.task_attachments FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY ta_own ON public.task_attachments FOR ALL TO authenticated USING (
  task_id IN (SELECT id FROM public.tasks WHERE employee_id = auth.uid())
) WITH CHECK (task_id IN (SELECT id FROM public.tasks WHERE employee_id = auth.uid()));

-- ============ DUTY SESSIONS ============
CREATE TABLE public.duty_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  clock_in_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  clock_out_time TIMESTAMPTZ,
  duration_minutes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.duty_sessions TO authenticated;
GRANT ALL ON public.duty_sessions TO service_role;
ALTER TABLE public.duty_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY duty_admin_all ON public.duty_sessions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY duty_own ON public.duty_sessions FOR ALL TO authenticated USING (employee_id = auth.uid()) WITH CHECK (employee_id = auth.uid());

-- ============ EMPLOYEE LOCATIONS ============
CREATE TABLE public.employee_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  latitude NUMERIC(10,7) NOT NULL,
  longitude NUMERIC(11,7) NOT NULL,
  accuracy_meters INTEGER,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.employee_locations TO authenticated;
GRANT ALL ON public.employee_locations TO service_role;
ALTER TABLE public.employee_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY loc_admin_all ON public.employee_locations FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY loc_own ON public.employee_locations FOR ALL TO authenticated USING (employee_id = auth.uid()) WITH CHECK (employee_id = auth.uid());

-- ============ NOTIFICATIONS ============
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  reference_id TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notif_admin_all ON public.notifications FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY notif_own ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY notif_own_update ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY notif_insert_auth ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);

CREATE TABLE public.notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  channel public.notification_channel NOT NULL,
  message TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.notification_logs TO authenticated;
GRANT ALL ON public.notification_logs TO service_role;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY nl_admin_all ON public.notification_logs FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ AUDIT LOGS ============
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.profiles(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  old_value JSONB,
  new_value JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_admin_read ON public.audit_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY audit_insert_auth ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- ============ HANDLE NEW USER ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'client') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ REALTIME ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices;
