import { Link, useRouterState } from "@tanstack/react-router";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard, Users, Package, Receipt, Wallet, ScrollText, MapPin,
  ClipboardList, Clock, MapPinned, FileText, User,
} from "lucide-react";

type Role = "admin" | "employee" | "client";

const navByRole: Record<Role, { label: string; items: { title: string; url: string; icon: any }[] }[]> = {
  admin: [{
    label: "Admin",
    items: [
      { title: "Overview", url: "/dashboard", icon: LayoutDashboard },
      { title: "Customers", url: "/admin/customers", icon: Users },
      { title: "Employees", url: "/admin/employees", icon: User },
      { title: "Orders", url: "/admin/orders", icon: Package },
      { title: "Invoices", url: "/admin/invoices", icon: Receipt },
      { title: "Credit purse", url: "/admin/credit", icon: Wallet },
      { title: "Locations", url: "/admin/locations", icon: MapPin },
      { title: "Audit log", url: "/admin/audit", icon: ScrollText },
    ],
  }],
  employee: [{
    label: "Field",
    items: [
      { title: "Today", url: "/dashboard", icon: LayoutDashboard },
      { title: "Clients", url: "/employee/clients", icon: Users },
      { title: "New order", url: "/employee/orders/new", icon: Package },
      { title: "Tasks", url: "/employee/tasks", icon: ClipboardList },
      { title: "Clock in / out", url: "/employee/duty", icon: Clock },
      { title: "Share location", url: "/employee/location", icon: MapPinned },
    ],
  }],
  client: [{
    label: "My account",
    items: [
      { title: "Overview", url: "/dashboard", icon: LayoutDashboard },
      { title: "Orders", url: "/client/orders", icon: Package },
      { title: "Invoices", url: "/client/invoices", icon: Receipt },
      { title: "Ledger", url: "/client/ledger", icon: FileText },
      { title: "Profile & KYC", url: "/client/profile", icon: User },
    ],
  }],
};

export function AppSidebar({ role, name }: { role: Role; name: string }) {
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
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const active = pathname === item.url || (item.url !== "/dashboard" && pathname.startsWith(item.url));
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                        <Link to={item.url} className="flex items-center gap-2">
                          <item.icon className="size-4" />
                          <span>{item.title}</span>
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
