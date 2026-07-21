import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const isAdmin = async (ctx: { supabase: any; userId: string }) => {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  return !!data;
};

export const listEmployees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await isAdmin(context))) throw new Error("Forbidden");
    const { data, error } = await context.supabase
      .from("employee_profiles")
      .select("*, profiles(*)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      email: z.string().email(),
      password: z.string().min(8),
      name: z.string().min(1),
      phone: z.string().optional(),
      territory: z.string().optional(),
      order_limit: z.number().int().positive().default(100),
      max_order_value: z.number().nonnegative().default(100000),
      base_salary: z.number().nonnegative().default(0),
      commission_rate: z.number().min(0).max(1).default(0.02),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context))) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email, password: data.password, email_confirm: true,
      user_metadata: { name: data.name },
    });
    if (error) throw new Error(error.message);
    const uid = created.user!.id;
    await supabaseAdmin.from("profiles").upsert({ id: uid, email: data.email, name: data.name, phone: data.phone }, { onConflict: "id" });
    await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
    await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: "employee" });
    await supabaseAdmin.from("employee_profiles").insert({
      id: uid, territory: data.territory, order_limit: data.order_limit,
      max_order_value: data.max_order_value, base_salary: data.base_salary, commission_rate: data.commission_rate,
    });
    return { id: uid };
  });

export const updateEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      territory: z.string().optional().nullable(),
      order_limit: z.number().int().positive().optional(),
      max_order_value: z.number().nonnegative().optional(),
      base_salary: z.number().nonnegative().optional(),
      commission_rate: z.number().min(0).max(1).optional(),
      active: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context))) throw new Error("Forbidden");
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("employee_profiles").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getEmployeePerformance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context))) throw new Error("Forbidden");
    const { data: emp } = await context.supabase.from("employee_profiles").select("*, profiles(*)").eq("id", data.id).maybeSingle();
    const { data: orders } = await context.supabase.from("orders").select("total_amount, status, created_at").eq("employee_id", data.id);
    const { data: tasks } = await context.supabase.from("tasks").select("status").eq("employee_id", data.id);
    const { data: duty } = await context.supabase.from("duty_sessions").select("duration_minutes").eq("employee_id", data.id).not("duration_minutes", "is", null);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthOrders = (orders ?? []).filter((o) => o.created_at >= monthStart);
    const totalValue = (orders ?? []).reduce((s, o) => s + Number(o.total_amount), 0);
    const monthValue = monthOrders.reduce((s, o) => s + Number(o.total_amount), 0);
    const dutyMin = (duty ?? []).reduce((s, d) => s + (d.duration_minutes ?? 0), 0);

    return {
      employee: emp,
      totalOrders: orders?.length ?? 0,
      monthOrders: monthOrders.length,
      totalValue, monthValue,
      completedTasks: (tasks ?? []).filter((t) => t.status === "completed").length,
      allTasks: tasks?.length ?? 0,
      dutyHours: Math.round((dutyMin / 60) * 10) / 10,
    };
  });
