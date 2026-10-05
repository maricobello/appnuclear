import { beforeAll, describe, expect, it } from "vitest";
import { plants, getPlant } from "@/data/plants";
import { analyzeFinance, buildCashFlows, createRng, fioBChargedPct, irr, mulberry32, npv, paybackYears, percentile, projectCotas } from "@/lib/finance";
import { cdiPathPct, computeBenchmarks, longTermNominalPct } from "@/lib/finance/benchmarks";
import { simulateGeneration } from "@/lib/solar";
import type { FinancialResult, GenerationResult, MarketRates, Plant, SolarResource } from "@/lib/types";

/** Fixture de mercado fixa (não depende das APIs) */
const market: MarketRates = {
  selicPct: 15,
  cdiPct: 14.9,
  ipca12mPct: 5.2,
  ipcaLongTermPct: 4.0,
  realRatePct: 7.5,
  usdBrl: 5.45,
  usdtBrl: 5.47,
  provenance: [
    { id: "bcb-sgs-432", name: "BCB SGS 432 — Selic meta", url: "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json", fetchedAt: "2026-10-04T12:00:00Z", status: "fallback" },
    { id: "bcb-focus", name: "BCB Focus — IPCA longo prazo", url: "https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/", fetchedAt: "2026-10-04T12:00:00Z", status: "fallback" },
  ],
};

function resourceOf(plant: Plant): SolarResource {
  const c = plant.fallbackClimate;
  return { monthly: c, annualGhiKWhM2: 0, interannualCvPct: c.interannualCvPct, provenance: [{ id: "fb", name: "fallback", url: "", fetchedAt: "", status: "fallback" }] };
}

const gens = new Map<string, GenerationResult>();
const fins = new Map<string, FinancialResult>();
beforeAll(() => {
  for (const p of plants) {
    const g = simulateGeneration(p, resourceOf(p));
    gens.set(p.slug, g);
    fins.set(p.slug, analyzeFinance(p, g, market, { monteCarloRuns: 2000, seed: 42 }));
  }
});

describe("npv / irr", () => {
  it("casos de livro-texto", () => {
    expect(npv(10, [-100, 110])).toBeCloseTo(0, 12);
    expect(npv(0, [-100, 30, 40, 50])).toBeCloseTo(20, 12);
    expect(npv(10, [-1000, 500, 500, 500])).toBeCloseTo(243.426, 3);
    expect(irr([-100, 110])).toBeCloseTo(10, 9);
    // exemplos da documentação da função TIR/IRR do Excel
    expect(irr([-70000, 12000, 15000, 18000, 21000, 26000])).toBeCloseTo(8.66, 2);
    expect(irr([-70000, 12000, 15000, 18000, 21000])).toBeCloseTo(-2.12, 2);
    expect(irr([-70000, 12000, 15000])).toBeCloseTo(-44.35, 2);
    // exemplo clássico (Wikipedia, "Internal rate of return")
    expect(irr([-123400, 36200, 54800, 48100])).toBeCloseTo(5.96, 2);
  });

  it("VPL na TIR é zero", () => {
    const cf = [-13e6, 2.5e6, 2.4e6, 2.45e6, 2.5e6, 2.55e6, 2.6e6, 2.6e6, 2.6e6, 2.6e6, 2.6e6, 2.6e6, 1.7e6, 2.7e6];
    const r = irr(cf)!;
    expect(Math.abs(npv(r, cf))).toBeLessThan(1e-4);
  });

  it("sem troca de sinal → null", () => {
    expect(irr([100, 200, 300])).toBeNull();
    expect(irr([-100, -200])).toBeNull();
    expect(irr([0, 0, 0])).toBeNull();
  });

  it("múltiplas trocas de sinal: escolhe a raiz de perfil de investimento (VPL decrescente)", () => {
    // −100 + 230/(1+r) − 132/(1+r)² = 0 → r = 10 % ou 20 %; VPL decresce em 20 %
    expect(irr([-100, 230, -132])).toBeCloseTo(20, 8);
    // reposição de inversor deixa um ano negativo, mas a TIR continua única e correta
    const cf = [-1000, 300, 300, -100, 300, 300, 300];
    expect(Math.abs(npv(irr(cf)!, cf))).toBeLessThan(1e-6);
  });

  it("payback com interpolação linear", () => {
    expect(paybackYears([-100, 40, 40, 40])).toBeCloseTo(2.5, 12);
    expect(paybackYears([-100, 50, 60])).toBeCloseTo(1 + 50 / 60, 12);
    expect(paybackYears([-100, 10, 10])).toBeNull();
    // acumulado volta a ficar negativo: vale o último cruzamento
    expect(paybackYears([-100, 150, -100, 100])).toBeCloseTo(2.5, 12);
  });

  it("percentil tipo 7", () => {
    const xs = [1, 2, 3, 4, 5];
    expect(percentile(xs, 50)).toBe(3);
    expect(percentile(xs, 10)).toBeCloseTo(1.4, 12);
    expect(percentile(xs, 90)).toBeCloseTo(4.6, 12);
  });
});

