import type { Filters } from "@/server/metrics/filters";

/** Link to the opportunity list carrying the dashboard's dimension filters. */
export function opportunitiesLink(f: Pick<Filters, "salespersonIds" | "stageIds" | "jobTypeIds" | "leadSourceIds">, extra: Record<string, string> = {}) {
  const q = new URLSearchParams();
  if (f.salespersonIds.length) q.set("sp", f.salespersonIds.join(","));
  if (f.stageIds.length) q.set("stage", f.stageIds.join(","));
  if (f.jobTypeIds.length) q.set("jobType", f.jobTypeIds.join(","));
  if (f.leadSourceIds.length) q.set("leadSource", f.leadSourceIds.join(","));
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return `/opportunities?${q.toString()}`;
}
