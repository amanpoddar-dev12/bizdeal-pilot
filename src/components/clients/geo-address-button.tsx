import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin } from "lucide-react";
import { reverseGeocode } from "@/lib/reverse-geocode";
import { toast } from "sonner";

/**
 * Optional helper: fills the address field from the device location.
 * Geolocation is never mandatory — if permission is denied or the device has
 * no GPS we simply tell the user and leave the manual field untouched.
 */
export function GeoAddressButton({
  onResolved,
}: {
  onResolved: (v: { address: string; latitude: number; longitude: number }) => void;
}) {
  const [busy, setBusy] = useState(false);

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Location isn't available on this device. Please type the address.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const r = await reverseGeocode(latitude, longitude);
          const address = r.address ?? [r.place_name, r.area, r.city, r.state, r.country].filter(Boolean).join(", ");
          if (!address) {
            toast.message("Captured coordinates. Please type the address manually.");
            onResolved({ address: "", latitude, longitude });
          } else {
            onResolved({ address, latitude, longitude });
            toast.success("Address filled from your location — edit it if needed.");
          }
        } catch {
          onResolved({ address: "", latitude, longitude });
          toast.message("Couldn't look up the address. Please type it manually.");
        } finally {
          setBusy(false);
        }
      },
      () => {
        setBusy(false);
        toast.error("Location permission denied — please enter the address manually.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={locate} disabled={busy}>
      {busy ? <Loader2 className="mr-1 size-4 animate-spin" /> : <MapPin className="mr-1 size-4" />}
      Use my location
    </Button>
  );
}
