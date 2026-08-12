-- ============ INDEXES ============
CREATE INDEX IF NOT EXISTS idx_orders_client_created ON public.orders (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_employee_created ON public.orders (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON public.orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items (order_id);

CREATE INDEX IF NOT EXISTS idx_invoices_client_date ON public.invoices (client_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_order ON public.invoices (order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status_due ON public.invoices (status, due_date);

CREATE INDEX IF NOT EXISTS idx_payments_client_date ON public.payments (client_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON public.payments (invoice_id);

CREATE INDEX IF NOT EXISTS idx_order_payments_client ON public.order_payments (client_id);
CREATE INDEX IF NOT EXISTS idx_order_payments_status_submitted ON public.order_payments (status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_otps_order_active ON public.delivery_otps (order_id, created_at DESC) WHERE active;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications (user_id) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notification_logs_user ON public.notification_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_client_date ON public.ledger_entries (client_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_client_employees_employee ON public.client_employees (employee_id);

CREATE INDEX IF NOT EXISTS idx_clients_user ON public.clients (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clients_active_name ON public.clients (active, business_name);

CREATE INDEX IF NOT EXISTS idx_products_active_name ON public.products (active, name);

CREATE INDEX IF NOT EXISTS idx_tasks_employee_status ON public.tasks (employee_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON public.task_attachments (task_id);

CREATE INDEX IF NOT EXISTS idx_duty_employee_in ON public.duty_sessions (employee_id, clock_in_time DESC);
CREATE INDEX IF NOT EXISTS idx_duty_open ON public.duty_sessions (employee_id) WHERE clock_out_time IS NULL;

CREATE INDEX IF NOT EXISTS idx_audit_module_created ON public.audit_logs (module, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target ON public.audit_logs (target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_employee_profiles_manager ON public.employee_profiles (reporting_manager_id);

-- duplicate index on employee_locations
DROP INDEX IF EXISTS public.employee_locations_emp_time_idx;

-- ============ RLS: identical predicates, evaluated once per query ============
ALTER POLICY audit_insert_auth ON public.audit_logs
  WITH CHECK ((actor_id = (SELECT auth.uid())) OR (SELECT public.has_role((SELECT auth.uid()), 'admin')));
ALTER POLICY audit_admin_read ON public.audit_logs
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

ALTER POLICY ce_admin_all ON public.client_employees
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
ALTER POLICY ce_emp_read ON public.client_employees
  USING (employee_id = (SELECT auth.uid()));

ALTER POLICY clients_admin_all ON public.clients
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
ALTER POLICY clients_own_read ON public.clients
  USING (user_id = (SELECT auth.uid()));
ALTER POLICY clients_emp_read ON public.clients
  USING (EXISTS (SELECT 1 FROM public.client_employees ce
                  WHERE ce.client_id = clients.id AND ce.employee_id = (SELECT auth.uid())));
ALTER POLICY clients_emp_update ON public.clients
  USING ((SELECT public.has_role((SELECT auth.uid()), 'employee'))
         AND EXISTS (SELECT 1 FROM public.client_employees ce
                      WHERE ce.client_id = clients.id AND ce.employee_id = (SELECT auth.uid())))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'employee'))
         AND EXISTS (SELECT 1 FROM public.client_employees ce
                      WHERE ce.client_id = clients.id AND ce.employee_id = (SELECT auth.uid())));

ALTER POLICY cp_admin_all ON public.credit_purse
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
ALTER POLICY cp_client_read ON public.credit_purse
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

ALTER POLICY otp_client_read ON public.delivery_otps
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = delivery_otps.client_id AND c.user_id = (SELECT auth.uid())));
ALTER POLICY otp_admin_read ON public.delivery_otps
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

ALTER POLICY duty_own_select ON public.duty_sessions
  USING (employee_id = (SELECT auth.uid()));
ALTER POLICY duty_admin_all ON public.duty_sessions
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

ALTER POLICY loc_admin_all ON public.employee_locations
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
ALTER POLICY loc_own ON public.employee_locations
  USING (employee_id = (SELECT auth.uid()))
  WITH CHECK (employee_id = (SELECT auth.uid()));

ALTER POLICY emp_self_read ON public.employee_profiles
  USING (id = (SELECT auth.uid()));
ALTER POLICY emp_admin_all ON public.employee_profiles
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

ALTER POLICY inv_admin_all ON public.invoices
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
ALTER POLICY inv_client_read ON public.invoices
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));
ALTER POLICY inv_emp_read ON public.invoices
  USING (EXISTS (SELECT 1 FROM public.client_employees ce
                  WHERE ce.client_id = invoices.client_id AND ce.employee_id = (SELECT auth.uid())));

ALTER POLICY ledger_admin_all ON public.ledger_entries
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
ALTER POLICY ledger_client_read ON public.ledger_entries
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

ALTER POLICY nl_admin_all ON public.notification_logs
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

ALTER POLICY notif_own ON public.notifications
  USING (user_id = (SELECT auth.uid()));
ALTER POLICY notif_own_update ON public.notifications
  USING (user_id = (SELECT auth.uid()));
ALTER POLICY notif_insert_self ON public.notifications
  WITH CHECK ((user_id = (SELECT auth.uid())) OR (SELECT public.has_role((SELECT auth.uid()), 'admin')));
ALTER POLICY notif_admin_all ON public.notifications
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

ALTER POLICY order_approvals_read ON public.order_approvals
  USING (EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.id = order_approvals.order_id
       AND ((SELECT public.has_role((SELECT auth.uid()), 'admin'))
            OR o.employee_id = (SELECT auth.uid())
            OR public.is_assigned_employee(o.client_id)
            OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = o.client_id AND c.user_id = (SELECT auth.uid())))));

ALTER POLICY order_events_read ON public.order_events
  USING (EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.id = order_events.order_id
       AND ((SELECT public.has_role((SELECT auth.uid()), 'admin'))
            OR o.employee_id = (SELECT auth.uid())
            OR public.is_assigned_employee(o.client_id)
            OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = o.client_id AND c.user_id = (SELECT auth.uid())))));

