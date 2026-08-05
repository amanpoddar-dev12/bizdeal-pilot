import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Employee (or admin) sends an order to its client for approval. */
export const submitOrderForClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("submit_order_for_client", { p_id: data.id });
    if (error) throw new Error(error.message);
    return { ok: true, status: "pending_client" as const };
  });

const reviewSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  checklist: z.record(z.string(), z.boolean()).default({}),
  remarks: z.string().max(1000).optional().nullable(),
});

/** Client approves or rejects an order awaiting them. */
export const clientReviewOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => reviewSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("client_review_order", {
      p_id: data.id,
      p_action: data.action,
      p_checklist: data.checklist,
      p_remarks: data.remarks ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true, status: data.action === "approve" ? "client_approved" : "client_rejected" };
  });

/** Full order detail: items, timeline and approval records. */
export const getOrderWorkflow = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [order, events, approvals] = await Promise.all([
      supabase
        .from("orders")
        .select("*, clients(id, business_name, phone, email), order_items(*), profiles:employee_id(name)")
        .eq("id", data.id)
        .maybeSingle(),
      supabase
        .from("order_events")
        .select("*, profiles:actor_id(name)")
        .eq("order_id", data.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("order_approvals")
        .select("*, profiles:actor_id(name)")
        .eq("order_id", data.id)
        .order("created_at", { ascending: false }),
    ]);
    return {
      order: order.data,
      events: events.data ?? [],
      approvals: approvals.data ?? [],
    };
  });