describe("fioBChargedPct — Lei 14.300/2022", () => {
  it("direito adquirido (acesso até 2022): 0 % até 2045, 100 % depois", () => {
    expect(fioBChargedPct(2022, 2024)).toBe(0);
    expect(fioBChargedPct(2021, 2045)).toBe(0);
    expect(fioBChargedPct(2022, 2046)).toBe(100);
  });

  it("transição do art. 27 por ano-calendário", () => {
    expect([2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2040].map((y) => fioBChargedPct(2025, y))).toEqual([0, 15, 30, 45, 60, 75, 90, 100, 100]);
    // anos anteriores ao da solicitação seguem o calendário
    expect(fioBChargedPct(2027, 2024)).toBe(30);
    expect(fioBChargedPct(2023, 2023)).toBe(15);
  });
});

describe("PRNG determinístico", () => {
  it("mulberry32 reproduzível e normal com média 0 e desvio 1", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
    const rng = createRng(7);
    const xs = Array.from({ length: 20000 }, () => rng.normal());
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(sd - 1)).toBeLessThan(0.03);
  });
});

describe("analyzeFinance — caso-base das usinas de exemplo", () => {
  for (const p of plants) {
    it(`${p.slug}: TIR finita e plausível, real < nominal (Fisher)`, () => {
      const f = fins.get(p.slug)!;
      expect(Number.isFinite(f.irrNominalPct)).toBe(true);
      expect(f.irrNominalPct).toBeGreaterThan(8);
      expect(f.irrNominalPct).toBeLessThan(35);
      expect(f.irrRealPct).toBeLessThan(f.irrNominalPct);
      expect((1 + f.irrNominalPct / 100) / (1 + market.ipcaLongTermPct / 100) - 1).toBeCloseTo(f.irrRealPct / 100, 12);
      expect(f.discountRatePct).toBeCloseTo((1.075 * 1.04 - 1) * 100 + 3, 12);
      expect(npv(f.irrNominalPct, f.cashFlows.map((c) => c.netCashFlowBRL))).toBeCloseTo(0, 2);
    });

    it(`${p.slug}: fluxo de caixa consistente`, () => {
      const f = fins.get(p.slug)!;
      const cf = f.cashFlows;
      expect(f.investmentBRL).toBe(p.token.totalCotas * p.token.cotaPriceBRL);
      expect(f.capexBRL).toBeCloseTo(f.investmentBRL * (1 - p.token.structuringFeePct / 100), 6);
      expect(cf).toHaveLength(p.finance.horizonYears + 1);
      expect(cf[0]).toMatchObject({ year: 0, netCashFlowBRL: -f.investmentBRL, capexBRL: f.investmentBRL });
      expect(cf[1].calendarYear).toBe(p.finance.startYear);
      expect(cf[cf.length - 1].calendarYear).toBe(p.finance.startYear + p.finance.horizonYears - 1);
      let cum = 0;
      for (const c of cf) {
        cum += c.netCashFlowBRL;
        expect(c.cumulativeBRL).toBeCloseTo(cum, 4);
        expect(c.discountedCashFlowBRL).toBeCloseTo(c.netCashFlowBRL / (1 + f.discountRatePct / 100) ** c.year, 4);
        if (c.year === 0) continue;
        expect(c.netCashFlowBRL).toBeCloseTo(c.revenueBRL - c.taxesBRL - c.opexBRL - c.capexBRL, 4);
        expect(c.taxesBRL).toBeCloseTo((p.finance.taxPctRevenue / 100) * c.revenueBRL, 4);
        expect(c.priceBRLPerKWh * c.energyMWh * 1000).toBeCloseTo(c.revenueBRL, 3);
        expect(c.fioBChargedPct).toBe(fioBChargedPct(p.finance.accessRequestYear, c.calendarYear));
        expect(c.energyMWh).toBeCloseTo(gens.get(p.slug)!.yearly[c.year - 1].energyMWh, 9);
      }
      // ano 1: crédito = (tarifa − %FioB × FioB) × (1 − desconto) × (1 − perdas)
      const y1 = cf[1];
      const credit = (p.finance.tariffBRLPerKWh - (y1.fioBChargedPct / 100) * p.finance.fioBBRLPerKWh) * (1 - p.finance.clientDiscountPct / 100) * (1 - p.finance.revenueLossPct / 100);
      expect(y1.priceBRLPerKWh).toBeCloseTo(credit, 12);
      // reposição de inversores reajustada pelo IPCA
      const rep = cf[p.finance.inverterReplacementYear];
      expect(rep.capexBRL).toBeCloseTo(p.finance.inverterReplacementBRLPerKW * p.tech.acKW * 1.04 ** (p.finance.inverterReplacementYear - 1), 4);
      expect(f.npvBRL).toBeCloseTo(cf.reduce((s, c) => s + c.discountedCashFlowBRL, 0), 3);
    });

    it(`${p.slug}: indicadores derivados`, () => {
      const f = fins.get(p.slug)!;
      const dist = f.cashFlows.slice(1).reduce((s, c) => s + c.netCashFlowBRL, 0);
      expect(f.moic).toBeCloseTo(dist / f.investmentBRL, 12);
      expect(f.roiTotalPct).toBeCloseTo((f.moic - 1) * 100, 9);
      expect(f.firstYearYieldPct).toBeCloseTo((f.cashFlows[1].netCashFlowBRL / f.investmentBRL) * 100, 12);
      expect(f.paybackYears).not.toBeNull();
      expect(f.paybackYears!).toBeGreaterThan(2);
      expect(f.paybackYears!).toBeLessThan(12);
      expect(f.discountedPaybackYears!).toBeGreaterThan(f.paybackYears!);
      expect(f.lcoeBRLPerMWh).toBeGreaterThan(200);
      expect(f.lcoeBRLPerMWh).toBeLessThan(800);
      expect(f.perCota.priceBRL).toBe(p.token.cotaPriceBRL);
      expect(f.perCota.totalIncomeBRL * p.token.totalCotas).toBeCloseTo(dist, 3);
      expect(f.perCota.avgMonthlyIncomeBRL).toBeCloseTo(f.perCota.totalIncomeBRL / (p.finance.horizonYears * 12), 12);
    });

    it(`${p.slug}: Monte Carlo determinístico e ordenado`, () => {
      const f = fins.get(p.slug)!;
      const mc = f.monteCarlo;
      expect(mc.runs).toBe(2000);
      expect(mc.seed).toBe(42);
      expect(mc.irrP10Pct).toBeLessThanOrEqual(mc.irrP50Pct);
      expect(mc.irrP50Pct).toBeLessThanOrEqual(mc.irrP90Pct);
      expect(mc.npvP10BRL).toBeLessThanOrEqual(mc.npvP50BRL);
      expect(mc.npvP50BRL).toBeLessThanOrEqual(mc.npvP90BRL);
      expect(Math.abs(mc.irrP50Pct - f.irrNominalPct)).toBeLessThan(3);
      expect(mc.histogram).toHaveLength(20);
      expect(mc.histogram.reduce((s, h) => s + h.count, 0)).toBe(2000);
      for (let i = 1; i < mc.histogram.length; i++) expect(mc.histogram[i].fromPct).toBeCloseTo(mc.histogram[i - 1].toPct, 9);
      expect(mc.probIrrBelowCdiPct).toBeGreaterThanOrEqual(0);
      expect(mc.probIrrBelowCdiPct).toBeLessThanOrEqual(100);
      expect(mc.probNpvNegativePct).toBeGreaterThanOrEqual(0);
      expect(mc.variables.length).toBeGreaterThanOrEqual(7);
    });

    it(`${p.slug}: sensibilidade com sinais esperados`, () => {
      const f = fins.get(p.slug)!;
      const row = (v: string) => f.sensitivity.find((s) => s.variable.startsWith(v))!;
      expect(row("Tarifa").irrHighPct).toBeGreaterThan(row("Tarifa").irrLowPct);
      expect(row("Geração").npvHighBRL).toBeGreaterThan(row("Geração").npvLowBRL);
      expect(row("CAPEX").irrHighPct).toBeLessThan(row("CAPEX").irrLowPct);
      expect(row("OPEX").irrHighPct).toBeLessThan(row("OPEX").irrLowPct);
      expect(row("Desconto ao assinante").irrHighPct).toBeLessThan(row("Desconto ao assinante").irrLowPct);
      const dr = row("Taxa de desconto");
      expect(dr.irrLowPct).toBeCloseTo(f.irrNominalPct, 9);
      expect(dr.irrHighPct).toBeCloseTo(f.irrNominalPct, 9);
      expect(dr.npvLowBRL).toBeGreaterThan(dr.npvHighBRL);
      const fio = row("Fio B");
      expect(fio.irrLowPct).toBeCloseTo(f.irrNominalPct, 9);
      expect(fio.irrHighPct).toBeLessThanOrEqual(f.irrNominalPct);
      expect(f.sensitivity).toHaveLength(7);
    });
  }

  it("estresse do Fio B pesa muito mais na usina com direito adquirido (Petrolina)", () => {
    const fio = (slug: string) => {
      const f = fins.get(slug)!;
      const r = f.sensitivity.find((s) => s.variable.startsWith("Fio B"))!;
      return f.irrNominalPct - r.irrHighPct;
    };
    expect(fio("ufv-petrolina-1")).toBeGreaterThan(3);
    expect(fio("ufv-petrolina-1")).toBeGreaterThan(5 * fio("ufv-janauba-1"));
  });

  it("Monte Carlo: mesma semente → mesmo resultado; semente diferente → diferente", () => {
    const p = plants[0];
    const g = gens.get(p.slug)!;
    const a = analyzeFinance(p, g, market, { monteCarloRuns: 500, seed: 7 });
    const b = analyzeFinance(p, g, market, { monteCarloRuns: 500, seed: 7 });
    const c = analyzeFinance(p, g, market, { monteCarloRuns: 500, seed: 8 });
    expect(b).toEqual(a);
    expect(c.monteCarlo.irrP50Pct).not.toBe(a.monteCarlo.irrP50Pct);
    expect(c.irrNominalPct).toBe(a.irrNominalPct);
  });

  it("rápido: 2000 rodadas de Monte Carlo bem abaixo de 300 ms", () => {
    const p = plants[2];
    const g = gens.get(p.slug)!;
    analyzeFinance(p, g, market); // aquecimento do JIT
    const t0 = performance.now();
    analyzeFinance(p, g, market, { monteCarloRuns: 2000, seed: 42 });
    expect(performance.now() - t0).toBeLessThan(300);
  });

  it("premissas em pt-BR com unidades", () => {
    const f = fins.get("ufv-janauba-1")!;
    const get = (l: string) => f.assumptions.find((a) => a.label === l)?.value;
    expect(get("Tarifa B1 (com impostos)")).toBe("R$ 0,95/kWh");
    expect(get("Taxa de desconto nominal")).toMatch(/^14,80 % a\.a\./);
    expect(get("Captação (cotas × preço)")).toBe("130.000 cotas × R$ 100,00 = R$ 13.000.000");
    expect(get("Fio B a partir de 2029")).toMatch(/100 %/);
    expect(f.assumptions.length).toBeGreaterThan(25);
  });

  it("modelo PPA: receita = energia × preço reajustado pelo IPCA, sem Fio B", () => {
    const base = getPlant("ufv-janauba-1")!;
    const ppa: Plant = { ...base, finance: { ...base.finance, revenueModel: "ppa", ppaPriceBRLPerMWh: 320 } };
    const f = analyzeFinance(ppa, gens.get(base.slug)!, market, { monteCarloRuns: 200 });
    expect(f.cashFlows[1].revenueBRL).toBeCloseTo(f.cashFlows[1].energyMWh * 320, 6);
    expect(f.cashFlows[3].revenueBRL).toBeCloseTo(f.cashFlows[3].energyMWh * 320 * 1.04 ** 2, 6);
    expect(f.cashFlows.every((c) => c.fioBChargedPct === 0)).toBe(true);
    expect(f.sensitivity.find((s) => s.variable.startsWith("Fio B"))).toBeUndefined();
    expect(f.assumptions.find((a) => a.label === "Preço do PPA")?.value).toBe("R$ 320,00/MWh, reajustado pelo IPCA");
  });

  it("buildCashFlows: CAPEX +10 % aumenta a captação e reduz a TIR", () => {
    const p = plants[0];
    const g = gens.get(p.slug)!;
    const s = {
      energyMWh: g.yearly.map((y) => y.energyMWh),
      ipcaPct: 4,
      tariffRealGrowthPct: p.finance.tariffRealGrowthPct,
      tariffMult: 1,
      clientDiscountPct: p.finance.clientDiscountPct,
      revenueLossPct: p.finance.revenueLossPct,
      opexMult: 1,
      omMult: 1,
      capexMult: 1,
      discountRatePct: 14.8,
    };
    const a = buildCashFlows(p, s);
    const b = buildCashFlows(p, { ...s, capexMult: 1.1 });
    expect(b.investmentBRL).toBeCloseTo(a.investmentBRL * 1.1, 6);
    expect(irr(b.flows)!).toBeLessThan(irr(a.flows)!);
  });
});

