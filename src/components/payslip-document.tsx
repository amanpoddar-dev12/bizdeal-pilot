import { inr, fmtDate } from "@/lib/format";
import { EARNING_KEYS, DEDUCTION_KEYS } from "@/lib/payslips.functions";

export const COMPANY = {
  name: "Kredix Trading Pvt. Ltd.",
  address: "2nd Floor, Trade Centre, MG Road, Bengaluru 560001, India",
  gst: "29ABCDE1234F1Z5",
  email: "payroll@kredix.app",
};

export const FIELD_LABELS: Record<string, string> = {
  basic_pay: "Basic pay",
  hra: "HRA",
  allowances: "Allowances",
  bonus: "Bonus / incentive",
  commission: "Commission",
  other_earnings: "Other earnings",
  pf: "Provident fund",
  professional_tax: "Professional tax",
  tds: "TDS",
  advance_deduction: "Salary advance",
  other_deductions: "Other deductions",
};

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const periodLabel = (y: number, m: number) => `${MONTHS[m - 1]} ${y}`;

export function PayslipDocument({ slip }: { slip: any }) {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4 text-sm md:p-6">
      <header className="flex flex-col gap-2 border-b border-border pb-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold">{COMPANY.name}</h3>
          <p className="text-xs text-muted-foreground">{COMPANY.address}</p>
          <p className="text-xs text-muted-foreground">GSTIN {COMPANY.gst} · {COMPANY.email}</p>
        </div>
        <div className="md:text-right">
          <p className="font-medium">Payslip — {periodLabel(slip.period_year, slip.period_month)}</p>
          <p className="text-xs text-muted-foreground">Generated {fmtDate(slip.generated_at)}</p>
        </div>
      </header>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Employee</p>
          <p className="font-medium">{slip.employee?.name ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Employee ID</p>
          <p className="break-all font-mono text-xs">{slip.employee_id}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section>
          <h4 className="mb-2 font-medium">Earnings</h4>
          <dl className="space-y-1">
            {EARNING_KEYS.map((k) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{FIELD_LABELS[k]}</dt>
                <dd>{inr(slip[k])}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t border-border pt-1 font-medium">
              <dt>Gross earnings</dt>
              <dd>{inr(slip.gross_earnings)}</dd>
            </div>
          </dl>
        </section>
        <section>
          <h4 className="mb-2 font-medium">Deductions</h4>
          <dl className="space-y-1">
            {DEDUCTION_KEYS.map((k) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{FIELD_LABELS[k]}</dt>
                <dd>{inr(slip[k])}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t border-border pt-1 font-medium">
              <dt>Total deductions</dt>
              <dd>{inr(slip.total_deductions)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 font-semibold">
        <span>Net salary</span>
        <span>{inr(slip.net_pay)}</span>
      </div>

      {slip.notes ? <p className="text-xs text-muted-foreground">Note: {slip.notes}</p> : null}
    </div>
  );
}
