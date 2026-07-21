import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("invoices")
      .select("*, clients(business_name, credit_terms, penalty_rate_per_day)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getInvoice = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: inv } = await context.supabase
      .from("invoices")
      .select("*, clients(*), orders(order_number, order_items(*))")
      .eq("id", data.id)
      .maybeSingle();
    return inv;
  });

export const generateInvoiceFromOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { order_id: string }) => z.object({ order_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { data: order } = await context.supabase.from("orders").select("*, clients(credit_terms, user_id)").eq("id", data.order_id).maybeSingle();
    if (!order) throw new Error("Order not found");
    const terms = order.clients?.credit_terms ?? 30;
    const dueDate = new Date(Date.now() + terms * 864e5).toISOString();
    const { data: inv, error } = await context.supabase
      .from("invoices")
      .insert({ order_id: order.id, client_id: order.client_id, amount: order.total_amount, due_date: dueDate, status: "sent" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("orders").update({ status: "invoiced" }).eq("id", order.id);
    if (order.clients?.user_id) {
      await context.supabase.from("notifications").insert({
        user_id: order.clients.user_id, type: "invoice", title: "New invoice",
        message: `Invoice ${inv.invoice_number} awaiting your approval`, reference_id: inv.id,
      });
    }
    return inv;
  });

export const respondToInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; action: "accept" | "decline" }) =>
    z.object({ id: z.string().uuid(), action: z.enum(["accept", "decline"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const status = data.action === "accept" ? "approved" : "declined";
    const { error } = await context.supabase.from("invoices").update({ status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, status };
  });

export const recordPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { invoice_id: string; amount: number; method?: string; notes?: string }) =>
    z.object({
      invoice_id: z.string().uuid(),
      amount: z.number().positive(),
      method: z.string().optional(),
      notes: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { data: inv } = await context.supabase.from("invoices").select("*").eq("id", data.invoice_id).maybeSingle();
    if (!inv) throw new Error("Invoice not found");
    const newPaid = Number(inv.payment_amount) + data.amount;
    const status = newPaid >= Number(inv.amount) ? "paid" : "partially_paid";
    await context.supabase.from("payments").insert({
      invoice_id: inv.id, client_id: inv.client_id, amount: data.amount,
      method: data.method, notes: data.notes, recorded_by: context.userId,
    });
    await context.supabase.from("invoices").update({
      payment_amount: newPaid, status, payment_date: status === "paid" ? new Date().toISOString() : inv.payment_date,
    }).eq("id", inv.id);
    return { ok: true, status };
  });

export const listPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("payments")
      .select("*, invoices(invoice_number), clients(business_name)")
      .order("payment_date", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
