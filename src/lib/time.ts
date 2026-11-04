import { TZDate } from "@date-fns/tz";
import {
  addDays,
  addMonths,
  format,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subMonths,
  subYears,
  endOfMonth,
  endOfYear,
} from "date-fns";

/** yyyy-MM-dd */
export type LocalDate = string;

export const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parts(d: LocalDate) {
  const [y, m, day] = d.split("-").map(Number);
  return { y, m, day };
}

/** The UTC instant at which local date `d` begins in `tz`. */
export function startOfLocalDay(d: LocalDate, tz: string): Date {
  const { y, m, day } = parts(d);
  return new Date(new TZDate(y, m - 1, day, 0, 0, 0, 0, tz).getTime());
}

/** Inclusive local-date range -> half-open UTC instant range [start, end). */
export function localRangeToUtc(from: LocalDate, to: LocalDate, tz: string) {
  return { start: startOfLocalDay(from, tz), end: startOfLocalDay(addLocalDays(to, 1), tz) };
}

export function addLocalDays(d: LocalDate, n: number): LocalDate {
  const { y, m, day } = parts(d);
  return format(addDays(new Date(y, m - 1, day), n), "yyyy-MM-dd");
}

export function todayLocal(tz: string, now: Date = new Date()): LocalDate {
  return format(new TZDate(now.getTime(), tz), "yyyy-MM-dd");
}

export function toLocalDate(instant: Date, tz: string): LocalDate {
  return format(new TZDate(instant.getTime(), tz), "yyyy-MM-dd");
}

/** PB activity due date + optional HH:MM, interpreted in the company time zone. Without a time, due at end of that day. */
export function activityDueAt(dueDate: string | null | undefined, beginTime: string | null | undefined, tz: string): Date | null {
  if (!dueDate || !LOCAL_DATE_RE.test(dueDate)) return null;
  const { y, m, day } = parts(dueDate);
  const t = beginTime && /^\d{2}:\d{2}/.test(beginTime) ? beginTime : null;
  if (!t) return startOfLocalDay(addLocalDays(dueDate, 1), tz);
  const [hh, mm] = t.split(":").map(Number);
  return new Date(new TZDate(y, m - 1, day, hh, mm, 0, 0, tz).getTime());
}

export const DATE_PRESETS = [
  { key: "mtd", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "qtd", label: "This quarter" },
  { key: "ytd", label: "Year to date" },
  { key: "last-12m", label: "Last 12 months" },
  { key: "last-year", label: "Last year" },
] as const;
export type DatePresetKey = (typeof DATE_PRESETS)[number]["key"];

export function presetRange(key: DatePresetKey, tz: string, now: Date = new Date()): { from: LocalDate; to: LocalDate } {
  const today = todayLocal(tz, now);
  const { y, m, day } = parts(today);
  const local = new Date(y, m - 1, day);
  const f = (d: Date) => format(d, "yyyy-MM-dd");
  switch (key) {
    case "mtd":
      return { from: f(startOfMonth(local)), to: today };
    case "last-month": {
      const lm = subMonths(startOfMonth(local), 1);
      return { from: f(lm), to: f(endOfMonth(lm)) };
    }
    case "qtd":
      return { from: f(startOfQuarter(local)), to: today };
    case "ytd":
      return { from: f(startOfYear(local)), to: today };
    case "last-12m":
      return { from: f(addDays(subMonths(local, 12), 1)), to: today };
    case "last-year": {
      const ly = subYears(startOfYear(local), 1);
      return { from: f(ly), to: f(endOfYear(ly)) };
    }
  }
}

export function monthBounds(d: LocalDate): { start: LocalDate; end: LocalDate } {
  const { y, m } = parts(d);
  const s = new Date(y, m - 1, 1);
  return { start: format(s, "yyyy-MM-dd"), end: format(addDays(addMonths(s, 1), -1), "yyyy-MM-dd") };
}

export function daysBetween(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}
