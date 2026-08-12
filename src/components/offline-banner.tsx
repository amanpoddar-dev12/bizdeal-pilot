import { WifiOff } from "lucide-react";
import { useNetworkStatus } from "@/hooks/use-network-status";

/**
 * Slim offline strip. Cached pages stay fully rendered and usable; this only
 * tells the user why numbers may be stale, and disappears when the link
 * returns (React Query refetches on reconnect).
 */
export function OfflineBanner() {
  const { online } = useNetworkStatus();
  if (online) return null;
  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
      <WifiOff className="size-3.5 shrink-0" />
      <span className="truncate">You're offline — showing saved data. Changes will sync when you reconnect.</span>
    </div>
  );
}
