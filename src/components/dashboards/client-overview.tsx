import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getClientLedger } from "@/lib/ledger.functions";
import { listInvoices } from "@/lib/invoices.functions";
import { listOrders } from "@/lib/orders.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { inr, fmtDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function ClientOverview() {
  const ledgerFn = useServerFn(getClientLedger);
  const invoicesFn = useServerFn(listInvoices);
  const ordersFn = useServerFn(listOrders);
  const ledger = useQuery({ queryKey: ["ledger"], queryFn: () => ledgerFn({ data: {} }) });
  const invoices = useQuery({ queryKey: ["invoices"], queryFn: () => invoicesFn() });
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => ordersFn() });

  const invs = ledger.data?.invoices ?? [];
  const outstanding = invs.reduce((s: number, i: any) => s + (Number(i.amount) - Number(i.payment_amount)), 0);
  const openInvs = (invoices.data ?? []).filter((i: any) => i.status !== "paid" && i.status !== "declined");
  const pendingOrders = (orders.data ?? []).filter((o: any) => o.status === "pending" || o.status === "change_requested");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Your account</h1>
        <p className="text-sm text-muted-foreground">Orders, invoices, and running balance.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm">Outstanding</CardTitle></CardHeader>
          <CardContent><div className="font-display text-3xl font-semibold text-amber-600">{inr(outstanding)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Open invoices</CardTitle></CardHeader>
          <CardContent><div className="font-display text-3xl font-semibold">{openInvs.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Pending orders</CardTitle></CardHeader>
          <CardContent><div className="font-display text-3xl font-semibold">{pendingOrders.length}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Awaiting your action</CardTitle></CardHeader>
        <CardContent>
          {pendingOrders.length === 0 && openInvs.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing to review</p>
          )}
          <ul className="divide-y divide-border">
            {pendingOrders.map((o: any) => (
              <li key={o.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium">Order {o.order_number}</div>
                  <div className="text-xs text-muted-foreground">{fmtDate(o.created_at)} · {inr(o.total_amount)}</div>
                </div>
                <Button asChild size="sm" variant="outline"><Link to="/client/orders">Review</Link></Button>
              </li>
            ))}
            {openInvs.filter((i: any) => i.status === "sent").map((i: any) => (
              <li key={i.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium">Invoice {i.invoice_number}</div>
                  <div className="text-xs text-muted-foreground">Due {fmtDate(i.due_date)} · {inr(i.amount)}</div>
                </div>
                <Badge variant="outline">{i.status}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
