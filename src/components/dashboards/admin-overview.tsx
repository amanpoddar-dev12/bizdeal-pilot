import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { adminReports } from "@/lib/reports.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inr, fmtDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";
import { AlertCircle, Wallet, Users, Receipt, TrendingUp } from "lucide-react";

const COLORS = ["#0ea5e9", "#f59e0b", "#ef4444"];

export function AdminOverview() {
  const { t } = useTranslation();
  const fn = useServerFn(adminReports);
  const { data, isLoading } = useQuery({ queryKey: ["admin-reports"], queryFn: () => fn() });
  if (isLoading || !data) return <div className="text-sm text-muted-foreground">{t("dashboard.admin.loading")}</div>;
  const k = data.kpis;

  const agingData = [
    { name: "0-30", value: data.aging.d0_30 },
    { name: "30-60", value: data.aging.d30_60 },
    { name: "60+", value: data.aging.d60_plus },
  ].filter((x) => x.value > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">{t("dashboard.admin.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("dashboard.admin.subtitle")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Kpi icon={<Wallet />} label={t("dashboard.admin.outstanding")} value={inr(k.outstanding)} tone="warning" />
        <Kpi icon={<TrendingUp />} label={t("dashboard.admin.totalRevenue")} value={inr(k.totalRevenue)} tone="success" />
        <Kpi icon={<Receipt />} label={t("dashboard.admin.openInvoices")} value={String(k.openInvoices)} />
        <Kpi icon={<AlertCircle />} label={t("dashboard.admin.overdue")} value={String(k.overdueCount)} tone="danger" />
        <Kpi icon={<Users />} label={t("dashboard.admin.activeClients")} value={String(k.activeClients)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>{t("dashboard.admin.orders30")}</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.orderTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("dashboard.admin.agingTitle")}</CardTitle></CardHeader>
          <CardContent className="h-64">
            {agingData.length === 0 ? (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">{t("dashboard.admin.nothingOverdue")}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={agingData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={80}>
                    {agingData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => inr(v)} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("dashboard.admin.topOutstanding")}</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {data.topClients.length === 0 && <li className="py-4 text-muted-foreground">{t("dashboard.admin.noOutstanding")}</li>}
              {data.topClients.map((c: any) => (
                <li key={c.name} className="flex items-center justify-between py-2">
                  <span>{c.name}</span>
                  <span className="font-medium">{inr(c.outstanding)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("dashboard.admin.salesByEmployee")}</CardTitle></CardHeader>
          <CardContent className="h-56">
            {data.empSales.length === 0 ? (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">{t("dashboard.admin.noOrders")}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.empSales}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => inr(v)} />
                  <Bar dataKey="value" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Overdue invoices</CardTitle>
          <CardDescription>Sorted by longest overdue first</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2">Client</th>
                  <th className="pb-2">Due</th>
                  <th className="pb-2">Days overdue</th>
                  <th className="pb-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.overdueList.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No overdue invoices</td></tr>
                )}
                {data.overdueList.map((r: any) => (
                  <tr key={r.id} className="border-b border-border/60">
                    <td className="py-2">{r.client}</td>
                    <td>{fmtDate(r.due_date)}</td>
                    <td><Badge variant="destructive">{r.days_overdue} d</Badge></td>
                    <td className="text-right font-medium">{inr(r.amount)}</td>
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

function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: "success" | "warning" | "danger" }) {
  const toneCls = tone === "success" ? "text-emerald-600" : tone === "warning" ? "text-amber-600" : tone === "danger" ? "text-red-600" : "text-primary";
  return (
    <Card>
      <CardContent className="p-4">
        <div className={`flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground`}>
          <span className={`grid size-6 place-items-center rounded ${toneCls}`}>{icon}</span>
          {label}
        </div>
        <div className="mt-2 font-display text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
