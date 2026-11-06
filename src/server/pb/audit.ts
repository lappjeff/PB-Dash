/**
 * Compares raw PB REST responses with the field tables in the official docs
 * (https://app.precisebuilder.com/docs/, read 2026-11-06) and tallies differences.
 *
 * Output is field names, JSON types and counts only, plus out-of-spec values of
 * enum fields (temperature, status, activity type). Never record contents.
 */

type Kind =
  | "uuid"
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "time"
  | "timestamp"
  | { enum: readonly string[] }
  | { object: Spec; label: string }
  | { array: Kind };

/** Field name -> documented kind. Fields the docs mark write-only are not expected in responses. */
export type Spec = Record<string, Kind>;

const ref: Kind = { object: { id: "uuid", name: "string" }, label: "{id, name}" };
const address: Kind = {
  object: { address1: "string", address2: "string", city: "string", state: "string", zip: "string" },
  label: "address",
};
const oppSummary: Kind = {
  object: { id: "uuid", number: "string", description: "string", sales_stage: ref, status: { enum: ["pending", "won", "lost"] } },
  label: "opportunity summary",
};

export const DOC_SPECS = {
  lookup: { id: "uuid", name: "string" },
  "sales stage": { id: "uuid", name: "string", status: { enum: ["pending", "won", "lost"] } },
  customer: {
    id: "uuid",
    display_name: "string",
    first_name: "string",
    last_name: "string",
    company: "string",
    billing_address: address,
    phones: { array: { object: { phone: "string", label: "string" }, label: "phone" } },
    emails: { array: { object: { email: "string", label: "string" }, label: "email" } },
    notes: "string",
    lead_source: ref,
    sales_rep: ref,
    created_date: "date",
    archived: "boolean",
    current_opportunity: oppSummary,
    opportunities: { array: oppSummary },
  },
  opportunity: {
    id: "uuid",
    number: "string",
    customer: ref,
    description: "string",
    notes: "string",
    site_address: address,
    job_type: ref,
    temperature: { enum: ["hot", "warm", "cold"] },
    revenue: "number",
    sales_stage: ref,
    status: { enum: ["pending", "won", "lost"] },
    sales_rep: ref,
    lost_reason: ref,
    closed_at: "timestamp",
    completed_at: "timestamp",
    created_date: "date",
    archived: "boolean",
  },
  activity: {
    id: "uuid",
    opportunity: { object: { id: "uuid", number: "string" }, label: "{id, number}" },
    title: "string",
    type: { enum: ["phone", "meeting", "email", "text", "task"] },
    assigned_user: ref,
    due_date: "date",
    begin_time: "time",
    completed_at: "timestamp",
    note: "string",
  },
} satisfies Record<string, Spec>;

export type FieldStats = { missing: number; nulls: number; wrongType: Map<string, number>; badEnum: Map<string, number> };
export type AuditResult = {
  records: number;
  fields: Map<string, FieldStats>;
  /** Undocumented field path -> number of records that had it. */
  extra: Map<string, number>;
};

