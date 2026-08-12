import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getProofUrl } from "@/lib/delivery.functions";
import { Button } from "@/components/ui/button";
import { FileImage, Loader2, Maximize2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Payment-proof preview.
 *
 * - Nothing is requested until the card scrolls into view (IntersectionObserver).
 * - Only the small thumbnail is fetched for the inline preview.
 * - The full-resolution file is signed and opened only on explicit request.
 * - A fixed aspect box reserves space so loading the image causes no layout shift.
 */
export function ProofPreview({ path }: { path: string }) {
  const urlFn = useServerFn(getProofUrl);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [thumb, setThumb] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || thumb || failed) return;
    let cancelled = false;
    urlFn({ data: { path, thumb: true } })
      .then((r: any) => {
        if (cancelled) return;
        if (r?.url && r?.isImage) setThumb(r.url);
        else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [visible, thumb, failed, path, urlFn]);

  const openFull = useMutation({
    mutationFn: () => urlFn({ data: { path } }),
    onSuccess: (r: any) => window.open(r.url, "_blank", "noopener"),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div ref={boxRef} className="w-full max-w-[220px] space-y-1.5">
      {!failed && (
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md border border-border bg-muted">
          {thumb ? (
            <img
              src={thumb}
              alt="Payment proof preview"
              loading="lazy"
              decoding="async"
              width={400}
              height={300}
              className="h-full w-full object-cover"
              onError={() => setFailed(true)}
            />
          ) : (
            <div className="h-full w-full animate-pulse bg-muted" />
          )}
        </div>
      )}
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={() => openFull.mutate()}
        disabled={openFull.isPending}
      >
        {openFull.isPending ? (
          <Loader2 className="mr-1 size-4 animate-spin" />
        ) : failed ? (
          <FileImage className="mr-1 size-4" />
        ) : (
          <Maximize2 className="mr-1 size-4" />
        )}
        {failed ? "View proof" : "View full size"}
      </Button>
    </div>
  );
}
