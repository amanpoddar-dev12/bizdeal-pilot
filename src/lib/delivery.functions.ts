import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const PAYMENT_METHODS = ["upi", "bank_transfer", "cash", "cheque", "other"] as const;

const submitSchema = z.object({
  order_id: z.string().uuid(),
  amount: z.number().positive(),
  method: z.enum(PAYMENT_METHODS),
  reference_id: z.string().trim().max(120).optional().nullable(),
  proof_path: z.string().trim().max(500).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});

/** Client submits payment proof for an accepted order. */
export const submitPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => submitSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("client_submit_payment", {
      p_order_id: data.order_id,
      p_amount: data.amount,
      p_method: data.method,
      p_reference: data.reference_id ?? undefined,
      p_proof_path: data.proof_path ?? undefined,
      p_note: data.note ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin approves or rejects a submitted payment. */
export const reviewPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        payment_id: z.string().uuid(),
        action: z.enum(["approve", "reject"]),
        reason: z.string().trim().max(1000).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("admin_review_payment", {
      p_payment_id: data.payment_id,
      p_action: data.action,
      p_reason: data.reason ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Payments visible to the caller (RLS scopes: admin all, client own, employee assigned). */
export const listPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("order_payments")
      .select("*, clients(business_name), orders(order_number, total_amount, status, employee_id, profiles:employee_id(name))")
      .order("submitted_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Payment attempts + (client/admin only) the live delivery code for one order. */
export const getOrderDeliveryState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [payments, otps] = await Promise.all([
      context.supabase
        .from("order_payments")
        .select("*")
        .eq("order_id", data.id)
        .order("submitted_at", { ascending: false }),
      // RLS hides these rows from employees entirely.
      context.supabase
        .from("delivery_otps")
        .select("id, code, expires_at, used_at, active, created_at")
        .eq("order_id", data.id)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    const otp = (otps.data ?? [])[0] ?? null;
    return {
      payments: payments.data ?? [],
      otp: otp && otp.active && !otp.used_at ? otp : null,
    };
  });

/** Signed URL for a stored payment proof (storage RLS decides visibility). */
export const getProofUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { path: string }) => z.object({ path: z.string().min(1).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: signed, error } = await context.supabase.storage
      .from("payment-proofs")
      .createSignedUrl(data.path, 300);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

/** Employee marks a payment-verified order out for delivery (backend also issues the OTP). */
export const markOutForDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("emp_mark_out_for_delivery", { p_order_id: data.id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Employee requests a fresh delivery code (previous one is invalidated). */
export const regenerateDeliveryOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("emp_regenerate_delivery_otp", { p_order_id: data.id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Employee enters the client's code; the backend validates and completes the order. */
export const verifyDeliveryOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("emp_verify_delivery_otp", {
      p_order_id: data.id,
      p_code: data.code,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
