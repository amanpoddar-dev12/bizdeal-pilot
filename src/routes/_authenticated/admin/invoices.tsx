import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listInvoices, recordPayment, respondToInvoice } from "@/lib/invoices.functions";
import { getMe } from "@/lib/me.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { inr, fmtDate, calcPenalty } from "@/lib/format";
import { toast } from "sonner";
import { useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { downloadCsv, num, csvDate } from "@/lib/csv";
import { Download, FileText } from "lucide-react";

const stColor: Record<string, string> = {
  draft: "bg-gray-500", sent: "bg-sky-500", approved: "bg-indigo-500",
  declined: "bg-red-500", partially_paid: "bg-amber-500", paid: "bg-emerald-500",
};

function InvoicesTable({ scope }: { scope: "admin" | "client" }) {
  const listFn = useServerFn(listInvoices);
  const meFn = useServerFn(getMe);
  const payFn = useServerFn(recordPayment);
  const respFn = useServerFn(respondToInvoice);
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => meFn() });
  const { data = [] } = useQuery({ queryKey: ["invoices"], queryFn: () => listFn() });
  const [payFor, setPayFor] = useState<any>(null);

  const respond = useMutation({
    mutationFn: (v: any) => respFn({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["invoices"] }); toast.success("Response sent"); },
    onError: (e: any) => toast.error(e.message),
  });

  function exportCsv() {
    downloadCsv(
      "invoices.csv",
      data.map((i: any) => {
        const amount = Number(i.amount ?? 0);
        const paid = Number(i.payment_amount ?? 0);
        const balance = amount - paid;
        const days = Math.max(0, Math.floor((Date.now() - new Date(i.due_date).getTime()) / 864e5));
        const rate = Number(i.clients?.penalty_rate_per_day ?? 0);
        const interest = calcPenalty(balance, rate, days);
        return {
          "Invoice number": i.invoice_number,
          Client: i.clients?.business_name ?? "",
          "Invoice date": csvDate(i.invoice_date),
          "Due date": csvDate(i.due_date),
          "Amount (INR)": num(amount),
          "Paid (INR)": num(paid),
          "Balance (INR)": num(balance),
          "Days overdue": days,
          "Interest rate per day (%)": num(rate * 100, 3),
          "Interest (INR)": num(interest),
          "Total payable (INR)": num(balance + interest),
          Status: i.status,
        };
      }),
    );
  }

  function exportPdf(inv: any) {
    const doc = new jsPDF();
    doc.setFontSize(18); doc.text("Invoice", 14, 20);
    doc.setFontSize(11);
    doc.text(`Invoice: ${inv.invoice_number}`, 14, 30);
    doc.text(`Client: ${inv.clients?.business_name}`, 14, 36);
    doc.text(`Date: ${fmtDate(inv.invoice_date)}`, 14, 42);
    doc.text(`Due: ${fmtDate(inv.due_date)}`, 14, 48);
    autoTable(doc, {
      startY: 60,
      head: [["Description", "Amount"]],
      body: [
        ["Amount", inr(inv.amount)],
        ["Paid", inr(inv.payment_amount)],
        ["Balance", inr(Number(inv.amount) - Number(inv.payment_amount))],
      ],
    });
    doc.save(`${inv.invoice_number}.pdf`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold sm:text-2xl">Invoices</h1>
          <p className="text-sm text-muted-foreground">Track invoices, approvals, and payments.</p>
        </div>
        <div className="ml-auto"><Button size="sm" variant="outline" onClick={exportCsv}><Download className="mr-1 size-4" />Export CSV</Button></div>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3">Invoice</th>
                  <th className="py-3">Client</th>
                  <th className="py-3">Amount</th>
                  <th className="py-3">Paid</th>
                  <th className="py-3">Balance</th>
                  <th className="py-3">Due</th>
                  <th className="py-3">Interest</th>
                  <th className="py-3">Status</th>
                  <th className="py-3 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No invoices</td></tr>}
                {data.map((i: any) => {
                  const bal = Number(i.amount) - Number(i.payment_amount);
                  const days = Math.max(0, Math.floor((Date.now() - new Date(i.due_date).getTime()) / 864e5));
                  const rate = Number(i.clients?.penalty_rate_per_day ?? 0);
                  const penalty = calcPenalty(bal, rate, days);
                  return (
                    <tr key={i.id} className="border-b border-border/60">
                      <td className="px-4 py-3 font-medium">{i.invoice_number}</td>
                      <td className="py-3">{i.clients?.business_name}</td>
                      <td className="py-3">{inr(i.amount)}</td>
                      <td className="py-3">{inr(i.payment_amount)}</td>
                      <td className="py-3 font-medium">{inr(bal)}</td>
                      <td className="py-3">{fmtDate(i.due_date)}{days > 0 && <span className="ml-1 text-xs text-red-600">+{days}d</span>}</td>
                      <td className="py-3">{penalty > 0 ? <span className="text-red-600">{inr(penalty)}</span> : "—"}</td>
                      <td className="py-3"><Badge className={stColor[i.status]}>{i.status}</Badge></td>
                      <td className="py-3 pr-4 text-right space-x-1">
                        <Button size="sm" variant="ghost" onClick={() => exportPdf(i)}><FileText className="size-4" /></Button>
                        {scope === "admin" && me?.role === "admin" && bal > 0 && (
                          <Button size="sm" onClick={() => setPayFor(i)}>Record payment</Button>
                        )}
                        {scope === "client" && me?.role === "client" && i.status === "sent" && (
                          <>
                            <Button size="sm" onClick={() => respond.mutate({ id: i.id, action: "accept" })}>Approve</Button>
                            <Button size="sm" variant="outline" onClick={() => respond.mutate({ id: i.id, action: "decline" })}>Decline</Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!payFor} onOpenChange={(o) => { if (!o) setPayFor(null); }}>
        {payFor && <PayForm inv={payFor} payFn={payFn} onDone={() => { setPayFor(null); qc.invalidateQueries({ queryKey: ["invoices"] }); }} />}
      </Dialog>
    </div>
  );
}

function PayForm({ inv, payFn, onDone }: any) {
  const bal = Number(inv.amount) - Number(inv.payment_amount);
  const [amt, setAmt] = useState(bal);
  const [method, setMethod] = useState("bank");
  const [notes, setNotes] = useState("");
  const mut = useMutation({
    mutationFn: () => payFn({ data: { invoice_id: inv.id, amount: Number(amt), method, notes } }),
    onSuccess: () => { toast.success("Payment recorded"); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Record payment · {inv.invoice_number}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">Balance {inr(bal)}</div>
        <div className="space-y-1"><Label>Amount</Label><Input type="number" value={amt} onChange={(e) => setAmt(e.target.value as any)} /></div>
        <div className="space-y-1"><Label>Method</Label>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="bank">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="cheque">Cheque</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="space-y-1"><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <DialogFooter><Button onClick={() => mut.mutate()} disabled={mut.isPending}>{mut.isPending ? "Saving…" : "Record"}</Button></DialogFooter>
    </DialogContent>
  );
}

export const Route = createFileRoute("/_authenticated/admin/invoices")({
  head: () => ({
    meta: [
      { title: "Invoices — Kredix" },
      { name: "description", content: "Invoice status, approvals, and payments." },
      { property: "og:title", content: "Invoices — Kredix" },
      { property: "og:description", content: "Invoice status, approvals, and payments." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <InvoicesTable scope="admin" />,
});

export { InvoicesTable };
