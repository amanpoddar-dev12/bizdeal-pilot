REVOKE ALL ON FUNCTION public.has_employee_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_employee_permission(uuid, text) TO authenticated, service_role;