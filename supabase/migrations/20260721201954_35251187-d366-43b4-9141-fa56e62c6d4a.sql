
DROP POLICY IF EXISTS notif_insert_auth ON public.notifications;
CREATE POLICY notif_insert_self ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
