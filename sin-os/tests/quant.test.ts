import { describe, expect, it } from "vitest";
import { chi2Cdf, mulberry32, normCdf, normInv, quantile, randn, tCdf } from "../src/lib/quant/stats";
import { lassoIC } from "../src/lib/quant/lasso";
import { lassoLarsIC } from "../src/lib/quant/lars";
import { learBacktest } from "../src/lib/quant/lear";
import { mae } from "../src/lib/quant/metrics";
import { adaptiveConformal } from "../src/lib/quant/conformal";
import { quantileRegression } from "../src/lib/quant/qra";
import { fitHmm } from "../src/lib/quant/hmm";
import { fitGarch } from "../src/lib/quant/garch";
import { calibrateMRJD, simulateMRJD } from "../src/lib/quant/ou";
import { adf, engleGranger, halfLife, mackinnonCrit, mackinnonP } from "../src/lib/quant/cointegration";
import { optimizeStorageDP, valueStorageLSMC } from "../src/lib/quant/storage";
import { dieboldMariano, kupiec } from "../src/lib/quant/metrics";
import { riskMetrics } from "../src/lib/quant/risk";

describe("distribuições", () => {
  it("normal, t e qui-quadrado batem com tabelas", () => {
    expect(normCdf(1.959964)).toBeCloseTo(0.975, 5);
    expect(normInv(0.975)).toBeCloseTo(1.959964, 5);
    expect(normInv(0.01)).toBeCloseTo(-2.326348, 5);
    expect(tCdf(2.085963, 20)).toBeCloseTo(0.975, 5);
    expect(tCdf(-1.812461, 10)).toBeCloseTo(0.05, 5);
    expect(chi2Cdf(3.841459, 1)).toBeCloseTo(0.95, 5);
    expect(chi2Cdf(11.0705, 5)).toBeCloseTo(0.95, 4);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
});

describe("LASSO (descida coordenada + AIC)", () => {
  it("recupera suporte esparso", () => {
    const rng = mulberry32(1);
    const n = 200, p = 30;
    const X = Array.from({ length: n }, () => Array.from({ length: p }, () => randn(rng)));
    const y = X.map((r) => 3 * r[0] - 2 * r[5] + 1.5 * r[12] + 0.3 * randn(rng) + 10);
    const fit = lassoIC(X, y);
    expect(fit.coef[0]).toBeGreaterThan(2.7);
    expect(fit.coef[5]).toBeLessThan(-1.7);
    expect(fit.coef[12]).toBeGreaterThan(1.2);
    expect(fit.intercept).toBeCloseTo(10, 0);
    const noise = fit.coef.filter((c, j) => ![0, 5, 12].includes(j) && Math.abs(c) > 0.1);
    expect(noise.length).toBeLessThanOrEqual(2);
  });
});

describe("LARS-LASSO (Efron et al., 2004)", () => {
  it("recupera suporte esparso e concorda com a descida coordenada", () => {
    const rng = mulberry32(2);
    const n = 150, p = 40;
    const X = Array.from({ length: n }, () => Array.from({ length: p }, () => randn(rng)));
    // colunas correlacionadas (como defasagens de preço horárias)
    for (const r of X) { r[1] = 0.9 * r[0] + 0.1 * r[1]; r[2] = 0.8 * r[1] + 0.2 * r[2]; }
    const y = X.map((r) => 2.5 * r[0] - 1.5 * r[7] + 1 * r[20] + 0.4 * randn(rng) - 3);
    const lars = lassoLarsIC(X, y, "aicc");
    const cd = lassoIC(X, y, { criterion: "aicc", nLambda: 60, tol: 1e-7, maxSweeps: 2000 });
    expect(Math.abs(lars.coef[7] + 1.5)).toBeLessThan(0.25);
    expect(Math.abs(lars.coef[20] - 1)).toBeLessThan(0.25);
    expect(lars.coef[0] + lars.coef[1] + lars.coef[2]).toBeGreaterThan(2);
    const predL = X.map((r) => lars.intercept + r.reduce((s, v, j) => s + v * lars.coef[j], 0));
    const predC = X.map((r) => cd.intercept + r.reduce((s, v, j) => s + v * cd.coef[j], 0));
    expect(mae(predL, predC)).toBeLessThan(0.15);
    expect(lars.criterion).toBeLessThanOrEqual(cd.criterion + 1);
  });
});

describe("LEAR (epftoolbox)", () => {
  it("supera o ingênuo semanal em série horária sintética com dinâmica AR + sazonalidade", () => {
    // nível diário AR(1) (φ=0.5) + perfil intradiário + efeito fim de semana + ruído horário.
    // O ingênuo carrega o ruído de d−1 (variância 2σ²) e ignora a reversão à média;
    // o LEAR deve reduzir o erro de forma consistente.
    const rng = mulberry32(7);
    const D = 110;
    const days: number[][] = [];
    const dows: number[] = [];
    let level = 200;
    for (let d = 0; d < D; d++) {
      level = 200 + 0.5 * (level - 200) + 8 * randn(rng);
      const dow = d % 7;
      const weekend = dow === 0 || dow === 6 ? -30 : 0;
      days.push(Array.from({ length: 24 }, (_, h) => level + weekend + 40 * Math.sin(((h - 6) / 24) * 2 * Math.PI) + 12 * randn(rng)));
      dows.push(dow);
    }
    const bt = learBacktest(days, dows, 20, { calibrationDays: 90 });
    const errL = mae(bt.actuals.flat(), bt.forecasts.flat());
    const errN = mae(bt.actuals.flat(), bt.naive.flat());
    expect(errL).toBeLessThan(0.9 * errN);
    const dm = dieboldMariano(
      bt.actuals.map((a, d) => mae(a, bt.forecasts[d])),
      bt.actuals.map((a, d) => mae(a, bt.naive[d])),
    );
    expect(dm.pValue).toBeLessThan(0.05);
  });
});

describe("Conformal adaptativo (Gibbs & Candès)", () => {
  it("atinge cobertura nominal ~90%", () => {
    const rng = mulberry32(3);
    const r = Array.from({ length: 2000 }, () => randn(rng) * 10);
    const res = adaptiveConformal(r, 0.1, 0.005, 300);
    expect(res.empiricalCoverage).toBeGreaterThan(0.87);
    expect(res.empiricalCoverage).toBeLessThan(0.93);
    expect(res.halfWidth).toBeGreaterThan(14);
    expect(res.halfWidth).toBeLessThan(19);
  });
});

describe("Regressão quantílica (MM Hunter–Lange)", () => {
  it("mediana recupera inclinação e quantil 90% desloca o intercepto", () => {
    const rng = mulberry32(5);
    const x = Array.from({ length: 600 }, () => rng() * 10);
    const y = x.map((v) => 2 * v + (rng() - 0.5) * 4); // ruído U(−2,2)
    const X = x.map((v) => [1, v]);
    const b50 = quantileRegression(X, y, 0.5);
    const b90 = quantileRegression(X, y, 0.9);
    expect(b50[1]).toBeCloseTo(2, 1);
    expect(b50[0]).toBeCloseTo(0, 0);
    expect(b90[0]).toBeGreaterThan(1.2);
    expect(b90[0]).toBeLessThan(2.0);
  });
});

describe("HMM gaussiano (Baum–Welch)", () => {
  it("recupera médias de dois regimes persistentes", () => {
    const rng = mulberry32(11);
    const y: number[] = [];
    let s = 0;
    for (let t = 0; t < 1500; t++) {
      if (rng() < (s === 0 ? 0.02 : 0.1)) s = 1 - s;
      y.push(s === 0 ? 0 + randn(rng) : 6 + 1.5 * randn(rng));
    }
    const res = fitHmm(y, 2);
    expect(res.means[0]).toBeCloseTo(0, 0);
    expect(res.means[1]).toBeGreaterThan(5.3);
    expect(res.means[1]).toBeLessThan(6.7);
    expect(res.transition[0][0]).toBeGreaterThan(0.95);
  });
});

describe("GARCH(1,1) MLE", () => {
  it("estima persistência de série simulada", () => {
    const rng = mulberry32(13);
    const omega = 0.05, alpha = 0.1, beta = 0.85;
    let s2 = omega / (1 - alpha - beta);
    const r: number[] = [];
    let e = 0;
    for (let t = 0; t < 4000; t++) {
      s2 = omega + alpha * e * e + beta * s2;
      e = Math.sqrt(s2) * randn(rng);
      r.push(e);
    }
    const g = fitGarch(r);
    expect(g.persistence).toBeGreaterThan(0.9);
    expect(g.persistence).toBeLessThan(0.99);
    expect(g.alpha).toBeGreaterThan(0.05);
    expect(g.alpha).toBeLessThan(0.16);
  });
});

describe("MRJD (Cartea–Figueroa)", () => {
  it("recupera κ, μ e intensidade de saltos", () => {
    const rng = mulberry32(17);
    const params = { kappa: 0.2, mu: 5, sigma: 1, lambda: 0.02, jumpMean: 6, jumpSd: 1, halfLife: 0, nJumps: 0 };
    const [path] = simulateMRJD(params, 5, 6000, 1, rng);
    const cal = calibrateMRJD(path);
    expect(cal.kappa).toBeGreaterThan(0.15);
    expect(cal.kappa).toBeLessThan(0.26);
    expect(cal.mu).toBeCloseTo(5, 0);
    expect(cal.lambda).toBeGreaterThan(0.01);
    expect(cal.lambda).toBeLessThan(0.03);
  });
});

describe("ADF / Engle–Granger (MacKinnon)", () => {
  it("p-valores coerentes com a superfície de resposta", () => {
    expect(mackinnonP(-2.86154)).toBeCloseTo(0.05, 2);
    expect(mackinnonP(-3.43035)).toBeCloseTo(0.01, 2);
    // continuidade entre ramos small/large em τ*
    expect(Math.abs(mackinnonP(-1.6101) - mackinnonP(-1.6099))).toBeLessThan(0.01);
    expect(Math.abs(mackinnonP(-2.6201, 2) - mackinnonP(-2.6199, 2))).toBeLessThan(0.01);
    expect(mackinnonCrit(1e9)["5%"]).toBeCloseTo(-2.86154, 4);
  });

  it("distingue passeio aleatório de AR(1) estacionário", () => {
    const rng = mulberry32(19);
    const rw: number[] = [0];
    const ar: number[] = [0];
    for (let t = 1; t < 800; t++) {
      rw.push(rw[t - 1] + randn(rng));
      ar.push(0.5 * ar[t - 1] + randn(rng));
    }
    expect(adf(rw).pValue).toBeGreaterThan(0.05);
    expect(adf(ar).pValue).toBeLessThan(0.01);
    expect(halfLife(ar)).toBeCloseTo(1, 0);
  });

  it("detecta cointegração", () => {
    const rng = mulberry32(23);
    const x: number[] = [0];
    for (let t = 1; t < 800; t++) x.push(x[t - 1] + randn(rng));
    const y = x.map((v) => 3 + 2 * v + randn(rng));
    const eg = engleGranger(y, x);
    expect(eg.hedgeRatio).toBeCloseTo(2, 1);
    expect(eg.cointegrated5).toBe(true);
    const z: number[] = [0];
    for (let t = 1; t < 800; t++) z.push(z[t - 1] + randn(rng));
    expect(engleGranger(z, x).cointegrated5).toBe(false);
  });
});

describe("Armazenamento: DP e LSMC", () => {
  it("DP resolve caso trivial e bate com força bruta", () => {
    const spec = { capacityMWh: 1, powerMW: 1, etaCharge: 1, etaDischarge: 1, socInit: 0, socEnd: 0, levels: 1 };
    expect(optimizeStorageDP([10, 100], spec).value).toBeCloseTo(90, 6);

    const prices = [50, 20, 80, 30, 120, 60];
    const s2 = { capacityMWh: 2, powerMW: 1, etaCharge: 0.9, etaDischarge: 0.9, socInit: 0, socEnd: 0, levels: 2 };
    // força bruta sobre sequências de níveis 0..2 com |Δ| ≤ 1
    let best = -Infinity;
    const rec = (t: number, lvl: number, acc: number) => {
      if (t === prices.length) { if (lvl === 0) best = Math.max(best, acc); return; }
      for (const nl of [lvl - 1, lvl, lvl + 1]) {
        if (nl < 0 || nl > 2) continue;
        const d = nl - lvl;
        const c = d > 0 ? -(d / 0.9) * prices[t] : d < 0 ? -d * 0.9 * prices[t] : 0;
        rec(t + 1, nl, acc + c);
      }
    };
    rec(0, 0, 0);
    expect(optimizeStorageDP(prices, s2).value).toBeCloseTo(best, 6);
  });

  it("intrínseco ≤ LSMC ≤ informação perfeita", () => {
    const rng = mulberry32(29);
    const T = 48;
    const mk = () =>
      Array.from({ length: T }, (_, t) => 100 + 40 * Math.sin((2 * Math.PI * t) / 24) + 25 * randn(rng));
    const train = Array.from({ length: 400 }, mk);
    const evalP = Array.from({ length: 400 }, mk);
    const spec = { capacityMWh: 4, powerMW: 1, etaCharge: 0.95, etaDischarge: 0.95, socInit: 0.5, levels: 8 };
    const r = valueStorageLSMC(train, evalP, spec);
    expect(r.value).toBeGreaterThan(r.intrinsic - 3 * r.stdErr);
    expect(r.value).toBeLessThanOrEqual(r.perfectForesight + 3 * r.stdErr);
    expect(r.perfectForesight).toBeGreaterThan(r.intrinsic);
  });
});

describe("Testes de previsão e risco", () => {
  it("Diebold–Mariano detecta modelo superior", () => {
    const rng = mulberry32(31);
    const a = Array.from({ length: 300 }, () => Math.abs(randn(rng)));
    const b = Array.from({ length: 300 }, () => Math.abs(2 * randn(rng)));
    expect(dieboldMariano(a, b).pValue).toBeLessThan(0.01);
  });

  it("Kupiec aceita cobertura correta e rejeita incorreta", () => {
    expect(kupiec(10, 100, 0.1).pValue).toBeGreaterThan(0.5);
    expect(kupiec(30, 100, 0.1).pValue).toBeLessThan(0.001);
  });

  it("CVaR ≥ VaR", () => {
    const rng = mulberry32(37);
    const pnl = Array.from({ length: 100000 }, () => 10 + 20 * randn(rng));
    const m = riskMetrics(pnl);
    expect(m.cvar95).toBeGreaterThan(m.var95);
    expect(m.var95).toBeCloseTo(-10 + 1.645 * 20, 0);
  });
});
