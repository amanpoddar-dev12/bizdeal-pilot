import { Spinner } from "@/components/global-loader";

/** Shown while a route's loader is in flight. */
export function RoutePending() {
  return (
    <div className="grid min-h-[50vh] place-items-center p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <Spinner className="size-6 text-primary" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    </div>
  );
}
