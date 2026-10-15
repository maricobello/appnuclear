"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { EChartsCoreOption, ECharts } from "echarts/core";
import { themeOption, withBrtTicks } from "@/lib/chart";
import { useScheme } from "@/lib/theme";
import { Empty, ErrorBox, Loading } from "./ui";

export type ChartOption = EChartsCoreOption;

/** Fica verdadeiro na primeira vez que o elemento chega perto da área visível (e não volta). */
function useNearViewport(ref: RefObject<HTMLElement | null>, margin = "300px") {
  const [near, setNear] = useState(() => typeof window !== "undefined" && typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, near, margin]);
  return near;
}

/** Uma série não precisa de legenda (o título já diz o que é plotado). */
function withLegendRule(option: ChartOption): ChartOption {
  const series = (Array.isArray(option.series) ? option.series : []) as { name?: string }[];
  const names = new Set(series.map((s) => s.name).filter((n) => n && !n.endsWith("-base")));
  if (names.size > 1 || !option.legend) return option;
  const grid = (option.grid ?? {}) as Record<string, unknown>;
  return { ...option, legend: { ...(option.legend as object), show: false }, grid: { ...grid, top: Math.min(Number(grid.top ?? 30), 30) } };
}

/**
 * Wrapper do ECharts: a biblioteca é carregada sob demanda e cada gráfico só é montado quando
 * chega perto da tela (menos trabalho na abertura da página, sobretudo no celular). Redimensiona
 * com o container, mantém o render anterior durante refetch (esmaecido) e segue o tema.
 */
export function EChart({ option, height = 280, label, dim = false, group }: { option: ChartOption; height?: number; label: string; dim?: boolean; group?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [chart, setChart] = useState<ECharts | null>(null);
  const near = useNearViewport(ref);
  const scheme = useScheme();
  const themed = useMemo(() => themeOption(withBrtTicks(withLegendRule(option)), scheme), [option, scheme]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !near) return;
    let c: ECharts | null = null;
    let ro: ResizeObserver | null = null;
    let gone = false;
    void import("./echarts-lib").then(({ echarts }) => {
      if (gone) return;
      c = echarts.init(el, undefined, { renderer: "canvas" });
      if (group) {
        c.group = group;
        echarts.connect(group);
      }
      ro = new ResizeObserver(() => c?.resize());
      ro.observe(el);
      setChart(c);
    });
    return () => {
      gone = true;
      ro?.disconnect();
      c?.dispose();
    };
  }, [group, near]);

  useEffect(() => {
    if (chart && !chart.isDisposed()) chart.setOption(themed, { notMerge: true, lazyUpdate: true });
  }, [chart, themed]);

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
