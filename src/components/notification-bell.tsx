import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyNotifications, markAllRead } from "@/lib/notifications.functions";
import { getMe } from "@/lib/me.functions";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime } from "@/lib/format";
import { qk } from "@/lib/query-keys";

export function NotificationBell() {
  const listFn = useServerFn(listMyNotifications);
  const markFn = useServerFn(markAllRead);
  const meFn = useServerFn(getMe);
  const qc = useQueryClient();

  const { data: me } = useQuery({ queryKey: qk.me, queryFn: () => meFn() });
  const { data: items = [] } = useQuery({ queryKey: qk.notifications, queryFn: () => listFn() });
  const unread = items.filter((n: any) => !n.is_read).length;

  useEffect(() => {
    if (!me?.userId) return;
    const ch = supabase
      .channel(`notif-${me.userId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${me.userId}` },
        () => { qc.invalidateQueries({ queryKey: qk.notifications }); },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [me?.userId, qc]);

  return (
    <Popover onOpenChange={async (o) => {
      if (o && unread > 0) { await markFn(); qc.invalidateQueries({ queryKey: qk.notifications }); }
    }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="size-5" />
          {unread > 0 && (
            <Badge className="absolute -right-1 -top-1 h-5 min-w-5 px-1 text-[10px]" variant="destructive">{unread}</Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border p-3 text-sm font-medium">Notifications</div>
        <div className="max-h-96 overflow-auto">
          {items.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">No notifications yet</div>
          )}
          {items.map((n: any) => (
            <div key={n.id} className="border-b border-border p-3 last:border-0">
              <div className="text-sm font-medium">{n.title}</div>
              {n.message && <div className="text-xs text-muted-foreground">{n.message}</div>}
              <div className="mt-1 text-[10px] text-muted-foreground">{fmtDateTime(n.created_at)}</div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
