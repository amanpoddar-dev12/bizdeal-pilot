import type { QueryClient } from "@tanstack/react-query";
import { listClients } from "@/lib/clients.functions";
import { listEmployees, listEmployeeActivity } from "@/lib/employees.functions";
import { listOrders } from "@/lib/orders.functions";
import { listProducts } from "@/lib/products.functions";
import { listInvoices } from "@/lib/invoices.functions";
import { listEmployeeLatestLocations, getMyDutyStatus } from "@/lib/duty.functions";
import { listAuditLogs, adminReports } from "@/lib/reports.functions";
import { listTasks } from "@/lib/tasks.functions";
import { getClientLedger } from "@/lib/ledger.functions";
import { getUserSettings } from "@/lib/user-settings.functions";

type Entry = { queryKey: unknown[]; queryFn: () => Promise<unknown> };

const clients: Entry = { queryKey: ["clients"], queryFn: () => listClients() as any };
const orders: Entry = { queryKey: ["orders"], queryFn: () => listOrders() as any };
const invoices: Entry = { queryKey: ["invoices"], queryFn: () => listInvoices() as any };
const products: Entry = { queryKey: ["products"], queryFn: () => listProducts() as any };

const map: Record<string, Entry[]> = {
  "/admin/customers": [clients],
  "/admin/credit": [clients],
  "/admin/employees": [{ queryKey: ["employees"], queryFn: () => listEmployees() as any }],
  "/admin/activity": [{ queryKey: ["employee-activity"], queryFn: () => listEmployeeActivity() as any }],
  "/admin/orders": [orders],
  "/admin/products": [products],
  "/admin/invoices": [invoices],
  "/admin/locations": [{ queryKey: ["locations"], queryFn: () => listEmployeeLatestLocations() as any }],
  "/admin/audit": [{ queryKey: ["audit", "", ""], queryFn: () => listAuditLogs({ data: { from: null, to: null } }) as any }],
  "/employee/clients": [clients],
  "/employee/orders/new": [clients, products],
  "/employee/orders": [orders],
  "/employee/tasks": [{ queryKey: ["tasks"], queryFn: () => listTasks() as any }],
  "/employee/duty": [{ queryKey: ["duty"], queryFn: () => getMyDutyStatus() as any }],
  "/client/orders": [orders],
  "/client/invoices": [invoices],
  "/client/ledger": [{ queryKey: ["ledger"], queryFn: () => getClientLedger({ data: {} }) as any }],
  "/client/profile": [clients],
  "/settings": [{ queryKey: ["user-settings"], queryFn: () => getUserSettings() as any }],
};

const dashboardByRole: Record<string, Entry[]> = {
  admin: [{ queryKey: ["admin-reports"], queryFn: () => adminReports() as any }],
  employee: [
    { queryKey: ["duty"], queryFn: () => getMyDutyStatus() as any },
    { queryKey: ["tasks"], queryFn: () => listTasks() as any },
    orders,
  ],
  client: [
    { queryKey: ["ledger"], queryFn: () => getClientLedger({ data: {} }) as any },
    invoices,
    orders,
  ],
};

/** Warm the TanStack Query cache for the data a route will render. */
export function prefetchRouteData(qc: QueryClient, url: string, role?: string) {
  const entries = url === "/dashboard" ? dashboardByRole[role ?? ""] ?? [] : map[url] ?? [];
  for (const e of entries) {
    void qc.prefetchQuery({ ...e, staleTime: 30_000 });
  }
}
