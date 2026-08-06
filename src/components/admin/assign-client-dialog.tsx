import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listClientAssignments,
  assignClientToEmployee,
  unassignClientFromEmployee,
} from "@/lib/clients.functions";
import { listEmployees } from "@/lib/employees.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { PhoneDisplay } from "@/components/phone-display";

export function AssignClientDialog({
  client,
  open,
  onOpenChange,
}: {
  client: { id: string; business_name: string } | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const empFn = useServerFn(listEmployees);
  const assignmentsFn = useServerFn(listClientAssignments);
  const assign = useServerFn(assignClientToEmployee);
  const unassign = useServerFn(unassignClientFromEmployee);
  const qc = useQueryClient();

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => empFn(),
    enabled: open,
  });
  const { data: assignments = [] } = useQuery({
    queryKey: ["client-assignments"],
    queryFn: () => assignmentsFn(),
    enabled: open,
  });

  const assignedIds = new Set(
    (assignments as any[]).filter((a) => a.client_id === client?.id).map((a) => a.employee_id),
  );

  const toggle = useMutation({
    mutationFn: async (v: { employee_id: string; next: boolean }) => {
      if (!client) return;
      const payload = { data: { client_id: client.id, employee_id: v.employee_id } };
      return v.next ? assign(payload) : unassign(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client-assignments"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Assignment updated");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to update assignment"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign employees</DialogTitle>
          <DialogDescription>
            Only assigned employees can view and manage {client?.business_name ?? "this client"}.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {(employees as any[]).length === 0 && (
            <p className="text-sm text-muted-foreground">No employees yet.</p>
          )}
          {(employees as any[]).map((e) => {
            const checked = assignedIds.has(e.id);
            return (
              <label
                key={e.id}
                className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 hover:bg-muted/40"
              >
                <Checkbox
                  checked={checked}
                  disabled={toggle.isPending}
                  onCheckedChange={(c) => toggle.mutate({ employee_id: e.id, next: !!c })}
                />
                <span className="text-sm">
                  <span className="font-medium">{e.profiles?.name ?? "Employee"}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {e.profiles?.phone ? <PhoneDisplay phone={e.profiles.phone} /> : (e.profiles?.email ?? "")}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
