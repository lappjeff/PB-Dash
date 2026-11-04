"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, AriaComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";

echarts.use([BarChart, LineChart, HeatmapChart, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, AriaComponent, SVGRenderer]);

export type VizTokens = {
  surface: string;
  grid: string;
  textPrimary: string;
  textSecondary: string;
  series1: string;
  series2: string;
  seq: [string, string, string, string];
};

function readTokens(): VizTokens {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    surface: v("--viz-surface"),
    grid: v("--viz-grid"),
    textPrimary: v("--viz-text-primary"),
    textSecondary: v("--viz-text-secondary"),
    series1: v("--viz-series-1"),
    series2: v("--viz-series-2"),
    seq: [v("--viz-seq-100"), v("--viz-seq-250"), v("--viz-seq-450"), v("--viz-seq-650")],
  };
}

export type ChartClick = { dataIndex: number; seriesIndex: number; name: string };

/**
 * Thin ECharts host. `build` receives the current theme tokens so light and dark are each
 * selected from the palette rather than auto-inverted.
 */
export function EChart({
  build,
  height = 280,
  onClick,
  ariaLabel,
}: {
  build: (t: VizTokens) => EChartsCoreOption;
  height?: number;
  onClick?: (e: ChartClick) => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const { resolvedTheme } = useTheme();
  const [tokens, setTokens] = useState<VizTokens | null>(null);
  const clickRef = useRef(onClick);
  useEffect(() => {
    clickRef.current = onClick;
  });

  useEffect(() => {
    // Wait a frame so the theme class is applied before reading tokens.
    const id = requestAnimationFrame(() => setTokens(readTokens()));
    return () => cancelAnimationFrame(id);
  }, [resolvedTheme]);

  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: "svg" });
    chart.current = c;
    c.on("click", (p) => clickRef.current?.({ dataIndex: p.dataIndex, seriesIndex: p.seriesIndex ?? 0, name: String(p.name) }));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      c.dispose();
    };
  }, []);

  useEffect(() => {
    if (!chart.current || !tokens) return;
    const opt = build(tokens);
    chart.current.setOption(
      {
        aria: { enabled: true, label: { description: ariaLabel } },
        textStyle: { fontFamily: "var(--font-geist-sans), system-ui, sans-serif", color: tokens.textSecondary },
        animationDuration: 300,
        ...opt,
      },
      true,
    );
  }, [build, tokens, ariaLabel]);

  return <div ref={ref} style={{ height }} className={onClick ? "w-full cursor-pointer" : "w-full"} role="img" aria-label={ariaLabel} />;
}

/** Shared axis/tooltip styling: recessive hairline grid, text tokens for labels. */
export function axisStyle(t: VizTokens) {
  return {
    axisLine: { lineStyle: { color: t.grid } },
    axisTick: { show: false },
    axisLabel: { color: t.textSecondary, fontSize: 11 },
    splitLine: { lineStyle: { color: t.grid, width: 1, type: "solid" as const } },
  };
}

export function tooltipStyle(t: VizTokens) {
  return {
    backgroundColor: t.surface,
    borderColor: t.grid,
    textStyle: { color: t.textPrimary, fontSize: 12 },
    extraCssText: "box-shadow: 0 4px 16px rgb(0 0 0 / 0.12); border-radius: 8px;",
  };
}

export function compactMoney(cents: number) {
  const d = cents / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (Math.abs(d) >= 10_000) return `$${Math.round(d / 1000)}K`;
  return `$${Math.round(d).toLocaleString("en-US")}`;
}
