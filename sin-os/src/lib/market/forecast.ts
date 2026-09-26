import { adaptiveConformal } from "../quant/conformal";
import { fitGarch } from "../quant/garch";
import { fitHmm, hmmStateLabel, regimeForecast } from "../quant/hmm";
import { learBacktest, learFit, learForecast, naiveForecast } from "../quant/lear";
import { crpsFromQuantiles, dieboldMariano, kupiec, mae, rmae, rmse, smape } from "../quant/metrics";
import { calibrateMRJD, calibrateMRJDSegments, fitSeasonality, simulateMRJD } from "../quant/ou";
import { fitQRA, predictQRA } from "../quant/qra";
import { mean, mulberry32, quantile, round } from "../quant/stats";
import { asinhFwd, asinhInv, fitAsinh } from "../quant/transforms";
import { addDays } from "../sources/time";
import type { Sub, SubPanel } from "../sources/types";
import { capDailyMean, capDailyMeans, PLD_LIMITS, toDayMatrix } from "./brazil";

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
    /** CRPS e cobertura 5–95% do QRA fora da amostra (ajuste na 1ª metade do backtest). */
    qraCrps: number;
    qraCoverage90: number;
    /** Erro fora da amostra por horizonte (D+1…D+7) e o fator de alargamento da banda. */
    horizonErrors: { day: number; mae: number | null; n: number; spread: number }[];
    /** MAE separado por regime: horas no piso vs. fora do piso (e a fração no piso). */
    regimeMae: { floor: number | null; offFloor: number | null; floorShare: number };
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
  mrjd: { kappaPerHour: number; halfLifeHours: number; sigma: number; jumpsPerDay: number; jumpMean: number; jumpSd: number; calibratedOn: string } | null;
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
  const nTest = Math.max(8, Math.min(28, dm.rows.length - 22));
  // piso/teto horário (clip) e teto estrutural na média do dia (post) — a mesma regra do PLD.
  // Escalonamento asinh por hora (epftoolbox): em 87 dias reais (jun–set/2026) reduziu o MAE
  // nos 4 submercados, com DM significativo a 5% em SE, S e N. Ensemble de janelas e CMO
  // semanal do DECOMP como exógena não trouxeram ganho consistente e ficaram de fora.
  const learOpts = { calibrationDays, clip, post: capDailyMean, scaling: "hourly" as const };
  // backtest multi-horizonte: cada origem prevê D+1…D+H, para medir o erro por horizonte
  const btAll = learBacktest(dm.rows, dm.dows, nTest, { ...learOpts, horizon: horizonDays });
  // dias interpolados (ausentes na fonte) não são "observados": ficam fora das métricas
  const imputed = new Set(dm.imputed);
  const keep = btAll.dayIndex.map((d) => !imputed.has(dm.dates[d]));
  const pick = <T,>(a: T[]) => a.filter((_, i) => keep[i]);
  const bt = { forecasts: pick(btAll.forecasts), naive: pick(btAll.naive), actuals: pick(btAll.actuals), dayIndex: pick(btAll.dayIndex) };
  if (dm.imputed.length) warnings.push(`${dm.imputed.length} dia(s) ausente(s) na fonte preenchido(s) por interpolação: ${dm.imputed.slice(-5).join(", ")}`);

  // erros por horizonte (k = 0 é D+1): só dias observados de verdade
  const errByH: number[][] = Array.from({ length: horizonDays }, () => []);
  btAll.multi.forEach((path, i) => {
    const o = btAll.dayIndex[i];
    path.forEach((f, k) => {
      const d = o + k;
      if (d >= dm.rows.length || imputed.has(dm.dates[d])) return;
      dm.rows[d].forEach((a, h) => errByH[k].push(a - f[h]));
    });
  });
  // razão de dispersão D+k / D+1 (quantil 90% de |erro|), monotônica; poucos dados ⇒ √k
  const q90 = (e: number[]) => quantile(e.map(Math.abs), 0.9);
  const growth: number[] = [];
  errByH.forEach((e, k) => {
    const prev = growth[k - 1] ?? 1;
    const r = k === 0 ? 1 : e.length >= 24 * 5 && errByH[0].length ? q90(e) / q90(errByH[0]) : prev * Math.sqrt((k + 1) / k);
    growth.push(Math.max(prev, Number.isFinite(r) ? r : prev));
  });
  const horizonErrors = errByH.map((e, k) => ({ day: k + 1, mae: e.length ? mean(e.map(Math.abs)) : null, n: e.length / 24, spread: growth[k] }));
  const act = bt.actuals.flat();
  const fL = bt.forecasts.flat();
  const fN = bt.naive.flat();
  const dmTest = dieboldMariano(
    bt.actuals.map((a, d) => mae(a, bt.forecasts[d])),
    bt.actuals.map((a, d) => mae(a, bt.naive[d])),
  );
  const resid = act.map((a, i) => a - fL[i]);
  // day-ahead: as 24 horas saem juntas ⇒ ACI em blocos de 24 h (sem informação do próprio dia)
  const aci = adaptiveConformal(resid, 0.1, 0.01, 168, 24);
  const kup = kupiec(aci.violations, Math.max(1, aci.evaluated), 0.1);
  // heterocedasticidade intradiária: fator por hora-do-dia (q90 do |erro| relativo à média),
  // normalizado para média 1 — redistribui a largura da banda entre pico e fora-de-pico sem
  // mudar a cobertura global. Sample pequeno ⇒ limita a [0.5, 2].
  const byHour: number[][] = Array.from({ length: 24 }, () => []);
  resid.forEach((r, i) => byHour[i % 24].push(Math.abs(r)));
  const q90h = byHour.map((e) => (e.length ? quantile(e, 0.9) : 0));
  const meanQ90 = mean(q90h.filter((v) => v > 0)) || 1;
  const hourScale = q90h.map((v) => Math.min(2, Math.max(0.5, (v || meanQ90) / meanQ90)));
  // MAE por regime: horas coladas no piso vs. fora do piso (o MAE agrupado esconde onde falha)
  const floorLvl = PLD_LIMITS.min * 1.01;
  const rg = { floorErr: [] as number[], offErr: [] as number[] };
  bt.actuals.forEach((a, d) => a.forEach((v, h) => (v <= floorLvl ? rg.floorErr : rg.offErr).push(Math.abs(v - bt.forecasts[d][h]))));
  const regimeMae = {
    floor: rg.floorErr.length ? mean(rg.floorErr) : null,
    offFloor: rg.offErr.length ? mean(rg.offErr) : null,
    floorShare: act.length ? rg.floorErr.length / act.length : 0,
  };
  // QRA avaliado fora da amostra: ajusta na 1ª metade dos dias do backtest, mede na 2ª
  const cut = 24 * Math.floor(bt.actuals.length / 2);
  const qraCal = fitQRA(fL.slice(0, cut).map((f, i) => [f, fN[i]]), act.slice(0, cut), QRA_TAUS);
  const oos = act.slice(cut).map((a, j) => ({ a, q: predictQRA(qraCal, [fL[cut + j], fN[cut + j]]) }));
  const qraCrps = mean(oos.map(({ a, q }) => crpsFromQuantiles(a, q, QRA_TAUS)));
  const qraCoverage90 = mean(oos.map(({ a, q }) => (a >= q[0] && a <= q[q.length - 1] ? 1 : 0)));
  // modelo operacional: todos os dias do backtest
  const qra = fitQRA(fL.map((f, i) => [f, fN[i]]), act, QRA_TAUS);

  // ---- previsão final
  const model = learFit(dm.rows, dm.dows, learOpts);
  const lastDate = dm.dates[dm.dates.length - 1];
  const futureDates = Array.from({ length: horizonDays }, (_, k) => addDays(lastDate, k + 1));
  const futureDows = futureDates.map((d) => new Date(`${d}T12:00:00Z`).getUTCDay());
  const fut = learForecast(model, dm.rows, futureDows, clip, capDailyMean);
  const extended = [...dm.rows, ...fut];
  const naiveFut = futureDows.map((dow, k) => naiveForecast(extended.slice(0, dm.rows.length + k), dow));
  const qraNextDay = fut[0].map((f, h) => predictQRA(qra, [f, naiveFut[0][h]]).map(clipPld));

  const hTs = futureDates.flatMap((d) => Array.from({ length: 24 }, (_, h) => Date.parse(`${d}T${String(h).padStart(2, "0")}:00:00-03:00`)));
  const learFlat = fut.flat();
  // banda conformal de D+1 (ACI) alargada pelo crescimento MEDIDO do erro em cada horizonte
  const band = (i: number) => aci.halfWidth * growth[Math.floor(i / 24)] * hourScale[i % 24];
  const aciLo = learFlat.map((f, i) => clipPld(f - band(i)));
  const aciHi = learFlat.map((f, i) => clipPld(f + band(i)));

  // ---- MRJD calibrado nos ERROS do LEAR (espaço asinh) → Monte Carlo em torno do LEAR.
  // Cenários com a dispersão real da previsão; a dispersão por horizonte segue o backtest.
  const recent = dm.rows.slice(-60).flat();
  const scaler = fitAsinh(recent);
  const y = recent.map((p) => asinhFwd(scaler, p));
  const residDays = bt.actuals.map((a, d) => a.map((v, h) => asinhFwd(scaler, v) - asinhFwd(scaler, bt.forecasts[d][h])));
  const residAsinh = residDays.flat();
  let mrjd: ForecastResult["mrjd"] = null;
  let paths: number[][] = [];
  try {
    let params = residDays.length >= 10 ? calibrateMRJDSegments(residDays) : null;
    let calibratedOn: "resíduos do LEAR" | "desvios sazonais" = "resíduos do LEAR";
    if (!params || !Number.isFinite(params.kappa) || params.kappa <= 0 || params.sigma <= 0) {
      const seas = fitSeasonality(y);
      params = calibrateMRJD(y.map((v, t) => v - seas.predict(t)));
      calibratedOn = "desvios sazonais";
      warnings.push("MRJD calibrado em desvios sazonais (resíduos do LEAR insuficientes ou degenerados)");
    }
    if (!Number.isFinite(params.kappa) || params.sigma <= 0) throw new Error("MRJD degenerado");
    mrjd = {
      kappaPerHour: params.kappa,
      halfLifeHours: params.halfLife,
      sigma: params.sigma,
      jumpsPerDay: params.lambda * 24,
      jumpMean: params.jumpMean,
      jumpSd: params.jumpSd,
      calibratedOn,
    };
    const center = learFlat.map((p) => asinhFwd(scaler, p));
    // aquecimento de 72 h: começa na distribuição estacionária (o erro de D+1 não é zero na 1ª hora)
    const burn = 72;
    const devPaths = simulateMRJD({ ...params, mu: 0 }, 0, center.length + burn, nPaths, mulberry32(20260925)).map((d) => d.slice(burn));
    // casamento de quantis: a faixa 5–95% simulada em D+1 passa a ter a largura da faixa
    // 5–95% dos erros reais do LEAR (o MRJD sozinho superestimava a dispersão)
    let c = 1;
    if (calibratedOn === "resíduos do LEAR") {
      const sim = devPaths.flatMap((d) => d.slice(0, 24));
      const wSim = quantile(sim, 0.95) - quantile(sim, 0.05);
      const wEmp = quantile(residAsinh, 0.95) - quantile(residAsinh, 0.05);
      if (wSim > 0 && wEmp > 0) c = Math.min(3, Math.max(0.3, wEmp / wSim));
    }
    // cada trajetória obedece à regra completa do PLD: piso/teto horário e teto estrutural diário
    paths = devPaths.map((d) => capDailyMeans(d.map((x, t) => clipPld(asinhInv(scaler, center[t] + c * x * growth[Math.floor(t / 24)])))));
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
      days: bt.actuals.length,
      maeLear: mae(act, fL),
      maeNaive: mae(act, fN),
      rmae: rmae(act, fL, fN),
      smape: smape(act, fL),
      rmse: rmse(act, fL),
      dm: { statistic: dmTest.statistic, pValue: dmTest.pValue },
      aci: { coverage: aci.empiricalCoverage, halfWidth: aci.halfWidth, alpha: aci.alphaFinal, kupiecP: kup.pValue },
      qraCrps,
      qraCoverage90,
      horizonErrors,
      regimeMae,
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
