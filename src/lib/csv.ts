import Papa from "papaparse";

/** Plain number for CSV cells — never a formatted currency string. */
export const num = (v: unknown, digits = 2) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : 0;
};

/** ISO-ish date for spreadsheets (yyyy-mm-dd), stable across locales. */
export const csvDate = (d: string | Date | null | undefined) => {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
};

/** Build + download a CSV file from an array of flat row objects. */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const csv = Papa.unparse(rows.length ? rows : [{}]);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
