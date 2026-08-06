-- Employees may only read clients assigned to them.
DROP POLICY IF EXISTS clients_emp_read_all ON public.clients;

-- Employees may only create orders for clients assigned to them.
DROP POLICY IF EXISTS orders_emp_insert ON public.orders;
CREATE POLICY orders_emp_insert ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = auth.uid()
    AND public.has_role(auth.uid(), 'employee')
    AND EXISTS (
      SELECT 1 FROM public.client_employees ce
      WHERE ce.client_id = orders.client_id AND ce.employee_id = auth.uid()
    )
  );

-- Only admins may assign/unassign clients to employees (ce_admin_all already
-- covers writes; ensure no other write path exists).
DROP POLICY IF EXISTS ce_emp_write ON public.client_employees;