import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Keeps order lists, timelines and dashboards live without a page refresh.
 * One channel per mounted consumer, torn down on unmount.
 */
export function useRealtimeOrders(orderId?: string) {
  const qc = useQueryClient();

  useEffect(() => {
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      if (orderId) qc.invalidateQueries({ queryKey: ["order-workflow", orderId] });
    };

    const channel = supabase
      .channel(`orders-live${orderId ? `-${orderId}` : ""}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_events" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_approvals" }, refresh)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, orderId]);
}
