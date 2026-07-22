
REVOKE ALL ON FUNCTION public.enforce_clients_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_orders_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_invoices_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_duty_sessions_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
