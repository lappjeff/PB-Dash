"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ChevronDown, X } from "lucide-react";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DATE_PRESETS } from "@/lib/time";

type Option = { id: number; name: string; active?: boolean };

export type FilterBarProps = {
  /** Current resolved range (shown even when a preset is active). */
  from: string;
  to: string;
  preset: string | null;
  showDate?: boolean;
  salespeople?: Option[];
  stages?: Option[];
  jobTypes?: Option[];
  leadSources?: Option[];
};

/** All dashboard widgets read the same URL search params, so filters stay consistent and shareable. */
function useParamsUpdater() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const update = (changes: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") q.delete(k);
      else q.set(k, v);
    }
    q.delete("page");
    start(() => router.push(`${pathname}${q.size ? `?${q}` : ""}`, { scroll: false }));
  };
  return { sp, update, pending };
}

export function FilterBar(props: FilterBarProps) {
  const { sp, update, pending } = useParamsUpdater();
  const selected = (key: string) => (sp.get(key) ?? "").split(",").map(Number).filter(Boolean);

  const chips: { key: string; label: string; id: number }[] = [];
  const addChips = (key: string, label: string, opts?: Option[]) => {
    for (const id of selected(key)) {
      const o = opts?.find((x) => x.id === id);
      if (o) chips.push({ key, id, label: `${label}: ${o.name}` });
    }
  };
  addChips("sp", "Salesperson", props.salespeople);
  addChips("stage", "Stage", props.stages);
  addChips("jobType", "Job type", props.jobTypes);
  addChips("leadSource", "Lead source", props.leadSources);

  const removeChip = (key: string, id: number) => update({ [key]: selected(key).filter((x) => x !== id).join(",") || null });

  return (
    <div className={cn("space-y-2", pending && "opacity-70 transition-opacity")} aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2">
        {props.showDate !== false && <DateRangeFilter {...props} onChange={update} />}
        {props.salespeople && <MultiFilter label="Salesperson" paramKey="sp" options={props.salespeople} selected={selected("sp")} onChange={update} />}
        {props.stages && <MultiFilter label="Stage" paramKey="stage" options={props.stages} selected={selected("stage")} onChange={update} />}
        {props.jobTypes && <MultiFilter label="Job type" paramKey="jobType" options={props.jobTypes} selected={selected("jobType")} onChange={update} />}
        {props.leadSources && props.leadSources.length > 0 && (
          <MultiFilter label="Lead source" paramKey="leadSource" options={props.leadSources} selected={selected("leadSource")} onChange={update} />
        )}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={`${c.key}-${c.id}`}
              type="button"
              onClick={() => removeChip(c.key, c.id)}
              className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2.5 py-0.5 text-xs hover:bg-muted"
              aria-label={`Remove filter ${c.label}`}
            >
              {c.label}
              <X className="size-3" aria-hidden />
            </button>
          ))}
          <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => update({ sp: null, stage: null, jobType: null, leadSource: null })}>
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

export function DateRangeFilter({ from, to, preset, onChange }: FilterBarProps & { onChange: (c: Record<string, string | null>) => void }) {
  const value = preset ?? "custom";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="date-preset">
        Date range
      </label>
      <select
        id="date-preset"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "custom") onChange({ preset: null, from, to });
          else onChange({ preset: v, from: null, to: null });
        }}
        className="h-8 rounded-lg border bg-background px-2.5 text-sm"
      >
        {DATE_PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom range…</option>
      </select>
      {value === "custom" ? (
        <span className="flex items-center gap-1 text-sm">
          <input aria-label="From date" type="date" className="h-8 rounded-lg border bg-background px-2 text-sm" defaultValue={from} max={to} onChange={(e) => e.target.value && onChange({ from: e.target.value, to, preset: null })} />
          <span className="text-muted-foreground">–</span>
          <input aria-label="To date" type="date" className="h-8 rounded-lg border bg-background px-2 text-sm" defaultValue={to} min={from} onChange={(e) => e.target.value && onChange({ to: e.target.value, from, preset: null })} />
        </span>
      ) : (
        <span className="text-xs text-muted-foreground tabular">
          {from} → {to}
        </span>
      )}
    </div>
  );
}

export function MultiFilter({
  label,
  paramKey,
  options,
  selected,
  onChange,
}: {
  label: string;
  paramKey: string;
  options: Option[];
  selected: number[];
  onChange: (c: Record<string, string | null>) => void;
}) {
  const toggle = (id: number, on: boolean) => {
    const next = on ? [...selected, id] : selected.filter((x) => x !== id);
    onChange({ [paramKey]: next.length ? next.join(",") : null });
  };
  const hasInactive = options.some((o) => o.active === false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={buttonVariants({ variant: "outline", size: "sm", className: selected.length ? "border-foreground/30" : "" })}>
        {label}
        {selected.length > 0 && <span className="rounded bg-secondary px-1 text-[11px] tabular">{selected.length}</span>}
        <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-80 min-w-56 overflow-y-auto">
        <DropdownMenuGroup>
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuCheckboxItem key={o.id} checked={selected.includes(o.id)} onCheckedChange={(v) => toggle(o.id, Boolean(v))} closeOnClick={false}>
            <span className={o.active === false ? "text-muted-foreground" : ""}>{o.name}</span>
            {o.active === false && <span className="ml-auto text-[10px] text-muted-foreground">inactive</span>}
          </DropdownMenuCheckboxItem>
        ))}
        </DropdownMenuGroup>
        {hasInactive && <p className="px-2 py-1 text-[11px] text-muted-foreground">Inactive = no longer in PB&apos;s sales-rep list.</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
