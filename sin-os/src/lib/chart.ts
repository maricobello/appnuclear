/**
 * Tema dos gráficos (ECharts desenha em canvas, então usa hex e não CSS vars).
 * As opções são montadas sempre com a paleta ESCURA (`C`); no tema claro o EChart troca cada cor
 * pela variante clara com `themeOption` (inclusive dentro do HTML dos tooltips). Cores do sistema
 * da Apple; a cor segue a entidade (SE sempre azul etc.), nunca o ranking.
 */
const DARK = {
  surface: "#1c1c1e",
  surface2: "#2c2c2e",
  grid: "#28282a",
  axis: "#3a3a3c",
  ink: "#f5f5f7",
  ink2: "#d1d1d6",
  muted: "#98989d",
  accent: "#0a84ff",
  accent2: "#64d2ff",
  series: ["#0a84ff", "#ff9f0a", "#30d158", "#bf5af2", "#ff375f", "#ffd60a", "#5e5ce6", "#ff453a"],
  good: "#30d158",
  warning: "#ffd60a",
  serious: "#ff9f0a",
  critical: "#ff453a",
  // sequencial (1 matiz): valor baixo some no fundo, valor alto se destaca
  seq: ["#0a2240", "#0d3566", "#114b8f", "#1a66bd", "#4a90e2", "#8ab8f0", "#cfe3fb"],
  // divergente azul ↔ vermelho com ponto médio neutro
  div: ["#2563b5", "#4d8fe0", "#9bc0ee", "#48484a", "#f2a19c", "#ec6a62", "#c03c35"],
  tooltip: "rgba(44,44,46,0.94)",
  pointer: "rgba(152,152,157,0.55)",
  accentSoft: "rgba(10,132,255,0.14)",
  peakSoft: "rgba(255,214,10,0.05)",
  inkSoft: "rgba(209,209,214,0.07)",
  goodSoft: "rgba(48,209,88,0.55)",
};

const LIGHT: typeof DARK = {
  surface: "#ffffff",
  surface2: "#f2f2f5",
  grid: "#ececf0",
  axis: "#d2d2d7",
  ink: "#1d1d1f",
  ink2: "#3a3a3c",
  muted: "#6e6e73",
  accent: "#007aff",
  accent2: "#0a7ea4",
  series: ["#007aff", "#e67700", "#2fa84f", "#af52de", "#ff2d55", "#b38600", "#5856d6", "#ff3b30"],
  good: "#2fa84f",
  warning: "#b38600",
  serious: "#e67700",
  critical: "#ff3b30",
  seq: ["#eaf2fd", "#c9ddf8", "#9cc2f1", "#5e9be6", "#2f74cf", "#1b56a3", "#0b3a75"],
  div: ["#1e4f99", "#3b7fd6", "#a9c9f2", "#e5e5ea", "#f4a7a2", "#e5534b", "#b1271f"],
  tooltip: "rgba(255,255,255,0.97)",
  pointer: "rgba(110,110,115,0.45)",
  accentSoft: "rgba(0,122,255,0.12)",
  peakSoft: "rgba(255,149,0,0.06)",
  inkSoft: "rgba(58,58,60,0.05)",
  goodSoft: "rgba(47,168,79,0.55)",
};

export const C = DARK;

/** Cor (hex/rgba) da paleta escura → variante clara. */
export const LIGHT_OF: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  const add = (d: string, l: string) => {
    const k = d.toLowerCase();
    const prev = m.get(k);
    if (prev && prev !== l) throw new Error(`cor ${d} com duas variantes claras (${prev}, ${l})`);
    m.set(k, l);
  };
  for (const k of Object.keys(DARK) as (keyof typeof DARK)[]) {
    const d = DARK[k];
    const l = LIGHT[k];
    if (Array.isArray(d)) d.forEach((x, i) => add(x, (l as string[])[i]));
    else add(d, l as string);
  }
  return m;
})();

const HEX_RE = new RegExp([...LIGHT_OF.keys()].map((k) => k.replace(/[().]/g, "\\$&")).join("|"), "gi");

/** Cor para o tema: no claro troca pela variante clara; CSS vars e cores desconhecidas passam direto. */
export const themedColor = (c: string, scheme: "light" | "dark") => (scheme === "dark" ? c : (LIGHT_OF.get(c.toLowerCase()) ?? c));

/** Troca as cores da paleta escura dentro de um texto (HTML de tooltip). */
export const themedText = (s: string) => s.replace(HEX_RE, (m) => LIGHT_OF.get(m.toLowerCase()) ?? m);

/**
 * Opção do ECharts para o tema: no claro percorre a opção trocando cores e embrulha os
 * `formatter` que devolvem HTML. No escuro devolve a própria opção.
 */
export function themeOption<T>(option: T, scheme: "light" | "dark"): T {
  if (scheme === "dark") return option;
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === "string") return LIGHT_OF.get(v.toLowerCase()) ?? v;
    if (typeof v === "function") {
      if (key !== "formatter") return v;
      const f = v as (...a: unknown[]) => unknown;
      return (...a: unknown[]) => {
        const r = f(...a);
        return typeof r === "string" ? themedText(r) : r;
      };
    }
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x, k);
      return out;
    }
    return v;
  };
  return walk(option) as T;
}

export const SUB_COLOR: Record<string, string> = { SE: C.series[0], S: C.series[1], NE: C.series[2], N: C.series[3] };
/** Mesmas cores como variáveis CSS, para o DOM (seguem o tema sozinhas). */
export const SUB_CSS: Record<string, string> = { SE: "var(--sub-se)", S: "var(--sub-s)", NE: "var(--sub-ne)", N: "var(--sub-n)" };

