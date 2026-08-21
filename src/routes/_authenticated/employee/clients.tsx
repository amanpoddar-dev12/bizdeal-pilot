import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listClients, upsertClient } from "@/lib/clients.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { inr } from "@/lib/format";
import { PhoneDisplay } from "@/components/phone-display";
import { downloadCsv, num } from "@/lib/csv";
import { useMemo, useState } from "react";
import { useVisibleRows } from "@/hooks/use-visible-rows";
import { toast } from "sonner";
import { Download, Plus } from "lucide-react";
import { qk } from "@/lib/query-keys";
import { usePermissions } from "@/hooks/use-permissions";
import { invalidateFor } from "@/lib/query-mutations";

export const Route = createFileRoute("/_authenticated/employee/clients")({
  head: () => ({
    meta: [
      { title: "My clients — Kredix" },
      { name: "description", content: "Clients assigned to you." },
      { property: "og:title", content: "My clients — Kredix" },
      { property: "og:description", content: "Clients assigned to you." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EmpClients,
});

const phoneRegex = /^\+[1-9]\d{7,14}$/;

function EmpClients() {
  const fn = useServerFn(listClients);
  const save = useServerFn(upsertClient);
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: qk.clients, queryFn: () => fn() });
  const { can } = usePermissions();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    business_name: "",
    contact_person: "",
    phone: "",
    email: "",
    gst_number: "",
    address: "",
  });

  const create = useMutation({
    mutationFn: async () => {
      if (form.business_name.trim().length < 2) throw new Error("Business name is required");
      if (!phoneRegex.test(form.phone)) throw new Error("Phone must be in E.164 format, e.g. +14155552671");
      return save({
        data: {
          values: {
            business_name: form.business_name.trim(),
            contact_person: form.contact_person.trim() || null,
            phone: form.phone.trim(),
            email: form.email.trim() || null,
            gst_number: form.gst_number.trim() || null,
            address: form.address.trim() || null,
            credit_limit: 0,
            credit_terms: 30,
            penalty_rate_per_day: 0.005,
            kyc_verified: false,
            active: true,
          },
        },
      });
    },
    onSuccess: () => {
      toast.success("Client added. They can sign in with their phone number.");
      setOpen(false);
      setForm({ business_name: "", contact_person: "", phone: "", email: "", gst_number: "", address: "" });
      invalidateFor(qc, "client");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to add client"),
  });

  const filtered = useMemo(() => {
    if (!q) return data;
    const s = q.toLowerCase();
    return data.filter(
      (c: any) => c.business_name.toLowerCase().includes(s) || (c.phone ?? "").includes(q),
    );
  }, [data, q]);
  const { shown, hasMore, remaining, showMore } = useVisibleRows(filtered, 60);

  function exportCsv() {
    downloadCsv(
      "clients.csv",
      filtered.map((c: any) => {
        const purse = Array.isArray(c.credit_purse) ? c.credit_purse[0] : c.credit_purse;
        return {
          "Business name": c.business_name,
          "Contact person": c.contact_person ?? "",
          Phone: c.phone ?? "",
          Email: c.email ?? "",
          GST: c.gst_number ?? "",
          "Credit limit (INR)": num(c.credit_limit),
          "Credit terms (days)": Number(c.credit_terms ?? 0),
          "Interest rate per day (%)": num(Number(c.penalty_rate_per_day ?? 0) * 100, 3),
          "Used credit (INR)": num(purse?.used_credit),
          "Remaining credit (INR)": num(purse?.remaining_credit),
          KYC: c.kyc_verified ? "Verified" : "Pending",
        };
      }),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold sm:text-2xl">My clients</h1>
        </div>
        <Input
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full sm:ml-auto sm:w-56"
        />
        <Button variant="outline" onClick={exportCsv}>
          <Download className="mr-1 size-4" /> CSV
        </Button>
        {can("clients.manage") && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">
              <Plus className="mr-1 size-4" /> New client
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add a new client</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <Field label="Business name *">
                <Input
                  value={form.business_name}
                  onChange={(e) => setForm((f) => ({ ...f, business_name: e.target.value }))}
                />
              </Field>
              <Field label="Contact person">
                <Input
                  value={form.contact_person}
                  onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))}
                />
              </Field>
              <Field label="Mobile number *">
                <Input
                  placeholder="+919876543210"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Email">
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </Field>
                <Field label="GST number">
                  <Input
                    value={form.gst_number}
                    onChange={(e) => setForm((f) => ({ ...f, gst_number: e.target.value }))}
                  />
                </Field>
              </div>
              <Field label="Address">
                <Input
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                The mobile number becomes their sign-in ID. They will complete the rest of their
                profile on first login.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                {create.isPending ? "Saving…" : "Save client"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button asChild>
          <Link to="/employee/orders/new">Punch order</Link>
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {shown.map((c: any) => (
          <Card key={c.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-medium">{c.business_name}</div>
                {c.kyc_verified ? (
                  <Badge className="bg-emerald-600">KYC</Badge>
                ) : (
                  <Badge variant="outline">KYC pending</Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                <span className="truncate">{c.contact_person ?? "—"}</span>
                <span>·</span>
                <PhoneDisplay phone={c.phone} />
              </div>
              <div className="text-xs">
                Credit limit: <span className="font-medium">{inr(c.credit_limit)}</span> · Terms:{" "}
                {c.credit_terms}d
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">No clients yet.</p>
        )}
      </div>
      {hasMore && (
        <div className="text-center">
          <Button variant="outline" size="sm" onClick={showMore}>
            Show more ({remaining} remaining)
          </Button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
