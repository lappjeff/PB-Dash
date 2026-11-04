"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { EChart, axisStyle, compactMoney, tooltipStyle, type VizTokens } from "./echart";
import { formatCents } from "@/lib/money";

export type PipelineStage = { stageId: number | null; stageName: string; count: number; valueCents: number; missingValue: number };

/** Open pipeline by stage (horizontal bars, one series). Click a bar to open those opportunities. */
export function PipelineChart({ stages, linkBase }: { stages: PipelineStage[]; linkBase: string }) {
  const [mode, setMode] = useState<"value" | "count">("value");
  const router = useRouter();
  const build = useCallback(
    (t: VizTokens) => {
      const rows = [...stages].reverse();
      return {
        grid: { left: 140, right: 64, top: 8, bottom: 28 },
        tooltip: {
          trigger: "item",
          ...tooltipStyle(t),
          formatter: (p: { dataIndex: number }) => {
            const s = rows[p.dataIndex];
            const missing = s.missingValue ? `<br/><span style="opacity:.7">${s.missingValue} without a value (excluded from $)</span>` : "";
            return `<b>${s.stageName}</b><br/>${formatCents(s.valueCents)} · ${s.count} open${missing}<br/><span style="opacity:.7">Click to view</span>`;
          },
        },
        xAxis: { type: "value", ...axisStyle(t), axisLabel: { ...axisStyle(t).axisLabel, formatter: (v: number) => (mode === "value" ? compactMoney(v) : String(v)) } },
        yAxis: { type: "category", data: rows.map((s) => s.stageName), ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.textPrimary, fontSize: 12, width: 128, overflow: "truncate" } },
        series: [
          {
            type: "bar",
            data: rows.map((s) => (mode === "value" ? s.valueCents : s.count)),
            barMaxWidth: 22,
            itemStyle: { color: t.series1, borderRadius: [0, 4, 4, 0] },
            emphasis: { itemStyle: { color: t.seq[3] } },
            label: {
              show: true,
              position: "right",
              color: t.textSecondary,
              fontSize: 11,
              formatter: (p: { value: number }) => (mode === "value" ? compactMoney(p.value) : String(p.value)),
            },
          },
        ],
      };
    },
    [stages, mode],
  );

  if (!stages.length) return <EmptyChart>No open opportunities match these filters.</EmptyChart>;
  const rows = [...stages].reverse();
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <Segmented value={mode} onChange={setMode} options={[{ value: "value", label: "Value" }, { value: "count", label: "Count" }]} />
      </div>
      <EChart
        build={build}
        height={Math.max(180, stages.length * 40 + 24)}
        ariaLabel="Open pipeline by stage"
        onClick={(e) => {
          const s = rows[e.dataIndex];
          if (s?.stageId) router.push(`${linkBase}&stage=${s.stageId}`);
        }}
      />
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div role="radiogroup" className="inline-flex rounded-lg border p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 transition-colors ${value === o.value ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyChart({ children }: { children: React.ReactNode }) {
  return <div className="grid h-40 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">{children}</div>;
}
