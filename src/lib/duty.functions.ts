import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const clockIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // All timestamps and ownership enforced server-side inside the RPC.
    const { data, error } = await context.supabase.rpc("duty_clock_in");
    if (error) throw new Error(error.message);
    return { id: data };
  });

export const clockOut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("duty_clock_out");
    if (error) throw new Error(error.message);
    return { ok: true, duration: data ?? 0 };
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
  .inputValidator((d: {
    latitude: number; longitude: number; accuracy_meters?: number;
    place_name?: string; area?: string; city?: string; district?: string;
    state?: string; country?: string; address?: string; source?: string;
  }) =>
    z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracy_meters: z.number().int().nonnegative().optional(),
      place_name: z.string().max(200).optional(),
      area: z.string().max(200).optional(),
      city: z.string().max(120).optional(),
      district: z.string().max(120).optional(),
      state: z.string().max(120).optional(),
      country: z.string().max(120).optional(),
      address: z.string().max(500).optional(),
      source: z.enum(["gps", "network"]).optional(),
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

export const listEmployeeLocationHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { employee_id?: string; limit?: number }) =>
    z.object({
      employee_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    const targetId = data.employee_id ?? context.userId;
    if (!isAdmin && targetId !== context.userId) throw new Error("Forbidden");
    const { data: rows } = await context.supabase
      .from("employee_locations")
      .select("*")
      .eq("employee_id", targetId)
      .order("captured_at", { ascending: false })
      .limit(data.limit ?? 100);
    return rows ?? [];
  });
