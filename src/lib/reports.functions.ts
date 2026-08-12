import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const adminReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabase } = context;

    const [invoices, orders, payments, clients, purse] = await Promise.all([
      supabase.from("invoices").select("id, client_id, amount, payment_amount, due_date, status, invoice_date, clients(business_name)"),
      supabase.from("orders").select("employee_id, total_amount, created_at, profiles:employee_id(name)"),
      supabase.from("payments").select("amount"),
      supabase.from("clients").select("id, active"),
      supabase.from("credit_purse").select("*"),
    ]);

    const outstanding = (invoices.data ?? []).reduce((s, i) => s + (Number(i.amount) - Number(i.payment_amount)), 0);
    const totalRevenue = (payments.data ?? []).reduce((s, p) => s + Number(p.amount), 0);
    const now = Date.now();
    const overdue = (invoices.data ?? []).filter((i) => new Date(i.due_date).getTime() < now && Number(i.amount) > Number(i.payment_amount));

    const aging = { d0_30: 0, d30_60: 0, d60_plus: 0 };
    overdue.forEach((i) => {
      const days = Math.floor((now - new Date(i.due_date).getTime()) / 864e5);
      const out = Number(i.amount) - Number(i.payment_amount);
      if (days <= 30) aging.d0_30 += out;
      else if (days <= 60) aging.d30_60 += out;
      else aging.d60_plus += out;
    });

    // Top clients by outstanding
    const clientMap = new Map<string, { name: string; outstanding: number; revenue: number }>();
    (invoices.data ?? []).forEach((i) => {
      const key = i.client_id;
      const cur = clientMap.get(key) ?? { name: (i as any).clients?.business_name ?? "—", outstanding: 0, revenue: 0 };
      cur.outstanding += Number(i.amount) - Number(i.payment_amount);
      cur.revenue += Number(i.payment_amount);
      clientMap.set(key, cur);
    });
    const topClients = Array.from(clientMap.values()).sort((a, b) => b.outstanding - a.outstanding).slice(0, 10);

    // Sales by employee
    const empMap = new Map<string, { name: string; value: number; count: number }>();
    (orders.data ?? []).forEach((o) => {
      if (!o.employee_id) return;
      const cur = empMap.get(o.employee_id) ?? { name: (o as any).profiles?.name ?? "—", value: 0, count: 0 };
      cur.value += Number(o.total_amount);
      cur.count += 1;
      empMap.set(o.employee_id, cur);
    });
    const empSales = Array.from(empMap.values()).sort((a, b) => b.value - a.value);

    // Order volume last 30 days
    const days: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * 864e5);
      days[d.toISOString().slice(0, 10)] = 0;
    }
    (orders.data ?? []).forEach((o) => {
      const k = new Date(o.created_at).toISOString().slice(0, 10);
      if (k in days) days[k] += 1;
    });
    const orderTrend = Object.entries(days).map(([date, count]) => ({ date: date.slice(5), count }));

    return {
      kpis: {
        outstanding, totalRevenue,
        openInvoices: (invoices.data ?? []).filter((i) => i.status !== "paid" && i.status !== "declined").length,
        overdueCount: overdue.length,
        activeClients: (clients.data ?? []).filter((c) => c.active).length,
      },
      aging, topClients, empSales, orderTrend,
      overdueList: overdue.map((i) => ({
        id: i.id, invoice_id: i.id, client: (i as any).clients?.business_name ?? "—",
        amount: Number(i.amount) - Number(i.payment_amount),
        days_overdue: Math.floor((now - new Date(i.due_date).getTime()) / 864e5),
        due_date: i.due_date,
      })).sort((a, b) => b.days_overdue - a.days_overdue),
      purses: purse.data ?? [],
    };
  });

export const listAuditLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { data: logs } = await context.supabase
      .from("audit_logs")
      .select("*, profiles:actor_id(name, email, phone)")
      .order("created_at", { ascending: false })
      .limit(2000);

    const actorIds = Array.from(new Set((logs ?? []).map((l: any) => l.actor_id).filter(Boolean)));
    const roleMap = new Map<string, string>();
    if (actorIds.length) {
      const { data: roles } = await context.supabase
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", actorIds as string[]);
      const rank = (x: string) => (x === "admin" ? 1 : x === "employee" ? 2 : 3);
      (roles ?? []).forEach((r: any) => {
        const cur = roleMap.get(r.user_id);
        if (!cur || rank(r.role) < rank(cur)) roleMap.set(r.user_id, r.role);
      });
    }
    return (logs ?? []).map((l: any) => ({
      ...l,
      actor_role: l.actor_id ? roleMap.get(l.actor_id) ?? null : null,
    }));
  });
