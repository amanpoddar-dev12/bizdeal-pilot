import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const phoneRegex = /^\+[1-9]\d{7,14}$/;

const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(255),
  phone: z
    .string()
    .trim()
    .regex(phoneRegex, "Phone must be in E.164 format, e.g. +14155552671"),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(72)
    .regex(/[A-Z]/, "Must include an uppercase letter")
    .regex(/[a-z]/, "Must include a lowercase letter")
    .regex(/[0-9]/, "Must include a number"),
});

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const listAdmins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: roles, error } = await context.supabase
      .from("user_roles")
      .select("user_id, role, created_at")
      .eq("role", "admin");
    if (error) throw new Error(error.message);
    const ids = (roles ?? []).map((r: any) => r.user_id);
    if (ids.length === 0) return [];
    const { data: profiles, error: pErr } = await context.supabase
      .from("profiles")
      .select("id, email, name, phone")
      .in("id", ids);
    if (pErr) throw new Error(pErr.message);
    const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    return (roles ?? []).map((r: any) => ({
      user_id: r.user_id,
      email: (pMap.get(r.user_id) as any)?.email ?? "",
      name: (pMap.get(r.user_id) as any)?.name ?? "",
      phone: (pMap.get(r.user_id) as any)?.phone ?? "",
      created_at: r.created_at as string,
    }));
  });

export const createAdminUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Reject phone numbers already in use.
    const { data: existingPhone } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("phone", data.phone)
      .maybeSingle();
    if (existingPhone) throw new Error("Phone number is already in use.");

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      phone: data.phone,
      phone_confirm: true,
      user_metadata: { name: data.name, phone: data.phone },
    });
    if (createErr || !created.user) {
      throw new Error(createErr?.message ?? "Failed to create admin user");
    }
    const newId = created.user.id;

    // handle_new_user trigger inserted profile + default 'client' role.
    // Swap client role for admin.
    await supabaseAdmin.from("user_roles").delete().eq("user_id", newId).eq("role", "client");
    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newId, role: "admin" });
    if (roleErr) throw new Error(roleErr.message);

    // Belt-and-suspenders: ensure phone is on profile.
    await supabaseAdmin.from("profiles").update({ phone: data.phone }).eq("id", newId);

    return { ok: true, userId: newId };
  });
