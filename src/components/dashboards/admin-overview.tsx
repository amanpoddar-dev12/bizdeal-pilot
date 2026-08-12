import { useRealtimeOrders } from "@/hooks/use-realtime-orders";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { adminReports } from "@/lib/reports.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inr, fmtDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { lazy, Suspense, useMemo } from "react";
import { PendingActions } from "@/components/tasks/pending-actions";
import { RecentActivity } from "@/components/tasks/recent-activity";
import { AlertCircle, Wallet, Users, Receipt, TrendingUp } from "lucide-react";
import { qk } from "@/lib/query-keys";

// Charts are ~the largest dependency on this page; load them after the
// KPIs and tables so first paint isn't blocked by the charting library.
const OrderTrendChart = lazy(() =>
  import("@/components/dashboards/admin-charts").then((m) => ({ default: m.OrderTrendChart })));
const AgingPieChart = lazy(() =>
  import("@/components/dashboards/admin-charts").then((m) => ({ default: m.AgingPieChart })));
const EmployeeSalesChart = lazy(() =>
  import("@/components/dashboards/admin-charts").then((m) => ({ default: m.EmployeeSalesChart })));

const ChartFallback = () => (
  <div className="h-full w-full animate-pulse rounded-md bg-muted/40" />
);

export function AdminOverview() {
  const { t } = useTranslation();
  useRealtimeOrders();
  const fn = useServerFn(adminReports);
  const { data, isLoading } = useQuery({ queryKey: qk.adminReports, queryFn: () => fn() });

  // Derived once per data change instead of on every render.
  const agingData = useMemo(
    () =>
      [
        { name: "0-30", value: data?.aging.d0_30 ?? 0 },
        { name: "30-60", value: data?.aging.d30_60 ?? 0 },
        { name: "60+", value: data?.aging.d60_plus ?? 0 },
      ].filter((x) => x.value > 0),
    [data],
  );

  if (isLoading || !data) return <div className="text-sm text-muted-foreground">{t("dashboard.admin.loading")}</div>;
  const k = data.kpis;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold sm:text-2xl">{t("dashboard.admin.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("dashboard.admin.subtitle")}</p>
      </div>

      <PendingActions />

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
            <Suspense fallback={<ChartFallback />}>
              <OrderTrendChart data={data.orderTrend} />
            </Suspense>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("dashboard.admin.agingTitle")}</CardTitle></CardHeader>
          <CardContent className="h-64">
            {agingData.length === 0 ? (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">{t("dashboard.admin.nothingOverdue")}</div>
            ) : (
              <Suspense fallback={<ChartFallback />}>
                <AgingPieChart data={agingData} />
              </Suspense>
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
              <Suspense fallback={<ChartFallback />}>
                <EmployeeSalesChart data={data.empSales} />
              </Suspense>
            )}
          </CardContent>
        </Card>
      </div>

      <RecentActivity />

      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.admin.overdueInvoices")}</CardTitle>
          <CardDescription>{t("dashboard.admin.overdueSort")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2">{t("dashboard.admin.client")}</th>
                  <th className="pb-2">{t("dashboard.admin.due")}</th>
                  <th className="pb-2">{t("dashboard.admin.daysOverdue")}</th>
                  <th className="pb-2 text-right">{t("dashboard.admin.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {data.overdueList.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">{t("dashboard.admin.noOverdue")}</td></tr>
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
        <div className="mt-2 font-display text-xl font-semibold sm:text-2xl">{value}</div>
      </CardContent>
    </Card>
  );
}
