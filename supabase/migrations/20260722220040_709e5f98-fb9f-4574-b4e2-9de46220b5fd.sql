CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role app_role;
  v_requested text;
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  v_requested := NEW.raw_user_meta_data->>'role';
  -- Only allow self-signup as client or employee. Admin must be invited.
  IF v_requested = 'employee' THEN
    v_role := 'employee';
  ELSE
    v_role := 'client';
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, v_role) ON CONFLICT DO NOTHING;

  IF v_role = 'employee' THEN
    INSERT INTO public.employee_profiles (user_id, full_name, phone)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)), NULL)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;