
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS module text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS remarks text,
  ADD COLUMN IF NOT EXISTS user_agent text;

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs (actor_id);

-- Immutability: block updates and deletes on audit_logs for everyone (incl. admins).
CREATE OR REPLACE FUNCTION public.audit_logs_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_no_update
  BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_immutable();

DROP TRIGGER IF EXISTS trg_audit_logs_no_delete ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_no_delete
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_immutable();
