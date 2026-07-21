import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const isAdmin = async (ctx: { supabase: any; userId: string }) => {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  return !!data;
};

export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("tasks")
      .select("*, profiles!tasks_employee_id_fkey(name)")
      .order("due_date", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      employee_id: z.string().uuid(),
      title: z.string().min(1),
      description: z.string().optional(),
      due_date: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context))) throw new Error("Forbidden");
    const { data: t, error } = await context.supabase.from("tasks").insert({ ...data, assigned_by: context.userId }).select().single();
    if (error) throw new Error(error.message);
    await context.supabase.from("notifications").insert({
      user_id: data.employee_id, type: "task", title: "New task assigned", message: data.title, reference_id: t.id,
    });
    return t;
  });

export const updateTaskStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: "todo" | "in_progress" | "completed"; notes?: string }) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["todo", "in_progress", "completed"]),
      notes: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: { status: "todo" | "in_progress" | "completed"; notes?: string; completed_date?: string } = { status: data.status };
    if (data.notes) patch.notes = data.notes;
    if (data.status === "completed") patch.completed_date = new Date().toISOString();
    const { error } = await context.supabase.from("tasks").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
