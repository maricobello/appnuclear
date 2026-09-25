"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, LineChart, ScatterChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  BarChart,
  HeatmapChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkAreaComponent,
  CanvasRenderer,
]);

export type ChartOption = echarts.EChartsCoreOption;

/** Uma série não precisa de legenda (o título já diz o que é plotado). */
function withLegendRule(option: ChartOption): ChartOption {
  const series = (Array.isArray(option.series) ? option.series : []) as { name?: string }[];
  const names = new Set(series.map((s) => s.name).filter((n) => n && !n.endsWith("-base")));
  if (names.size > 1 || !option.legend) return option;
  const grid = (option.grid ?? {}) as Record<string, unknown>;
  return { ...option, legend: { ...(option.legend as object), show: false }, grid: { ...grid, top: Math.min(Number(grid.top ?? 30), 30) } };
}

/** Wrapper mínimo: ECharts tree-shaken, redimensiona com o container, mantém o render anterior durante refetch. */
export function EChart({ option, height = 280, label, dim = false }: { option: ChartOption; height?: number; label: string; dim?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const c = echarts.init(el, undefined, { renderer: "canvas" });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(withLegendRule(option), { notMerge: true, lazyUpdate: true });
  }, [option]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      style={{ height, opacity: dim ? 0.55 : 1, transition: "opacity 200ms" }}
      className="w-full"
    />
  );
}
