import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listOrders, updateOrderStatus } from "@/lib/orders.functions";
import { submitOrderForClient } from "@/lib/order-workflow.functions";
import { generateInvoiceFromOrder } from "@/lib/invoices.functions";
import { getMe } from "@/lib/me.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { OrderReviewPanel } from "@/components/orders/order-review-panel";
import { useRealtimeOrders } from "@/hooks/use-realtime-orders";
import { inr, fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { useState } from "react";

function OrdersTable({ scope }: { scope: "admin" | "client" | "employee" }) {
  const listFn = useServerFn(listOrders);
  const meFn = useServerFn(getMe);
  const statusFn = useServerFn(updateOrderStatus);
  const submitFn = useServerFn(submitOrderForClient);
  const invFn = useServerFn(generateInvoiceFromOrder);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => meFn() });
  const { data = [] } = useQuery({ queryKey: ["orders"], queryFn: () => listFn() });

  useRealtimeOrders();

  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: any }) => statusFn({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); toast.success("Status updated"); },
    onError: (e: any) => toast.error(e.message),
  });
  const submit = useMutation({
    mutationFn: (id: string) => submitFn({ data: { id } }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["orders"] });
      const prev = qc.getQueryData<any[]>(["orders"]);
      qc.setQueryData<any[]>(["orders"], (rows) =>
        (rows ?? []).map((o) => (o.id === id ? { ...o, status: "pending_client" } : o)));
      return { prev };
    },
    onError: (e: any, _id, ctx) => { if (ctx?.prev) qc.setQueryData(["orders"], ctx.prev); toast.error(e.message); },
    onSuccess: () => toast.success("Sent to client for approval"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["orders"] }),
  });
  const invoice = useMutation({
    mutationFn: (id: string) => invFn({ data: { order_id: id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); qc.invalidateQueries({ queryKey: ["invoices"] }); toast.success("Invoice generated"); },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = data.filter((o: any) => !q ||
    o.order_number.toLowerCase().includes(q.toLowerCase()) ||
    o.clients?.business_name?.toLowerCase().includes(q.toLowerCase()));

  const canSubmit = (o: any) =>
    (me?.role === "admin" || (me?.role === "employee" && o.employee_id === me?.userId)) &&
    ["pending", "confirmed", "change_requested", "client_rejected"].includes(o.status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="font-display text-xl font-semibold sm:text-2xl">Orders</h1>
          <p className="text-sm text-muted-foreground">
            {scope === "client" ? "Orders awaiting your review and past approvals." : "All orders across the business."}
          </p>
        </div>
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="ml-auto w-56" />
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3">Order</th>
                  <th className="py-3">Client</th>
                  <th className="py-3">Employee</th>
                  <th className="py-3">Date</th>
                  <th className="py-3">Amount</th>
                  <th className="py-3">Status</th>
                  <th className="py-3 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No orders</td></tr>}
                {filtered.map((o: any) => (
                  <tr
                    key={o.id}
                    className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40"
                    onClick={() => setOpenId(o.id)}
                  >
                    <td className="px-4 py-3 font-medium">{o.order_number}</td>
                    <td className="py-3">{o.clients?.business_name}</td>
                    <td className="py-3">{o.profiles?.name ?? "—"}</td>
                    <td className="py-3">{fmtDate(o.created_at)}</td>
                    <td className="py-3 font-medium">{inr(o.total_amount)}</td>
                    <td className="py-3"><OrderStatusBadge status={o.status} /></td>
                    <td className="py-3 pr-4 text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                      {me?.role === "client" && o.status === "pending_client" && (
                        <Button size="sm" onClick={() => setOpenId(o.id)}>Review</Button>
                      )}
                      {scope !== "client" && canSubmit(o) && (
                        <Button size="sm" variant="outline" disabled={submit.isPending}
                          onClick={() => submit.mutate(o.id)}>Send for approval</Button>
                      )}
                      {scope === "admin" && me?.role === "admin" && (
                        <>
                          {o.status === "pending" && (
                            <Button size="sm" onClick={() => setStatus.mutate({ id: o.id, status: "confirmed" })}>Confirm</Button>
                          )}
                          {(o.status === "confirmed" || o.status === "client_approved") && (
                            <Button size="sm" onClick={() => invoice.mutate(o.id)}>Generate invoice</Button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <OrderReviewPanel
        orderId={openId}
        open={!!openId}
        onOpenChange={(v) => setOpenId(v ? openId : null)}
        canReview={me?.role === "client"}
      />
    </div>
  );
}


export const Route = createFileRoute("/_authenticated/admin/orders")({
  head: () => ({
    meta: [
      { title: "Orders — Kredix" },
      { name: "description", content: "All orders across clients and employees." },
      { property: "og:title", content: "Orders — Kredix" },
      { property: "og:description", content: "All orders across clients and employees." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <OrdersTable scope="admin" />,
});

export { OrdersTable };
