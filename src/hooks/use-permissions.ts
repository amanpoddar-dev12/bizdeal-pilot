import { useQuery } from "@tanstack/react-query";
import { getMe } from "@/lib/me.functions";
import { qk } from "@/lib/query-keys";
import type { EmployeePermission } from "@/lib/permissions";

/**
 * UI-layer permission check. Purely cosmetic — every guarded action is also
 * enforced in the server function and in the database (RLS / RPC).
 */
export function usePermissions() {
  const { data: me } = useQuery({ queryKey: qk.me, queryFn: () => getMe() });
  const role = me?.role;
  const permissions: string[] = (me as any)?.permissions ?? [];
  const can = (perm: EmployeePermission) => role === "admin" || permissions.includes(perm);
  return { role, permissions, can, isReadOnly: role === "employee" && !can("orders.create") };
}
