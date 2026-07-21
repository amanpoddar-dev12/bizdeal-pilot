CREATE OR REPLACE FUNCTION public.trg_refresh_credit_purse_clients()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.refresh_credit_purse(COALESCE(NEW.id, OLD.id));
  RETURN COALESCE(NEW, OLD);
END; $$;

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tgname, c.relname
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'clients'
      AND NOT tg.tgisinternal
      AND tg.tgfoid = 'public.trg_refresh_credit_purse'::regproc
  LOOP
    EXECUTE format('DROP TRIGGER %I ON public.clients', t.tgname);
  END LOOP;
END $$;

CREATE TRIGGER refresh_credit_purse_on_clients
AFTER INSERT OR UPDATE OF credit_limit ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_credit_purse_clients();