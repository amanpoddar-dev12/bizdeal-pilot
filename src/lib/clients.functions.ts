import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requirePermission } from "./permission-guard";

const isAdmin = async (ctx: { supabase: any; userId: string }) => {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  return !!data;
};

export const listClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("clients")
      .select("*, credit_purse(*)")
      .order("business_name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getClient = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: c } = await context.supabase.from("clients").select("*, credit_purse(*)").eq("id", data.id).maybeSingle();
    return c;
  });

const clientSchema = z.object({
  business_name: z.string().min(1),
  business_type: z.string().optional().nullable(),
  contact_person: z.string().optional().nullable(),
  email: z.string().email().optional().or(z.literal("")).nullable(),
  phone: z.string().optional().nullable(),
  gst_number: z.string().optional().nullable(),
  pan: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  bank_account: z.string().optional().nullable(),
  credit_limit: z.number().nonnegative().default(0),
  credit_terms: z.number().int().min(0).max(365).default(30),
  penalty_rate_per_day: z.number().nonnegative().default(0.005),
  kyc_verified: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const upsertClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id?: string; values: unknown }) =>
    z.object({ id: z.string().uuid().optional(), values: clientSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const admin = await isAdmin(context);
    const { data: empRole } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "employee",
    });
    if (!admin && !empRole) throw new Error("Forbidden");
    await requirePermission(context, "clients.manage", "add or edit client information");
    const values = data.values;
    // Non-admins may never set credit/KYC fields via this path — the DB
    // trigger enforces it on update; strip them here to make inserts safe too.
    if (!admin) {
      delete (values as any).credit_limit;
      delete (values as any).credit_terms;
      delete (values as any).penalty_rate_per_day;
      delete (values as any).kyc_verified;
    }
    if (data.id) {
      const { error } = await context.supabase.from("clients").update(values).eq("id", data.id);
      if (error) throw new Error(error.message);
      await context.supabase.from("audit_logs").insert({
        actor_id: context.userId, action: "client_updated", target_type: "client", target_id: data.id, new_value: values,
      });
      return { id: data.id };
    }
    if (!admin) {
      // Employees create clients through a scoped RPC that also links the new
      // client to the creating employee.
      const { data: newId, error: rpcErr } = await context.supabase.rpc("emp_create_client", {
        p_values: values as any,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      return { id: newId as string };
    }
    const { data: inserted, error } = await context.supabase.from("clients").insert(values).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_logs").insert({
      actor_id: context.userId, action: "client_created", target_type: "client", target_id: inserted.id, new_value: values,
    });
    return { id: inserted.id };
  });


export const setKycVerified = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; verified: boolean }) =>
    z.object({ id: z.string().uuid(), verified: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context))) throw new Error("Forbidden");
    const { error } = await context.supabase.from("clients").update({ kyc_verified: data.verified }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_logs").insert({
      actor_id: context.userId, action: "kyc_toggled", target_type: "client", target_id: data.id,
      new_value: { verified: data.verified },
    });
    return { ok: true };
  });

/** Admin-only: every client→employee assignment, for the assignment UI. */
export const listClientAssignments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await isAdmin(context))) throw new Error("Forbidden");
    const { data, error } = await context.supabase
      .from("client_employees")
      .select("client_id, employee_id, assigned_at");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const assignClientToEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { client_id: string; employee_id: string }) =>
    z.object({ client_id: z.string().uuid(), employee_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context))) throw new Error("Forbidden");
    const { error } = await context.supabase.from("client_employees").upsert(data).select();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_logs").insert({
      actor_id: context.userId, action: "client_assigned", module: "clients", status: "success",
      target_type: "client", target_id: data.client_id, new_value: data,
    });
    return { ok: true };
  });

export const unassignClientFromEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { client_id: string; employee_id: string }) =>
    z.object({ client_id: z.string().uuid(), employee_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context))) throw new Error("Forbidden");
    const { error } = await context.supabase.from("client_employees").delete().match(data);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_logs").insert({
      actor_id: context.userId, action: "client_unassigned", module: "clients", status: "success",
      target_type: "client", target_id: data.client_id, old_value: data,
    });
    return { ok: true };
  });

