import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { OrderStatusBadge } from "./order-status-badge";
import { getOrderWorkflow, clientReviewOrder } from "@/lib/order-workflow.functions";
import { getMe } from "@/lib/me.functions";
import { OrderDeliverySection } from "./order-delivery-section";
import { useRealtimeOrders } from "@/hooks/use-realtime-orders";
import { inr, fmtDate, fmtDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Check, X, Loader2 } from "lucide-react";

const CHECKS = [
  { key: "items", label: "I have verified the items, quantities and rates" },
  { key: "delivery", label: "Delivery date and address are correct" },
  { key: "credit", label: "I accept this order against my credit terms" },
];

export function OrderReviewPanel({
  orderId,
  open,
  onOpenChange,
  canReview,
}: {
  orderId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canReview: boolean;
}) {
  const detailFn = useServerFn(getOrderWorkflow);
  const meFn = useServerFn(getMe);
  const reviewFn = useServerFn(clientReviewOrder);
  const qc = useQueryClient();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [remarks, setRemarks] = useState("");

  useRealtimeOrders(orderId ?? undefined);

  const { data, isLoading } = useQuery({
    queryKey: ["order-workflow", orderId],
    queryFn: () => detailFn({ data: { id: orderId! } }),
    enabled: !!orderId && open,
  });

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => meFn() });
  const order: any = data?.order;
  const allChecked = useMemo(() => CHECKS.every((c) => checked[c.key]), [checked]);

  const review = useMutation({
    mutationFn: (action: "approve" | "reject") =>
      reviewFn({ data: { id: orderId!, action, checklist: checked, remarks: remarks || null } }),
    // Optimistic status flip so the UI reacts instantly.
    onMutate: async (action) => {
      await qc.cancelQueries({ queryKey: ["orders"] });
      const prev = qc.getQueryData<any[]>(["orders"]);
      const next = action === "approve" ? "payment_pending" : "client_rejected";
      qc.setQueryData<any[]>(["orders"], (rows) =>
        (rows ?? []).map((o) => (o.id === orderId ? { ...o, status: next } : o)),
      );
      return { prev };
    },
    onError: (e: any, _a, ctx) => {
      if (ctx?.prev) qc.setQueryData(["orders"], ctx.prev);
      toast.error(e.message);
    },
    onSuccess: (_r, action) => {
      toast.success(action === "approve" ? "Order accepted — submit payment next" : "Order rejected");
      if (action !== "approve") onOpenChange(false);
      setChecked({});
      setRemarks("");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["order-delivery", orderId] });
      qc.invalidateQueries({ queryKey: ["order-workflow", orderId] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const reviewable = canReview && order?.status === "pending_client";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {isLoading || !order ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-6 pb-6">
            <SheetHeader className="space-y-2 text-left">
              <div className="flex flex-wrap items-center gap-3">
                <SheetTitle className="font-display">{order.order_number}</SheetTitle>
                <OrderStatusBadge status={order.status} />
              </div>
              <SheetDescription>
                {order.clients?.business_name} · {fmtDate(order.order_date ?? order.created_at)}
              </SheetDescription>
            </SheetHeader>

            <section className="space-y-2">
              <h3 className="text-sm font-medium">Items</h3>
              <div className="rounded-lg border border-border">
                {(order.order_items ?? []).map((it: any) => (
                  <div key={it.id} className="flex items-center justify-between border-b border-border/60 px-3 py-2 text-sm last:border-0">
                    <div>
                      <div className="font-medium">{it.product_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {it.quantity} × {inr(it.rate)}
                      </div>
                    </div>
                    <div className="font-medium">{inr(it.amount)}</div>
                  </div>
                ))}
                <div className="flex items-center justify-between bg-muted/40 px-3 py-2 text-sm font-semibold">
                  <span>Total</span>
                  <span>{inr(order.total_amount)}</span>
                </div>
              </div>
              {order.notes && <p className="text-sm text-muted-foreground">{order.notes}</p>}
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-medium">Timeline</h3>
              <ol className="relative space-y-4 border-l border-border pl-4">
                <li className="relative">
                  <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-muted-foreground" />
                  <div className="text-sm">Order created</div>
                  <div className="text-xs text-muted-foreground">{fmtDateTime(order.created_at)}</div>
                </li>
                {(data?.events ?? []).map((e: any) => (
                  <li key={e.id} className="relative animate-in fade-in slide-in-from-bottom-1">
                    <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" />
                    <div className="text-sm capitalize">{String(e.event).replaceAll("_", " ")}</div>
                    <div className="text-xs text-muted-foreground">
                      {e.profiles?.name ? `${e.profiles.name} · ` : ""}{fmtDateTime(e.created_at)}
                    </div>
                    {e.note && <div className="mt-1 text-xs">{e.note}</div>}
                  </li>
                ))}
              </ol>
            </section>

            {reviewable && (
              <>
                <Separator />
                <section className="space-y-3">
                  <h3 className="text-sm font-medium">Confirm before approving</h3>
                  {CHECKS.map((c) => (
                    <label key={c.key} className="flex cursor-pointer items-start gap-2 text-sm">
                      <Checkbox
                        checked={!!checked[c.key]}
                        onCheckedChange={(v) => setChecked((s) => ({ ...s, [c.key]: !!v }))}
                      />
                      <span className="leading-snug">{c.label}</span>
                    </label>
                  ))}
                  <Textarea
                    rows={2}
                    placeholder="Remarks (optional)"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      disabled={!allChecked || review.isPending}
                      onClick={() => review.mutate("approve")}
                    >
                      <Check className="mr-1 size-4" /> Approve
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      disabled={review.isPending}
                      onClick={() => review.mutate("reject")}
                    >
                      <X className="mr-1 size-4" /> Reject
                    </Button>
                  </div>
                  {!allChecked && (
                    <p className="text-xs text-muted-foreground">Tick all confirmations to enable approval.</p>
                  )}
                </section>
              </>
            )}

            {me?.role && (
              <OrderDeliverySection order={order} role={me.role as any} />
            )}

            {(data?.approvals ?? []).length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Approval record</h3>
                {(data?.approvals ?? []).map((a: any) => (
                  <div key={a.id} className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="capitalize font-medium">{a.action}</span>
                      <span className="text-xs text-muted-foreground">{fmtDateTime(a.created_at)}</span>
                    </div>
                    {a.remarks && <p className="mt-1 text-xs text-muted-foreground">{a.remarks}</p>}
                  </div>
                ))}
              </section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
