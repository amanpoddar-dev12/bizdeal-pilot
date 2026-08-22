import { Badge } from "@/components/ui/badge";
import type { FieldVisitPriority, FieldVisitStatus } from "@/lib/field-visits.functions";

const STATUS_LABEL: Record<FieldVisitStatus, string> = {
  pending: "Pending",
  assigned: "Assigned",
  completed: "Completed",
  cancelled: "Cancelled",
  overdue: "Overdue",
};

const STATUS_CLASS: Record<FieldVisitStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  assigned: "bg-primary/10 text-primary border-primary/20",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  cancelled: "bg-muted text-muted-foreground line-through",
  overdue: "bg-destructive/10 text-destructive border-destructive/20",
};

const PRIORITY_CLASS: Record<FieldVisitPriority, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-sky-500/10 text-sky-600 border-sky-500/20 dark:text-sky-400",
  high: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
  urgent: "bg-destructive/10 text-destructive border-destructive/20",
};

export function VisitStatusBadge({ status }: { status: string }) {
  const s = (status as FieldVisitStatus) ?? "pending";
  return (
    <Badge variant="outline" className={STATUS_CLASS[s] ?? ""}>
      {STATUS_LABEL[s] ?? status}
    </Badge>
  );
}

export function VisitPriorityBadge({ priority }: { priority: string }) {
  const p = (priority as FieldVisitPriority) ?? "medium";
  return (
    <Badge variant="outline" className={PRIORITY_CLASS[p] ?? ""}>
      {p.charAt(0).toUpperCase() + p.slice(1)}
    </Badge>
  );
}

export function visitTarget(v: any) {
  return v.clients?.business_name ?? v.prospect_name ?? "—";
}

export function visitWhen(v: any) {
  const d = new Date(`${v.visit_date}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return v.visit_time ? `${d} · ${String(v.visit_time).slice(0, 5)}` : d;
}
