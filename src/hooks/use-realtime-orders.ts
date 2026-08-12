import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { acquireWorkflowRealtime } from "@/lib/realtime-hub";
import { qk } from "@/lib/query-keys";

/**
 * Keeps order lists, timelines and dashboards live without a page refresh.
 *
 * All consumers share ONE realtime channel (see realtime-hub): mounting this
 * hook in several widgets no longer opens duplicate sockets, and navigation
 * between pages reuses the same subscription instead of recreating it.
 */
export function useRealtimeOrders(orderId?: string) {
  const qc = useQueryClient();

  useEffect(() => {
    const release = acquireWorkflowRealtime(qc);
    return release;
  }, [qc]);

  // A focused panel also wants its own order slices fresh on mount.
  useEffect(() => {
    if (!orderId) return;
    qc.invalidateQueries({ queryKey: qk.orderWorkflow(orderId) as unknown as unknown[] });
    qc.invalidateQueries({ queryKey: qk.orderDelivery(orderId) as unknown as unknown[] });
  }, [qc, orderId]);
}
