"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { EChart, axisStyle, compactMoney, tooltipStyle, type VizTokens } from "./echart";
import { EmptyChart, Segmented } from "./pipeline-chart";
import { formatCents } from "@/lib/money";

export type TrendPoint = { bucket: string; won: { count: number; valueCents: number; missingValue: number }; lost: { count: number; valueCents: number; missingValue: number } };
type Group = "week" | "month" | "quarter";

function bucketLabel(b: string, g: Group) {
  const d = new Date(`${b}T00:00:00Z`);
  if (g === "quarter") return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  if (g === "month") return d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function bucketEnd(b: string, g: Group) {
  const d = new Date(`${b}T00:00:00Z`);
  if (g === "week") d.setUTCDate(d.getUTCDate() + 6);
  else {
    d.setUTCMonth(d.getUTCMonth() + (g === "month" ? 1 : 3));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Won Sales by close period (columns, one series). With `showLost`, won and lost values
 * are shown side by side (two series, legend + tooltip). Click a column to list those deals.
 */
export function RevenueTrendChart({
  points,
  group,
  showLost = false,
  opportunitiesHref,
  height = 280,
}: {
  points: TrendPoint[];
  group: Group;
  showLost?: boolean;
  opportunitiesHref: string;
  height?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [metric, setMetric] = useState<"value" | "count">("value");

  const build = useCallback(
    (t: VizTokens) => {
      const val = (a: TrendPoint["won"]) => (metric === "value" ? a.valueCents : a.count);
      const series = [
        { name: "Won", type: "bar", data: points.map((p) => val(p.won)), barMaxWidth: 24, barGap: "8%", itemStyle: { color: t.series1, borderRadius: [4, 4, 0, 0] } },
        ...(showLost
          ? [{ name: "Lost", type: "bar", data: points.map((p) => val(p.lost)), barMaxWidth: 24, itemStyle: { color: t.series2, borderRadius: [4, 4, 0, 0] } }]
          : []),
      ];
      return {
        grid: { left: 56, right: 16, top: showLost ? 32 : 12, bottom: 28 },
        legend: showLost ? { top: 0, right: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, textStyle: { color: t.textSecondary } } : undefined,
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow", shadowStyle: { color: t.grid, opacity: 0.5 } },
          ...tooltipStyle(t),
          formatter: (ps: { dataIndex: number }[]) => {
            const p = points[ps[0].dataIndex];
            const line = (label: string, a: TrendPoint["won"]) =>
              `${label}: <b>${formatCents(a.valueCents)}</b> · ${a.count}${a.missingValue ? ` <span style="opacity:.7">(${a.missingValue} w/o value)</span>` : ""}`;
            return `<b>${bucketLabel(p.bucket, group)}</b><br/>${line("Won", p.won)}${showLost ? `<br/>${line("Lost", p.lost)}` : ""}`;
          },
        },
        xAxis: { type: "category", data: points.map((p) => bucketLabel(p.bucket, group)), ...axisStyle(t), splitLine: { show: false } },
        yAxis: { type: "value", ...axisStyle(t), axisLabel: { ...axisStyle(t).axisLabel, formatter: (v: number) => (metric === "value" ? compactMoney(v) : String(v)) } },
        series,
      };
    },
    [points, group, showLost, metric],
  );

  const setGroup = (g: Group) => {
    const q = new URLSearchParams(sp.toString());
    if (g === "month") q.delete("group");
    else q.set("group", g);
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap justify-end gap-2">
        <Segmented value={metric} onChange={setMetric} options={[{ value: "value", label: "Value" }, { value: "count", label: "Count" }]} />
        <Segmented value={group} onChange={setGroup} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "quarter", label: "Quarter" }]} />
      </div>
      {points.every((p) => p.won.count === 0 && p.lost.count === 0) ? (
        <EmptyChart>No won or lost opportunities closed in this range.</EmptyChart>
      ) : (
        <EChart
          build={build}
          height={height}
          ariaLabel={showLost ? "Won and lost value by close period" : "Won Sales by close period"}
          onClick={(e) => {
            const p = points[e.dataIndex];
            const status = e.seriesIndex === 1 ? "lost" : "won";
            router.push(`${opportunitiesHref}&status=${status}&closedFrom=${p.bucket}&closedTo=${bucketEnd(p.bucket, group)}`);
          }}
        />
      )}
    </div>
  );
}