describe("benchmarks", () => {
  it("CDI converge para juro real + IPCA; poupança 0,5 % a.m. com Selic > 8,5 %; Tesouro IPCA+", () => {
    const path = cdiPathPct(market, 25);
    expect(path[0]).toBeLessThan(market.cdiPct);
    expect(path[0]).toBeGreaterThan(longTermNominalPct(market));
    expect(path[24]).toBeCloseTo(longTermNominalPct(market), 2);
    const f = fins.get("ufv-janauba-1")!;
    const by = (n: string) => f.benchmarks.find((b) => b.name.startsWith(n))!;
    expect(by("Poupança").annualPct).toBeCloseTo((1.005 ** 12 - 1) * 100, 9);
    expect(by("Tesouro IPCA+").annualPct).toBeCloseTo((1.075 * 1.04 - 1) * 100, 9);
    expect(by("Tesouro IPCA+").finalValueOf1000BRL).toBeCloseTo(1000 + (1000 * 1.118 ** 25 - 1000) * 0.85, 3);
    expect(by("UFV (distribuições acumuladas)").finalValueOf1000BRL).toBeCloseTo(1000 * f.moic, 6);
    expect(by("UFV (distribuições acumuladas)").annualPct).toBe(f.irrNominalPct);
    expect(by("UFV (distribuições reinvestidas").finalValueOf1000BRL).toBeGreaterThan(by("UFV (distribuições acumuladas)").finalValueOf1000BRL);
    for (const b of f.benchmarks) expect(b.note.length).toBeGreaterThan(20);
  });

  it("poupança passa a 70 % da Selic quando a Selic fica abaixo de 8,5 %", () => {
    const low: MarketRates = { ...market, selicPct: 7, cdiPct: 6.9, realRatePct: 3, ipcaLongTermPct: 3 };
    const b = computeBenchmarks(low, 10, [-1000, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200], 15.1);
    const poup = b.find((x) => x.name === "Poupança")!;
    expect(poup.annualPct).toBeLessThan(5);
    expect(poup.annualPct).toBeGreaterThan(0.7 * 6);
  });
});