export function newAudit(): AuditResult {
  return { records: 0, fields: new Map(), extra: new Map() };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
// ISO 8601 with a time zone (Z or ±hh:mm / ±hhmm).
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

function bump(m: Map<string, number>, k: string) {
  m.set(k, (m.get(k) ?? 0) + 1);
}
function stats(a: AuditResult, path: string): FieldStats {
  let s = a.fields.get(path);
  if (!s) a.fields.set(path, (s = { missing: 0, nulls: 0, wrongType: new Map(), badEnum: new Map() }));
  return s;
}
function jsonType(v: unknown): string {
  return v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
}

/** Problem description if `v` (non-null) doesn't match `kind`, else null. */
function typeProblem(kind: Kind, v: unknown): string | null {
  const t = jsonType(v);
  if (typeof kind === "string") {
    switch (kind) {
      case "number":
        return t === "number" ? null : t;
      case "boolean":
        return t === "boolean" ? null : t;
      case "string":
        return t === "string" ? null : t;
      case "uuid":
        return t !== "string" ? t : UUID.test(v as string) ? null : "string, not a UUID";
      case "date":
        return t !== "string" ? t : DATE.test(v as string) ? null : "string, not yyyy-MM-dd";
      case "time":
        return t !== "string" ? t : TIME.test(v as string) ? null : "string, not HH:MM";
      case "timestamp":
        return t !== "string" ? t : TIMESTAMP.test(v as string) ? null : "string, not ISO 8601 with time zone";
    }
  }
  if ("enum" in kind) return t === "string" ? null : t; // value checked separately
  if ("object" in kind) return t === "object" ? null : t;
  return t === "array" ? null : t;
}

function walk(a: AuditResult, spec: Spec, obj: Record<string, unknown>, prefix: string, seenExtra: Set<string>) {
  for (const [field, kind] of Object.entries(spec)) {
    const path = prefix + field;
    const s = stats(a, path);
    if (!(field in obj)) {
      s.missing++;
      continue;
    }
    const v = obj[field];
    if (v === null) {
      s.nulls++;
      continue;
    }
    const problem = typeProblem(kind, v);
    if (problem) {
      bump(s.wrongType, problem);
      continue;
    }
    if (typeof kind === "object" && "enum" in kind && !kind.enum.includes(v as string)) bump(s.badEnum, String(v).slice(0, 30));
    if (typeof kind === "object" && "object" in kind) walk(a, kind.object, v as Record<string, unknown>, `${path}.`, seenExtra);
    if (typeof kind === "object" && "array" in kind) {
      const item = kind.array;
      for (const el of v as unknown[]) {
        const ip = `${path}[]`;
        if (el === null) {
          stats(a, ip).nulls++;
          continue;
        }
        const p = typeProblem(item, el);
        if (p) bump(stats(a, ip).wrongType, p);
        else if (typeof item === "object" && "object" in item) walk(a, item.object, el as Record<string, unknown>, `${ip}.`, seenExtra);
      }
    }
  }
  for (const k of Object.keys(obj)) if (!(k in spec)) seenExtra.add(prefix + k);
}

export function auditRecords(a: AuditResult, spec: Spec, records: unknown[]) {
  for (const r of records) {
    if (r === null || typeof r !== "object" || Array.isArray(r)) {
      bump(a.extra, `(record is ${jsonType(r)}, not an object)`);
      continue;
    }
    a.records++;
    const seen = new Set<string>();
    walk(a, spec, r as Record<string, unknown>, "", seen);
    for (const k of seen) bump(a.extra, k);
  }
  return a;
}

export type Finding = { severity: "mismatch" | "note"; text: string };

/**
 * Differences worth reporting. `nullable` lists field paths where the docs allow null
 * (e.g. "address ... or null", completed_at "null while not done"); nulls elsewhere are
 * reported as notes, because the docs don't say whether those fields can be null.
 */
export function findings(a: AuditResult, nullable: ReadonlySet<string> = new Set()): Finding[] {
  const out: Finding[] = [];
  for (const [path, s] of a.fields) {
    if (s.missing) out.push({ severity: "mismatch", text: `\`${path}\` missing from ${s.missing} of ${a.records} records` });
    for (const [t, n] of s.wrongType) out.push({ severity: "mismatch", text: `\`${path}\` was ${t} in ${n} records` });
    for (const [v, n] of s.badEnum) out.push({ severity: "mismatch", text: `\`${path}\` had undocumented value "${v}" in ${n} records` });
    if (s.nulls && !nullable.has(path)) out.push({ severity: "note", text: `\`${path}\` was null in ${s.nulls} of ${a.records} records` });
  }
  for (const [path, n] of a.extra) out.push({ severity: "mismatch", text: `undocumented field \`${path}\` in ${n} of ${a.records} records` });
  return out.sort((x, y) => (x.severity === y.severity ? x.text.localeCompare(y.text) : x.severity === "mismatch" ? -1 : 1));
}
