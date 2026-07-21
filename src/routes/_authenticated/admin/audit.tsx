import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAuditLogs } from "@/lib/reports.functions";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  head: () => ({
    meta: [
      { title: "Audit log — Kredix" },
      { name: "description", content: "Full audit trail of admin actions." },
      { property: "og:title", content: "Audit log — Kredix" },
      { property: "og:description", content: "Full audit trail of admin actions." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Audit,
});

function Audit() {
  const fn = useServerFn(listAuditLogs);
  const { data = [] } = useQuery({ queryKey: ["audit"], queryFn: () => fn() });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">Recent actions across the workspace.</p>
      </div>
      <Card><CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3">When</th>
                <th className="py-3">Actor</th>
                <th className="py-3">Action</th>
                <th className="py-3">Target</th>
                <th className="py-3 pr-4">Details</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No entries yet</td></tr>}
              {data.map((a: any) => (
                <tr key={a.id} className="border-b border-border/60">
                  <td className="px-4 py-3">{fmtDateTime(a.created_at)}</td>
                  <td className="py-3">{a.profiles?.name ?? a.profiles?.email ?? "system"}</td>
                  <td className="py-3"><Badge variant="outline">{a.action}</Badge></td>
                  <td className="py-3">{a.target_type} · <span className="font-mono text-xs">{a.target_id?.slice(0, 8)}</span></td>
                  <td className="py-3 pr-4 max-w-md truncate text-xs text-muted-foreground">{JSON.stringify(a.new_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent></Card>
    </div>
  );
}
