import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyDutyStatus } from "@/lib/duty.functions";
import { listTasks } from "@/lib/tasks.functions";
import { listOrders } from "@/lib/orders.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { inr, fmtDateTime } from "@/lib/format";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function EmployeeOverview() {
  const dutyFn = useServerFn(getMyDutyStatus);
  const tasksFn = useServerFn(listTasks);
  const ordersFn = useServerFn(listOrders);
  const duty = useQuery({ queryKey: ["duty"], queryFn: () => dutyFn() });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => tasksFn() });
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => ordersFn() });

  const openTasks = (tasks.data ?? []).filter((t: any) => t.status !== "completed").slice(0, 5);
  const myOrders = (orders.data ?? []).slice(0, 5);
  const isOnDuty = !!duty.data?.open;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Today</h1>
        <p className="text-sm text-muted-foreground">Your day at a glance.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm">Duty status</CardTitle></CardHeader>
          <CardContent>
            <Badge variant={isOnDuty ? "default" : "secondary"}>{isOnDuty ? "On duty" : "Off duty"}</Badge>
            <div className="mt-3">
              <Button asChild size="sm" variant="outline"><Link to="/employee/duty">Manage</Link></Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Open tasks</CardTitle></CardHeader>
          <CardContent><div className="font-display text-3xl font-semibold">{openTasks.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Recent orders</CardTitle></CardHeader>
          <CardContent><div className="font-display text-3xl font-semibold">{(orders.data ?? []).length}</div></CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Upcoming tasks</CardTitle></CardHeader>
          <CardContent>
            {openTasks.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No open tasks</p>}
            <ul className="divide-y divide-border">
              {openTasks.map((t: any) => (
                <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-muted-foreground">{t.due_date ? fmtDateTime(t.due_date) : "no due date"}</div>
                  </div>
                  <Badge variant="outline">{t.status}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent orders</CardTitle></CardHeader>
          <CardContent>
            {myOrders.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No orders yet</p>}
            <ul className="divide-y divide-border">
              {myOrders.map((o: any) => (
                <li key={o.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium">{o.order_number}</div>
                    <div className="text-xs text-muted-foreground">{o.clients?.business_name}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{inr(o.total_amount)}</div>
                    <Badge variant="outline" className="text-[10px]">{o.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
