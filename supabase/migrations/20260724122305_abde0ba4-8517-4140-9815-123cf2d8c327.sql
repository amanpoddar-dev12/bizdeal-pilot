
DROP TRIGGER IF EXISTS trg_enforce_clients_update ON public.clients;
CREATE TRIGGER trg_enforce_clients_update BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.enforce_clients_update();

DROP TRIGGER IF EXISTS trg_enforce_orders_update ON public.orders;
CREATE TRIGGER trg_enforce_orders_update BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_orders_update();

DROP TRIGGER IF EXISTS trg_enforce_invoices_update ON public.invoices;
CREATE TRIGGER trg_enforce_invoices_update BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invoices_update();

DROP TRIGGER IF EXISTS trg_enforce_duty_sessions_write ON public.duty_sessions;
CREATE TRIGGER trg_enforce_duty_sessions_write BEFORE INSERT OR UPDATE ON public.duty_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_duty_sessions_write();

REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM PUBLIC, anon, authenticated;
