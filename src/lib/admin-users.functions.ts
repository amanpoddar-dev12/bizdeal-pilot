import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(255),
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
      .select("id, email, name")
      .in("id", ids);
    if (pErr) throw new Error(pErr.message);
    const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    return (roles ?? []).map((r: any) => ({
      user_id: r.user_id,
      email: (pMap.get(r.user_id) as any)?.email ?? "",
      name: (pMap.get(r.user_id) as any)?.name ?? "",
      created_at: r.created_at as string,
    }));
  });

export const createAdminUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Send an invitation email — the invitee sets their own password via the emailed link.
    const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      data.email,
      { data: { name: data.name } },
    );
    if (inviteErr || !invited.user) {
      throw new Error(inviteErr?.message ?? "Failed to send invitation");
    }
    const newId = invited.user.id;

    // handle_new_user trigger inserted profile + default 'client' role.
    // Swap client role for admin.
    await supabaseAdmin.from("user_roles").delete().eq("user_id", newId).eq("role", "client");
    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newId, role: "admin" });
    if (roleErr) throw new Error(roleErr.message);

    return { ok: true, userId: newId, invited: true };
  });
