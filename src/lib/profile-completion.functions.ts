import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Returns whether the current user has all mandatory profile fields filled in
// for their role. Employees need name + phone. Clients additionally need
// business name and GST number on their client record.
export const getProfileCompletion = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("name, phone")
      .eq("id", userId)
      .maybeSingle();
    const { data: rolesData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roles = new Set((rolesData ?? []).map((r: any) => r.role));
    const role = roles.has("admin")
      ? "admin"
      : roles.has("employee")
        ? "employee"
        : "client";

    const nameOk = !!(profile?.name && profile.name.trim().length >= 2);
    const phoneOk = !!(profile?.phone && profile.phone.trim().length > 0);

    if (role === "admin") {
      return { role, complete: nameOk && phoneOk, client: null };
    }
    if (role === "employee") {
      return { role, complete: nameOk && phoneOk, client: null };
    }

    // client
    const { data: client } = await supabase
      .from("clients")
      .select("id, business_name, gst_number, contact_person")
      .eq("user_id", userId)
      .maybeSingle();
    const businessOk = !!(client?.business_name && client.business_name.trim().length >= 2);
    const gstOk = !!(client?.gst_number && client.gst_number.trim().length >= 5);
    return {
      role,
      complete: nameOk && phoneOk && businessOk && gstOk,
      client: client ?? null,
    };
  });

const completeSchema = z.object({
  name: z.string().trim().min(2).max(120),
  business_name: z.string().trim().max(200).optional().nullable(),
  gst_number: z.string().trim().max(30).optional().nullable(),
});

export const saveProfileCompletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => completeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: pErr } = await supabase
      .from("profiles")
      .update({ name: data.name })
      .eq("id", userId);
    if (pErr) throw new Error(pErr.message);

    const { data: rolesData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roles = new Set((rolesData ?? []).map((r: any) => r.role));

    if (roles.has("client")) {
      if (!data.business_name || !data.gst_number) {
        throw new Error("Business name and GST number are required for clients.");
      }
      const { data: existing } = await supabase
        .from("clients")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      if (existing?.id) {
        // enforce_clients_update trigger blocks non-admins from touching
        // credit/KYC fields, but contact fields are allowed.
        const { error } = await supabaseAdmin
          .from("clients")
          .update({
            business_name: data.business_name,
            gst_number: data.gst_number,
            contact_person: data.name,
          })
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabaseAdmin.from("clients").insert({
          user_id: userId,
          business_name: data.business_name,
          gst_number: data.gst_number,
          contact_person: data.name,
        });
        if (error) throw new Error(error.message);
      }
    }

    return { ok: true };
  });
