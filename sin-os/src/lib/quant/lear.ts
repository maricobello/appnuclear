import { lassoIC, predictLinear, type LassoFit } from "./lasso";
import { lassoLarsIC } from "./lars";
import { asinhFwd, asinhInv, fitAsinh, type AsinhScaler } from "./transforms";

/**
 * LEAR — LASSO Estimated AutoRegressive (Uniejewski, Nowotarski & Weron, 2016;
 * benchmark aberto de Lago, Marcjasz, De Schutter & Weron, 2021, Applied Energy 293,
 * "Forecasting day-ahead electricity prices: A review of state-of-the-art algorithms,
 * best practices and an open-access benchmark" — github.com/jeslago/epftoolbox).
 *
 * 24 modelos (um por hora do dia). Regressores: preços transformados (asinh-median)
 * das 24 horas de d−1, d−2, d−3 e d−7, exógenas opcionais conhecidas no momento da
 * previsão (LEAR-X) e dummies de dia da semana.
 *
 * Como no epftoolbox, a transformação asinh-median é ajustada POR COLUNA (cada hora do
 * dia e cada exógena tem mediana/MAD próprias), e a previsão final pode ser a média de
 * modelos calibrados em janelas de tamanhos diferentes (ensemble de janelas).
 */
export interface LearModel {
  /** Escalonador por hora do dia (24) — o preço da hora h usa scalers[h] em qualquer defasagem. */
  scalers: AsinhScaler[];
  exogScalers: AsinhScaler[];
  fits: LassoFit[]; // 24
  /**
   * Faixa do alvo transformado (asinh) vista no treino, por hora. A previsão é limitada a
   * essa faixa antes de voltar à escala de preço: numa janela quase toda no piso o MAD
   * colapsa (b pequeno) e sinh(ŷ) extrapolava para o teto (ex.: NE úmido/2025 previu
   * ~931 R$/MWh com realizado de 72). Limitar nunca piorou o MAE na validação real.
   */
  yRange: [number, number][];
  lags: number[];
  nTrain: number;
  selectedFeatures: number; // média de coeficientes ativos
  calibrationDays: number;
}

export interface LearOptions {
  lags?: number[];
  calibrationDays?: number;
  /** Ensemble de janelas de calibração (dias); substitui `calibrationDays` quando definido. */
  windows?: number[];
  /** "hourly" (padrão, como o epftoolbox) ou "global" (um escalonador para todas as horas). */
  scaling?: "hourly" | "global";
  /**
   * Exógenas por dia, alinhadas ao índice de `days` e estendidas pelos dias previstos:
   * exog[d] = valores CONHECIDOS antes de prever o dia d (ex.: CMO semanal do DECOMP).
   */
  exog?: number[][];
  clip?: [number, number];
  nLambda?: number;
  /** "lars" (padrão, caminho exato como o LassoLarsIC do epftoolbox) ou "cd" (descida coordenada). */
  solver?: "lars" | "cd";
  /** Regra aplicada a cada dia previsto (ex.: teto estrutural do PLD), antes de virar defasagem. */
  post?: (day: number[]) => number[];
}

const HOURS = 24;

function features(tDays: number[][], d: number, dow: number, lags: number[], exogRow: number[]): number[] {
  const x: number[] = [];
  for (const L of lags) {
    const row = tDays[d - L];
    for (let h = 0; h < HOURS; h++) x.push(row[h]);
  }
  x.push(...exogRow);
  for (let k = 0; k < 7; k++) x.push(dow === k ? 1 : 0);
  return x;
}

const transformRow = (m: LearModel, row: number[]) => row.map((p, h) => asinhFwd(m.scalers[h], p));
const transformExog = (m: LearModel, row: number[] | undefined) => (row ?? []).slice(0, m.exogScalers.length).map((v, j) => asinhFwd(m.exogScalers[j], v));

/** Ajusta o LEAR no final da janela (matriz D×24) com o dia da semana de cada dia. */
export function learFit(days: number[][], dows: number[], opts: LearOptions = {}): LearModel {
  const lags = opts.lags ?? [1, 2, 3, 7];
  const maxLag = Math.max(...lags);
  const cal = opts.calibrationDays ?? 120;
  const start = Math.max(0, days.length - cal);
  const win = days.slice(start);
  const winDow = dows.slice(start);
  if (win.length < maxLag + 14) throw new Error(`LEAR precisa de ≥ ${maxLag + 14} dias completos (tem ${win.length})`);

  const scalers =
    opts.scaling === "global"
      ? new Array<AsinhScaler>(HOURS).fill(fitAsinh(win.flat()))
      : Array.from({ length: HOURS }, (_, h) => fitAsinh(win.map((r) => r[h])));
  const exogWin = opts.exog ? opts.exog.slice(start, days.length) : [];
  const nExog = exogWin[0]?.length ?? 0;
  const exogScalers = Array.from({ length: nExog }, (_, j) => fitAsinh(exogWin.map((r) => r[j])));
  const model: LearModel = { scalers, exogScalers, fits: [], yRange: [], lags, nTrain: 0, selectedFeatures: 0, calibrationDays: cal };

  const t = win.map((row) => transformRow(model, row));
  const X: number[][] = [];
  const rows: number[] = [];
  for (let d = maxLag; d < t.length; d++) {
    X.push(features(t, d, winDow[d], lags, transformExog(model, exogWin[d])));
    rows.push(d);
  }
  let active = 0;
  for (let h = 0; h < HOURS; h++) {
    const y = rows.map((d) => t[d][h]);
    const fit =
      opts.solver === "cd" ? lassoIC(X, y, { criterion: "aicc", nLambda: opts.nLambda ?? 20 }) : lassoLarsIC(X, y, "aicc");
    model.fits.push(fit);
    model.yRange.push([Math.min(...y), Math.max(...y)]);
    active += fit.df;
  }
  model.nTrain = X.length;
  model.selectedFeatures = active / HOURS;
  return model;
}

