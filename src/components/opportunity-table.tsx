"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import {
  columnVisibilityFeature,
  createColumnHelper,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnVisibilityState,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatCents } from "@/lib/money";
import { formatLocalDate, formatRelative } from "@/lib/format";
import type { OpportunityListRow, SortKey } from "@/server/metrics/opportunities";

const features = tableFeatures({ rowSortingFeature, columnVisibilityFeature });
const col = createColumnHelper<typeof features, OpportunityListRow>();

export function StatusBadge({ status, archived }: { status: OpportunityListRow["status"]; archived?: boolean }) {
  const cls = status === "won" ? "bg-status-good/15 text-foreground" : status === "lost" ? "bg-status-critical/12 text-foreground" : "bg-secondary text-secondary-foreground";
  const dot = status === "won" ? "bg-status-good" : status === "lost" ? "bg-status-critical" : "bg-muted-foreground/50";
  return (
    <span className="inline-flex items-center gap-1">
      <Badge className={cls}>
        <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
        {status === "pending" ? "Open" : status === "won" ? "Won" : "Lost"}
      </Badge>
      {archived && <Badge variant="outline">Archived</Badge>}
    </span>
  );
}

const columns = col.columns([
  col.accessor("name", {
    id: "name",
    header: "Opportunity",
    cell: (c) => (
      <Link href={`/opportunities/${c.row.original.id}`} className="font-medium hover:underline">
        {c.getValue()}
        {c.row.original.number && <span className="ml-1.5 text-xs font-normal text-muted-foreground">#{c.row.original.number}</span>}
      </Link>
    ),
  }),
  col.accessor("customerName", { id: "customer", header: "Customer", cell: (c) => c.getValue() ?? "—" }),
  col.accessor("salespersonName", { id: "salesperson", header: "Salesperson", cell: (c) => c.getValue() ?? "Unassigned" }),
  col.accessor("stageName", { id: "stage", header: "Stage", cell: (c) => c.getValue() ?? "—" }),
  col.accessor("valueCents", {
    id: "value",
    header: "Value",
    cell: (c) => (c.getValue() === null ? <span className="text-muted-foreground" title="No value in PB">No value</span> : formatCents(c.getValue())),
    meta: { align: "right" },
  }),
  col.accessor("jobTypeName", { id: "jobType", header: "Job type", cell: (c) => c.getValue() ?? "—" }),
  col.accessor("createdDate", { id: "created", header: "Created", cell: (c) => formatLocalDate(c.getValue()) }),
  col.accessor("lastChangedAt", {
    id: "changed",
    header: "Last change seen",
    cell: (c) => {
      const v = c.getValue();
      return v ? formatRelative(v) : <span className="text-muted-foreground" title="No change observed since this app began tracking. PB does not expose an updated timestamp.">Not observed</span>;
    },
  }),
  col.accessor("ageDays", { id: "age", header: "Age", cell: (c) => (c.getValue() === null ? "—" : `${c.getValue()}d`), meta: { align: "right" } }),
  col.accessor("status", { id: "status", header: "Status", cell: (c) => <StatusBadge status={c.getValue()} archived={c.row.original.archived} /> }),
]);

const STORAGE_KEY = "pb.opportunityTable.columns";
const EMPTY: ColumnVisibilityState = {};
let cache: { raw: string | null; value: ColumnVisibilityState } = { raw: null, value: EMPTY };

/** Column visibility is a per-browser preference kept in localStorage (absent on the server). */
function readStored(): ColumnVisibilityState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== cache.raw) cache = { raw, value: raw ? (JSON.parse(raw) as ColumnVisibilityState) : EMPTY };
  } catch {
    /* storage unavailable */
  }
  return cache.value;
}
function writeStoredVisibility(v: ColumnVisibilityState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("pb-columns"));
}
function useStoredVisibility() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("pb-columns", cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener("pb-columns", cb);
        window.removeEventListener("storage", cb);
      };
    },
    readStored,
    () => EMPTY,
  );
}

/**
 * Server-paginated opportunity table. Sorting, search and paging live in the URL and
 * the server returns only the current page; column visibility is a per-browser preference.
 */
export function OpportunityTable({
  rows,
  total,
  page,
  pageSize,
  sort,
  dir,
  exportHref,
  hideColumns = [],
  compact = false,
}: {
  rows: OpportunityListRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: SortKey;
  dir: "asc" | "desc";
  exportHref?: string;
  hideColumns?: string[];
  /** Read-only preview: no search, paging or sorting controls. */
  compact?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const stored = useStoredVisibility();
  const visibility: ColumnVisibilityState = useMemo(
    () => ({ ...stored, ...Object.fromEntries(hideColumns.map((c) => [c, false])) }),
    [stored, hideColumns],
  );
  const [q, setQ] = useState(sp.get("q") ?? "");

  const push = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    start(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  useEffect(() => {
    const current = sp.get("q") ?? "";
    if (q === current) return;
    const t = setTimeout(() => push({ q: q || null, page: null }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const sorting: SortingState = useMemo(() => [{ id: sort, desc: dir === "desc" }], [sort, dir]);

  const table = useTable({
    features,
    columns,
    data: rows,
    manualSorting: true,
    state: { sorting, columnVisibility: visibility },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const s = next[0];
      push({ sort: s?.id ?? null, dir: s ? (s.desc ? "desc" : "asc") : null, page: null });
    },
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === "function" ? updater(visibility) : updater;
      writeStoredVisibility(next);
    },
  });

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const fromRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const toRow = Math.min(total, page * pageSize);

  return (
    <div className="space-y-3">
      {!compact && (
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, customer or job #" className="pl-8" aria-label="Search opportunities" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Columns3 className="size-3.5" aria-hidden /> Columns
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                {table
                  .getAllLeafColumns()
                  .filter((c) => c.id !== "name")
                  .map((c) => (
                    <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(Boolean(v))} closeOnClick={false}>
                      {String(c.columnDef.header)}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {exportHref && (
            <a href={exportHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Download className="size-3.5" aria-hidden /> CSV
            </a>
          )}
        </div>
      </div>
      )}

      <div className={`overflow-x-auto rounded-xl border bg-card ${pending ? "opacity-70" : ""}`} aria-busy={pending}>
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  const right = (h.column.columnDef.meta as { align?: string } | undefined)?.align === "right";
                  return (
                    <th key={h.id} scope="col" className={`px-3 py-2 font-medium whitespace-nowrap ${right ? "text-right" : "text-left"}`} aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : "none"}>
                      {compact ? (
                        <table.FlexRender header={h} />
                      ) : (
                        <button type="button" className={`inline-flex items-center gap-1 hover:text-foreground ${sorted ? "text-foreground" : ""}`} onClick={h.column.getToggleSortingHandler()}>
                          <table.FlexRender header={h} />
                          {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No opportunities match these filters.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                  {r.getVisibleCells().map((c) => (
                    <td key={c.id} className={`px-3 py-2 whitespace-nowrap ${(c.column.columnDef.meta as { align?: string } | undefined)?.align === "right" ? "text-right tabular" : ""}`}>
                      <table.FlexRender cell={c} />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!compact && (
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="tabular">
          {fromRow.toLocaleString()}–{toRow.toLocaleString()} of {total.toLocaleString()}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => push({ page: String(page - 1) })} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          <span className="px-2 tabular">
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => push({ page: String(page + 1) })} aria-label="Next page">
            <ChevronRight />
          </Button>
        </div>
      </div>
      )}
    </div>
  );
}
