import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listClients } from "@/lib/clients.functions";
import { createOrder } from "@/lib/orders.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus } from "lucide-react";
import { inr } from "@/lib/format";
import { useState } from "react";
import { toast } from "sonner";

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

function NewOrder() {
  const clientsFn = useServerFn(listClients);
  const createFn = useServerFn(createOrder);
  const nav = useNavigate();
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => clientsFn() });
  const [clientId, setClientId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState([{ product_name: "", product_code: "", quantity: 1, rate: 0 }]);

  const total = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.rate || 0), 0);

  const mut = useMutation({
    mutationFn: () => createFn({
      data: {
        client_id: clientId,
        delivery_date: deliveryDate || null,
        notes: notes || null,
        items: items.map((i) => ({ ...i, quantity: Number(i.quantity), rate: Number(i.rate) })),
      },
    }),
    onSuccess: (o: any) => { toast.success(`Order ${o.order_number} created`); nav({ to: "/dashboard" }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div><h1 className="font-display text-2xl font-semibold">New order</h1></div>
      <Card>
        <CardHeader><CardTitle>Client & delivery</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1"><Label>Client</Label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">Select client…</option>
              {clients.map((c: any) => <option key={c.id} value={c.id}>{c.business_name}</option>)}
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
            onClick={() => setItems([...items, { product_name: "", product_code: "", quantity: 1, rate: 0 }])}>
            <Plus className="mr-1 size-4" />Add item
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <Input className="col-span-5" placeholder="Product" value={it.product_name} onChange={(e) => update(i, "product_name", e.target.value)} />
                <Input className="col-span-2" placeholder="Code" value={it.product_code} onChange={(e) => update(i, "product_code", e.target.value)} />
                <Input className="col-span-2" type="number" placeholder="Qty" value={it.quantity} onChange={(e) => update(i, "quantity", e.target.value)} />
                <Input className="col-span-2" type="number" placeholder="Rate" value={it.rate} onChange={(e) => update(i, "rate", e.target.value)} />
                <Button className="col-span-1" size="icon" variant="ghost" onClick={() => setItems(items.filter((_, j) => j !== i))} disabled={items.length === 1}>
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
        <Button onClick={() => mut.mutate()} disabled={!clientId || items.some((i) => !i.product_name || !i.quantity || !i.rate) || mut.isPending}>
          {mut.isPending ? "Creating…" : "Create order"}
        </Button>
      </div>
    </div>
  );

  function update(i: number, key: string, value: any) {
    setItems(items.map((it, j) => j === i ? { ...it, [key]: value } : it));
  }
}
