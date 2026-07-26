import { AlertTriangle, MapPin, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAutoLocation } from "@/hooks/use-auto-location";
import { fmtDateTime } from "@/lib/format";

/**
 * Small banner shown to employees when the browser has not granted
 * geolocation permission. Prompts them to enable it and explains why.
 */
export function LocationPermissionBanner({ role }: { role: string | undefined }) {
  const loc = useAutoLocation(role);
  if (role !== "employee") return null;

  if (loc.permission === "granted") {
    return (
      <div className="mb-3 flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
        <MapPin className="mt-0.5 size-4 text-emerald-600" />
        <div className="flex-1">
          <div className="font-medium text-emerald-700 dark:text-emerald-400">
            Location tracking active
          </div>
          <div className="text-muted-foreground">
            {loc.lastAddress
              ? <>Current: {loc.lastAddress}</>
              : <>Waiting for first fix…</>}
            {loc.lastAt && <> · Updated {fmtDateTime(loc.lastAt)}</>}
            {loc.lastAccuracy && <> · ±{loc.lastAccuracy}m</>}
          </div>
        </div>
      </div>
    );
  }

  if (loc.permission === "unsupported") {
    return (
      <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
        <AlertTriangle className="mt-0.5 size-4 text-amber-600" />
        <div>
          <div className="font-medium">Location not supported</div>
          <div className="text-muted-foreground">
            This device or browser doesn't support geolocation. Attendance and field tracking will be limited.
          </div>
        </div>
      </div>
    );
  }

  const denied = loc.permission === "denied";
  return (
    <div className="mb-3 flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <div className="flex-1">
        <div className="font-medium">
          {denied ? "Location access blocked" : "Location access required"}
        </div>
        <div className="text-muted-foreground">
          We use your location for attendance verification and field activity tracking. Updates every 5 minutes while you're signed in.
          {denied && <> Please enable location in your browser's site settings and reload.</>}
        </div>
      </div>
      {!denied && (
        <Button size="sm" onClick={loc.request}>
          <MapPin className="mr-1 size-3.5" /> Enable
        </Button>
      )}
    </div>
  );
}

/** Small inline "Updating…" indicator, exported for reuse if needed. */
export function LocationUpdatingHint() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Loader2 className="size-3 animate-spin" /> Updating location…
    </span>
  );
}
