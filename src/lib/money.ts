/**
 * Money is stored and aggregated as integer cents (Postgres bigint, summed in SQL).
 * PB sends `revenue` as a JSON number; we convert it through its decimal string
 * representation so binary floating-point never enters aggregation.
 */
export function toCents(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  let s = String(value);
  if (/e/i.test(s)) s = value.toFixed(6);
  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);
  const [intPart, fracPart = ""] = s.split(".");
  const frac = (fracPart + "000").slice(0, 3);
  let c = BigInt(intPart) * 100n + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) c += 1n; // round half away from zero
  const n = Number(negative ? -c : c);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Display only. */
export function formatCents(c: number | null | undefined, opts: { exact?: boolean; compact?: boolean } = {}) {
  if (c === null || c === undefined) return "—";
  if (opts.compact) return compact.format(c / 100);
  return (opts.exact ? usd2 : usd0).format(c / 100);
}

/** Parses a user-entered dollar amount ("12,500.50") to cents without floats. */
export function parseDollarsToCents(input: string): number | null {
  const s = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [i, f = ""] = s.split(".");
  const n = Number(BigInt(i) * 100n + BigInt((f + "00").slice(0, 2)));
  return Number.isSafeInteger(n) ? n : null;
}

/** Postgres numeric/bigint results arrive as strings, numbers or bigints depending on driver. */
export function toInt(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
export function toIntOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : toInt(v);
}
