import { useEffect, useState } from "react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

/** Small inline spinner usable inside buttons and cards. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]",
        className,
      )}
    />
  );
}

/**
 * Global activity indicator:
 *  - slim top progress bar whenever anything is in flight (queries, route
 *    transitions, mutations) — cheap, non-blocking, no layout shift
 *  - blocking overlay ONLY for long-running user-initiated mutations. A
 *    background refetch or a slow route load never covers a page the user
 *    can already read and use.
 */
export function GlobalLoader() {
  const routerPending = useRouterState({
    select: (s) => s.status === "pending" || s.isLoading,
  });
  // Background refetches must stay invisible: only count queries that have
  // nothing to show yet (first load) plus user-initiated mutations.
  const coldFetching = useIsFetching({
    predicate: (q) => q.state.status === "pending" && q.state.data === undefined,
  });
  const mutating = useIsMutating();

  const active = routerPending || coldFetching > 0 || mutating > 0;
  // Overlay is reserved for writes; reads degrade to the progress bar.
  const blocking = mutating > 0;
  const [showBar, setShowBar] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);

  useEffect(() => {
    if (!active) {
      setShowBar(false);
      setShowOverlay(false);
      return;
    }
    const barId = setTimeout(() => setShowBar(true), 150);
    const overlayId = blocking ? setTimeout(() => setShowOverlay(true), 1200) : undefined;
    return () => {
      clearTimeout(barId);
      if (overlayId) clearTimeout(overlayId);
    };
  }, [active, blocking]);

  return (
    <>
      <div
        aria-hidden={!showBar}
        className={cn(
          "pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden transition-opacity duration-200",
          showBar ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="h-full w-1/3 animate-[loader-slide_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
      </div>

      <div
        role="status"
        aria-live="polite"
        aria-hidden={!showOverlay}
        className={cn(
          "fixed inset-0 z-[55] grid place-items-center bg-background/60 backdrop-blur-[2px] transition-opacity duration-200",
          showOverlay ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 shadow-lg">
          <Spinner className="size-5 text-primary" />
          <div className="text-sm">
            <div className="font-medium text-foreground">Working on it…</div>
            <div className="text-xs text-muted-foreground">This is taking a moment, please wait.</div>
          </div>
        </div>
      </div>
    </>
  );
}
