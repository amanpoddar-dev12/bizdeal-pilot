import type { EmployeePermission } from "./permissions";

type Ctx = { supabase: any; userId: string };

/** Reads the caller's effective permissions (admins get everything). */
export async function hasPermission(ctx: Ctx, perm: EmployeePermission) {
  const { data } = await ctx.supabase.rpc("has_employee_permission", {
    _user_id: ctx.userId,
    _perm: perm,
  });
  return !!data;
}

/**
 * API-layer guard. The database enforces the same rule, this simply turns a
 * denial into a readable message before any work is done.
 */
export async function requirePermission(ctx: Ctx, perm: EmployeePermission, action = "perform this action") {
  if (!(await hasPermission(ctx, perm))) {
    throw new Error(`Permission denied: you are not allowed to ${action}.`);
  }
}
