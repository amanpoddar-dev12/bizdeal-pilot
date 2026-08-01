import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchRouteData } from "@/lib/route-prefetch";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard, Users, Package, Receipt, Wallet, ScrollText, MapPin,
  ClipboardList, Clock, MapPinned, FileText, User, Settings, Activity,
} from "lucide-react";


type Role = "admin" | "employee" | "client";

type NavItem = { key: string; url: string; icon: any };
type NavGroup = { labelKey: string; items: NavItem[] };

const navByRole: Record<Role, NavGroup[]> = {
  admin: [{
    labelKey: "nav.groups.admin",
    items: [
      { key: "nav.overview", url: "/dashboard", icon: LayoutDashboard },
      { key: "nav.customers", url: "/admin/customers", icon: Users },
      { key: "nav.employees", url: "/admin/employees", icon: User },
      { key: "nav.activity", url: "/admin/activity", icon: Activity },
      { key: "nav.orders", url: "/admin/orders", icon: Package },
      { key: "nav.products", url: "/admin/products", icon: Package },
      { key: "nav.invoices", url: "/admin/invoices", icon: Receipt },
      { key: "nav.credit", url: "/admin/credit", icon: Wallet },
      { key: "nav.locations", url: "/admin/locations", icon: MapPin },
      { key: "nav.audit", url: "/admin/audit", icon: ScrollText },
      { key: "nav.settings", url: "/settings", icon: Settings },
    ],
  }],
  employee: [{
    labelKey: "nav.groups.field",
    items: [
      { key: "nav.today", url: "/dashboard", icon: LayoutDashboard },
      { key: "nav.clients", url: "/employee/clients", icon: Users },
      { key: "nav.newOrder", url: "/employee/orders/new", icon: Package },
      { key: "nav.tasks", url: "/employee/tasks", icon: ClipboardList },
      { key: "nav.duty", url: "/employee/duty", icon: Clock },
      { key: "nav.shareLocation", url: "/employee/location", icon: MapPinned },
      { key: "nav.settings", url: "/settings", icon: Settings },
    ],
  }],
  client: [{
    labelKey: "nav.groups.myAccount",
    items: [
      { key: "nav.overview", url: "/dashboard", icon: LayoutDashboard },
      { key: "nav.orders", url: "/client/orders", icon: Package },
      { key: "nav.invoices", url: "/client/invoices", icon: Receipt },
      { key: "nav.ledger", url: "/client/ledger", icon: FileText },
      { key: "nav.profile", url: "/client/profile", icon: User },
      { key: "nav.settings", url: "/settings", icon: Settings },
    ],
  }],
};

export function AppSidebar({ role, name }: { role: Role; name: string }) {
  const { t } = useTranslation();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const groups = navByRole[role] ?? navByRole.client;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 p-2">
          <div className="grid size-8 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground font-bold">K</div>
          {!collapsed && (
            <div className="flex flex-col overflow-hidden">
              <span className="truncate font-display text-sm font-semibold">Kredix</span>
              <span className="truncate text-xs text-muted-foreground">{name}</span>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.labelKey}>
            <SidebarGroupLabel>{t(g.labelKey)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const title = t(item.key);
                  const active = pathname === item.url || (item.url !== "/dashboard" && pathname.startsWith(item.url));
                  return (
                    <SidebarMenuItem key={item.key + item.url}>
                      <SidebarMenuButton asChild isActive={active} tooltip={title}>
                        <Link to={item.url} className="flex items-center gap-2">
                          <item.icon className="size-4" />
                          <span>{title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
