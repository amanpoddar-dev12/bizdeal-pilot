import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { qk } from "@/lib/query-keys";
import { invalidateFor } from "@/lib/query-mutations";
import { ALL_PERMISSIONS, EMPLOYEE_PERMISSIONS, READ_ONLY_PRESET } from "@/lib/permissions";
import { listEmployeePermissions, setEmployeePermissions } from "@/lib/employee-permissions.functions";

export function useEmployeePermissionMap() {
  const listFn = useServerFn(listEmployeePermissions);
  const { data = [] } = useQuery({ queryKey: qk.employeePermissions, queryFn: () => listFn() });
  return useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of data as any[]) {
      map.set(row.employee_id, [...(map.get(row.employee_id) ?? []), row.permission]);
    }
    return map;
  }, [data]);
}

export function EmployeePermissionsDialog({
  employeeId, employeeName, current,
}: { employeeId: string; employeeName: string; current: string[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(current);
  const qc = useQueryClient();
  const saveFn = useServerFn(setEmployeePermissions);

  useEffect(() => { if (open) setSelected(current); }, [open, current]);

  const mut = useMutation({
    mutationFn: () => saveFn({ data: { employee_id: employeeId, permissions: selected } }),
    onSuccess: () => {
      toast.success("Permissions updated");
      invalidateFor(qc, "employee");
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggle = (key: string, on: boolean) =>
    setSelected((s) => (on ? [...new Set([...s, key])] : s.filter((k) => k !== key)));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <ShieldCheck className="mr-1 size-4" />Permissions
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Permissions — {employeeName}</DialogTitle>
          <DialogDescription>
            Only the ticked actions are allowed. Rules are enforced in the app, the API and the database.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setSelected([...ALL_PERMISSIONS])}>Full access</Button>
          <Button size="sm" variant="outline" onClick={() => setSelected([...READ_ONLY_PRESET])}>Read-only</Button>
          <Button size="sm" variant="outline" onClick={() => setSelected([])}>Clear all</Button>
        </div>

        <div className="space-y-3">
          {EMPLOYEE_PERMISSIONS.map((p) => (
            <label key={p.key} className="flex items-start gap-3 rounded-md border border-border p-3">
              <Checkbox
                checked={selected.includes(p.key)}
                onCheckedChange={(v) => toggle(p.key, v === true)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <Label className="cursor-pointer">{p.label}</Label>
                <p className="text-xs text-muted-foreground">{p.hint}</p>
              </span>
            </label>
          ))}
        </div>

        <DialogFooter className="items-center gap-2">
          <Badge variant="secondary" className="mr-auto">{selected.length} of {ALL_PERMISSIONS.length} granted</Badge>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Saving…" : "Save permissions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
