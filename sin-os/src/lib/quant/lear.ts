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
 * das 24 horas de d−1, d−2, d−3 e d−7 + dummies de dia da semana.
 */
export interface LearModel {
  scaler: AsinhScaler;
  fits: LassoFit[]; // 24
  lags: number[];
  nTrain: number;
  selectedFeatures: number; // média de coeficientes ativos
}

export interface LearOptions {
  lags?: number[];
  calibrationDays?: number;
  clip?: [number, number];
  nLambda?: number;
  /** "lars" (padrão, caminho exato como o LassoLarsIC do epftoolbox) ou "cd" (descida coordenada). */
  solver?: "lars" | "cd";
}

const HOURS = 24;

function features(tDays: number[][], d: number, dow: number, lags: number[]): number[] {
  const x: number[] = [];
  for (const L of lags) {
    const row = tDays[d - L];
    for (let h = 0; h < HOURS; h++) x.push(row[h]);
  }
  for (let k = 0; k < 7; k++) x.push(dow === k ? 1 : 0);
  return x;
}

/** Ajusta o LEAR no final da janela `days` (matriz D×24) com o dia da semana de cada dia. */
export function learFit(days: number[][], dows: number[], opts: LearOptions = {}): LearModel {
  const lags = opts.lags ?? [1, 2, 3, 7];
  const maxLag = Math.max(...lags);
  const cal = opts.calibrationDays ?? 120;
  const start = Math.max(0, days.length - cal);
  const win = days.slice(start);
  const winDow = dows.slice(start);
  if (win.length < maxLag + 14) throw new Error(`LEAR precisa de ≥ ${maxLag + 14} dias completos (tem ${win.length})`);

  const scaler = fitAsinh(win.flat());
  const t = win.map((row) => row.map((p) => asinhFwd(scaler, p)));
  const X: number[][] = [];
  const rows: number[] = [];
  for (let d = maxLag; d < t.length; d++) {
    X.push(features(t, d, winDow[d], lags));
    rows.push(d);
  }
  const fits: LassoFit[] = [];
  let active = 0;
  for (let h = 0; h < HOURS; h++) {
    const y = rows.map((d) => t[d][h]);
    const fit =
      opts.solver === "cd" ? lassoIC(X, y, { criterion: "aicc", nLambda: opts.nLambda ?? 20 }) : lassoLarsIC(X, y, "aicc");
    fits.push(fit);
    active += fit.df;
  }
  return { scaler, fits, lags, nTrain: X.length, selectedFeatures: active / HOURS };
}

/** Previsão recursiva de `horizonDays` dias à frente. */
export function learForecast(
  model: LearModel,
  days: number[][],
  nextDows: number[],
  clip?: [number, number],
): number[][] {
  const maxLag = Math.max(...model.lags);
  const hist = days.slice(-maxLag).map((row) => row.map((p) => asinhFwd(model.scaler, p)));
  const out: number[][] = [];
  for (const dow of nextDows) {
    const d = hist.length;
    const x = features([...hist, []], d, dow, model.lags);
    const tRow = model.fits.map((fit) => predictLinear(fit, x));
    let pRow = tRow.map((v) => asinhInv(model.scaler, v));
    if (clip) pRow = pRow.map((p) => Math.min(clip[1], Math.max(clip[0], p)));
    out.push(pRow);
    hist.push(pRow.map((p) => asinhFwd(model.scaler, p)));
  }
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
}

/**
 * Avaliação fora da amostra em janela rolante (re-estimação diária, como no epftoolbox).
 * Retorna previsões LEAR e ingênuas para os últimos `nTest` dias.
 */
export function learBacktest(days: number[][], dows: number[], nTest: number, opts: LearOptions = {}): BacktestResult {
  const res: BacktestResult = { forecasts: [], naive: [], actuals: [], dayIndex: [] };
  for (let d = days.length - nTest; d < days.length; d++) {
    const trainDays = days.slice(0, d);
    const trainDows = dows.slice(0, d);
    const model = learFit(trainDays, trainDows, opts);
    res.forecasts.push(learForecast(model, trainDays, [dows[d]], opts.clip)[0]);
    res.naive.push(naiveForecast(trainDays, dows[d]));
    res.actuals.push(days[d].slice());
    res.dayIndex.push(d);
  }
  return res;
}
