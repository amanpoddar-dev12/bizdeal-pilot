export const inr = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);
};

export const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export const fmtDateTime = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export const maskPhone = (phone: string | null | undefined) => {
  if (!phone) return "—";
  const clean = phone.replace(/\s/g, "");
  if (clean.length < 6) return clean;
  return clean.slice(0, 3) + "••••••" + clean.slice(-2);
};

export const daysBetween = (a: Date | string, b: Date | string) => {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.floor((db - da) / (1000 * 60 * 60 * 24));
};

export const calcPenalty = (outstanding: number, ratePerDay: number, daysOverdue: number) => {
  if (daysOverdue <= 0) return 0;
  return outstanding * ratePerDay * daysOverdue;
};
