CREATE TYPE public.field_visit_status AS ENUM ('pending','assigned','completed','cancelled','overdue');
CREATE TYPE public.field_visit_priority AS ENUM ('low','medium','high','urgent');

CREATE TABLE public.field_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  prospect_name text,
  visit_date date NOT NULL,
  visit_time time,
  location text,
  purpose text NOT NULL,
  instructions text,
  priority public.field_visit_priority NOT NULL DEFAULT 'medium',
  status public.field_visit_status NOT NULL DEFAULT 'pending',
  completion_notes text,
  completed_at timestamptz,
  cancelled_reason text,
  cancelled_at timestamptz,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_visits_target_present CHECK (client_id IS NOT NULL OR NULLIF(trim(coalesce(prospect_name,'')),'') IS NOT NULL)
);

CREATE INDEX idx_field_visits_employee ON public.field_visits(employee_id, visit_date DESC);
CREATE INDEX idx_field_visits_status ON public.field_visits(status, visit_date);
CREATE INDEX idx_field_visits_client ON public.field_visits(client_id);
CREATE UNIQUE INDEX uq_field_visits_active_dedupe ON public.field_visits(
  employee_id, visit_date, lower(trim(purpose)), coalesce(client_id::text, lower(trim(coalesce(prospect_name,''))))
) WHERE status IN ('pending','assigned','overdue');

CREATE TABLE public.field_visit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.field_visits(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id),
  event text NOT NULL,
  from_status text,
  to_status text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_field_visit_events_visit ON public.field_visit_events(visit_id, created_at DESC);

GRANT SELECT ON public.field_visits TO authenticated;
GRANT ALL ON public.field_visits TO service_role;
GRANT SELECT ON public.field_visit_events TO authenticated;
GRANT ALL ON public.field_visit_events TO service_role;

ALTER TABLE public.field_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_visit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read all field visits" ON public.field_visits
  FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'));
CREATE POLICY "Employees read own field visits" ON public.field_visits
  FOR SELECT TO authenticated USING (employee_id = (SELECT auth.uid()));

CREATE POLICY "Admins read field visit history" ON public.field_visit_events
  FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'));
CREATE POLICY "Employees read own field visit history" ON public.field_visit_events
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.field_visits v WHERE v.id = visit_id AND v.employee_id = (SELECT auth.uid()))
  );

CREATE TRIGGER trg_field_visits_updated BEFORE UPDATE ON public.field_visits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Create / assign a field visit (admin only)
CREATE OR REPLACE FUNCTION public.admin_upsert_field_visit(p_id uuid, p_values jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_emp uuid; v_old public.field_visits; v_status public.field_visit_status; v_label text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not permitted'; END IF;
  v_emp := NULLIF(p_values->>'employee_id','')::uuid;
  IF NULLIF(trim(coalesce(p_values->>'purpose','')),'') IS NULL THEN RAISE EXCEPTION 'Purpose is required'; END IF;
  IF NULLIF(p_values->>'visit_date','') IS NULL THEN RAISE EXCEPTION 'Visit date is required'; END IF;
  v_status := CASE WHEN v_emp IS NULL THEN 'pending' ELSE 'assigned' END;

  IF p_id IS NULL THEN
    INSERT INTO public.field_visits(employee_id, client_id, prospect_name, visit_date, visit_time, location,
                                    purpose, instructions, priority, status, created_by)
    VALUES (v_emp, NULLIF(p_values->>'client_id','')::uuid, NULLIF(p_values->>'prospect_name',''),
            (p_values->>'visit_date')::date, NULLIF(p_values->>'visit_time','')::time,
            NULLIF(p_values->>'location',''), trim(p_values->>'purpose'), NULLIF(p_values->>'instructions',''),
            COALESCE(NULLIF(p_values->>'priority','')::public.field_visit_priority,'medium'), v_status, auth.uid())
    RETURNING id INTO v_id;
    INSERT INTO public.field_visit_events(visit_id, actor_id, event, to_status, note)
    VALUES (v_id, auth.uid(), CASE WHEN v_emp IS NULL THEN 'created' ELSE 'assigned' END, v_status::text, NULL);
  ELSE
    SELECT * INTO v_old FROM public.field_visits WHERE id = p_id;
    IF v_old.id IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
    IF v_old.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'This visit is closed and cannot be edited'; END IF;
    UPDATE public.field_visits SET
      employee_id = v_emp,
      client_id = NULLIF(p_values->>'client_id','')::uuid,
      prospect_name = NULLIF(p_values->>'prospect_name',''),
      visit_date = (p_values->>'visit_date')::date,
      visit_time = NULLIF(p_values->>'visit_time','')::time,
      location = NULLIF(p_values->>'location',''),
      purpose = trim(p_values->>'purpose'),
      instructions = NULLIF(p_values->>'instructions',''),
      priority = COALESCE(NULLIF(p_values->>'priority','')::public.field_visit_priority, v_old.priority),
      status = CASE WHEN v_emp IS NULL THEN 'pending'::public.field_visit_status
                    WHEN v_old.status = 'overdue' AND (p_values->>'visit_date')::date >= CURRENT_DATE THEN 'assigned'::public.field_visit_status
                    WHEN v_old.status = 'pending' THEN 'assigned'::public.field_visit_status
                    ELSE v_old.status END
    WHERE id = p_id
    RETURNING id, status INTO v_id, v_status;
    INSERT INTO public.field_visit_events(visit_id, actor_id, event, from_status, to_status, note)
    VALUES (v_id, auth.uid(), 'updated', v_old.status::text, v_status::text, NULLIF(p_values->>'note',''));
  END IF;

  SELECT COALESCE(c.business_name, fv.prospect_name, 'visit')
    INTO v_label FROM public.field_visits fv LEFT JOIN public.clients c ON c.id = fv.client_id WHERE fv.id = v_id;

  IF v_emp IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, message, reference_id)
    VALUES (v_emp, 'field_visit',
            CASE WHEN p_id IS NULL THEN 'Field visit assigned' ELSE 'Field visit updated' END,
            v_label || ' — ' || to_char((p_values->>'visit_date')::date, 'DD Mon YYYY')
              || COALESCE(' ' || NULLIF(p_values->>'visit_time',''), '') || ' · ' || trim(p_values->>'purpose'),
            v_id::text);
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, module, status, target_type, target_id, old_value, new_value)
  VALUES (auth.uid(), CASE WHEN p_id IS NULL THEN 'field_visit.created' ELSE 'field_visit.updated' END,
          'field_visits', 'success', 'field_visit', v_id::text,
          CASE WHEN p_id IS NULL THEN NULL ELSE to_jsonb(v_old) END, p_values);
  RETURN v_id;
