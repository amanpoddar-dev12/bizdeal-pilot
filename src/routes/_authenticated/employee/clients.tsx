import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listClients } from "@/lib/clients.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { inr } from "@/lib/format";
import { useState } from "react";

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

function EmpClients() {
  const fn = useServerFn(listClients);
  const { data = [] } = useQuery({ queryKey: ["clients"], queryFn: () => fn() });
  const [q, setQ] = useState("");
  const filtered = data.filter((c: any) => !q || c.business_name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div><h1 className="font-display text-2xl font-semibold">My clients</h1></div>
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="ml-auto w-56" />
        <Button asChild><Link to="/employee/orders/new">Punch order</Link></Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((c: any) => (
          <Card key={c.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-medium">{c.business_name}</div>
                {c.kyc_verified ? <Badge className="bg-emerald-600">KYC</Badge> : <Badge variant="outline">KYC pending</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">{c.contact_person} · {c.phone}</div>
              <div className="text-xs">Credit limit: <span className="font-medium">{inr(c.credit_limit)}</span> · Terms: {c.credit_terms}d</div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && <p className="text-sm text-muted-foreground">No clients yet.</p>}
      </div>
    </div>
  );
}
