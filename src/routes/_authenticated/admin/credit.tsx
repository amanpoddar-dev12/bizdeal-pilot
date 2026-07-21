import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listClients } from "@/lib/clients.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { inr } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/credit")({
  head: () => ({
    meta: [
      { title: "Credit purse — Kredix" },
      { name: "description", content: "Live credit utilization across all clients." },
      { property: "og:title", content: "Credit purse — Kredix" },
      { property: "og:description", content: "Live credit utilization across all clients." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Credit,
});

function Credit() {
  const listFn = useServerFn(listClients);
  const { data = [] } = useQuery({ queryKey: ["clients"], queryFn: () => listFn() });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Credit purse</h1>
        <p className="text-sm text-muted-foreground">Utilization per client, refreshed automatically.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data.map((c: any) => {
          const purse = c.credit_purse?.[0] ?? { available: c.credit_limit, used: 0 };
          const used = Number(purse.used ?? 0);
          const limit = Number(c.credit_limit ?? 0);
          const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
          const tone = pct > 90 ? "destructive" : pct > 60 ? "default" : "secondary";
          return (
            <Card key={c.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{c.business_name}</div>
                  <Badge variant={tone as any}>{pct.toFixed(0)}%</Badge>
                </div>
                <Progress value={pct} />
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><div className="text-muted-foreground">Limit</div><div className="font-medium">{inr(limit)}</div></div>
                  <div><div className="text-muted-foreground">Used</div><div className="font-medium">{inr(used)}</div></div>
                  <div><div className="text-muted-foreground">Available</div><div className="font-medium">{inr(purse.available ?? 0)}</div></div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
