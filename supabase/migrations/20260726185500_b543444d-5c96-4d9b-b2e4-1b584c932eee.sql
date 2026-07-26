
-- Employees can insert new client records
CREATE POLICY "clients_emp_insert" ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'employee'));

-- Employees can update clients assigned to them (contact/business info only; the
-- enforce_clients_update trigger already prevents non-admins from touching
-- credit/KYC fields).
CREATE POLICY "clients_emp_update" ON public.clients
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'employee'))
  WITH CHECK (public.has_role(auth.uid(), 'employee'));
