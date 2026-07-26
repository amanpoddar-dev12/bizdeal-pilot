import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { shareLocation } from "@/lib/duty.functions";
import { reverseGeocode } from "@/lib/reverse-geocode";

const INTERVAL_MS = 5 * 60 * 1000;

export type LocationPermissionState =
  | "unknown"
  | "prompt"
  | "granted"
  | "denied"
  | "unsupported";

export type AutoLocationState = {
  permission: LocationPermissionState;
  lastAt?: string;
  lastAddress?: string;
  lastAccuracy?: number;
  lastError?: string;
  request: () => Promise<void>;
};

/**
 * Automatically tracks the employee's location every 5 minutes while the app
 * is active. Requests permission on mount, reverse-geocodes coordinates, and
 * writes readable place info to the server.
 */
export function useAutoLocation(role: string | undefined): AutoLocationState {
  const share = useServerFn(shareLocation);
  const [permission, setPermission] = useState<LocationPermissionState>("unknown");
  const [lastAt, setLastAt] = useState<string | undefined>();
  const [lastAddress, setLastAddress] = useState<string | undefined>();
  const [lastAccuracy, setLastAccuracy] = useState<number | undefined>();
  const [lastError, setLastError] = useState<string | undefined>();
  const busyRef = useRef(false);

  async function capture(highAccuracy: boolean): Promise<GeolocationPosition | null> {
    return new Promise((resolve) => {
      if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos),
        () => resolve(null),
        {
          enableHighAccuracy: highAccuracy,
          timeout: highAccuracy ? 15000 : 8000,
          maximumAge: 0,
        },
      );
    });
  }

  async function pingOnce() {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      // Prefer GPS; fall back to network.
      let pos = await capture(true);
      let source: "gps" | "network" = "gps";
      if (!pos) {
        pos = await capture(false);
        source = "network";
      }
      if (!pos) {
        setLastError("Location unavailable");
        return;
      }
      const { latitude, longitude, accuracy } = pos.coords;
      const addr = await reverseGeocode(latitude, longitude);
      await share({
        data: {
          latitude,
          longitude,
          accuracy_meters: Math.round(accuracy),
          source,
          ...addr,
        },
      });
      const readable = [addr.place_name, addr.area, addr.city, addr.state]
        .filter(Boolean)
        .join(", ");
      setLastAddress(readable || addr.address || "Location recorded");
      setLastAccuracy(Math.round(accuracy));
      setLastAt(new Date().toISOString());
      setLastError(undefined);
      setPermission("granted");
    } catch (e: any) {
      setLastError(e?.message ?? "Failed to update location");
    } finally {
      busyRef.current = false;
    }
  }

  async function request() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setPermission("unsupported");
      return;
    }
    // Triggering getCurrentPosition surfaces the browser prompt.
    await pingOnce();
  }

  useEffect(() => {
    if (role !== "employee") return;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setPermission("unsupported");
      return;
    }

    let cancelled = false;
    let permStatus: PermissionStatus | null = null;

    async function boot() {
      try {
        if ((navigator as any).permissions?.query) {
          permStatus = await (navigator as any).permissions.query({ name: "geolocation" });
          if (cancelled) return;
          const map = (s: string): LocationPermissionState =>
            s === "granted" ? "granted" : s === "denied" ? "denied" : "prompt";
          setPermission(map(permStatus!.state));
          permStatus!.onchange = () => {
            setPermission(map(permStatus!.state));
            if (permStatus!.state === "granted") pingOnce();
          };
          if (permStatus!.state === "granted") pingOnce();
        } else {
          // No Permissions API — attempt directly.
          pingOnce();
        }
      } catch {
        pingOnce();
      }
    }
    boot();

    const iv = window.setInterval(() => {
      if (document.visibilityState === "visible") pingOnce();
    }, INTERVAL_MS);

    const onVis = () => {
      if (document.visibilityState === "visible") pingOnce();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      if (permStatus) permStatus.onchange = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  return { permission, lastAt, lastAddress, lastAccuracy, lastError, request };
}
