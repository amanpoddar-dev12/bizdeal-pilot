import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getClientLedger } from "@/lib/ledger.functions";
import { Card, CardContent } from "@/components/ui/card";
import { inr, fmtDate } from "@/lib/format";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/client/ledger")({
  head: () => ({
    meta: [
      { title: "Ledger — Kredix" },
      { name: "description", content: "Running balance across invoices and payments." },
      { property: "og:title", content: "Ledger — Kredix" },
      { property: "og:description", content: "Running balance across invoices and payments." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Ledger,
});

function Ledger() {
  const fn = useServerFn(getClientLedger);
  const { data } = useQuery({ queryKey: ["ledger"], queryFn: () => fn({ data: {} }) });
  const invs = (data?.invoices ?? []).map((i: any) => ({ date: i.invoice_date, type: "Invoice", ref: i.invoice_number, debit: Number(i.amount), credit: 0 }));
  const pays = (data?.payments ?? []).map((p: any) => ({ date: p.payment_date, type: "Payment", ref: p.invoices?.invoice_number ?? "—", debit: 0, credit: Number(p.amount) }));
  const rows = [...invs, ...pays].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let bal = 0;
  const withBal = rows.map((r) => { bal += r.debit - r.credit; return { ...r, balance: bal }; });

  function exportCsv() {
    const csv = Papa.unparse(withBal.map((r) => ({ date: r.date, type: r.type, ref: r.ref, debit: r.debit, credit: r.credit, balance: r.balance })));
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "ledger.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center">
        <div><h1 className="font-display text-2xl font-semibold">Ledger</h1><p className="text-sm text-muted-foreground">Running balance in chronological order.</p></div>
        <Button size="sm" variant="outline" className="ml-auto" onClick={exportCsv}><Download className="mr-1 size-4" />CSV</Button>
      </div>
      <Card><CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3">Date</th><th className="py-3">Type</th><th className="py-3">Ref</th>
                <th className="py-3 text-right">Debit</th><th className="py-3 text-right">Credit</th><th className="py-3 pr-4 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {withBal.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No entries yet</td></tr>}
              {withBal.map((r, i) => (
                <tr key={i} className="border-b border-border/60">
                  <td className="px-4 py-3">{fmtDate(r.date)}</td>
                  <td className="py-3">{r.type}</td>
                  <td className="py-3">{r.ref}</td>
                  <td className="py-3 text-right">{r.debit ? inr(r.debit) : "—"}</td>
                  <td className="py-3 text-right">{r.credit ? inr(r.credit) : "—"}</td>
                  <td className="py-3 pr-4 text-right font-medium">{inr(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent></Card>
    </div>
  );
}
