"use client";

import { useEffect, useRef, type ReactNode } from "react";
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, LineChart, ScatterChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { Empty, ErrorBox, Loading } from "./ui";

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
  MarkPointComponent,
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

/**
 * Wrapper do ECharts (tree-shaken): redimensiona com o container, mantém o render anterior
 * durante refetch (esmaecido) e anima a transição entre estados (merge, não recria).
 */
export function EChart({ option, height = 280, label, dim = false, group }: { option: ChartOption; height?: number; label: string; dim?: boolean; group?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const c = echarts.init(el, undefined, { renderer: "canvas" });
    chart.current = c;
    if (group) {
      c.group = group;
      echarts.connect(group);
    }
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, [group]);

  useEffect(() => {
    chart.current?.setOption(withLegendRule(option), { notMerge: true, lazyUpdate: true });
  }, [option]);

  return <div ref={ref} role="img" aria-label={label} style={{ height, opacity: dim ? 0.55 : 1, transition: "opacity 200ms" }} className="w-full" />;
}

/**
 * Moldura de gráfico com os estados explícitos: carregando · erro (com repetir) · vazio · pronto.
 */
export function ChartFrame({
  option,
  loading,
  error,
  empty,
  height = 280,
  label,
  dim,
  onRetry,
  emptyLabel,
  group,
}: {
  option: ChartOption | null;
  loading?: boolean;
  error?: unknown;
  empty?: boolean;
  height?: number;
  label: string;
  dim?: boolean;
  onRetry?: () => void;
  emptyLabel?: ReactNode;
  group?: string;
}) {
  if (option && !empty) return <EChart option={option} height={height} label={label} dim={dim} group={group} />;
  if (error && !loading) return <div style={{ minHeight: height }} className="flex items-center"><div className="w-full"><ErrorBox error={error} onRetry={onRetry} /></div></div>;
  if (loading || !option) return <Loading height={height} label="Carregando…" />;
  return <Empty height={height} label={typeof emptyLabel === "string" ? emptyLabel : "Sem dados no período."} />;
}
