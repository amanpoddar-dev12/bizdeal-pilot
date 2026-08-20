import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { scanOrderDocument, type ScanResult } from "@/lib/order-scan.functions";
import { prepareUpload } from "@/lib/image-compress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2, ScanLine, Upload } from "lucide-react";
import { toast } from "sonner";
import { inr } from "@/lib/format";

export const LOW_CONFIDENCE = 0.6;

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";

function toDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(file);
  });
}

function ConfidenceBadge({ value }: { value: number }) {
  if (value >= LOW_CONFIDENCE) return <Badge variant="secondary">{Math.round(value * 100)}% confident</Badge>;
  return (
    <Badge variant="destructive" className="gap-1">
      <AlertTriangle className="size-3" />
      Low confidence — review
    </Badge>
  );
}

/**
 * Upload → OCR → review. Applying the result only fills the existing order
 * form; it never creates an order on its own.
 */
export function OrderScanCard({ onApply }: { onApply: (r: ScanResult) => void }) {
  const scanFn = useServerFn(scanOrderDocument);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setResult(null);
    try {
      const { file: prepared } = await prepareUpload(file);
      if (prepared.size > 8_000_000) throw new Error("File is too large. Use a smaller photo or a PDF under 8 MB.");
      const fileData = await toDataUrl(prepared);
      const r = await scanFn({ data: { fileData, mimeType: prepared.type || file.type } });
      setResult(r);
      setFileName(file.name);
      toast.success("Document scanned — review the extracted values before submitting.");
    } catch (e: any) {
      toast.error(e?.message ?? "Scanning failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center">
        <CardTitle className="flex items-center gap-2">
          <ScanLine className="size-4" />
          Scan order document
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Upload className="mr-1 size-4" />}
          {busy ? "Scanning…" : "Upload image / PDF"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
      </CardHeader>
      <CardContent className="space-y-3">
        {!result && !busy && (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            Optional. Upload a photo or PDF of the order sheet and we&apos;ll extract the client, reference number and
            line items. Nothing is saved until you review and submit the form below.
          </p>
        )}
        {busy && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Reading the document…
          </p>
        )}

        {result && (
          <div className="space-y-3">
            {fileName && <p className="text-xs text-muted-foreground">From: {fileName}</p>}

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-border p-3">
                <div className="text-xs text-muted-foreground">Client</div>
                <div className="text-sm font-medium">{result.client_name ?? "Not detected"}</div>
                <div className="mt-1"><ConfidenceBadge value={result.client_name ? result.client_confidence : 0} /></div>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-xs text-muted-foreground">Reference number</div>
                <div className="text-sm font-medium">{result.reference_number ?? "Not detected"}</div>
                <div className="mt-1"><ConfidenceBadge value={result.reference_number ? result.reference_confidence : 0} /></div>
              </div>
            </div>

            <div className="space-y-2">
              {result.items.length === 0 && (
                <p className="text-sm text-muted-foreground">No line items were detected.</p>
              )}
              {result.items.map((it, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-sm">
                  <span className="font-medium">{it.product_name ?? "Unknown product"}</span>
                  {it.product_code && <span className="text-muted-foreground">({it.product_code})</span>}
                  <span className="text-muted-foreground">
                    {it.quantity ?? "?"} × {it.rate == null ? "?" : inr(it.rate)}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    {!it.product_id && <Badge variant="outline">No catalog match</Badge>}
                    <ConfidenceBadge value={it.confidence} />
                  </span>
                </div>
              ))}
            </div>

            {result.warnings.length > 0 && (
              <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                {result.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setResult(null)}>
                Discard
              </Button>
              <Button size="sm" onClick={() => onApply(result)}>
                Fill form with these values
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
