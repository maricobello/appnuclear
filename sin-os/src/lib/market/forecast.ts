import { adaptiveConformal, conformalQuantile } from "../quant/conformal";
import { fitGarch } from "../quant/garch";
import { fitHmm, hmmStateLabel, regimeForecast } from "../quant/hmm";
import { learBacktest, learFit, learForecast, naiveForecast } from "../quant/lear";
import { christoffersen, crpsFromQuantiles, dieboldMariano, kupiecBlocks, mae, rmae, rmse, smape } from "../quant/metrics";
import { calibrateMRJD, calibrateTwoFactor, fitSeasonality, simulateTwoFactor, type TwoFactorParams } from "../quant/ou";
import { fitQRA, predictQRA } from "../quant/qra";
import { mean, mulberry32, quantile, round } from "../quant/stats";
import { asinhFwd, asinhInv, fitAsinh } from "../quant/transforms";
import { addDays } from "../sources/time";
import type { Sub, SubPanel } from "../sources/types";
import { capDailyMean, capDailyMeans, PLD_LIMITS, toDayMatrix } from "./brazil";

export const QRA_TAUS = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];

/**
 * Peso do LEAR na previsão pontual publicada (o resto vai para o ingênuo semanal).
 * Em 891 dias reais fora da amostra (abr/2024–set/2026), o LEAR sozinho teve rMAE
 * 1,04–1,12 (perde do ingênuo no período longo, com a transição úmido→seco), enquanto a
 * média simples 50/50 ficou em 0,95–0,99 nos 4 submercados e venceu o LEAR com DM (HAC)
 * t ≈ −3,9 a −4,5. Pesos estimados em janela móvel não superaram a média simples
 * (o "enigma da combinação" de previsões — Smith & Wallis, 2009).
 */
export const LEAR_WEIGHT = 0.5;

/**
 * Combina uma trajetória LEAR (dias × 24) com o ingênuo semanal de forma recursiva: o
 * ingênuo de D+k usa a própria previsão combinada dos dias anteriores quando o dia de
 * referência ainda não foi observado. `hist` = dias observados até a origem.
 */
export function combinePath(learPath: number[][], hist: number[][], dows: number[], w = LEAR_WEIGHT): number[][] {
  const ext = hist.slice(-7);
  return learPath.map((row, k) => {
    const nv = naiveForecast(ext, dows[k]);
    const c = row.map((v, h) => w * v + (1 - w) * nv[h]);
    ext.push(c);
    return c;
  });
}

export interface ForecastResult {
  sub: Sub;
  generatedAt: number;
  lastObservedDate: string;
  firstForecastDate: string;
  history: { ts: number[]; values: number[] };
  horizon: {
    ts: number[];
    /** Previsão pontual publicada: LEAR ⊕ ingênuo semanal (ver LEAR_WEIGHT). Centro das bandas e do Monte Carlo. */
    point: number[];
    /** LEAR sozinho (transparência). */
    lear: number[];
    aciLo: number[];
    aciHi: number[];
    mc: { p05: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] };
    qraNextDay: { taus: number[]; quantiles: number[][] };
    dailyMean: { date: string; point: number; lear: number; p05: number; p95: number }[];
  };
  backtest: {
    days: number;
    /** MAE da previsão publicada (LEAR ⊕ ingênuo). */
    maeModel: number;
    maeLear: number;
    maeNaive: number;
    /** rMAE da previsão publicada vs ingênuo semanal; rmaeLear = LEAR sozinho. */
    rmae: number;
    rmaeLear: number;
    /** DM (HAC) da publicada contra o LEAR sozinho (p < 0,05 ⇒ a combinação é melhor). */
    dmVsLear: { statistic: number; pValue: number };
    smape: number;
    rmse: number;
    dm: { statistic: number; pValue: number };
    /**
     * Cobertura da banda PUBLICADA (escore normalizado pelo fator da hora) e testes:
     * Kupiec com efeito de desenho diário (deff) e independência de Christoffersen na
     * mesma hora de dias consecutivos (defasagem 24 h).
     */
    aci: { coverage: number; halfWidth: number; alpha: number; kupiecP: number; deff: number; christoffersenP: number; pi01: number; pi11: number };
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
  mrjd: {
    kappaPerHour: number;
    halfLifeHours: number;
    sigma: number;
    jumpsPerDay: number;
    jumpMean: number;
    jumpSd: number;
    /** Fator de nível diário (modelo de dois fatores): desvio-padrão e AR(1) entre dias. */
    dayLevelSd: number;
    dayPhi: number;
    calibratedOn: string;
  } | null;
  lear: { activeFeatures: number; nTrain: number; calibrationDays: number };
  warnings: string[];
}

