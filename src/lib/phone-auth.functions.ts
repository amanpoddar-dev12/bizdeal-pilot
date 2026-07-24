import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// E.164: leading + and 8–15 digits
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Phone must be in E.164 format, e.g. +14155552671");

const roleSchema = z.enum(["admin", "employee", "client"]);

const sendSchema = z.object({
  phone: phoneSchema,
  role: roleSchema,
  mode: z.enum(["signin", "signup"]),
});

const verifySchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().min(4).max(10),
  role: roleSchema,
  mode: z.enum(["signin", "signup"]),
  name: z.string().trim().min(2).max(100).optional(),
});

function syntheticEmail(phone: string) {
  const clean = phone.replace(/[^0-9]/g, "");
  return `phone.${clean}@phone.kredix.local`;
}

function randomPassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "P!" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") + "Aa9";
}

function twilioAuthHeader() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("Twilio credentials are not configured");
  return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

async function twilioVerifyStart(phone: string) {
  const service = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!service) throw new Error("Twilio Verify service is not configured");
  const res = await fetch(
    `https://verify.twilio.com/v2/Services/${service}/Verifications`,
    {
      method: "POST",
      headers: {
        Authorization: twilioAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: phone, Channel: "sms" }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    console.error("Twilio Verify start failed", res.status, body);
    throw new Error("Failed to send verification code. Please try again.");
  }
}

async function twilioVerifyCheck(phone: string, code: string) {
  const service = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!service) throw new Error("Twilio Verify service is not configured");
  const res = await fetch(
    `https://verify.twilio.com/v2/Services/${service}/VerificationCheck`,
    {
      method: "POST",
      headers: {
        Authorization: twilioAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: phone, Code: code }),
    },
  );
  const body = await res.json().catch(() => null as any);
  if (!res.ok) {
    console.error("Twilio Verify check failed", res.status, body);
    throw new Error("Could not verify the code. Please try again.");
  }
  return body?.status === "approved";
}

async function findUserIdByPhone(phone: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function getRoles(userId: string): Promise<Set<string>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  return new Set((data ?? []).map((r: any) => r.role));
}

/**
 * Verifies the phone/role combo is valid for the requested mode, then sends
 * a Twilio Verify OTP via SMS. Public endpoint — no auth required.
 */
export const sendOtp = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => sendSchema.parse(data))
  .handler(async ({ data }) => {
    const existingId = await findUserIdByPhone(data.phone);

    if (data.mode === "signin") {
      if (!existingId) {
        throw new Error("No account found for this phone number. Create one first.");
      }
      const roles = await getRoles(existingId);
      if (!roles.has(data.role)) {
        throw new Error(
          `This phone number is not registered as ${data.role}.`,
        );
      }
    } else {
      if (data.role === "admin") {
        throw new Error("Admin accounts are created by another admin.");
      }
      if (existingId) {
        throw new Error("An account with this phone number already exists.");
      }
    }

    await twilioVerifyStart(data.phone);
    return { ok: true };
  });

/**
 * Verifies the OTP with Twilio, then either signs the user in or creates a
 * new account (for signup mode). Returns a Supabase session for
 * `supabase.auth.setSession()` on the client. Public endpoint.
 */
export const verifyOtp = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => verifySchema.parse(data))
  .handler(async ({ data }) => {
    const approved = await twilioVerifyCheck(data.phone, data.code);
    if (!approved) throw new Error("Invalid or expired verification code.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let userId = await findUserIdByPhone(data.phone);

    if (data.mode === "signup") {
      if (data.role === "admin") throw new Error("Admin sign-up is not allowed.");
      if (userId) throw new Error("An account with this phone number already exists.");
      if (!data.name) throw new Error("Name is required to create an account.");

      const email = syntheticEmail(data.phone);
      const password = randomPassword();

      const { data: created, error: createErr } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          phone: data.phone,
          phone_confirm: true,
          user_metadata: { name: data.name, phone: data.phone },
        });
      if (createErr || !created.user) {
        throw new Error(createErr?.message ?? "Failed to create account");
      }
      userId = created.user.id;

      // Trigger inserts default 'client' role + profile. If the user picked
      // 'employee', swap the role.
      if (data.role === "employee") {
        await supabaseAdmin.from("user_roles").delete().eq("user_id", userId).eq("role", "client");
        await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "employee" });
      }
      // Ensure phone is set on the profile (trigger already tries, but safe upsert).
      await supabaseAdmin
        .from("profiles")
        .update({ phone: data.phone })
        .eq("id", userId);
    } else {
      if (!userId) throw new Error("No account found for this phone number.");
      const roles = await getRoles(userId);
      if (!roles.has(data.role)) {
        throw new Error(`This phone number is not registered as ${data.role}.`);
      }
    }

    // Rotate to a fresh random password, then sign in with it to mint a
    // session. The password is never stored anywhere and is discarded after
    // this call.
    const password = randomPassword();
    const { data: updated, error: updErr } =
      await supabaseAdmin.auth.admin.updateUserById(userId!, { password });
    if (updErr) throw new Error(updErr.message);
    const email = updated.user?.email;
    if (!email) throw new Error("Account is missing an email; contact support.");

    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL!;
    const anon = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const authClient = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: signIn, error: signInErr } =
      await authClient.auth.signInWithPassword({ email, password });
    if (signInErr || !signIn.session) {
      throw new Error(signInErr?.message ?? "Failed to sign in");
    }

    return {
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    };
  });
