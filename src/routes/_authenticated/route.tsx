import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { getMe } from "@/lib/me.functions";
import { useServerFn } from "@tanstack/react-start";
import { LogOut } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({ queryKey: ["me"], queryFn: () => getMe() }),
  component: AuthedLayout,
  errorComponent: ({ error }) => (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="max-w-md text-center">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      </div>
    </div>
  ),
});

function AuthedLayout() {
  const { data: me } = useSuspenseQuery({ queryKey: ["me"], queryFn: () => getMe() });
  const router = useRouter();
  const qc = useQueryClient();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  return (
    <SidebarProvider>
      <AppSidebar role={me.role} name={me.profile?.name ?? me.profile?.email ?? "User"} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger />
          <div className="ml-2 text-sm font-medium capitalize text-muted-foreground">
            {me.role} · <span className="text-foreground">{me.profile?.name ?? me.profile?.email}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <NotificationBell />
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="mr-1 size-4" /> Sign out
            </Button>
          </div>
        </header>
        <div className="p-4 md:p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