export interface ForecastInternal extends ForecastResult {
  paths: number[][]; // trajetórias MC em R$/MWh (M × H)
  publishedAhead: { date: string; prices: number[] }[]; // dias futuros já publicados (ex.: D+1)
  realizedDaily: number[][]; // últimos dias realizados (matriz dia×24h) — base do backtest de P&L realizado
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
  // previsão publicada em cada origem: LEAR ⊕ ingênuo (recursivo por horizonte)
  const comboMulti = btAll.multi.map((path, i) => {
    const o = btAll.dayIndex[i];
    return combinePath(path, dm.rows.slice(0, o), dm.dows.slice(o, o + path.length));
  });
  // dias interpolados (ausentes na fonte) não são "observados": ficam fora das métricas
  const imputed = new Set(dm.imputed);
  const keep = btAll.dayIndex.map((d) => !imputed.has(dm.dates[d]));
  const pick = <T,>(a: T[]) => a.filter((_, i) => keep[i]);
  const bt = {
    forecasts: pick(comboMulti.map((p) => p[0])),
    lear: pick(btAll.forecasts),
    naive: pick(btAll.naive),
    actuals: pick(btAll.actuals),
    dayIndex: pick(btAll.dayIndex),
  };
  if (dm.imputed.length) warnings.push(`${dm.imputed.length} dia(s) ausente(s) na fonte preenchido(s) por interpolação: ${dm.imputed.slice(-5).join(", ")}`);

