"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { formatCents } from "@/lib/money";
import { formatPercent } from "@/lib/format";

export type LeaderRow = {
  salespersonId: number;
  name: string;
  active: boolean;
  wonCents: number;
  wonCount: number;
  lostCents: number;
  lostCount: number;
  openCents: number;
  openCount: number;
  winRate: number | null;
  avgWonCents: number | null;
  medianCycleDays: number | null;
  overdueActivities: number;
};

type Col = { key: keyof LeaderRow; label: string; render: (r: LeaderRow) => React.ReactNode; title?: string };

const BASE_COLS: Col[] = [
  { key: "wonCents", label: "Won Sales", render: (r) => formatCents(r.wonCents) },
  { key: "openCents", label: "Open pipeline", render: (r) => formatCents(r.openCents) },
  { key: "wonCount", label: "Won", render: (r) => r.wonCount },
  { key: "winRate", label: "Win rate", render: (r) => formatPercent(r.winRate), title: "Won ÷ (won + lost) closed in range" },
  { key: "avgWonCents", label: "Avg won deal", render: (r) => formatCents(r.avgWonCents) },
];
const EXTENDED_COLS: Col[] = [
  { key: "wonCents", label: "Won Sales", render: (r) => formatCents(r.wonCents) },
  { key: "lostCents", label: "Lost value", render: (r) => formatCents(r.lostCents) },
  { key: "openCents", label: "Open pipeline", render: (r) => formatCents(r.openCents) },
  { key: "wonCount", label: "Won", render: (r) => r.wonCount },
  { key: "lostCount", label: "Lost", render: (r) => r.lostCount },
  { key: "winRate", label: "Win rate", render: (r) => formatPercent(r.winRate) },
  { key: "avgWonCents", label: "Avg won deal", render: (r) => formatCents(r.avgWonCents) },
  { key: "medianCycleDays", label: "Median cycle", render: (r) => (r.medianCycleDays === null ? "—" : `${r.medianCycleDays}d`) },
  { key: "overdueActivities", label: "Overdue acts.", render: (r) => r.overdueActivities, title: "Open PB activities past due on this person's open opportunities" },
];

/** Sortable salesperson table. Values come pre-aggregated from the server. */
export function SalesLeaderboard({ rows, extended = false, hrefBase, hrefSuffix = "" }: { rows: LeaderRow[]; extended?: boolean; hrefBase: string; hrefSuffix?: string }) {
  const cols = extended ? EXTENDED_COLS : BASE_COLS;
  const [sort, setSort] = useState<{ key: keyof LeaderRow; dir: "asc" | "desc" }>({ key: "wonCents", dir: "desc" });
  const sorted = useMemo(() => {
    const s = [...rows];
    s.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === null) return 1;
      if (bv === null) return -1;
      const c = typeof av === "string" ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
      return sort.dir === "asc" ? c : -c;
    });
    return s;
  }, [rows, sort]);

  const header = (key: keyof LeaderRow, label: string, title?: string, align: "left" | "right" = "right") => {
    const active = sort.key === key;
    return (
      <th key={String(key)} scope="col" className={`px-3 py-2 font-medium whitespace-nowrap ${align === "right" ? "text-right" : "text-left"}`} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          title={title}
          onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }))}
          className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}
        >
          {label}
          {active && (sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
        </button>
      </th>
    );
  };

  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b text-xs text-muted-foreground">
          <tr>
            {header("name", "Salesperson", undefined, "left")}
            {cols.map((c) => header(c.key, c.label, c.title))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.salespersonId} className="border-b last:border-0 hover:bg-muted/50">
              <td className="px-3 py-2">
                <Link href={`${hrefBase}${r.salespersonId}${hrefSuffix}`} className="flex items-center gap-2 font-medium hover:underline">
                  <span className="w-4 text-right text-xs text-muted-foreground tabular">{sort.key === "name" ? "" : i + 1}</span>
                  {r.name}
                  {!r.active && <span className="rounded border px-1 text-[10px] font-normal text-muted-foreground">inactive</span>}
                </Link>
              </td>
              {cols.map((c) => (
                <td key={c.key} className="px-3 py-2 text-right tabular">
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