/** Ajusta um modelo por janela do ensemble (janelas maiores que o histórico viram o histórico todo). */
export function learFitEnsemble(days: number[][], dows: number[], opts: LearOptions = {}): LearModel[] {
  const maxLag = Math.max(...(opts.lags ?? [1, 2, 3, 7]));
  const wins = (opts.windows ?? [opts.calibrationDays ?? 120]).map((w) => Math.min(w, days.length));
  const unique = wins.filter((w, i) => wins.indexOf(w) === i && w >= maxLag + 14);
  return unique.map((w) => learFit(days, dows, { ...opts, calibrationDays: w }));
}

/**
 * Previsão recursiva de `nextDows.length` dias à frente. Com vários modelos (ensemble de
 * janelas), a previsão de cada dia é a média dos modelos, e essa média vira a defasagem
 * dos dias seguintes. `exog` segue o índice de `days` (o dia previsto k usa exog[days.length + k]).
 */
export function learForecast(
  model: LearModel | LearModel[],
  days: number[][],
  nextDows: number[],
  clip?: [number, number],
  post?: (day: number[]) => number[],
  exog?: number[][],
): number[][] {
  const models = Array.isArray(model) ? model : [model];
  const maxLag = Math.max(...models.flatMap((m) => m.lags));
  const hist = days.slice(-maxLag).map((r) => r.slice());
  const out: number[][] = [];
  nextDows.forEach((dow, k) => {
    const exogRow = exog?.[days.length + k];
    const preds = models.map((m) => {
      const t = hist.map((r) => transformRow(m, r));
      const x = features([...t, []], t.length, dow, m.lags, transformExog(m, exogRow));
      return m.fits.map((fit, h) => {
        const [lo, hi] = m.yRange[h] ?? [-Infinity, Infinity];
        return asinhInv(m.scalers[h], Math.min(hi, Math.max(lo, predictLinear(fit, x))));
      });
    });
    let pRow = Array.from({ length: HOURS }, (_, h) => preds.reduce((s, p) => s + p[h], 0) / preds.length);
    if (clip) pRow = pRow.map((p) => Math.min(clip[1], Math.max(clip[0], p)));
    if (post) pRow = post(pRow);
    out.push(pRow);
    hist.push(pRow);
  });
  return out;
}

/** Benchmark ingênuo semanal de Lago et al. (2021): seg/sáb/dom usam d−7, demais d−1. */
export function naiveForecast(days: number[][], dow: number): number[] {
  const useWeekly = dow === 1 || dow === 6 || dow === 0;
  const src = useWeekly && days.length >= 7 ? days[days.length - 7] : days[days.length - 1];
  return src.slice();
}

export interface BacktestResult {
  forecasts: number[][];
  naive: number[][];
  actuals: number[][];
  dayIndex: number[];
  /** Com `horizon` > 1: previsões recursivas de cada origem para os dias d, d+1, … (até o fim da amostra). */
  multi: number[][][];
}

/**
 * Avaliação fora da amostra em janela rolante (re-estimação diária, como no epftoolbox).
 * Retorna previsões LEAR e ingênuas para os últimos `nTest` dias. Com `windows`, usa o
 * ensemble de janelas; com `exog`, a linha do dia previsto (conhecida na véspera).
 */
export function learBacktest(days: number[][], dows: number[], nTest: number, opts: LearOptions & { horizon?: number } = {}): BacktestResult {
  const res: BacktestResult = { forecasts: [], naive: [], actuals: [], dayIndex: [], multi: [] };
  const H = Math.max(1, opts.horizon ?? 1);
  for (let d = days.length - nTest; d < days.length; d++) {
    const trainDays = days.slice(0, d);
    const trainDows = dows.slice(0, d);
    const models = opts.windows ? learFitEnsemble(trainDays, trainDows, opts) : [learFit(trainDays, trainDows, opts)];
    const path = learForecast(models, trainDays, dows.slice(d, Math.min(days.length, d + H)), opts.clip, opts.post, opts.exog);
    res.forecasts.push(path[0]);
    res.multi.push(path);
    res.naive.push(naiveForecast(trainDays, dows[d]));
    res.actuals.push(days[d].slice());
    res.dayIndex.push(d);
  }
  return res;
}
