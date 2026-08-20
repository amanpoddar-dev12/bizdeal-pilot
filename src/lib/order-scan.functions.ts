import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * OCR / document extraction for the employee "new order" screen.
 *
 * The model only EXTRACTS what it can read — it never invents values. Every
 * extracted field carries a 0..1 confidence so the UI can flag low-confidence
 * values for manual review. Nothing here creates an order; the employee always
 * confirms through the existing order form + createOrder server fn.
 */

const scanInput = z.object({
  /** Full data URL: data:<mime>;base64,<...> */
  fileData: z.string().min(32).max(12_000_000),
  mimeType: z.string().min(3).max(120),
});

export type ScannedItem = {
  product_name: string | null;
  product_code: string | null;
  quantity: number | null;
  rate: number | null;
  confidence: number;
  /** Matched catalog product id, when a confident match exists. */
  product_id: string | null;
  matched_by: "code" | "name" | null;
};

export type ScanResult = {
  reference_number: string | null;
  reference_confidence: number;
  client_name: string | null;
  client_confidence: number;
  client_id: string | null;
  items: ScannedItem[];
  warnings: string[];
};

const modelSchema = z.object({
  reference_number: z.string().nullable().optional(),
  reference_confidence: z.number().min(0).max(1).nullable().optional(),
  client_name: z.string().nullable().optional(),
  client_confidence: z.number().min(0).max(1).nullable().optional(),
  items: z
    .array(
      z.object({
        product_name: z.string().nullable().optional(),
        product_code: z.string().nullable().optional(),
        quantity: z.number().nullable().optional(),
        rate: z.number().nullable().optional(),
        confidence: z.number().min(0).max(1).nullable().optional(),
      }),
    )
    .optional(),
  warnings: z.array(z.string()).optional(),
});

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export const scanOrderDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => scanInput.parse(d))
  .handler(async ({ data, context }): Promise<ScanResult> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("Document scanning is not configured. Contact your administrator.");

    const { supabase } = context;
    // RLS scopes both lists to what this employee may already see.
    const [{ data: products }, { data: clients }] = await Promise.all([
      supabase.from("products").select("id, code, name, unit_price, active").eq("active", true).limit(500),
      supabase.from("clients").select("id, business_name").limit(500),
    ]);

    const catalog = (products ?? []).map((p) => `${p.code} | ${p.name}`).join("\n").slice(0, 6000);

    const system = [
      "You extract purchase-order data from a scanned document or photo.",
      "Read the image even if it is rotated, skewed, or low quality.",
      "NEVER guess or invent a value. If a field is not clearly readable, return null for it.",
      "Return a confidence between 0 and 1 for each extracted value, reflecting how legible it was.",
      "Quantities and rates must be plain numbers (no currency symbols, no thousands separators).",
      "Only these products exist in the catalog (code | name). Match line items to them when possible:",
      catalog || "(catalog is empty)",
      "Respond with JSON only, matching exactly this shape:",
      '{"reference_number":string|null,"reference_confidence":number,"client_name":string|null,"client_confidence":number,"items":[{"product_name":string|null,"product_code":string|null,"quantity":number|null,"rate":number|null,"confidence":number}],"warnings":string[]}',
    ].join("\n");

    let res: Response;
    try {
      res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "google/gemini-3.7-flash",
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: [
                { type: "text", text: "Extract the order information from this document." },
                data.mimeType === "application/pdf"
                  ? { type: "file", file: { filename: "order.pdf", file_data: data.fileData } }
                  : { type: "image_url", image_url: { url: data.fileData } },
              ],
            },
          ],
          response_format: { type: "json_object" },
        }),
      });
    } catch {
      throw new Error("Could not reach the scanning service. Check your connection and try again.");
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Scanning is busy right now. Please try again in a moment.");
      if (res.status === 402) throw new Error("AI credits are exhausted. Ask an administrator to top up.");
      if (res.status === 403) throw new Error("AI scanning is disabled for this workspace.");
      throw new Error(`Scanning failed (${res.status}). ${body.slice(0, 200)}`);
    }

    const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = payload.choices?.[0]?.message?.content ?? "";
    const jsonText = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

    let parsed: z.infer<typeof modelSchema>;
    try {
      parsed = modelSchema.parse(JSON.parse(jsonText));
    } catch {
      throw new Error("Could not read any order details from this file. Try a clearer photo.");
    }

    const items: ScannedItem[] = (parsed.items ?? []).map((it) => {
      const code = it.product_code?.trim() || null;
      const name = it.product_name?.trim() || null;
      let match = code ? (products ?? []).find((p) => norm(p.code) === norm(code)) : undefined;
      let matched_by: ScannedItem["matched_by"] = match ? "code" : null;
      if (!match && name) {
        const n = norm(name);
        match = (products ?? []).find((p) => norm(p.name) === n) ?? (products ?? []).find((p) => norm(p.name).includes(n) && n.length >= 4);
        if (match) matched_by = "name";
      }
      const qty = typeof it.quantity === "number" && it.quantity > 0 ? it.quantity : null;
      const rate = typeof it.rate === "number" && it.rate >= 0 ? it.rate : match ? Number(match.unit_price) : null;
      return {
        product_name: match?.name ?? name,
        product_code: match?.code ?? code,
        quantity: qty,
        rate,
        confidence: typeof it.confidence === "number" ? it.confidence : 0,
        product_id: match?.id ?? null,
        matched_by,
      };
    });

    const clientName = parsed.client_name?.trim() || null;
    let clientId: string | null = null;
    if (clientName) {
      const n = norm(clientName);
      const hit =
        (clients ?? []).find((c) => norm(c.business_name) === n) ??
        (clients ?? []).find((c) => norm(c.business_name).includes(n) && n.length >= 4);
      clientId = hit?.id ?? null;
    }

    const warnings = [...(parsed.warnings ?? [])];
    if (items.length === 0) warnings.push("No line items could be read from this document.");
    if (items.some((i) => !i.product_id)) warnings.push("Some line items did not match a catalog product — select them manually.");
    if (clientName && !clientId) warnings.push(`Client "${clientName}" did not match a client you can access — select it manually.`);

    return {
      reference_number: parsed.reference_number?.trim() || null,
      reference_confidence: parsed.reference_confidence ?? 0,
      client_name: clientName,
      client_confidence: parsed.client_confidence ?? 0,
      client_id: clientId,
      items,
      warnings,
    };
  });