END;$$;

-- Complete / cancel / reopen
CREATE OR REPLACE FUNCTION public.set_field_visit_status(p_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.field_visits; v_admin boolean; v_new public.field_visit_status; v_label text; v_a uuid;
BEGIN
  SELECT * INTO v FROM public.field_visits WHERE id = p_id;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  v_admin := public.has_role(auth.uid(), 'admin');
  IF NOT v_admin THEN
    IF v.employee_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Not permitted'; END IF;
    IF NOT public.has_employee_permission(auth.uid(), 'orders.view') THEN
      RAISE EXCEPTION 'You do not have permission to update field visits';
    END IF;
  END IF;
  IF p_status NOT IN ('completed','cancelled','assigned') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF p_status = 'assigned' AND NOT v_admin THEN RAISE EXCEPTION 'Only an admin can reopen a visit'; END IF;
  IF v.status IN ('completed','cancelled') AND p_status <> 'assigned' THEN RAISE EXCEPTION 'Visit already closed'; END IF;
  IF p_status = 'cancelled' AND NOT v_admin AND NULLIF(trim(coalesce(p_note,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Please add a reason for cancelling';
  END IF;
  v_new := p_status::public.field_visit_status;

  UPDATE public.field_visits SET
    status = v_new,
    completion_notes = CASE WHEN v_new = 'completed' THEN NULLIF(p_note,'') ELSE completion_notes END,
    completed_at = CASE WHEN v_new = 'completed' THEN now() ELSE NULL END,
    cancelled_reason = CASE WHEN v_new = 'cancelled' THEN NULLIF(p_note,'') ELSE NULL END,
    cancelled_at = CASE WHEN v_new = 'cancelled' THEN now() ELSE NULL END
  WHERE id = p_id;

  INSERT INTO public.field_visit_events(visit_id, actor_id, event, from_status, to_status, note)
  VALUES (p_id, auth.uid(), 'status_' || p_status, v.status::text, p_status, NULLIF(p_note,''));

  SELECT COALESCE(c.business_name, v.prospect_name, 'Field visit') INTO v_label
    FROM public.field_visits fv LEFT JOIN public.clients c ON c.id = fv.client_id WHERE fv.id = p_id;

  IF v_admin AND v.employee_id IS NOT NULL AND v.employee_id <> auth.uid() THEN
    INSERT INTO public.notifications(user_id, type, title, message, reference_id)
    VALUES (v.employee_id, 'field_visit', 'Field visit ' || p_status, v_label, p_id::text);
  ELSIF NOT v_admin THEN
    FOR v_a IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
      INSERT INTO public.notifications(user_id, type, title, message, reference_id)
      VALUES (v_a, 'field_visit', 'Field visit ' || p_status, v_label, p_id::text);
    END LOOP;
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, module, status, target_type, target_id, old_value, new_value, remarks)
  VALUES (auth.uid(), 'field_visit.' || p_status, 'field_visits', 'success', 'field_visit', p_id::text,
          jsonb_build_object('status', v.status), jsonb_build_object('status', p_status), NULLIF(p_note,''));
END;$$;

-- Flag past-due visits (idempotent; safe to run on a schedule)
CREATE OR REPLACE FUNCTION public.mark_field_visits_overdue()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_n int := 0; v_a uuid; v_label text;
BEGIN
  FOR r IN SELECT fv.id, fv.employee_id, COALESCE(c.business_name, fv.prospect_name, 'Field visit') AS label, fv.visit_date
             FROM public.field_visits fv LEFT JOIN public.clients c ON c.id = fv.client_id
            WHERE fv.status IN ('pending','assigned') AND fv.visit_date < CURRENT_DATE
  LOOP
    UPDATE public.field_visits SET status = 'overdue' WHERE id = r.id;
    INSERT INTO public.field_visit_events(visit_id, event, from_status, to_status, note)
    VALUES (r.id, 'overdue', 'assigned', 'overdue', 'Visit date passed');
    IF r.employee_id IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, type, title, message, reference_id)
      VALUES (r.employee_id, 'field_visit', 'Field visit overdue',
              r.label || ' — planned ' || to_char(r.visit_date,'DD Mon YYYY'), r.id::text);
    END IF;
    FOR v_a IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
      INSERT INTO public.notifications(user_id, type, title, message, reference_id)
      VALUES (v_a, 'field_visit', 'Field visit overdue', r.label, r.id::text);
    END LOOP;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;$$;