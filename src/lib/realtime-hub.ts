import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";

/**
 * Single shared Realtime hub.
 *
 * Why a hub instead of a channel per component:
 *  - Several widgets can be mounted at once (dashboard + pending tasks +
 *    order panel). One channel per widget meant N duplicate sockets and N
 *    invalidations for the same database event.
 *  - Navigation remounts widgets; a refcount keeps the SAME channel alive
 *    instead of tearing down and recreating it.
 *
 * Authorization is unchanged: Realtime applies the same RLS policies as the
 * Data API, so each subscriber only ever receives rows their role/assignment
 * already allows them to read. Notifications are additionally filtered
 * server-side to the current user.
 *
 * Only workflow-critical tables are subscribed. Static-ish data (products,
 * reports, audit history, archived activity) intentionally stays on normal
 * cached/background fetching.
 */

type Table =
  | "orders"
  | "order_events"
  | "order_approvals"
  | "order_payments"
  | "delivery_otps";

const WORKFLOW_TABLES: Table[] = [
  "orders",
  "order_events",
  "order_approvals",
  "order_payments",
  "delivery_otps",
];

/** Which cached slices a change on a given table can actually affect. */
function keysForTable(table: Table): Array<readonly unknown[]> {
  switch (table) {
    case "orders":
      // Orders consume credit the moment they exist, so the purse moves too.
      return [qk.orders, qk.pendingTasks, qk.activityHistory(), qk.adminReports, qk.clients, qk.creditPurseHistory()];
    case "order_events":
    case "order_approvals":
      return [qk.orders, qk.pendingTasks, qk.activityHistory()];
    case "order_payments":
      return [qk.orders, qk.payments, qk.pendingTasks, qk.activityHistory(), qk.adminReports, qk.clients, qk.creditPurseHistory()];
    case "delivery_otps":
      return [qk.orders, qk.pendingTasks, qk.activityHistory()];
  }
}

type HubState = {
  channel: ReturnType<typeof supabase.channel>;
  refs: number;
  qc: QueryClient;
  pending: Set<string>;
  pendingOrders: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
};

let hub: HubState | null = null;
const keyRegistry = new Map<string, readonly unknown[]>();

function flush() {
  if (!hub) return;
  hub.timer = null;
  const { qc } = hub;
  for (const serialized of hub.pending) {
    const key = keyRegistry.get(serialized);
    if (key) qc.invalidateQueries({ queryKey: key as unknown[] });
  }
  for (const orderId of hub.pendingOrders) {
    qc.invalidateQueries({ queryKey: qk.orderWorkflow(orderId) as unknown as unknown[] });
    qc.invalidateQueries({ queryKey: qk.orderDelivery(orderId) as unknown as unknown[] });
  }
  hub.pending.clear();
  hub.pendingOrders.clear();
}

/** Coalesce bursts (a workflow RPC writes several rows at once). */
function schedule(keys: Array<readonly unknown[]>, orderId?: string | null) {
  if (!hub) return;
  for (const key of keys) {
    const serialized = JSON.stringify(key);
    keyRegistry.set(serialized, key);
    hub.pending.add(serialized);
  }
  if (orderId) hub.pendingOrders.add(orderId);
  if (hub.timer === null) hub.timer = setTimeout(flush, 250);
}

function pickOrderId(payload: any): string | null {
  const row = payload?.new ?? payload?.old;
  if (!row) return null;
  return (row.order_id as string) ?? (row.id as string) ?? null;
}

/** Acquire the shared workflow channel. Returns a release function. */
export function acquireWorkflowRealtime(qc: QueryClient): () => void {
  if (!hub) {
    const channel = supabase.channel("workflow-live");
    const state: HubState = {
      channel,
      refs: 0,
      qc,
      pending: new Set(),
      pendingOrders: new Set(),
      timer: null,
    };
    hub = state;
    for (const table of WORKFLOW_TABLES) {
      channel.on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table },
        (payload: any) => schedule(keysForTable(table), pickOrderId(payload)),
      );
    }
    channel.subscribe();
  }
  hub.qc = qc;
  hub.refs += 1;

  let released = false;
  return () => {
    if (released || !hub) return;
    released = true;
    hub.refs -= 1;
    if (hub.refs <= 0) teardownWorkflow();
  };
}

function teardownWorkflow() {
  if (!hub) return;
  if (hub.timer) clearTimeout(hub.timer);
  supabase.removeChannel(hub.channel);
  hub = null;
}

/* ------------------------------------------------------------------ */
/* Per-user notification channel (server-side filtered to the user id)  */
/* ------------------------------------------------------------------ */

type NotifState = {
  channel: ReturnType<typeof supabase.channel>;
  refs: number;
  userId: string;
};
let notifHub: NotifState | null = null;

export function acquireNotificationRealtime(
  qc: QueryClient,
  userId: string,
  onInsert?: () => void,
): () => void {
  if (notifHub && notifHub.userId !== userId) teardownNotifications();
  if (!notifHub) {
    const channel = supabase
      .channel(`notif-${userId}`)
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => {
          qc.invalidateQueries({ queryKey: qk.notifications as unknown as unknown[] });
          qc.invalidateQueries({ queryKey: qk.pendingTasks as unknown as unknown[] });
          for (const cb of notifListeners) cb();
        },
      );
    notifHub = { channel, refs: 0, userId };
    channel.subscribe();
  }
  notifHub.refs += 1;
  if (onInsert) notifListeners.add(onInsert);

  let released = false;
  return () => {
    if (released || !notifHub) return;
    released = true;
    if (onInsert) notifListeners.delete(onInsert);
    notifHub.refs -= 1;
    if (notifHub.refs <= 0) teardownNotifications();
  };
}

const notifListeners = new Set<() => void>();

function teardownNotifications() {
  if (!notifHub) return;
  supabase.removeChannel(notifHub.channel);
  notifHub = null;
}

/** Drop every subscription — used on sign-out so nothing survives the session. */
export function teardownAllRealtime() {
  teardownWorkflow();
  teardownNotifications();
  notifListeners.clear();
}
