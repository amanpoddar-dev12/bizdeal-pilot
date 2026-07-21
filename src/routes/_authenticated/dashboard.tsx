import { createFileRoute, redirect } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getMe } from "@/lib/me.functions";
import { AdminOverview } from "@/components/dashboards/admin-overview";
import { EmployeeOverview } from "@/components/dashboards/employee-overview";
import { ClientOverview } from "@/components/dashboards/client-overview";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Kredix" },
      { name: "description", content: "Your Kredix workspace overview." },
      { property: "og:title", content: "Dashboard — Kredix" },
      { property: "og:description", content: "Your Kredix workspace overview." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data: me } = useSuspenseQuery({ queryKey: ["me"], queryFn: () => getMe() });
  if (me.role === "admin") return <AdminOverview />;
  if (me.role === "employee") return <EmployeeOverview />;
  return <ClientOverview />;
}
