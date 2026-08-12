import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listClients, upsertClient, setKycVerified } from "@/lib/clients.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { inr } from "@/lib/format";
import { PhoneDisplay } from "@/components/phone-display";
import { downloadCsv, num, csvDate } from "@/lib/csv";
import { useState } from "react";
import { toast } from "sonner";
import { Download, Plus, ShieldCheck, ShieldX, Users } from "lucide-react";
import { AssignClientDialog } from "@/components/admin/assign-client-dialog";
import { qk } from "@/lib/query-keys";
import { invalidateFor } from "@/lib/query-mutations";


export const Route = createFileRoute("/_authenticated/admin/customers")({
  head: () => ({
    meta: [
      { title: "Customers — Kredix" },
      { name: "description", content: "Manage clients, KYC, credit limits, and credit terms." },
      { property: "og:title", content: "Customers — Kredix" },
      { property: "og:description", content: "Manage clients, KYC, credit limits, and credit terms." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Customers,
});

function Customers() {
  const listFn = useServerFn(listClients);
  const upFn = useServerFn(upsertClient);
  const kycFn = useServerFn(setKycVerified);
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: qk.clients, queryFn: () => listFn() });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [q, setQ] = useState("");
  const [assigning, setAssigning] = useState<any>(null);


  const kyc = useMutation({
    mutationFn: (v: { id: string; verified: boolean }) => kycFn({ data: v }),
    onSuccess: () => { invalidateFor(qc, "client"); toast.success("KYC updated"); },
  });

  const filtered = data.filter((c: any) => !q || c.business_name.toLowerCase().includes(q.toLowerCase()));

  function exportCsv() {
    downloadCsv(
      "customers.csv",
      filtered.map((c: any) => {
        const purse = Array.isArray(c.credit_purse) ? c.credit_purse[0] : c.credit_purse;
        return {
          "Business name": c.business_name,
          "Contact person": c.contact_person ?? "",
          Phone: c.phone ?? "",
          Email: c.email ?? "",
          GST: c.gst_number ?? "",
          PAN: c.pan ?? "",
          Address: c.address ?? "",
          "Credit limit (INR)": num(c.credit_limit),
          "Credit terms (days)": Number(c.credit_terms ?? 0),
          "Interest rate per day (%)": num(Number(c.penalty_rate_per_day ?? 0) * 100, 3),
          "Used credit (INR)": num(purse?.used_credit),
          "Remaining credit (INR)": num(purse?.remaining_credit),
          "Utilization (%)": num(purse?.utilization_percent),
          KYC: c.kyc_verified ? "Verified" : "Pending",
          Status: c.active ? "Active" : "Inactive",
          "Created on": csvDate(c.created_at),
        };
      }),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold sm:text-2xl">Customers</h1>
          <p className="text-sm text-muted-foreground">Manage clients, KYC, and credit terms.</p>
        </div>
        <div className="ml-auto flex w-full flex-wrap gap-2 sm:w-auto">
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-56" />
          <Button variant="outline" onClick={exportCsv}><Download className="mr-1 size-4" />CSV</Button>
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditing(null)}><Plus className="mr-1 size-4" />New client</Button>
            </DialogTrigger>
            <ClientForm editing={editing} onDone={() => { setOpen(false); setEditing(null); invalidateFor(qc, "client"); }} upsert={upFn} />
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3">Business</th>
                  <th className="py-3">Contact</th>
                  <th className="py-3">Credit limit</th>
                  <th className="py-3">Terms</th>
                  <th className="py-3">KYC</th>
                  <th className="py-3 text-right pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No clients yet</td></tr>
                )}
                {filtered.map((c: any) => (
                  <tr key={c.id} className="border-b border-border/60 hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium">{c.business_name}
                      {!c.active && <Badge variant="secondary" className="ml-2">inactive</Badge>}
                    </td>
                    <td className="py-3">{c.contact_person ?? "—"}<div className="text-xs text-muted-foreground"><PhoneDisplay phone={c.phone} canReveal /></div></td>
                    <td className="py-3">{inr(c.credit_limit)}</td>
                    <td className="py-3">{c.credit_terms}d</td>
                    <td className="py-3">
                      {c.kyc_verified ? <Badge className="bg-emerald-600">Verified</Badge> : <Badge variant="outline">Pending</Badge>}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-4 text-right">
                      <Button size="sm" variant="ghost" onClick={() => kyc.mutate({ id: c.id, verified: !c.kyc_verified })}>
                        {c.kyc_verified ? <ShieldX className="size-4" /> : <ShieldCheck className="size-4" />}
                      </Button>
                      <Button size="sm" variant="ghost" title="Assign employees" onClick={() => setAssigning(c)}>
                        <Users className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(c); setOpen(true); }}>Edit</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <AssignClientDialog client={assigning} open={!!assigning} onOpenChange={(o) => !o && setAssigning(null)} />

    </div>
  );
}

function ClientForm({ editing, onDone, upsert }: { editing: any; onDone: () => void; upsert: any }) {
  const [v, setV] = useState(() => ({
    business_name: editing?.business_name ?? "",
    contact_person: editing?.contact_person ?? "",
    email: editing?.email ?? "",
    phone: editing?.phone ?? "",
    gst_number: editing?.gst_number ?? "",
    pan: editing?.pan ?? "",
    address: editing?.address ?? "",
    credit_limit: editing?.credit_limit ?? 0,
    credit_terms: editing?.credit_terms ?? 30,
    penalty_rate_per_day: editing?.penalty_rate_per_day ?? 0.005,
    active: editing?.active ?? true,
    kyc_verified: editing?.kyc_verified ?? false,
  }));

  const mut = useMutation({
    mutationFn: () => upsert({
      data: {
        id: editing?.id,
        values: {
          ...v,
          credit_limit: Number(v.credit_limit),
          credit_terms: Number(v.credit_terms),
          penalty_rate_per_day: Number(v.penalty_rate_per_day),
        },
      },
    }),
    onSuccess: () => { toast.success("Client saved"); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>{editing ? "Edit client" : "New client"}</DialogTitle></DialogHeader>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Business name" required><Input value={v.business_name} onChange={(e) => setV({ ...v, business_name: e.target.value })} /></Field>
        <Field label="Contact person"><Input value={v.contact_person} onChange={(e) => setV({ ...v, contact_person: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label="Phone"><Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
        <Field label="GST"><Input value={v.gst_number} onChange={(e) => setV({ ...v, gst_number: e.target.value })} /></Field>
        <Field label="PAN"><Input value={v.pan} onChange={(e) => setV({ ...v, pan: e.target.value })} /></Field>
        <Field label="Address" full><Input value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></Field>
        <Field label="Credit limit (₹)"><Input type="number" value={v.credit_limit} onChange={(e) => setV({ ...v, credit_limit: e.target.value as any })} /></Field>
        <Field label="Credit terms (days)"><Input type="number" value={v.credit_terms} onChange={(e) => setV({ ...v, credit_terms: e.target.value as any })} /></Field>
        <Field label="Penalty rate / day"><Input type="number" step="0.001" value={v.penalty_rate_per_day} onChange={(e) => setV({ ...v, penalty_rate_per_day: e.target.value as any })} /></Field>
        <div className="flex items-center gap-2 pt-6">
          <Switch checked={v.active} onCheckedChange={(c) => setV({ ...v, active: c })} />
          <Label>Active</Label>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={() => mut.mutate()} disabled={mut.isPending || !v.business_name}>{mut.isPending ? "Saving…" : "Save"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function Field({ label, children, required, full }: { label: string; children: React.ReactNode; required?: boolean; full?: boolean }) {
  return (
    <div className={full ? "md:col-span-2 space-y-1" : "space-y-1"}>
      <Label>{label}{required && <span className="text-red-500"> *</span>}</Label>
      {children}
    </div>
  );
}
