DROP POLICY IF EXISTS pp_client_insert ON storage.objects;
CREATE POLICY pp_client_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS pp_client_read ON storage.objects;
CREATE POLICY pp_client_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS pp_admin_read ON storage.objects;
CREATE POLICY pp_admin_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-proofs' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS pp_emp_read ON storage.objects;
CREATE POLICY pp_emp_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND EXISTS (
      SELECT 1 FROM public.order_payments op
      WHERE op.proof_path = storage.objects.name
        AND public.is_assigned_employee(op.client_id)
    )
  );