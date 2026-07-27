
-- Revoke anon EXECUTE from user-facing SECURITY DEFINER RPCs (authenticated only)
REVOKE EXECUTE ON FUNCTION public.client_cancel_order(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.client_respond_invoice(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.duty_clock_in() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.duty_clock_out() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.emp_update_order_meta(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_cancel_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_respond_invoice(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duty_clock_in() TO authenticated;
GRANT EXECUTE ON FUNCTION public.duty_clock_out() TO authenticated;
GRANT EXECUTE ON FUNCTION public.emp_update_order_meta(uuid, text, timestamptz) TO authenticated;

-- Attach column-level enforcement triggers (drop-if-exists for idempotency)
DROP TRIGGER IF EXISTS trg_enforce_clients_update ON public.clients;
CREATE TRIGGER trg_enforce_clients_update
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.enforce_clients_update();

DROP TRIGGER IF EXISTS trg_enforce_orders_update ON public.orders;
CREATE TRIGGER trg_enforce_orders_update
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_orders_update();

DROP TRIGGER IF EXISTS trg_enforce_invoices_update ON public.invoices;
CREATE TRIGGER trg_enforce_invoices_update
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invoices_update();

DROP TRIGGER IF EXISTS trg_enforce_duty_sessions_write ON public.duty_sessions;
CREATE TRIGGER trg_enforce_duty_sessions_write
  BEFORE INSERT OR UPDATE ON public.duty_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_duty_sessions_write();
