-- 1. History table
CREATE TABLE IF NOT EXISTS public.credit_purse_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  event text NOT NULL,
  source_table text,
  source_id text,
  actor_id uuid,
  credit_limit numeric NOT NULL DEFAULT 0,
  used_before numeric NOT NULL DEFAULT 0,
  used_after numeric NOT NULL DEFAULT 0,
  delta numeric NOT NULL DEFAULT 0,
  remaining_after numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.credit_purse_events TO authenticated;
GRANT ALL ON public.credit_purse_events TO service_role;
ALTER TABLE public.credit_purse_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cpe_admin_read" ON public.credit_purse_events FOR SELECT TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'));
CREATE POLICY "cpe_employee_read" ON public.credit_purse_events FOR SELECT TO authenticated
  USING (public.has_role((select auth.uid()), 'employee') AND public.is_assigned_employee(client_id));
CREATE POLICY "cpe_client_read" ON public.credit_purse_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = credit_purse_events.client_id AND c.user_id = (select auth.uid())));

CREATE INDEX IF NOT EXISTS idx_cpe_client_created ON public.credit_purse_events(client_id, created_at DESC);

-- 2. Single source of truth for utilisation
CREATE OR REPLACE FUNCTION public.refresh_credit_purse(_client_id uuid, _event text DEFAULT 'recalculated', _source_table text DEFAULT NULL, _source_id text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit NUMERIC; v_used NUMERIC; v_inv NUMERIC; v_ord NUMERIC; v_prev NUMERIC;
BEGIN
  SELECT credit_limit INTO v_limit FROM public.clients WHERE id = _client_id;
  IF v_limit IS NULL THEN RETURN; END IF;

  -- Outstanding on issued invoices
  SELECT COALESCE(SUM(GREATEST(amount - COALESCE(payment_amount,0), 0)), 0) INTO v_inv
    FROM public.invoices WHERE client_id = _client_id AND status NOT IN ('paid', 'declined');

  -- Live orders that have not been invoiced yet (credit already committed)
  SELECT COALESCE(SUM(o.total_amount), 0) INTO v_ord
    FROM public.orders o
   WHERE o.client_id = _client_id
     AND o.status NOT IN ('declined', 'client_rejected')
     AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.order_id = o.id);

  v_used := v_inv + v_ord;

  SELECT used_credit INTO v_prev FROM public.credit_purse WHERE client_id = _client_id;

  INSERT INTO public.credit_purse (client_id, credit_limit, used_credit, remaining_credit, utilization_percent, last_updated)
  VALUES (_client_id, v_limit, v_used, v_limit - v_used,
          CASE WHEN v_limit > 0 THEN LEAST(100, (v_used / v_limit) * 100) ELSE 0 END, now())
  ON CONFLICT (client_id) DO UPDATE SET
    credit_limit = EXCLUDED.credit_limit,
    used_credit = EXCLUDED.used_credit,
    remaining_credit = EXCLUDED.remaining_credit,
    utilization_percent = EXCLUDED.utilization_percent,
    last_updated = now();

  IF v_prev IS DISTINCT FROM v_used OR _event <> 'recalculated' THEN
    INSERT INTO public.credit_purse_events(client_id, event, source_table, source_id, actor_id,
      credit_limit, used_before, used_after, delta, remaining_after)
    VALUES (_client_id, _event, _source_table, _source_id, auth.uid(),
      v_limit, COALESCE(v_prev,0), v_used, v_used - COALESCE(v_prev,0), v_limit - v_used);
  END IF;
END; $function$;

-- 3. Triggers
CREATE OR REPLACE FUNCTION public.trg_refresh_credit_purse()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_event text; v_client uuid;
BEGIN
  v_client := COALESCE(NEW.client_id, OLD.client_id);
  v_event := TG_TABLE_NAME || '.' || lower(TG_OP);
  PERFORM public.refresh_credit_purse(v_client, v_event, TG_TABLE_NAME, COALESCE(NEW.id, OLD.id)::text);
  RETURN COALESCE(NEW, OLD);
END; $function$;

CREATE OR REPLACE FUNCTION public.trg_refresh_credit_purse_orders()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_event text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.total_amount IS NOT DISTINCT FROM OLD.total_amount THEN
      RETURN NEW;
    END IF;
    v_event := 'order.' || NEW.status::text;
  ELSIF TG_OP = 'INSERT' THEN
    v_event := 'order.created';
  ELSE
    v_event := 'order.deleted';
  END IF;
  PERFORM public.refresh_credit_purse(COALESCE(NEW.client_id, OLD.client_id), v_event, 'orders', COALESCE(NEW.id, OLD.id)::text);
  RETURN COALESCE(NEW, OLD);
END; $function$;

DROP TRIGGER IF EXISTS trg_orders_refresh_credit ON public.orders;
CREATE TRIGGER trg_orders_refresh_credit
AFTER INSERT OR UPDATE OR DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_credit_purse_orders();

DROP TRIGGER IF EXISTS trg_order_items_refresh_credit ON public.order_items;
CREATE OR REPLACE FUNCTION public.trg_refresh_credit_purse_order_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_client uuid;
BEGIN
  SELECT client_id INTO v_client FROM public.orders WHERE id = COALESCE(NEW.order_id, OLD.order_id);
  IF v_client IS NOT NULL THEN
    PERFORM public.refresh_credit_purse(v_client, 'order.items_changed', 'orders', COALESCE(NEW.order_id, OLD.order_id)::text);
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $function$;
CREATE TRIGGER trg_order_items_refresh_credit
AFTER INSERT OR UPDATE OR DELETE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_credit_purse_order_items();

DROP TRIGGER IF EXISTS trg_order_payments_refresh_credit ON public.order_payments;
CREATE TRIGGER trg_order_payments_refresh_credit
AFTER INSERT OR UPDATE OR DELETE ON public.order_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_credit_purse();

-- clients trigger: also react to credit_limit approval changes
DROP TRIGGER IF EXISTS refresh_credit_purse_on_clients ON public.clients;
CREATE OR REPLACE FUNCTION public.trg_refresh_credit_purse_clients()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.refresh_credit_purse(COALESCE(NEW.id, OLD.id), 'client.credit_limit_changed', 'clients', COALESCE(NEW.id, OLD.id)::text);
  RETURN COALESCE(NEW, OLD);
END; $function$;
CREATE TRIGGER refresh_credit_purse_on_clients
AFTER INSERT OR UPDATE OF credit_limit ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_credit_purse_clients();

-- 4. Backfill every existing client from live data (no historical rows removed)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.clients LOOP
    PERFORM public.refresh_credit_purse(r.id, 'backfill_recalculation', 'system', NULL);
  END LOOP;
END $$;