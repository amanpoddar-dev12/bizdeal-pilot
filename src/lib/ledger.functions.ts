import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getClientLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { client_id?: string }) => z.object({ client_id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    let clientId = data.client_id;
    if (!clientId) {
      // client role -> derive from user
      const { data: cli } = await context.supabase.from("clients").select("id").eq("user_id", context.userId).maybeSingle();
      clientId = cli?.id;
    }
    if (!clientId) return { client_id: null, invoices: [], payments: [], orders: [] };

    const [invoices, payments, orders] = await Promise.all([
      context.supabase.from("invoices").select("*").eq("client_id", clientId).order("invoice_date"),
      context.supabase.from("payments").select("*, invoices(invoice_number)").eq("client_id", clientId).order("payment_date"),
      context.supabase.from("orders").select("*").eq("client_id", clientId).order("order_date"),
    ]);

    return {
      client_id: clientId,
      invoices: invoices.data ?? [],
      payments: payments.data ?? [],
      orders: orders.data ?? [],
    };
  });
