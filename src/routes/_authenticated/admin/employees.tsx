import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listEmployees, createEmployee, updateEmployee } from "@/lib/employees.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { inr } from "@/lib/format";
import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/employees")({
  head: () => ({
    meta: [
      { title: "Employees — Kredix" },
      { name: "description", content: "Manage field employees, limits, and commission." },
      { property: "og:title", content: "Employees — Kredix" },
      { property: "og:description", content: "Manage field employees, limits, and commission." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Employees,
});

function Employees() {
  const listFn = useServerFn(listEmployees);
  const createFn = useServerFn(createEmployee);
  const updateFn = useServerFn(updateEmployee);
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["employees"], queryFn: () => listFn() });
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center">
        <div>
          <h1 className="font-display text-2xl font-semibold">Employees</h1>
          <p className="text-sm text-muted-foreground">Field staff, order limits, and commission.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="ml-auto"><Plus className="mr-1 size-4" />Add employee</Button>
          </DialogTrigger>
          <CreateForm createFn={createFn} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["employees"] }); }} />
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3">Name</th>
                  <th className="py-3">Territory</th>
                  <th className="py-3">Max order</th>
                  <th className="py-3">Order limit</th>
                  <th className="py-3">Commission</th>
                  <th className="py-3">Status</th>
                  <th className="py-3 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No employees yet</td></tr>}
                {data.map((e: any) => (
                  <EmployeeRow key={e.id} e={e} updateFn={updateFn} onSaved={() => qc.invalidateQueries({ queryKey: ["employees"] })} />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EmployeeRow({ e, updateFn, onSaved }: any) {
  const mut = useMutation({
    mutationFn: (patch: any) => updateFn({ data: { id: e.id, ...patch } }),
    onSuccess: () => { onSaved(); toast.success("Saved"); },
    onError: (err: any) => toast.error(err.message),
  });
  return (
    <tr className="border-b border-border/60">
      <td className="px-4 py-3 font-medium">{e.profiles?.name ?? "—"}<div className="text-xs text-muted-foreground">{e.profiles?.email}</div></td>
      <td className="py-3">{e.territory ?? "—"}</td>
      <td className="py-3">{inr(e.max_order_value)}</td>
      <td className="py-3">{e.order_limit}</td>
      <td className="py-3">{(Number(e.commission_rate) * 100).toFixed(2)}%</td>
      <td className="py-3">{e.active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</td>
      <td className="py-3 pr-4 text-right">
        <Button size="sm" variant="ghost" onClick={() => mut.mutate({ active: !e.active })}>{e.active ? "Deactivate" : "Activate"}</Button>
      </td>
    </tr>
  );
}

function CreateForm({ createFn, onDone }: any) {
  const [v, setV] = useState({
    email: "", password: "", name: "", phone: "", territory: "",
    order_limit: 100, max_order_value: 100000, base_salary: 0, commission_rate: 0.02,
  });
  const mut = useMutation({
    mutationFn: () => createFn({ data: { ...v, order_limit: Number(v.order_limit), max_order_value: Number(v.max_order_value), base_salary: Number(v.base_salary), commission_rate: Number(v.commission_rate) } }),
    onSuccess: () => { toast.success("Employee created"); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>New employee</DialogTitle></DialogHeader>
      <div className="grid gap-3 md:grid-cols-2">
        <F label="Name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></F>
        <F label="Email"><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></F>
        <F label="Password"><Input type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></F>
        <F label="Phone"><Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></F>
        <F label="Territory"><Input value={v.territory} onChange={(e) => setV({ ...v, territory: e.target.value })} /></F>
        <F label="Max order value (₹)"><Input type="number" value={v.max_order_value} onChange={(e) => setV({ ...v, max_order_value: e.target.value as any })} /></F>
        <F label="Order limit (count)"><Input type="number" value={v.order_limit} onChange={(e) => setV({ ...v, order_limit: e.target.value as any })} /></F>
        <F label="Commission rate (0-1)"><Input type="number" step="0.01" value={v.commission_rate} onChange={(e) => setV({ ...v, commission_rate: e.target.value as any })} /></F>
      </div>
      <DialogFooter>
        <Button onClick={() => mut.mutate()} disabled={mut.isPending || !v.email || v.password.length < 8}>{mut.isPending ? "Creating…" : "Create"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function F({ label, children }: any) { return <div className="space-y-1"><Label>{label}</Label>{children}</div>; }
