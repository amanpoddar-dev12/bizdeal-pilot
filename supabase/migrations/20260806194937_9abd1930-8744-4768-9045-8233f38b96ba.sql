
-- Helper: is the current user an employee assigned to this client?
CREATE OR REPLACE FUNCTION public.is_assigned_employee(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_employees ce
    WHERE ce.client_id = _client_id AND ce.employee_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.is_assigned_employee(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_assigned_employee(uuid) TO authenticated;

-- ORDER ITEMS: assignment-based read (not just orders punched by this employee)
DROP POLICY IF EXISTS oi_read ON public.order_items;
CREATE POLICY oi_read ON public.order_items FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND (
        o.employee_id = auth.uid()
        OR public.is_assigned_employee(o.client_id)
        OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = o.client_id AND c.user_id = auth.uid())
      )
  )
);

-- ORDER EVENTS
DROP POLICY IF EXISTS order_events_read ON public.order_events;
CREATE POLICY order_events_read ON public.order_events FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_events.order_id
      AND (
        public.has_role(auth.uid(), 'admin')
        OR o.employee_id = auth.uid()
        OR public.is_assigned_employee(o.client_id)
        OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = o.client_id AND c.user_id = auth.uid())
      )
  )
);

-- ORDER APPROVALS
DROP POLICY IF EXISTS order_approvals_read ON public.order_approvals;
CREATE POLICY order_approvals_read ON public.order_approvals FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_approvals.order_id
      AND (
        public.has_role(auth.uid(), 'admin')
        OR o.employee_id = auth.uid()
        OR public.is_assigned_employee(o.client_id)
        OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = o.client_id AND c.user_id = auth.uid())
      )
  )
);

-- PAYMENTS: assigned employees can read their clients' payment history
DROP POLICY IF EXISTS pay_emp_read ON public.payments;
CREATE POLICY pay_emp_read ON public.payments FOR SELECT TO authenticated
USING (public.is_assigned_employee(payments.client_id));

-- LEDGER ENTRIES
DROP POLICY IF EXISTS ledger_emp_read ON public.ledger_entries;
CREATE POLICY ledger_emp_read ON public.ledger_entries FOR SELECT TO authenticated
USING (public.is_assigned_employee(ledger_entries.client_id));

-- CREDIT PURSE
DROP POLICY IF EXISTS cp_emp_read ON public.credit_purse;
CREATE POLICY cp_emp_read ON public.credit_purse FOR SELECT TO authenticated
USING (public.is_assigned_employee(credit_purse.client_id));
