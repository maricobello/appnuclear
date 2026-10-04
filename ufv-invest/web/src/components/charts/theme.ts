/**
 * Tema dos gráficos (canvas → hex). Paleta validada contra a superfície #0c1219 (skill dataviz):
 * série principal âmbar #c98500, secundária azul #3987e5, negativo #e66767.
 */
export const C = {
  surface: "#0c1219",
  grid: "#1a2430",
  axis: "#2a3644",
  ink: "#eef2f6",
  ink2: "#b9c3cf",
  muted: "#8592a3",
  s1: "#c98500",
  s2: "#3987e5",
  neg: "#e66767",
};

const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmt0 = (v: number) => nf0.format(v);
export const fmt1 = (v: number) => nf1.format(v);
export const fmtMi = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${nf1.format(v / 1e6)} mi`;
  if (a >= 1e3) return `${nf0.format(v / 1e3)} mil`;
  return nf0.format(v);
};

export function base() {
  return {
    backgroundColor: "transparent",
    animationDuration: 400,
    textStyle: { color: C.muted, fontFamily: "Geist, -apple-system, system-ui, sans-serif", fontSize: 12 },
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(12,18,25,0.97)",
      borderColor: "rgba(148,163,184,0.25)",
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: C.ink, fontSize: 12 },
      extraCssText: "border-radius:8px;box-shadow:none;",
      axisPointer: { type: "shadow", shadowStyle: { color: "rgba(148,163,184,0.08)" } },
      confine: true,
    },
    legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 12, itemHeight: 8, textStyle: { color: C.ink2, fontSize: 12 } },
  };
}

export function catAxis(data: (string | number)[], extra: Record<string, unknown> = {}) {
  return {
    type: "category",
    data,
    axisLine: { lineStyle: { color: C.axis } },
    axisTick: { show: false },
    axisLabel: { color: C.muted, fontSize: 11 },
    ...extra,
  };
}

export function valAxis(name?: string, formatter?: (v: number) => string, extra: Record<string, unknown> = {}) {
  return {
    type: "value",
    name,
    nameTextStyle: { color: C.muted, fontSize: 11, align: "left" },
    splitLine: { lineStyle: { color: C.grid } },
    axisLabel: { color: C.muted, fontSize: 11, formatter },
    ...extra,
  };
}

/** barra com topo arredondado (4px) ancorada na base; para valores negativos arredonda embaixo */
export const barRadius = (v: number): [number, number, number, number] => (v >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4]);