const tz = "America/Sao_Paulo";
const fmtHour = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit" });
const fmtDay = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit" });

export const axisTimeLabel = (v: number) => {
  const d = new Date(v);
  const h = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(d);
  return h === "00" ? fmtDay.format(d) : `${h}h`;
};

export const tooltipTime = (v: number) => fmtHour.format(new Date(v)) + "h";

export const CHART_FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Geist, system-ui, sans-serif";

export function baseOption() {
  return {
    backgroundColor: "transparent",
    animationDuration: 350,
    animationEasing: "cubicOut" as const,
    textStyle: { color: C.muted, fontFamily: CHART_FONT, fontSize: 11 },
    // topo reserva a linha da legenda e o nome do eixo y logo abaixo dela
    grid: { left: 8, right: 16, top: 48, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: C.tooltip,
      borderWidth: 0,
      padding: [8, 12],
      extraCssText: "border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,0.18);backdrop-filter:blur(14px);",
      textStyle: { color: C.ink, fontSize: 12, fontFamily: CHART_FONT },
      axisPointer: { type: "line", lineStyle: { color: C.pointer, width: 1 } },
      confine: true,
    },
    legend: {
      type: "scroll",
      top: 0,
      left: 0,
      pageIconColor: C.ink2,
      pageTextStyle: { color: C.muted },
      icon: "circle",
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 16,
      textStyle: { color: C.ink2, fontSize: 12 },
    },
  };
}

const nfAxis = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export const valueAxis = (name?: string, extra: Record<string, unknown> = {}) => ({
  type: "value",
  name,
  nameTextStyle: { color: C.muted, fontSize: 11, align: "left" },
  nameGap: 10,
  axisLine: { show: false },
  splitLine: { lineStyle: { color: C.grid, width: 1 } },
  axisLabel: { color: C.muted, fontSize: 11, formatter: (v: number) => nfAxis.format(v) },
  axisPointer: { label: { formatter: (p: { value: number }) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(p.value) } },
  scale: true,
  ...extra,
});

export const timeAxis = (extra: Record<string, unknown> = {}) => ({
  type: "time",
  axisLine: { lineStyle: { color: C.grid } },
  axisTick: { show: false },
  splitLine: { show: false },
  axisLabel: { color: C.muted, fontSize: 11, formatter: axisTimeLabel, hideOverlap: true },
  axisPointer: { label: { formatter: (p: { value: number }) => tooltipTime(p.value) } },
  ...extra,
});

export const categoryAxis = (data: (string | number)[], extra: Record<string, unknown> = {}) => ({
  type: "category",
  data,
  axisLine: { lineStyle: { color: C.grid } },
  axisTick: { show: false },
  axisLabel: { color: C.muted, fontSize: 11 },
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

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const BRT = 3 * HOUR;

/** Início do dia em Brasília (UTC−3 fixo) que contém `t`. */
const brtMidnight = (t: number) => Math.floor((t - BRT) / DAY) * DAY + BRT;

/**
 * Marcas do eixo de tempo no relógio de Brasília, independentes do fuso do navegador: meia-noite
 * BRT (rótulo dd/mm) em janelas longas, a cada 6 h em janelas curtas.
 */
export function brtTicks(min: number, max: number): number[] {
  const span = max - min;
  if (!(span > 0)) return [];
  const out: number[] = [];
  if (span > 36 * HOUR) {
    const step = Math.max(1, Math.ceil(span / DAY / 8)) * DAY;
    for (let t = brtMidnight(min) + (brtMidnight(min) < min ? DAY : 0); t <= max; t += step) out.push(t);
  } else {
    const step = span > 12 * HOUR ? 6 * HOUR : 3 * HOUR;
    for (let t = brtMidnight(min); t <= max; t += step) if (t >= min) out.push(t);
  }
  return out;
}

type AnyObj = Record<string, unknown>;

/** Aplica `brtTicks` a cada eixo x de tempo sem marcas próprias (usa o intervalo dos dados). */
export function withBrtTicks<T>(option: T): T {
  const o = option as AnyObj;
  const axes = Array.isArray(o.xAxis) ? (o.xAxis as AnyObj[]) : o.xAxis ? [o.xAxis as AnyObj] : [];
  if (!axes.some((a) => a.type === "time")) return option;
  let lo = Infinity;
  let hi = -Infinity;
  const seen = (t: unknown) => {
    if (typeof t === "number" && Number.isFinite(t)) {
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
  };
  for (const sr of (Array.isArray(o.series) ? o.series : []) as AnyObj[]) {
    for (const d of (Array.isArray(sr.data) ? sr.data : []) as unknown[]) {
      if (Array.isArray(d)) seen(d[0]);
      else if (d && typeof d === "object" && Array.isArray((d as AnyObj).value)) seen(((d as AnyObj).value as unknown[])[0]);
    }
  }
  const next = axes.map((a) => {
    if (a.type !== "time") return a;
    const label = (a.axisLabel ?? {}) as AnyObj;
    if (label.customValues) return a;
    const min = typeof a.min === "number" ? a.min : lo;
    const max = typeof a.max === "number" ? a.max : hi;
    const ticks = brtTicks(min, max);
    if (ticks.length < 2) return a;
    return { ...a, axisLabel: { ...label, customValues: ticks, hideOverlap: true }, axisTick: { ...((a.axisTick ?? {}) as AnyObj), customValues: ticks } };
  });
  return { ...o, xAxis: Array.isArray(o.xAxis) ? next : next[0] } as T;
}

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
