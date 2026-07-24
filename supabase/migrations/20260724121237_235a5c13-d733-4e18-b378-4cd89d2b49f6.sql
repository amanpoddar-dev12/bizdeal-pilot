
-- Allow any employee to view all clients so they can take orders.
CREATE POLICY "clients_emp_read_all" ON public.clients
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'employee'));

-- Relax order create/update for employees: allow any employee to punch orders for any client.
DROP POLICY IF EXISTS orders_emp_insert ON public.orders;
CREATE POLICY orders_emp_insert ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid() AND public.has_role(auth.uid(), 'employee'));

DROP POLICY IF EXISTS orders_emp_update ON public.orders;
CREATE POLICY orders_emp_update ON public.orders
  FOR UPDATE TO authenticated
  USING (employee_id = auth.uid())
  WITH CHECK (employee_id = auth.uid() AND public.has_role(auth.uid(), 'employee'));

-- Order items: employees can read items on any order they can now see (orders_emp_read still covers own orders).
-- Update oi_read to include admin, order owner (client/employee assigned), or any employee viewing their own order.
DROP POLICY IF EXISTS oi_read ON public.order_items;
CREATE POLICY oi_read ON public.order_items
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (
          o.employee_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = o.client_id AND c.user_id = auth.uid())
        )
    )
  );