ALTER POLICY oi_read ON public.order_items
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'))
         OR EXISTS (
           SELECT 1 FROM public.orders o
            WHERE o.id = order_items.order_id
              AND (o.employee_id = (SELECT auth.uid())
                   OR public.is_assigned_employee(o.client_id)
                   OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = o.client_id AND c.user_id = (SELECT auth.uid())))));
ALTER POLICY oi_emp_write ON public.order_items
  WITH CHECK (order_id IN (SELECT o.id FROM public.orders o WHERE o.employee_id = (SELECT auth.uid())));
ALTER POLICY oi_admin_all ON public.order_items
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

ALTER POLICY op_client_read ON public.order_payments
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = order_payments.client_id AND c.user_id = (SELECT auth.uid())));
ALTER POLICY op_admin_all ON public.order_payments
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

ALTER POLICY orders_admin_all ON public.orders
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
ALTER POLICY orders_client_read ON public.orders
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));
ALTER POLICY orders_emp_read ON public.orders
  USING (employee_id = (SELECT auth.uid())
         OR EXISTS (SELECT 1 FROM public.client_employees ce
                     WHERE ce.client_id = orders.client_id AND ce.employee_id = (SELECT auth.uid())));
ALTER POLICY orders_emp_insert ON public.orders
  WITH CHECK (employee_id = (SELECT auth.uid())
              AND (SELECT public.has_role((SELECT auth.uid()), 'employee'))
              AND EXISTS (SELECT 1 FROM public.client_employees ce
                           WHERE ce.client_id = orders.client_id AND ce.employee_id = (SELECT auth.uid())));

ALTER POLICY pay_admin_all ON public.payments
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
ALTER POLICY pay_client_read ON public.payments
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

ALTER POLICY products_admin_update ON public.products
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
ALTER POLICY products_admin_delete ON public.products
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
ALTER POLICY products_admin_insert ON public.products
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

ALTER POLICY profiles_admin_insert ON public.profiles
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR id = (SELECT auth.uid()));
ALTER POLICY profiles_admin_read ON public.profiles
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
ALTER POLICY profiles_self_read ON public.profiles
  USING (id = (SELECT auth.uid()));
ALTER POLICY profiles_admin_update ON public.profiles
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
ALTER POLICY profiles_self_update ON public.profiles
  USING (id = (SELECT auth.uid()));

ALTER POLICY ta_own ON public.task_attachments
  USING (task_id IN (SELECT t.id FROM public.tasks t WHERE t.employee_id = (SELECT auth.uid())))
  WITH CHECK (task_id IN (SELECT t.id FROM public.tasks t WHERE t.employee_id = (SELECT auth.uid())));
ALTER POLICY ta_admin_all ON public.task_attachments
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
