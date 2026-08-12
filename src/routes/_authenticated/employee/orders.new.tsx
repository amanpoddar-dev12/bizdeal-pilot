import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listClients } from "@/lib/clients.functions";
import { createOrder } from "@/lib/orders.functions";
import { listProducts } from "@/lib/products.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus } from "lucide-react";
import { inr } from "@/lib/format";
import { useState } from "react";
import { toast } from "sonner";
import { qk } from "@/lib/query-keys";
import { invalidateFor } from "@/lib/query-mutations";

export const Route = createFileRoute("/_authenticated/employee/orders/new")({
  head: () => ({
    meta: [
      { title: "New order — Kredix" },
      { name: "description", content: "Punch a new order on behalf of a client." },
      { property: "og:title", content: "New order — Kredix" },
      { property: "og:description", content: "Punch a new order on behalf of a client." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NewOrder,
});

type LineItem = { product_id: string; product_name: string; product_code: string; quantity: number; rate: number };

const blankItem = (): LineItem => ({ product_id: "", product_name: "", product_code: "", quantity: 1, rate: 0 });

function NewOrder() {
  const clientsFn = useServerFn(listClients);
  const productsFn = useServerFn(listProducts);
  const createFn = useServerFn(createOrder);
  const nav = useNavigate();
  const { data: clients = [] } = useQuery({ queryKey: qk.clients, queryFn: () => clientsFn() });
  const { data: products = [] } = useQuery({ queryKey: qk.products, queryFn: () => productsFn() });
  const activeProducts = (products as any[]).filter((p) => p.active);
  const qc = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([blankItem()]);

  const total = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.rate || 0), 0);

  const mut = useMutation({
    mutationFn: () => createFn({
      data: {
        client_id: clientId,
        delivery_date: deliveryDate || null,
        notes: notes || null,
        items: items.map((i) => ({
          product_name: i.product_name,
          product_code: i.product_code || null,
          quantity: Number(i.quantity),
          rate: Number(i.rate),
        })),
      },
    }),
    onSuccess: (o: any) => {
      invalidateFor(qc, "order");
      toast.success(`Order ${o.order_number} created`);
      nav({ to: "/dashboard" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  function pickProduct(i: number, productId: string) {
    const p = activeProducts.find((x) => x.id === productId);
    setItems(items.map((it, j) => j === i
      ? { ...it, product_id: productId, product_name: p?.name ?? "", product_code: p?.code ?? "", rate: Number(p?.unit_price ?? 0) }
      : it));
  }

  function update(i: number, key: keyof LineItem, value: any) {
    setItems(items.map((it, j) => j === i ? { ...it, [key]: value } : it));
  }

  const canSubmit = clientId && items.length > 0 && items.every((i) => i.product_id && i.quantity > 0 && i.rate >= 0) && !mut.isPending;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div><h1 className="font-display text-xl font-semibold sm:text-2xl">New order</h1></div>
      <Card>
        <CardHeader><CardTitle>Client & delivery</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1"><Label>Client</Label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">Select client…</option>
              {(clients as any[]).map((c) => <option key={c.id} value={c.id}>{c.business_name}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label>Delivery date</Label><Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} /></div>
          <div className="md:col-span-2 space-y-1"><Label>Notes</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center">
          <CardTitle>Line items</CardTitle>
          <Button size="sm" variant="outline" className="ml-auto"
            onClick={() => setItems([...items, blankItem()])}>
            <Plus className="mr-1 size-4" />Add item
          </Button>
        </CardHeader>
        <CardContent>
          {activeProducts.length === 0 && (
            <p className="mb-3 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
              No products in the catalog yet. Ask an admin to add products before punching orders.
            </p>
          )}
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <select
                  className="col-span-6 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={it.product_id}
                  onChange={(e) => pickProduct(i, e.target.value)}
                >
                  <option value="">Select product…</option>
                  {activeProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                  ))}
                </select>
                <Input className="col-span-2" type="number" min="0" step="any" placeholder="Qty" value={it.quantity}
                  onChange={(e) => update(i, "quantity", Number(e.target.value))} />
                <Input className="col-span-3" type="number" min="0" step="any" placeholder="Rate" value={it.rate}
                  onChange={(e) => update(i, "rate", Number(e.target.value))} />
                <Button className="col-span-1" size="icon" variant="ghost"
                  onClick={() => setItems(items.filter((_, j) => j !== i))} disabled={items.length === 1}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
            <div className="text-sm text-muted-foreground">Total</div>
            <div className="font-display text-xl font-semibold">{inr(total)}</div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => mut.mutate()} disabled={!canSubmit}>
          {mut.isPending ? "Creating…" : "Create order"}
        </Button>
      </div>
    </div>
  );
}
