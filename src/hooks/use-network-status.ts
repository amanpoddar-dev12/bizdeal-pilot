import { useEffect, useState } from "react";

type Conn = { effectiveType?: string; saveData?: boolean; addEventListener?: any; removeEventListener?: any };

function readConn(): Conn | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as any).connection ?? (navigator as any).mozConnection ?? (navigator as any).webkitConnection;
}

/**
 * Online/offline plus a "slow link" signal (Save-Data or 2g/3g).
 * Used to trim work on constrained devices — never to change permissions
 * or business behaviour.
 */
export function useNetworkStatus() {
  const [online, setOnline] = useState(true);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const sync = () => {
      setOnline(navigator.onLine);
      const c = readConn();
      const type = c?.effectiveType ?? "";
      setSlow(Boolean(c?.saveData) || type === "slow-2g" || type === "2g" || type === "3g");
    };
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    const c = readConn();
    c?.addEventListener?.("change", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      c?.removeEventListener?.("change", sync);
    };
  }, []);

  return { online, slow };
}

/** Non-reactive read for one-off decisions (initial page sizes etc.). */
export function isConstrainedClient() {
  if (typeof window === "undefined") return false;
  const c = readConn();
  const type = c?.effectiveType ?? "";
  return (
    Boolean(c?.saveData) ||
    type === "slow-2g" ||
    type === "2g" ||
    type === "3g" ||
    window.matchMedia("(max-width: 640px)").matches
  );
}
