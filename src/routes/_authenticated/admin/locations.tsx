import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listEmployeeLatestLocations } from "@/lib/duty.functions";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDateTime } from "@/lib/format";
import { MapPin } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/locations")({
  head: () => ({
    meta: [
      { title: "Locations — Kredix" },
      { name: "description", content: "Latest GPS ping from each field employee." },
      { property: "og:title", content: "Locations — Kredix" },
      { property: "og:description", content: "Latest GPS ping from each field employee." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Locations,
});

function Locations() {
  const fn = useServerFn(listEmployeeLatestLocations);
  const { data = [] } = useQuery({ queryKey: ["locations"], queryFn: () => fn() });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Employee locations</h1>
        <p className="text-sm text-muted-foreground">Latest ping per employee. Click to open in Maps.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {data.length === 0 && <p className="text-sm text-muted-foreground">No location pings yet.</p>}
        {data.map((l: any) => (
          <a key={l.id} href={`https://www.google.com/maps?q=${l.latitude},${l.longitude}`} target="_blank" rel="noreferrer">
            <Card className="hover:border-primary/50 transition">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 font-medium"><MapPin className="size-4" />{l.profiles?.name ?? "—"}</div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {Number(l.latitude).toFixed(5)}, {Number(l.longitude).toFixed(5)}
                  {l.accuracy_meters && <> · ±{l.accuracy_meters}m</>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{fmtDateTime(l.captured_at)}</div>
              </CardContent>
            </Card>
          </a>
        ))}
      </div>
    </div>
  );
}
