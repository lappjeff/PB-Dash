"use client";

import { useCallback } from "react";
import { EChart, axisStyle, compactMoney, tooltipStyle, type VizTokens } from "./echart";
import { EmptyChart } from "./pipeline-chart";

/** Single-series column chart for a distribution (e.g. sales-cycle histogram). */
export function SimpleColumns({ labels, values, unit, ariaLabel, money = false }: { labels: string[]; values: number[]; unit: string; ariaLabel: string; money?: boolean }) {
  const build = useCallback(
    (t: VizTokens) => ({
      grid: { left: 40, right: 8, top: 20, bottom: 28 },
      tooltip: { trigger: "item", ...tooltipStyle(t), formatter: (p: { name: string; value: number }) => `<b>${p.name}</b><br/>${money ? compactMoney(p.value) : p.value} ${unit}` },
      xAxis: { type: "category", data: labels, ...axisStyle(t), splitLine: { show: false } },
      yAxis: { type: "value", ...axisStyle(t), axisLabel: { ...axisStyle(t).axisLabel, formatter: (v: number) => (money ? compactMoney(v) : String(v)) } },
      series: [{ type: "bar", data: values, barMaxWidth: 24, itemStyle: { color: t.series1, borderRadius: [4, 4, 0, 0] }, label: { show: true, position: "top", color: t.textSecondary, fontSize: 11, formatter: (p: { value: number }) => (money ? compactMoney(p.value) : String(p.value)) } }],
    }),
    [labels, values, unit, money],
  );
  if (values.every((v) => v === 0)) return <EmptyChart>No data for this range.</EmptyChart>;
  return <EChart build={build} height={240} ariaLabel={ariaLabel} />;
}

/** Stage × age heatmap with a single-hue sequential ramp; "Unknown" column kept explicit. */
export function AgingHeatmap({ stages, buckets, counts }: { stages: string[]; buckets: readonly string[]; counts: number[][] }) {
  const build = useCallback(
    (t: VizTokens) => {
      const max = Math.max(1, ...counts.flat());
      const dark = document.documentElement.classList.contains("dark");
      // Text inside a fill picks white or near-black by the fill's lightness (same two in both modes).
      const ink = (n: number) => {
        const strong = n / max > 0.55;
        return (dark ? !strong && n > 0 : strong) ? "#ffffff" : "#0b0b0b";
      };
      const data = stages.flatMap((_, y) => buckets.map((_, x) => ({ value: [x, y, counts[y][x]], label: { color: ink(counts[y][x]) } })));
      return {
        grid: { left: 110, right: 8, top: 8, bottom: 64 },
        tooltip: { ...tooltipStyle(t), formatter: (p: { value: number[] }) => `<b>${stages[p.value[1]]}</b><br/>${buckets[p.value[0]]}: ${p.value[2]} open` },
        xAxis: { type: "category", data: buckets as string[], ...axisStyle(t), splitLine: { show: false } },
        yAxis: { type: "category", data: stages, ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.textPrimary, fontSize: 12 } },
        visualMap: { min: 0, max, orient: "horizontal", left: "center", bottom: 0, itemHeight: 120, itemWidth: 10, inRange: { color: [t.surface, ...t.seq] }, textStyle: { color: t.textSecondary, fontSize: 11 }, calculable: false },
        series: [{ type: "heatmap", data, itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 }, label: { show: true, fontSize: 11, formatter: (p: { value: number[] }) => (p.value[2] ? String(p.value[2]) : "") } }],
      };
    },
    [stages, buckets, counts],
  );
  if (!stages.length) return <EmptyChart>No open opportunities.</EmptyChart>;
  return <EChart build={build} height={Math.max(200, stages.length * 40 + 70)} ariaLabel="Open opportunities by stage and time in stage" />;
}
