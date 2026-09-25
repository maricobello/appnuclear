import { adaptiveConformal } from "../quant/conformal";
import { fitGarch } from "../quant/garch";
import { fitHmm, hmmStateLabel, regimeForecast } from "../quant/hmm";
import { learBacktest, learFit, learForecast, naiveForecast } from "../quant/lear";
import { crpsFromQuantiles, dieboldMariano, kupiec, mae, rmae, rmse, smape } from "../quant/metrics";
import { calibrateMRJD, fitSeasonality, simulateMRJD } from "../quant/ou";
import { fitQRA, predictQRA } from "../quant/qra";
import { mean, mulberry32, quantile, round } from "../quant/stats";
import { asinhFwd, asinhInv, fitAsinh } from "../quant/transforms";
import { addDays } from "../sources/time";
import type { Sub, SubPanel } from "../sources/types";
import { PLD_LIMITS, toDayMatrix } from "./brazil";

export const QRA_TAUS = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];

export interface ForecastResult {
  sub: Sub;
  generatedAt: number;
  lastObservedDate: string;
  firstForecastDate: string;
  history: { ts: number[]; values: number[] };
  horizon: {
    ts: number[];
    lear: number[];
    aciLo: number[];
    aciHi: number[];
    mc: { p05: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] };
    qraNextDay: { taus: number[]; quantiles: number[][] };
    dailyMean: { date: string; lear: number; p05: number; p95: number }[];
  };
  backtest: {
    days: number;
    maeLear: number;
    maeNaive: number;
    rmae: number;
    smape: number;
    rmse: number;
    dm: { statistic: number; pValue: number };
    aci: { coverage: number; halfWidth: number; alpha: number; kupiecP: number };
    qraCrps: number;
  };
  regime: {
    labels: string[];
    meansRS: number[];
    current: number[];
    in24h: number[];
    in7d: number[];
    transition: number[][];
    durationsH: number[];
    recentPath: number[];
  } | null;
  garch: { dailyVolPct: number; forecastVolPct: number[]; persistence: number; halfLifeDays: number; alpha: number; beta: number; n: number } | null;
  mrjd: { kappaPerHour: number; halfLifeHours: number; sigma: number; jumpsPerDay: number; jumpMean: number; jumpSd: number } | null;
  lear: { activeFeatures: number; nTrain: number; calibrationDays: number };
  warnings: string[];
}

export interface ForecastInternal extends ForecastResult {
  paths: number[][]; // trajetórias MC em R$/MWh (M × H)
  publishedAhead: { date: string; prices: number[] }[]; // dias futuros já publicados (ex.: D+1)
}

const clipPld = (v: number) => Math.min(PLD_LIMITS.maxHourly, Math.max(PLD_LIMITS.min, v));

