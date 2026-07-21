import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { shareLocation } from "@/lib/duty.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { MapPinned } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/employee/location")({
  head: () => ({
    meta: [
      { title: "Share location — Kredix" },
      { name: "description", content: "Share your current GPS location." },
      { property: "og:title", content: "Share location — Kredix" },
      { property: "og:description", content: "Share your current GPS location." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LocationPage,
});

function LocationPage() {
  const fn = useServerFn(shareLocation);
  const [last, setLast] = useState<{ lat: number; lng: number; acc?: number } | null>(null);
  const mut = useMutation({
    mutationFn: (v: any) => fn({ data: v }),
    onSuccess: () => toast.success("Location shared"),
    onError: (e: any) => toast.error(e.message),
  });

  function share() {
    if (!("geolocation" in navigator)) return toast.error("Geolocation not supported");
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      setLast({ lat: latitude, lng: longitude, acc: Math.round(accuracy) });
      mut.mutate({ latitude, longitude, accuracy_meters: Math.round(accuracy) });
    }, (err) => toast.error(err.message), { enableHighAccuracy: true, timeout: 10000 });
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div><h1 className="font-display text-2xl font-semibold">Share location</h1></div>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><MapPinned className="size-5" />Current position</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Sends your GPS location once. Admins can see the latest ping on the Locations page.</p>
          {last && (
            <div className="rounded-md border border-border p-3 text-xs">
              {last.lat.toFixed(5)}, {last.lng.toFixed(5)} {last.acc && `· ±${last.acc}m`}
            </div>
          )}
          <Button onClick={share} disabled={mut.isPending}>{mut.isPending ? "Sharing…" : "Share now"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
