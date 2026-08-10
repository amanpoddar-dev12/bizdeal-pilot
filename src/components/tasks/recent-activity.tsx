import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { getActivityHistory, type ActivityItem } from "@/lib/task-center.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OrderReviewPanel } from "@/components/orders/order-review-panel";
import { inr, fmtDateTime } from "@/lib/format";
import { ChevronRight } from "lucide-react";

export function RecentActivity({ limit = 5 }: { limit?: number }) {
  const fn = useServerFn(getActivityHistory);
  const { data, isLoading } = useQuery({
    queryKey: ["activity-history", limit],
    queryFn: () => fn({ data: { limit } }),
  });
  const [orderId, setOrderId] = useState<string | null>(null);
  const items: ActivityItem[] = data?.items ?? [];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Recent activity</CardTitle>
          <Link to="/history" className="flex items-center gap-1 text-xs text-primary hover:underline">
            View history <ChevronRight className="size-3" />
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && <p className="px-6 pb-4 text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && items.length === 0 && (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No activity yet</p>
          )}
          <ul className="divide-y divide-border">
            {items.map((i) => (
              <li key={i.id} className="flex items-center gap-2 px-4 py-2 sm:px-6">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{i.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[
                      i.orderNumber ? `Order ${i.orderNumber}` : null,
                      i.entity,
                      i.amount != null ? inr(i.amount) : null,
                      fmtDateTime(i.at),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                {i.orderId && (
                  <Button size="sm" variant="ghost" onClick={() => setOrderId(i.orderId!)}>
                    View
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <OrderReviewPanel
        orderId={orderId}
        open={!!orderId}
        onOpenChange={(v) => !v && setOrderId(null)}
        canReview={false}
      />
    </>
  );
}