export function buildForecast(panel: SubPanel, sub: Sub, horizonDays = 7, nPaths = 1000): ForecastInternal {
  const warnings: string[] = [];
  const dm = toDayMatrix(panel, sub);
  if (dm.rows.length < 36) throw new Error(`histórico contíguo insuficiente para ${sub}: ${dm.rows.length} dias (mín. 36)`);

  const clip: [number, number] = [PLD_LIMITS.min, PLD_LIMITS.maxHourly];
  const calibrationDays = Math.min(90, dm.rows.length - 1);
  const nTest = Math.min(14, dm.rows.length - 22);
  const bt = learBacktest(dm.rows, dm.dows, nTest, { calibrationDays, clip });
  const act = bt.actuals.flat();
  const fL = bt.forecasts.flat();
  const fN = bt.naive.flat();
  const dmTest = dieboldMariano(
    bt.actuals.map((a, d) => mae(a, bt.forecasts[d])),
    bt.actuals.map((a, d) => mae(a, bt.naive[d])),
  );
  const resid = act.map((a, i) => a - fL[i]);
  const aci = adaptiveConformal(resid, 0.1, 0.01, 168);
  const evaluated = Math.max(1, resid.length - Math.min(24, Math.floor(resid.length / 3)));
  const kup = kupiec(Math.round((1 - aci.empiricalCoverage) * evaluated), evaluated, 0.1);
  const qra = fitQRA(fL.map((f, i) => [f, fN[i]]), act, QRA_TAUS);
  const qraCrps = mean(act.map((a, i) => crpsFromQuantiles(a, predictQRA(qra, [fL[i], fN[i]]), QRA_TAUS)));

  // ---- previsão final
  const model = learFit(dm.rows, dm.dows, { calibrationDays, clip });
  const lastDate = dm.dates[dm.dates.length - 1];
  const futureDates = Array.from({ length: horizonDays }, (_, k) => addDays(lastDate, k + 1));
  const futureDows = futureDates.map((d) => new Date(`${d}T12:00:00Z`).getUTCDay());
  const fut = learForecast(model, dm.rows, futureDows, clip);
  const extended = [...dm.rows, ...fut];
  const naiveFut = futureDows.map((dow, k) => naiveForecast(extended.slice(0, dm.rows.length + k), dow));
  const qraNextDay = fut[0].map((f, h) => predictQRA(qra, [f, naiveFut[0][h]]).map(clipPld));

  const hTs = futureDates.flatMap((d) => Array.from({ length: 24 }, (_, h) => Date.parse(`${d}T${String(h).padStart(2, "0")}:00:00-03:00`)));
  const learFlat = fut.flat();
  const aciLo = learFlat.map((f, i) => clipPld(f - aci.halfWidth * Math.sqrt(1 + Math.floor(i / 24))));
  const aciHi = learFlat.map((f, i) => clipPld(f + aci.halfWidth * Math.sqrt(1 + Math.floor(i / 24))));

  // ---- MRJD sobre desvios da sazonalidade (espaço asinh) → Monte Carlo em torno do LEAR
  const recent = dm.rows.slice(-60).flat();
  const scaler = fitAsinh(recent);
  const y = recent.map((p) => asinhFwd(scaler, p));
  let mrjd: ForecastResult["mrjd"] = null;
  let paths: number[][] = [];
  try {
    const seas = fitSeasonality(y);
    const dev = y.map((v, t) => v - seas.predict(t));
    const params = calibrateMRJD(dev);
    if (!Number.isFinite(params.kappa) || params.sigma <= 0) throw new Error("MRJD degenerado");
    mrjd = {
      kappaPerHour: params.kappa,
      halfLifeHours: params.halfLife,
      sigma: params.sigma,
      jumpsPerDay: params.lambda * 24,
      jumpMean: params.jumpMean,
      jumpSd: params.jumpSd,
    };
    const center = learFlat.map((p) => asinhFwd(scaler, p));
    const devPaths = simulateMRJD({ ...params, mu: 0 }, 0, center.length, nPaths, mulberry32(20260925));
    paths = devPaths.map((d) => d.map((x, t) => clipPld(asinhInv(scaler, center[t] + x))));
  } catch (e) {
    warnings.push(`MRJD indisponível: ${e instanceof Error ? e.message : e}`);
    paths = [learFlat.slice()];
  }
  const col = (t: number) => paths.map((p) => p[t]);
  const mc = {
    p05: learFlat.map((_, t) => quantile(col(t), 0.05)),
    p25: learFlat.map((_, t) => quantile(col(t), 0.25)),
    p50: learFlat.map((_, t) => quantile(col(t), 0.5)),
    p75: learFlat.map((_, t) => quantile(col(t), 0.75)),
    p95: learFlat.map((_, t) => quantile(col(t), 0.95)),
  };
  const dailyMean = futureDates.map((date, k) => {
    const sl = (a: number[]) => a.slice(k * 24, k * 24 + 24);
    return { date, lear: mean(sl(learFlat)), p05: mean(sl(mc.p05)), p95: mean(sl(mc.p95)) };
  });

  // ---- regimes (HMM 3 estados) nas últimas 60 dias horárias
  let regime: ForecastResult["regime"] = null;
  try {
    const hmm = fitHmm(y, 3);
    const cur = hmm.filtered[hmm.filtered.length - 1];
    const fc = regimeForecast(cur, hmm.transition, 168);
    regime = {
      labels: hmm.means.map((_, i) => hmmStateLabel(3, i)),
      meansRS: hmm.means.map((m) => asinhInv(scaler, m)),
      current: cur,
      in24h: fc[23],
      in7d: fc[167],
      transition: hmm.transition,
      durationsH: hmm.expectedDuration,
      recentPath: hmm.viterbi.slice(-168),
    };
  } catch (e) {
    warnings.push(`HMM indisponível: ${e instanceof Error ? e.message : e}`);
  }

  // ---- GARCH(1,1) nos retornos log do preço médio diário
  let garch: ForecastResult["garch"] = null;
  const daily = dm.rows.map((r) => mean(r));
  const rets = daily.slice(1).map((p, i) => 100 * Math.log(p / daily[i]));
  const nonZero = rets.filter((r) => Math.abs(r) > 1e-9).length;
  if (rets.length >= 40 && nonZero >= 20) {
    const gfit = fitGarch(rets, horizonDays);
    // α≈0 ou α+β≈1 (fronteira): sem clustering identificável / processo integrado
    if (gfit.alpha < 0.01) warnings.push("GARCH: sem agrupamento de volatilidade identificável (α≈0) — volatilidade tratada como constante");
    else if (gfit.persistence > 0.995) warnings.push("GARCH: persistência ≈ 1 (IGARCH) — choques de volatilidade não decaem na janela");
    garch = {
      dailyVolPct: gfit.condVol[gfit.condVol.length - 1],
      forecastVolPct: gfit.forecastVol,
      persistence: gfit.persistence,
      halfLifeDays: gfit.alpha >= 0.01 && gfit.halfLife < 365 ? gfit.halfLife : Infinity,
      alpha: gfit.alpha,
      beta: gfit.beta,
      n: rets.length,
    };
  } else {
    warnings.push("GARCH omitido: poucos retornos não nulos (preço colado no piso/teto?)");
  }

  const histDays = Math.min(14, dm.rows.length);
  const histTs = dm.dates.slice(-histDays).flatMap((d) => Array.from({ length: 24 }, (_, h) => Date.parse(`${d}T${String(h).padStart(2, "0")}:00:00-03:00`)));

  // dias futuros já publicados no painel (ex.: PLD D+1 divulgado pela CCEE)
  const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const publishedAhead = dm.dates
    .map((d, i) => ({ date: d, prices: dm.rows[i] }))
    .filter((x) => x.date > today);

  return {
    sub,
    generatedAt: Date.now(),
    lastObservedDate: lastDate,
    firstForecastDate: futureDates[0],
    history: { ts: histTs, values: dm.rows.slice(-histDays).flat() },
    horizon: {
      ts: hTs,
      lear: learFlat.map((v) => round(v)),
      aciLo,
      aciHi,
      mc,
      qraNextDay: { taus: QRA_TAUS, quantiles: qraNextDay },
      dailyMean,
    },
    backtest: {
      days: nTest,
      maeLear: mae(act, fL),
      maeNaive: mae(act, fN),
      rmae: rmae(act, fL, fN),
      smape: smape(act, fL),
      rmse: rmse(act, fL),
      dm: { statistic: dmTest.statistic, pValue: dmTest.pValue },
      aci: { coverage: aci.empiricalCoverage, halfWidth: aci.halfWidth, alpha: aci.alphaFinal, kupiecP: kup.pValue },
      qraCrps,
    },
    regime,
    garch,
    mrjd,
    lear: { activeFeatures: model.selectedFeatures, nTrain: model.nTrain, calibrationDays },
    warnings,
    paths,
    publishedAhead,
  };
}

export function publicForecast(f: ForecastInternal): ForecastResult {
  const { paths: _p, publishedAhead: _a, ...rest } = f;
  void _p;
  void _a;
  return rest;
}
