import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listOrders, updateOrderStatus, respondToOrder } from "@/lib/orders.functions";
import { generateInvoiceFromOrder } from "@/lib/invoices.functions";
import { getMe } from "@/lib/me.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { inr, fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { useState } from "react";

const statusColor: Record<string, string> = {
  pending: "bg-amber-500", confirmed: "bg-sky-500", declined: "bg-red-500",
  change_requested: "bg-purple-500", invoiced: "bg-indigo-500", paid: "bg-emerald-500",
};

function OrdersTable({ scope }: { scope: "admin" | "client" | "employee" }) {
  const listFn = useServerFn(listOrders);
  const meFn = useServerFn(getMe);
  const statusFn = useServerFn(updateOrderStatus);
  const respFn = useServerFn(respondToOrder);
  const invFn = useServerFn(generateInvoiceFromOrder);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => meFn() });
  const { data = [] } = useQuery({ queryKey: ["orders"], queryFn: () => listFn() });

  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: any }) => statusFn({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); toast.success("Status updated"); },
    onError: (e: any) => toast.error(e.message),
  });
  const respond = useMutation({
    mutationFn: (v: { id: string; action: "accept" | "decline" }) => respFn({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); toast.success("Response sent"); },
    onError: (e: any) => toast.error(e.message),
  });
  const invoice = useMutation({
    mutationFn: (id: string) => invFn({ data: { order_id: id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); qc.invalidateQueries({ queryKey: ["invoices"] }); toast.success("Invoice generated"); },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = data.filter((o: any) => !q ||
    o.order_number.toLowerCase().includes(q.toLowerCase()) ||
    o.clients?.business_name?.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold">Orders</h1>
          <p className="text-sm text-muted-foreground">All orders across the business.</p>
        </div>
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="ml-auto w-56" />
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
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
                  <tr key={o.id} className="border-b border-border/60">
                    <td className="px-4 py-3 font-medium">{o.order_number}</td>
                    <td className="py-3">{o.clients?.business_name}</td>
                    <td className="py-3">{o.profiles?.name ?? "—"}</td>
                    <td className="py-3">{fmtDate(o.created_at)}</td>
                    <td className="py-3 font-medium">{inr(o.total_amount)}</td>
                    <td className="py-3"><Badge className={statusColor[o.status] ?? ""}>{o.status}</Badge></td>
                    <td className="py-3 pr-4 text-right space-x-1">
                      {scope === "client" && (o.status === "pending" || o.status === "confirmed") && me?.role === "client" && (
                        <>
                          <Button size="sm" onClick={() => respond.mutate({ id: o.id, action: "accept" })}>Accept</Button>
                          <Button size="sm" variant="outline" onClick={() => respond.mutate({ id: o.id, action: "decline" })}>Decline</Button>
                        </>
                      )}
                      {scope === "admin" && me?.role === "admin" && (
                        <>
                          {o.status === "pending" && (
                            <Button size="sm" onClick={() => setStatus.mutate({ id: o.id, status: "confirmed" })}>Approve</Button>
                          )}
                          {o.status === "confirmed" && (
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
