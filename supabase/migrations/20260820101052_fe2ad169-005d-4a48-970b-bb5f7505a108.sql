CREATE TABLE public.payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL,
  basic_pay numeric NOT NULL DEFAULT 0,
  hra numeric NOT NULL DEFAULT 0,
  allowances numeric NOT NULL DEFAULT 0,
  bonus numeric NOT NULL DEFAULT 0,
  commission numeric NOT NULL DEFAULT 0,
  other_earnings numeric NOT NULL DEFAULT 0,
  pf numeric NOT NULL DEFAULT 0,
  professional_tax numeric NOT NULL DEFAULT 0,
  tds numeric NOT NULL DEFAULT 0,
  advance_deduction numeric NOT NULL DEFAULT 0,
  other_deductions numeric NOT NULL DEFAULT 0,
  gross_earnings numeric NOT NULL DEFAULT 0,
  total_deductions numeric NOT NULL DEFAULT 0,
  net_pay numeric NOT NULL DEFAULT 0,
  notes text,
  generated_by uuid REFERENCES public.profiles(id),
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payslips_month_valid CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT payslips_year_valid CHECK (period_year BETWEEN 2000 AND 2200),
  CONSTRAINT payslips_unique_period UNIQUE (employee_id, period_year, period_month)
);

CREATE INDEX idx_payslips_employee ON public.payslips (employee_id, period_year DESC, period_month DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payslips TO authenticated;
GRANT ALL ON public.payslips TO service_role;

ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage payslips" ON public.payslips
  FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

CREATE POLICY "Employees view own payslips" ON public.payslips
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT auth.uid()));

CREATE TRIGGER trg_payslips_updated
  BEFORE UPDATE ON public.payslips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();