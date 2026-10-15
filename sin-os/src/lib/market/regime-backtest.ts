import { learBacktest } from "../quant/lear";
import type { DailySubPanel, Sub, SubPanel } from "../sources/types";
import { capDailyMean, PLD_LIMITS, toDayMatrix } from "./brazil";
import { LEAR_WEIGHT } from "./forecast";

/**
 * Backtest walk-forward da previsão de D+1 contra o ingênuo, separado por regime: período
 * hidrológico (úmido dez–abr / seco mai–nov), nível do reservatório do submercado (EAR) e faixa do
 * PLD realizado. O MAE agrupado esconde onde o modelo ganha e onde perde; aqui fica explícito.
 *
 * Cada dia de teste usa só o histórico anterior a ele (re-estimação diária), igual à previsão
 * publicada: LEAR ⊕ ingênuo semanal com peso LEAR_WEIGHT.
 */
export type RegimeGroup = "estacao" | "reservatorio" | "faixa_pld";

export interface RegimeBucket {
  group: RegimeGroup;
  key: string;
  label: string;
  hours: number;
  maeModel: number | null;
  maeNaive: number | null;
  /** MAE do modelo / MAE do ingênuo (< 1 = modelo melhor). */
  rmae: number | null;
  /** Poucas horas para concluir (menos de 2 dias). */
  smallSample: boolean;
}

export interface RegimeBreakdownInput {
  dates: string[];
  actuals: number[][];
  model: number[][];
  naive: number[][];
  /** EAR do submercado (% da capacidade) por data. */
  ear: Map<string, number>;
  floor: number;
}

export const SEASONS = [
  { key: "umido", label: "Período úmido (dez–abr)" },
  { key: "seco", label: "Período seco (mai–nov)" },
] as const;
export const EAR_BANDS = [
  { key: "ear_baixo", label: "Reservatório abaixo de 40%", max: 40 },
  { key: "ear_medio", label: "Reservatório entre 40% e 60%", max: 60 },
  { key: "ear_alto", label: "Reservatório acima de 60%", max: Infinity },
] as const;
export const PLD_BANDS = [
  { key: "piso", label: "PLD no piso" },
  { key: "ate150", label: "PLD do piso a R$ 150" },
  { key: "150a300", label: "PLD de R$ 150 a R$ 300" },
  { key: "acima300", label: "PLD acima de R$ 300" },
] as const;

const season = (date: string) => (["12", "01", "02", "03", "04"].includes(date.slice(5, 7)) ? "umido" : "seco");
const earBand = (v: number | undefined) => (v === undefined ? null : EAR_BANDS.find((b) => v < b.max)!.key);
const pldBand = (v: number, floor: number) => (v <= floor * 1.01 ? "piso" : v <= 150 ? "ate150" : v <= 300 ? "150a300" : "acima300");

export function regimeBreakdown(inp: RegimeBreakdownInput): { buckets: RegimeBucket[]; overall: RegimeBucket } {
  const acc = new Map<string, { m: number; n: number; h: number }>();
  const add = (k: string, m: number, n: number) => {
    const a = acc.get(k) ?? { m: 0, n: 0, h: 0 };
    a.m += m;
    a.n += n;
    a.h++;
    acc.set(k, a);
  };
  inp.dates.forEach((d, i) => {
    const s = season(d);
    const e = earBand(inp.ear.get(d));
    for (let h = 0; h < 24; h++) {
      const a = inp.actuals[i][h];
      const em = Math.abs(a - inp.model[i][h]);
      const en = Math.abs(a - inp.naive[i][h]);
      add(`estacao:${s}`, em, en);
      if (e) add(`reservatorio:${e}`, em, en);
      add(`faixa_pld:${pldBand(a, inp.floor)}`, em, en);
      add("total", em, en);
    }
  });
  const mk = (group: RegimeGroup, key: string, label: string): RegimeBucket => {
    const a = acc.get(group === "estacao" && key === "total" ? "total" : `${group}:${key}`) ?? { m: 0, n: 0, h: 0 };
    const maeModel = a.h ? a.m / a.h : null;
    const maeNaive = a.h ? a.n / a.h : null;
    return { group, key, label, hours: a.h, maeModel, maeNaive, rmae: maeModel !== null && maeNaive ? maeModel / maeNaive : null, smallSample: a.h < 48 };
  };
  const buckets = [
    ...SEASONS.map((s) => mk("estacao", s.key, s.label)),
    ...EAR_BANDS.map((b) => mk("reservatorio", b.key, b.label)),
    ...PLD_BANDS.map((b) => mk("faixa_pld", b.key, b.label)),
  ].filter((b) => b.hours > 0);
  return { buckets, overall: mk("estacao", "total", "Todos os dias") };
}

export interface RegimeBacktestResult {
  sub: Sub;
  from: string;
  to: string;
  days: number;
  overall: RegimeBucket;
  buckets: RegimeBucket[];
  method: string;
}

/** Walk-forward de `days` dias (D+1, re-estimado a cada dia) e quebra por regime. */
export function regimeBacktest(panel: SubPanel, sub: Sub, ear: DailySubPanel | null, days = 180): RegimeBacktestResult {
  const dm = toDayMatrix(panel, sub);
  const nTest = Math.min(days, dm.rows.length - 100);
  if (nTest < 14) throw new Error(`histórico insuficiente para o backtest por regime de ${sub}: ${dm.rows.length} dias`);
  const clip: [number, number] = [PLD_LIMITS.min, PLD_LIMITS.maxHourly];
  const bt = learBacktest(dm.rows, dm.dows, nTest, { calibrationDays: 90, clip, post: capDailyMean, scaling: "hourly" });
  const imputed = new Set(dm.imputed);
  const idx = bt.dayIndex.map((d, i) => ({ d, i })).filter(({ d }) => !imputed.has(dm.dates[d]));
  const earMap = new Map<string, number>();
  if (ear) ear.dates.forEach((d, i) => ear.values[sub][i] !== null && earMap.set(d, ear.values[sub][i] as number));
  const w = LEAR_WEIGHT;
  const { buckets, overall } = regimeBreakdown({
    dates: idx.map(({ d }) => dm.dates[d]),
    actuals: idx.map(({ i }) => bt.actuals[i]),
    model: idx.map(({ i }) => bt.forecasts[i].map((v, h) => w * v + (1 - w) * bt.naive[i][h])),
    naive: idx.map(({ i }) => bt.naive[i]),
    ear: earMap,
    floor: PLD_LIMITS.min,
  });
  return {
    sub,
    from: dm.dates[idx[0].d],
    to: dm.dates[idx[idx.length - 1].d],
    days: idx.length,
    overall,
    buckets,
    method: `Walk-forward de ${idx.length} dias: cada dia é previsto só com o histórico anterior (LEAR re-estimado diariamente, janela de 90 dias), combinado ${Math.round(w * 100)}/${Math.round((1 - w) * 100)} com o ingênuo semanal, e comparado ao próprio ingênuo. Dias ausentes na fonte ficam de fora.`,
  };
}