  // erros por horizonte (k = 0 é D+1): só dias observados de verdade
  const errByH: number[][] = Array.from({ length: horizonDays }, () => []);
  comboMulti.forEach((path, i) => {
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
  // erro da MÉDIA DIÁRIA por horizonte (conformal direto): a faixa do dia não depende da
  // estrutura de dependência do Monte Carlo, que subestimava a dispersão do nível do dia
  const dayErrByH: number[][] = Array.from({ length: horizonDays }, () => []);
  comboMulti.forEach((path, i) => {
    const o = btAll.dayIndex[i];
    path.forEach((f, k) => {
      const d = o + k;
      if (d >= dm.rows.length || imputed.has(dm.dates[d])) return;
      dayErrByH[k].push(Math.abs(mean(dm.rows[d]) - mean(f)));
    });
  });
  const dayQ: number[] = [];
  dayErrByH.forEach((e, k) => {
    const q = e.length >= 10 ? conformalQuantile(e, 0.1) : NaN;
    dayQ.push(Number.isFinite(q) ? Math.max(q, dayQ[k - 1] ?? 0) : NaN);
  });
  const horizonErrors = errByH.map((e, k) => ({ day: k + 1, mae: e.length ? mean(e.map(Math.abs)) : null, n: e.length / 24, spread: growth[k] }));
  const act = bt.actuals.flat();
  const fL = bt.forecasts.flat();
  const fN = bt.naive.flat();
  const fLear = bt.lear.flat();
  const dayLoss = (f: number[][]) => bt.actuals.map((a, d) => mae(a, f[d]));
  const dmTest = dieboldMariano(dayLoss(bt.forecasts), dayLoss(bt.naive));
  const dmVsLear = dieboldMariano(dayLoss(bt.forecasts), dayLoss(bt.lear));
  const resid = act.map((a, i) => a - fL[i]);
  // heterocedasticidade intradiária: fator por hora-do-dia (q90 do |erro| relativo à média),
  // normalizado para média 1 — redistribui a largura da banda entre pico e fora-de-pico.
  // Sample pequeno ⇒ limita a [0.5, 2].
  const byHour: number[][] = Array.from({ length: 24 }, () => []);
  resid.forEach((r, i) => byHour[i % 24].push(Math.abs(r)));
  const q90h = byHour.map((e) => (e.length ? quantile(e, 0.9) : 0));
  const meanQ90 = mean(q90h.filter((v) => v > 0)) || 1;
  const hourScale = q90h.map((v) => Math.min(3, Math.max(0.5, (v || meanQ90) / meanQ90)));
  // day-ahead: as 24 horas saem juntas ⇒ ACI em blocos de 24 h (sem informação do próprio
  // dia). O escore é |erro|/fator_da_hora, então a cobertura medida é a da banda publicada
  // (half-width × fator), não a de uma banda plana.
  const aci = adaptiveConformal(resid.map((r, i) => r / hourScale[i % 24]), 0.1, 0.01, 168, 24);
  const kup = kupiecBlocks(aci.hits, 24, 0.1);
  const chr = christoffersen(aci.hits, 24, kup.deff);
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
  const qraCal = fitQRA(fLear.slice(0, cut).map((f, i) => [f, fN[i]]), act.slice(0, cut), QRA_TAUS);
  const oos = act.slice(cut).map((a, j) => ({ a, q: predictQRA(qraCal, [fLear[cut + j], fN[cut + j]]) }));
  const qraCrps = mean(oos.map(({ a, q }) => crpsFromQuantiles(a, q, QRA_TAUS)));
  const qraCoverage90 = mean(oos.map(({ a, q }) => (a >= q[0] && a <= q[q.length - 1] ? 1 : 0)));
  // modelo operacional: todos os dias do backtest
  const qra = fitQRA(fLear.map((f, i) => [f, fN[i]]), act, QRA_TAUS);

  // ---- previsão final
  const model = learFit(dm.rows, dm.dows, learOpts);
  const lastDate = dm.dates[dm.dates.length - 1];
  const futureDates = Array.from({ length: horizonDays }, (_, k) => addDays(lastDate, k + 1));
  const futureDows = futureDates.map((d) => new Date(`${d}T12:00:00Z`).getUTCDay());
  const fut = learForecast(model, dm.rows, futureDows, clip, capDailyMean);
  const futPoint = combinePath(fut, dm.rows, futureDows);
  const extended = [...dm.rows, ...fut];
  const naiveFut = futureDows.map((dow, k) => naiveForecast(extended.slice(0, dm.rows.length + k), dow));
  const qraNextDay = fut[0].map((f, h) => predictQRA(qra, [f, naiveFut[0][h]]).map(clipPld));

  const hTs = futureDates.flatMap((d) => Array.from({ length: 24 }, (_, h) => Date.parse(`${d}T${String(h).padStart(2, "0")}:00:00-03:00`)));
  const learOnly = fut.flat();
  // centro de bandas e trajetórias = previsão publicada (LEAR ⊕ ingênuo)
  const learFlat = futPoint.flat();
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
    let params: TwoFactorParams | null = residDays.length >= 10 ? calibrateTwoFactor(residDays) : null;
    let calibratedOn = "resíduos do backtest (marginais empíricas + dependência de dois fatores)";
    if (!params || !Number.isFinite(params.kappa) || params.kappa <= 0 || params.sigma <= 0) {
      const seas = fitSeasonality(y);
      const one = calibrateMRJD(y.map((v, t) => v - seas.predict(t)));
      params = { ...one, mu: 0, dayVar: 0, dayPhi: 0, bWithin: Math.exp(-one.kappa) };
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
      dayLevelSd: Math.sqrt(params.dayVar),
      dayPhi: params.dayPhi,
      calibratedOn,
    };
    const H = learFlat.length;
    // Marginais EMPÍRICAS por horizonte: erros reais (R$/MWh) da previsão publicada em D+k,
    // normalizados pelo fator da hora. O modelo de dois fatores só fornece a DEPENDÊNCIA
    // (postos) entre horas e dias — cópula empírica. Assim o centro e a dispersão de cada
    // hora batem com o erro observado (antes, a volta do espaço asinh deslocava as
    // trajetórias 27–67 R$/MWh para cima e inflava a variação intradiária).
    const pools = errByH.map((e) => e.map((v, j) => v / hourScale[j % 24]).sort((a, b) => a - b));
    for (let k = 1; k < pools.length; k++) if (pools[k].length < 24 * 5) pools[k] = pools[k - 1].map((v) => v * (growth[k] / (growth[k - 1] || 1)));
    // os erros dos ~28 dias do backtest subestimam a dispersão fora da amostra nos horizontes
    // longos (validação real: 5–95% em D+7 ≈ 0,80): cada horizonte fica pelo menos tão largo
    // quanto a banda conformal ADAPTATIVA publicada (meia-largura ACI × crescimento medido)
    pools.forEach((pool, k) => {
      if (!pool.length) return;
      const q90 = quantile(pool.map(Math.abs), 0.9);
      const s = q90 > 0 ? Math.min(3, Math.max(1, (aci.halfWidth * growth[k]) / q90)) : 1;
      if (s > 1) pools[k] = pool.map((v) => v * s);
    });
    const empirical = pools[0].length >= 24 * 8 && params.kappa > 0;
    if (!empirical && calibratedOn.startsWith("resíduos do backtest")) calibratedOn = "resíduos no espaço asinh (poucos dias de backtest)";
    const qf = (pool: number[], u: number) => {
      const x = u * (pool.length - 1);
      const i = Math.floor(x);
      return pool[i] + (pool[Math.min(pool.length - 1, i + 1)] - pool[i]) * (x - i);
    };
    // postos → marginal empírica, hora a hora (+ regra do PLD: piso/teto e teto estrutural)
    const mapPaths = (dev: number[][], steps: number) => {
      const out = dev.map(() => new Array<number>(steps));
      const idx = dev.map((_, m) => m);
      for (let t = 0; t < steps; t++) {
        idx.sort((a, b) => dev[a][t] - dev[b][t]);
        const pool = pools[Math.floor(t / 24)];
        idx.forEach((m, r) => (out[m][t] = clipPld(learFlat[t] + hourScale[t % 24] * qf(pool, (r + 0.5) / dev.length))));
      }
      return out.map((p) => capDailyMeans(p));
    };
    if (empirical) {
      // Calibração em dois níveis, em D+1, por busca em grade:
      //  - multiplicador do fator DIÁRIO → dispersão da média do dia = dayQ (conformal 90%);
      //  - multiplicador de κ (com σ ajustado para manter a variância intradiária) → variação
      //    total intradiária Σ|p_{h+1} − p_h| mediana = a dos dias reais recentes (sem isso as
      //    trajetórias oscilavam ~1,5× mais que o PLD real e inflavam o valor da bateria).
      const base = params.dayVar > 1e-9 ? params.dayVar : (params.sigma ** 2 / (2 * params.kappa)) || 1e-4;
      const target = dayQ[0];
      const tv = (a: number[]) => a.slice(1).reduce((acc, v, h) => acc + Math.abs(v - a[h]), 0);
      const tvReal = quantile(dm.rows.slice(-28).map(tv), 0.5);
      if (Number.isFinite(target) && target > 0) {
        const pt0 = mean(learFlat.slice(0, 24));
        let best = { m: params.dayVar / base, k: 1, err: Infinity };
        for (const k of [0.03125, 0.0625, 0.125, 0.25, 0.5, 1]) {
          for (const m of [0, 0.25, 0.5, 1, 2, 4, 8, 16, 32]) {
            const trial = { ...params, kappa: params.kappa * k, sigma: params.sigma * Math.sqrt(k), dayVar: base * m };
            const sim = mapPaths(simulateTwoFactor(trial, 24, 400, mulberry32(7)), 24);
            const q = quantile(sim.map((p) => Math.abs(mean(p) - pt0)), 0.9);
            const tvSim = quantile(sim.map(tv), 0.5);
            const err = Math.abs(q - target) / target + (tvReal > 0 ? Math.abs(tvSim - tvReal) / tvReal : 0);
            if (err < best.err) best = { m, k, err };
          }
        }
        params = { ...params, kappa: params.kappa * best.k, sigma: params.sigma * Math.sqrt(best.k), halfLife: params.halfLife / best.k, dayVar: base * best.m };
        mrjd = { ...mrjd, kappaPerHour: params.kappa, halfLifeHours: params.halfLife, sigma: params.sigma };
      }
      paths = mapPaths(simulateTwoFactor(params, H, nPaths, mulberry32(20260925)), H);
    } else {
      const center = learFlat.map((p) => asinhFwd(scaler, p));
      const devPaths = simulateTwoFactor(params, H, nPaths, mulberry32(20260925));
      let c = 1;
      const sim = devPaths.flatMap((d) => d.slice(0, 24));
      const wSim = quantile(sim, 0.95) - quantile(sim, 0.05);
      const wEmp = quantile(residAsinh, 0.95) - quantile(residAsinh, 0.05);
      if (wSim > 0 && wEmp > 0) c = Math.min(3, Math.max(0.3, wEmp / wSim));
      paths = devPaths.map((d) => capDailyMeans(d.map((x, t) => clipPld(asinhInv(scaler, center[t] + c * x * growth[Math.floor(t / 24)])))));
    }
    mrjd = { ...mrjd, dayLevelSd: Math.sqrt(params.dayVar), calibratedOn };
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
  // faixa 90% da MÉDIA DIÁRIA: conformal nos erros da média do dia por horizonte (com
  // correção de amostra finita); sem erros suficientes, quantis por trajetória do MC.
  // (A média dos quantis horários só vale sob comonotonicidade — auditoria set/2026.)
  const dailyMean = futureDates.map((date, k) => {
    const point = mean(learFlat.slice(k * 24, k * 24 + 24));
    const dMeans = paths.map((p) => mean(p.slice(k * 24, k * 24 + 24)));
    const q = dayQ[k];
    const cap = (v: number) => Math.min(PLD_LIMITS.maxStructural, Math.max(PLD_LIMITS.min, v));
    return {
      date,
      point,
      lear: mean(learOnly.slice(k * 24, k * 24 + 24)),
      p05: Number.isFinite(q) ? cap(point - q) : quantile(dMeans, 0.05),
      p95: Number.isFinite(q) ? cap(point + q) : quantile(dMeans, 0.95),
    };
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
      point: learFlat.map((v) => round(v)),
      lear: learOnly.map((v) => round(v)),
      aciLo,
      aciHi,
      mc,
      qraNextDay: { taus: QRA_TAUS, quantiles: qraNextDay },
      dailyMean,
    },
    backtest: {
      days: bt.actuals.length,
      maeModel: mae(act, fL),
      maeLear: mae(act, fLear),
      maeNaive: mae(act, fN),
      rmae: rmae(act, fL, fN),
      rmaeLear: rmae(act, fLear, fN),
      dmVsLear: { statistic: dmVsLear.statistic, pValue: dmVsLear.pValue },
      smape: smape(act, fL),
      rmse: rmse(act, fL),
      dm: { statistic: dmTest.statistic, pValue: dmTest.pValue },
      aci: {
        coverage: aci.empiricalCoverage,
        halfWidth: aci.halfWidth,
        alpha: aci.alphaFinal,
        kupiecP: kup.pValue,
        deff: kup.deff,
        christoffersenP: chr.pValue,
        pi01: chr.pi01,
        pi11: chr.pi11,
      },
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
    realizedDaily: dm.rows.slice(-30),
  };
}

export function publicForecast(f: ForecastInternal): ForecastResult {
  const { paths: _p, publishedAhead: _a, realizedDaily: _r, ...rest } = f;
  void _p;
  void _a;
  void _r;
  return rest;
}