describe("projectCotas", () => {
  it("todas as cotas reproduzem os totais da usina", () => {
    const p = plants[0];
    const f = fins.get(p.slug)!;
    const pc = projectCotas(f, p.token.totalCotas);
    const dist = f.cashFlows.slice(1).reduce((s, c) => s + c.netCashFlowBRL, 0);
    expect(pc.investedBRL).toBeCloseTo(f.investmentBRL, 6);
    expect(pc.firstYearIncomeBRL).toBeCloseTo(f.cashFlows[1].netCashFlowBRL, 4);
    expect(pc.totalIncomeBRL).toBeCloseTo(dist, 3);
    expect(pc.avgMonthlyIncomeBRL).toBeCloseTo(dist / (p.finance.horizonYears * 12), 4);
    expect(pc.paybackYears!).toBeCloseTo(f.paybackYears!, 9);
    expect(pc.byYear).toHaveLength(p.finance.horizonYears);
    expect(pc.byYear[0]).toMatchObject({ year: 1, calendarYear: p.finance.startYear });
    expect(pc.byYear[pc.byYear.length - 1].cumulativeBRL).toBeCloseTo(pc.totalIncomeBRL, 6);
  });

  it("proporcional ao número de cotas", () => {
    const p = plants[1];
    const f = fins.get(p.slug)!;
    const one = projectCotas(f, 1);
    const hundred = projectCotas(f, 100);
    expect(hundred.investedBRL).toBe(100 * p.token.cotaPriceBRL);
    expect(hundred.totalIncomeBRL).toBeCloseTo(100 * one.totalIncomeBRL, 6);
    expect(one.totalIncomeBRL).toBeCloseTo(f.perCota.totalIncomeBRL, 9);
    expect(hundred.paybackYears!).toBeCloseTo(f.paybackYears!, 9);
    expect(projectCotas(f, 0).paybackYears).toBeNull();
  });
});
