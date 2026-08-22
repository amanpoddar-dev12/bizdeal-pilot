REVOKE EXECUTE ON FUNCTION public.refresh_credit_purse(uuid, text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_refresh_credit_purse() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_refresh_credit_purse_clients() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_refresh_credit_purse_orders() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_refresh_credit_purse_order_items() FROM anon, authenticated;