import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { ALL_PERMISSIONS } from "./permissions";

const isAdmin = async (ctx: { supabase: any; userId: string }) => {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  return !!data;
};

/** Admin-only: every employee → permission mapping, for the management UI. */
export const listEmployeePermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await isAdmin(context))) throw new Error("Forbidden");
    const { data, error } = await context.supabase
      .from("employee_permissions")
      .select("employee_id, permission, granted_by, created_at");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const setEmployeePermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { employee_id: string; permissions: string[] }) =>
    z
      .object({
        employee_id: z.string().uuid(),
        permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context))) throw new Error("Forbidden");
    const { supabase, userId } = context;

    const { data: current } = await supabase
      .from("employee_permissions")
      .select("permission")
      .eq("employee_id", data.employee_id);
    const before = (current ?? []).map((r: any) => r.permission).sort();
    const after = [...new Set(data.permissions)].sort();

    const removed = before.filter((p: string) => !after.includes(p));
    const added = after.filter((p: string) => !before.includes(p));

    if (removed.length) {
      const { error } = await supabase
        .from("employee_permissions")
        .delete()
        .eq("employee_id", data.employee_id)
        .in("permission", removed);
      if (error) throw new Error(error.message);
    }
    if (added.length) {
      const { error } = await supabase.from("employee_permissions").insert(
        added.map((permission: string) => ({
          employee_id: data.employee_id,
          permission,
          granted_by: userId,
        })),
      );
      if (error) throw new Error(error.message);
    }

    if (added.length || removed.length) {
      await supabase.from("audit_logs").insert({
        actor_id: userId,
        action: "employee.permissions_updated",
        module: "employees",
        status: "success",
        target_type: "employee",
        target_id: data.employee_id,
        old_value: { permissions: before },
        new_value: { permissions: after, added, removed },
        remarks: `${added.length} granted, ${removed.length} revoked`,
      });
    }

    return { ok: true, added, removed };
  });
