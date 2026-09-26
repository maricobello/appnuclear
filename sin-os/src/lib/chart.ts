/**
 * Tema dos gráficos (ECharts desenha em canvas, então usa hex e não CSS vars).
 * Categórica: ordem fixa validada (azul, laranja, água, amarelo, magenta, verde, violeta, vermelho);
 * cor segue a entidade (SE sempre azul etc.), nunca o ranking.
 */
export const C = {
  surface: "#0f141b",
  surface2: "#141b24",
  grid: "#1f2732",
  axis: "#2b3441",
  ink: "#f3f5f8",
  ink2: "#c3c9d3",
  muted: "#8b95a5",
  series: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
  // sequencial (1 matiz, azul) — no escuro, valor baixo ≈ superfície
  seq: ["#0d366b", "#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4", "#cde2fb"],
  // divergente azul ↔ vermelho com ponto médio neutro
  div: ["#1c5cab", "#3987e5", "#86b6ef", "#383835", "#ec9a9a", "#e66767", "#b73a3a"],
};

export const SUB_COLOR: Record<string, string> = { SE: C.series[0], S: C.series[1], NE: C.series[2], N: C.series[3] };

const tz = "America/Sao_Paulo";
const fmtHour = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit" });
const fmtDay = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit" });

export const axisTimeLabel = (v: number) => {
  const d = new Date(v);
  const h = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(d);
  return h === "00" ? fmtDay.format(d) : `${h}h`;
};

export const tooltipTime = (v: number) => fmtHour.format(new Date(v)) + "h";

export function baseOption() {
  return {
    backgroundColor: "transparent",
    animationDuration: 300,
    textStyle: { color: C.muted, fontFamily: "var(--font-geist-sans), system-ui, sans-serif", fontSize: 11 },
    // topo reserva a linha da legenda (0–16px) e o nome do eixo y logo abaixo dela
    grid: { left: 8, right: 16, top: 48, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#141b24",
      borderColor: "rgba(255,255,255,0.14)",
      borderWidth: 1,
      textStyle: { color: C.ink, fontSize: 12 },
      axisPointer: { type: "line", lineStyle: { color: C.muted, width: 1 } },
      confine: true,
    },
    legend: {
      type: "scroll",
      top: 0,
      left: 0,
      pageIconColor: C.ink2,
      pageTextStyle: { color: C.muted },
      icon: "roundRect",
      itemWidth: 14,
      itemHeight: 3,
      textStyle: { color: C.ink2, fontSize: 11 },
    },
  };
}

export const valueAxis = (name?: string, extra: Record<string, unknown> = {}) => ({
  type: "value",
  name,
  nameTextStyle: { color: C.muted, fontSize: 10, align: "left" },
  nameGap: 10,
  axisLine: { show: false },
  splitLine: { lineStyle: { color: C.grid, width: 1 } },
  axisLabel: { color: C.muted, fontSize: 10 },
  scale: true,
  ...extra,
});

export const timeAxis = (extra: Record<string, unknown> = {}) => ({
  type: "time",
  axisLine: { lineStyle: { color: C.axis } },
  axisTick: { show: false },
  splitLine: { show: false },
  axisLabel: { color: C.muted, fontSize: 10, formatter: axisTimeLabel, hideOverlap: true },
  ...extra,
});

export const categoryAxis = (data: (string | number)[], extra: Record<string, unknown> = {}) => ({
  type: "category",
  data,
  axisLine: { lineStyle: { color: C.axis } },
  axisTick: { show: false },
  axisLabel: { color: C.muted, fontSize: 10 },
  ...extra,
});

export const line = (name: string, data: [number, number | null][], color: string, extra: Record<string, unknown> = {}) => ({
  name,
  type: "line",
  data,
  showSymbol: false,
  symbolSize: 8,
  lineStyle: { width: 2, color, cap: "round", join: "round" },
  itemStyle: { color },
  emphasis: { focus: "series" },
  connectNulls: false,
  ...extra,
});

/** Banda (ex.: P05–P95) como área empilhada invisível + faixa. */
export function band(name: string, ts: number[], lo: number[], hi: number[], color: string, opacity = 0.14, stack = name) {
  return [
    { name: `${name}-base`, type: "line", data: ts.map((t, i) => [t, lo[i]]), stack, lineStyle: { opacity: 0 }, showSymbol: false, silent: true, tooltip: { show: false } },
    {
      name,
      type: "line",
      data: ts.map((t, i) => [t, hi[i] - lo[i]]),
      stack,
      lineStyle: { opacity: 0, color },
      itemStyle: { color, opacity: Math.min(1, opacity * 3) }, // amostra da legenda
      showSymbol: false,
      areaStyle: { color, opacity },
      silent: true,
      tooltip: { show: false },
    },
  ];
}
