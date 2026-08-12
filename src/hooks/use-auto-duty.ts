import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { clockIn, clockOut, getMyDutyStatus } from "@/lib/duty.functions";
import { qk } from "@/lib/query-keys";

/**
 * Automatically clocks the employee in when the app is active and clocks
 * them out when the tab is hidden/closed or after a period of inactivity.
 * Only runs for role === "employee".
 */
export function useAutoDuty(role: string | undefined) {
  const inFn = useServerFn(clockIn);
  const outFn = useServerFn(clockOut);
  const statusFn = useServerFn(getMyDutyStatus);
  const qc = useQueryClient();
  const openRef = useRef(false);

  useEffect(() => {
    if (role !== "employee") return;
    let cancelled = false;

    async function ensureIn() {
      try {
        const s = await statusFn();
        if (cancelled) return;
        if (!s?.open) {
          await inFn();
          openRef.current = true;
          qc.invalidateQueries({ queryKey: qk.duty });
        } else {
          openRef.current = true;
        }
      } catch { /* ignore */ }
    }

    async function doOut() {
      if (!openRef.current) return;
      openRef.current = false;
      try {
        await outFn();
        qc.invalidateQueries({ queryKey: qk.duty });
      } catch { /* ignore */ }
    }

    ensureIn();

    function onVisibility() {
      if (document.visibilityState === "visible") ensureIn();
      else doOut();
    }
    function onBeforeUnload() {
      // Best-effort — request may not complete but browser will try.
      doOut();
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);

    // Periodic heartbeat — if session was closed by admin/system, reopen while active.
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === "visible") ensureIn();
    }, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.clearInterval(heartbeat);
      doOut();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);
}
