import { formatDistanceToNowStrict } from "date-fns";

export function formatRelative(iso: string) {
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
}

const dt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const d = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

export function formatDateTime(iso: string, timeZone?: string) {
  return timeZone ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso)) : dt.format(new Date(iso));
}

/** For yyyy-MM-dd local dates (rendered without shifting time zones). */
export function formatLocalDate(ymd: string | null) {
  if (!ymd) return "—";
  return d.format(new Date(`${ymd}T00:00:00Z`));
}

export function formatPercent(r: number | null, digits = 1) {
  return r === null ? "—" : `${(r * 100).toFixed(digits)}%`;
}

export function formatCount(n: number) {
  return n.toLocaleString("en-US");
}

export function pluralize(n: number, one: string, many = `${one}s`) {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}
