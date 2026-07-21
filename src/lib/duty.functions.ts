import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const clockIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Close any dangling open session first
    await context.supabase
      .from("duty_sessions")
      .update({ clock_out_time: new Date().toISOString() })
      .eq("employee_id", context.userId)
      .is("clock_out_time", null);
    const { data, error } = await context.supabase
      .from("duty_sessions")
      .insert({ employee_id: context.userId, clock_in_time: new Date().toISOString() })
      .select().single();
    if (error) throw new Error(error.message);
    return data;
  });

export const clockOut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: open } = await context.supabase
      .from("duty_sessions")
      .select("*")
      .eq("employee_id", context.userId)
      .is("clock_out_time", null)
      .order("clock_in_time", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!open) return { ok: false, message: "No open session" };
    const out = new Date();
    const duration = Math.round((out.getTime() - new Date(open.clock_in_time).getTime()) / 60000);
    const { error } = await context.supabase
      .from("duty_sessions")
      .update({ clock_out_time: out.toISOString(), duration_minutes: duration })
      .eq("id", open.id);
    if (error) throw new Error(error.message);
    return { ok: true, duration };
  });

export const getMyDutyStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: open } = await context.supabase
      .from("duty_sessions").select("*").eq("employee_id", context.userId)
      .is("clock_out_time", null).order("clock_in_time", { ascending: false }).limit(1).maybeSingle();
    const { data: recent } = await context.supabase
      .from("duty_sessions").select("*").eq("employee_id", context.userId)
      .not("clock_out_time", "is", null).order("clock_in_time", { ascending: false }).limit(10);
    return { open, recent: recent ?? [] };
  });

export const shareLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { latitude: number; longitude: number; accuracy_meters?: number }) =>
    z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracy_meters: z.number().int().nonnegative().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("employee_locations").insert({ ...data, employee_id: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listEmployeeLatestLocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { data } = await context.supabase
      .from("employee_locations")
      .select("*, profiles(name)")
      .order("captured_at", { ascending: false })
      .limit(500);
    // Dedupe latest per employee
    const seen = new Set<string>();
    const latest: any[] = [];
    for (const row of (data ?? [])) {
      if (!seen.has(row.employee_id)) {
        seen.add(row.employee_id);
        latest.push(row);
      }
    }
    return latest;
  });
