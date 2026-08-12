import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";

/**
 * Keeps order lists, timelines and dashboards live without a page refresh.
 * One channel per mounted consumer, torn down on unmount.
 */
export function useRealtimeOrders(orderId?: string) {
  const qc = useQueryClient();

  useEffect(() => {
    const refresh = () => {
      qc.invalidateQueries({ queryKey: qk.orders });
      qc.invalidateQueries({ queryKey: qk.adminReports });
      qc.invalidateQueries({ queryKey: qk.payments });
      qc.invalidateQueries({ queryKey: qk.notifications });
      qc.invalidateQueries({ queryKey: qk.pendingTasks });
      qc.invalidateQueries({ queryKey: qk.activityHistory() });
      if (orderId) {
        qc.invalidateQueries({ queryKey: qk.orderWorkflow(orderId) });
        qc.invalidateQueries({ queryKey: qk.orderDelivery(orderId) });
      }
    };

    const channel = supabase
      .channel(`orders-live-${orderId ?? "all"}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_events" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_approvals" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_payments" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_otps" }, refresh)
      .subscribe();


    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, orderId]);
}
