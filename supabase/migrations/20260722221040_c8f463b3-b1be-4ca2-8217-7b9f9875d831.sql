
-- Lock down SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.trg_refresh_credit_purse_clients() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_refresh_credit_purse() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_credit_purse(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM PUBLIC, anon;
-- has_role/current_user_role remain executable by authenticated because RLS policies reference them.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- Rewrite order_items read policy with explicit ownership checks
DROP POLICY IF EXISTS oi_read ON public.order_items;
CREATE POLICY oi_read ON public.order_items
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (
          o.employee_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.clients c
            WHERE c.id = o.client_id AND c.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.client_employees ce
            WHERE ce.client_id = o.client_id AND ce.employee_id = auth.uid()
          )
        )
    )
  );

-- Add WITH CHECK to orders employee update policy so employees can't reassign ownership
DROP POLICY IF EXISTS orders_emp_update ON public.orders;
CREATE POLICY orders_emp_update ON public.orders
  FOR UPDATE
  USING (employee_id = auth.uid())
  WITH CHECK (
    employee_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.client_employees ce
      WHERE ce.client_id = orders.client_id AND ce.employee_id = auth.uid()
    )
  );
