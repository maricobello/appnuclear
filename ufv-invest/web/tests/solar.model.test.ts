import { describe, expect, it } from "vitest";
import { plants, getPlant } from "@/data/plants";
import { instantPower, simulateGeneration, SIN_EMISSION_FACTOR_TCO2_PER_MWH } from "@/lib/solar";
import type { GenerationResult, Plant, PvgisCrossCheck, SolarResource } from "@/lib/types";

const fallbackProv = { id: "fallback", name: "Climatologia embarcada", url: "INPE 2017", fetchedAt: "2026-10-04T00:00:00Z", status: "fallback" as const };
const liveProv = { id: "nasa-power", name: "NASA POWER", url: "https://power.larc.nasa.gov", fetchedAt: "2026-10-04T00:00:00Z", status: "live" as const };

function resourceOf(plant: Plant, live = false): SolarResource {
  const c = plant.fallbackClimate;
  const annual = c.ghiKWhM2Day.reduce((s, v, m) => s + v * [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m], 0);
  return { monthly: c, annualGhiKWhM2: annual, interannualCvPct: c.interannualCvPct, provenance: [live ? liveProv : fallbackProv] };
}

const withTech = (p: Plant, patch: Partial<Plant["tech"]>, loc?: Partial<Plant["location"]>): Plant => ({
  ...p,
  tech: { ...p.tech, ...patch },
  location: { ...p.location, ...loc },
});

const results = new Map<string, GenerationResult>(plants.map((p) => [p.slug, simulateGeneration(p, resourceOf(p))]));

describe("simulateGeneration — usinas de exemplo (climatologia de referência)", () => {
  for (const p of plants) {
    const g = results.get(p.slug)!;
    const tracker = p.tech.mounting === "single-axis";

    it(`${p.slug}: produtividade, PR e fator de capacidade plausíveis para o Brasil`, () => {
      if (tracker) {
        expect(g.specificYieldKWhPerKWp).toBeGreaterThan(1750);
        expect(g.specificYieldKWhPerKWp).toBeLessThan(2300);
        expect(g.capacityFactorPct).toBeGreaterThan(27);
        expect(g.capacityFactorPct).toBeLessThan(38);
      } else {
        expect(g.specificYieldKWhPerKWp).toBeGreaterThan(1450);
        expect(g.specificYieldKWhPerKWp).toBeLessThan(1850);
        expect(g.capacityFactorPct).toBeGreaterThan(18);
        expect(g.capacityFactorPct).toBeLessThan(31);
      }
      expect(g.performanceRatioPct).toBeGreaterThan(72);
      expect(g.performanceRatioPct).toBeLessThan(86);
      // fator de capacidade CA = E / (P_CA · 8760 h)
      expect(g.capacityFactorPct).toBeCloseTo((g.annualP50MWh / ((p.tech.acKW / 1000) * 8760)) * 100, 9);
      expect(g.specificYieldKWhPerKWp).toBeCloseTo((g.annualP50MWh * 1000) / p.tech.dcKWp, 9);
    });

    it(`${p.slug}: meses somam o anual e PR = E / (POA × kWp)`, () => {
      expect(g.monthly).toHaveLength(12);
      expect(g.monthly.map((m) => m.month)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect(g.monthly.reduce((s, m) => s + m.energyMWh, 0)).toBeCloseTo(g.annualP50MWh, 6);
      expect(g.monthly.reduce((s, m) => s + m.poaKWhM2, 0)).toBeCloseTo(g.annualPoaKWhM2, 6);
      expect(g.performanceRatioPct).toBeCloseTo((g.annualP50MWh / ((g.annualPoaKWhM2 * p.tech.dcKWp) / 1000)) * 100, 9);
      for (const m of g.monthly) {
        expect(m.prPct).toBeGreaterThan(70);
        expect(m.prPct).toBeLessThan(90);
        expect(m.cellTempC).toBeGreaterThan(p.fallbackClimate.tempC[m.month]);
        expect(m.cellTempC).toBeLessThan(70);
      }
    });

    it(`${p.slug}: cascata de perdas encadeada termina no P50`, () => {
      const w = g.lossWaterfall;
      expect(w[0].label).toBe("Irradiação no plano (POA) × kWp");
      expect(w[0].energyMWhAfter).toBeCloseTo((g.annualPoaKWhM2 * p.tech.dcKWp) / 1000, 6);
      expect(w[w.length - 1].label).toBe("Energia injetada (AC)");
      expect(w[w.length - 1].energyMWhAfter).toBeCloseTo(g.annualP50MWh, 9);
      for (let i = 1; i < w.length; i++) expect(w[i].energyMWhAfter).toBeCloseTo(w[i - 1].energyMWhAfter * (1 - w[i].pct / 100), 6);
      const labels = w.map((x) => x.label);
      for (const l of ["Ângulo de incidência (IAM)", "Temperatura dos módulos", "Sujidade", "Sombreamento", "Descasamento (mismatch)", "Cabeamento CC", "Eficiência do inversor", "Limitação CA do inversor (clipping)", "Cabeamento CA", "Transformador", "Indisponibilidade", "Degradação inicial (LID/LeTID, ano 1)"]) {
        expect(labels).toContain(l);
      }
      const bif = w.find((x) => x.label === "Ganho bifacial");
      if (p.tech.module.bifacial) {
        expect(bif!.pct).toBeLessThan(0); // ganho
        expect(bif!.pct).toBeGreaterThan(-8); // conservador
      } else {
        expect(bif).toBeUndefined();
      }
      // perdas declaradas aparecem exatamente
      expect(w.find((x) => x.label === "Sujidade")!.pct).toBeCloseTo(p.tech.losses.soilingPct, 9);
      expect(w.find((x) => x.label === "Degradação inicial (LID/LeTID, ano 1)")!.pct).toBeCloseTo(p.tech.degradation.firstYearPct, 9);
      expect(w.find((x) => x.label === "Eficiência do inversor")!.pct).toBeCloseTo(100 - p.tech.inverter.euroEfficiencyPct, 9);
      const clip = w.find((x) => x.label === "Limitação CA do inversor (clipping)")!.pct;
      expect(clip).toBeGreaterThanOrEqual(0);
      expect(clip).toBeLessThan(6);
    });

    it(`${p.slug}: P99 < P90 < P75 < P50, P90 de 10 anos entre P90 e P50`, () => {
      expect(g.p99MWh).toBeLessThan(g.p90MWh);
      expect(g.p90MWh).toBeLessThan(g.p75MWh);
      expect(g.p75MWh).toBeLessThan(g.annualP50MWh);
      expect(g.p90TenYearMWh).toBeGreaterThan(g.p90MWh);
      expect(g.p90TenYearMWh).toBeLessThan(g.annualP50MWh);
      const u = g.uncertainty;
      expect(u.totalPct).toBeCloseTo(Math.hypot(u.interannualPct, u.resourceDataPct, u.modelPct, u.degradationPct), 12);
      expect(g.p90MWh).toBeCloseTo(g.annualP50MWh * (1 - (1.2816 * u.totalPct) / 100), 6);
    });

    it(`${p.slug}: degradação anual linear, CO₂ e método documentado`, () => {
      expect(g.yearly).toHaveLength(p.finance.horizonYears);
      expect(g.yearly[0]).toEqual({ year: 1, energyMWh: g.annualP50MWh });
      expect(g.yearly[10].energyMWh).toBeCloseTo(g.annualP50MWh * (1 - (10 * p.tech.degradation.annualPct) / 100), 9);
      expect(g.co2AvoidedTonsYear).toBeCloseTo(g.annualP50MWh * SIN_EMISSION_FACTOR_TCO2_PER_MWH, 9);
      expect(g.method.length).toBeGreaterThan(8);
      expect(g.method.join(" ")).toMatch(/HDKR/);
      expect(g.method.join(" ")).toMatch(/Faiman/);
    });
  }

  it("incerteza dos dados: 7 % com climatologia embarcada, 5 % com fonte consultada", () => {
    const p = plants[0];
    expect(results.get(p.slug)!.uncertainty.resourceDataPct).toBe(7);
    const live = simulateGeneration(p, resourceOf(p, true));
    expect(live.uncertainty.resourceDataPct).toBe(5);
    expect(live.uncertainty.modelPct).toBe(3);
    expect(live.uncertainty.degradationPct).toBe(1);
    expect(live.uncertainty.interannualPct).toBe(p.fallbackClimate.interannualCvPct);
    expect(live.annualP50MWh).toBeCloseTo(results.get(p.slug)!.annualP50MWh, 9);
  });

  it("validação cruzada com o PVGIS", () => {
    const p = plants[0];
    const pvgis: PvgisCrossCheck = { annualKWhPerKWp: 1750, monthlyKWhPerKWp: new Array(12).fill(1750 / 12), provenance: { ...liveProv, id: "pvgis", name: "PVGIS 5.3 (JRC)" } };
    const g = simulateGeneration(p, resourceOf(p), pvgis);
    expect(g.crossCheck!.source).toBe("PVGIS 5.3 (JRC)");
    expect(g.crossCheck!.annualMWh).toBeCloseTo((1750 * p.tech.dcKWp) / 1000, 9);
    expect(g.crossCheck!.deviationPct).toBeCloseTo(((g.annualP50MWh - g.crossCheck!.annualMWh) / g.crossCheck!.annualMWh) * 100, 9);
    expect(simulateGeneration(p, resourceOf(p), null).crossCheck).toBeUndefined();
  });

  it("DHI informada é usada no lugar da correlação de Erbs", () => {
    const p = plants[0];
    const base = resourceOf(p, true);
    const lowDiffuse = { ...base, monthly: { ...base.monthly, dhiKWhM2Day: base.monthly.ghiKWhM2Day.map((g) => 0.25 * g) } };
    const highDiffuse = { ...base, monthly: { ...base.monthly, dhiKWhM2Day: base.monthly.ghiKWhM2Day.map((g) => 0.45 * g) } };
    const a = simulateGeneration(p, lowDiffuse);
    const b = simulateGeneration(p, highDiffuse);
    expect(a.method.join(" ")).toMatch(/DHI/);
    // mais difusa → menos ganho de transposição para o plano inclinado ao Norte
    expect(a.annualPoaKWhM2).toBeGreaterThan(b.annualPoaKWhM2);
  });

  it("determinístico e rápido", () => {
    const p = plants[2];
    const t0 = performance.now();
    const a = simulateGeneration(p, resourceOf(p));
    expect(performance.now() - t0).toBeLessThan(150);
    expect(simulateGeneration(p, resourceOf(p))).toEqual(a);
  });
});

describe("orientação no hemisfério Sul e ganho do seguidor", () => {
  const base = getPlant("ufv-janauba-1")!;
  const lat15 = { lat: -15 };

  it("plano inclinado voltado ao Norte ganha POA anual; voltado ao Sul perde", () => {
    const north = simulateGeneration(withTech(base, { tiltDeg: 20, azimuthDeg: 0 }, lat15), resourceOf(base));
    const south = simulateGeneration(withTech(base, { tiltDeg: 20, azimuthDeg: 180 }, lat15), resourceOf(base));
    const flat = simulateGeneration(withTech(base, { tiltDeg: 0, azimuthDeg: 0 }, lat15), resourceOf(base));
    expect(north.annualPoaKWhM2).toBeGreaterThan(north.annualGhiKWhM2);
    expect(south.annualPoaKWhM2).toBeLessThan(south.annualGhiKWhM2);
    expect(flat.annualPoaKWhM2).toBeCloseTo(flat.annualGhiKWhM2, 0);
    expect(north.annualP50MWh).toBeGreaterThan(flat.annualP50MWh);
    expect(flat.annualP50MWh).toBeGreaterThan(south.annualP50MWh);
    // inverno austral (jun): o plano ao Norte capta muito mais que o ao Sul
    expect(north.monthly[5].poaKWhM2).toBeGreaterThan(1.3 * south.monthly[5].poaKWhM2);
  });

  it("Leste e Oeste são simétricos (mesma POA anual ±1 %)", () => {
    const east = simulateGeneration(withTech(base, { tiltDeg: 20, azimuthDeg: 90 }), resourceOf(base));
    const west = simulateGeneration(withTech(base, { tiltDeg: 20, azimuthDeg: 270 }), resourceOf(base));
    expect(Math.abs(east.annualPoaKWhM2 / west.annualPoaKWhM2 - 1)).toBeLessThan(0.01);
  });

  it("seguidor de um eixo: POA 15–30 % acima da estrutura fixa ótima no Nordeste", () => {
    const bjl = getPlant("ufv-bom-jesus-da-lapa-1")!;
    const tracker = results.get(bjl.slug)!;
    const fixed = simulateGeneration(withTech(bjl, { mounting: "fixed", tiltDeg: 13, azimuthDeg: 0 }), resourceOf(bjl));
    const gain = tracker.annualPoaKWhM2 / fixed.annualPoaKWhM2 - 1;
    expect(gain).toBeGreaterThan(0.15);
    expect(gain).toBeLessThan(0.3);
    expect(tracker.annualP50MWh).toBeGreaterThan(fixed.annualP50MWh * 1.12);
  });
});

describe("instantPower", () => {
  const jan = getPlant("ufv-janauba-1")!;
  const bjl = getPlant("ufv-bom-jesus-da-lapa-1")!;
  // meio-dia solar em Janaúba (lon −43,3°) ≈ 14:53 UTC em outubro
  const noon = new Date("2027-10-15T14:50:00Z");

  it("noite ou GHI nula → 0 kW", () => {
    expect(instantPower(jan, { time: new Date("2027-10-15T04:00:00Z"), ghiWm2: 0, tempC: 20 })).toEqual({ poaWm2: 0, cellTempC: 20, acKW: 0 });
    expect(instantPower(jan, { time: new Date("2027-10-15T04:00:00Z"), ghiWm2: 300, tempC: 20 }).acKW).toBe(0);
  });

  it("céu claro ao meio-dia: potência limitada pela potência CA nominal menos perdas CA", () => {
    const r = instantPower(jan, { time: noon, ghiWm2: 1050, tempC: 30, windMs: 2 });
    const cap = jan.tech.acKW * (1 - jan.tech.losses.acWiringPct / 100) * (1 - jan.tech.losses.transformerPct / 100) * (1 - jan.tech.losses.unavailabilityPct / 100);
    expect(r.poaWm2).toBeGreaterThan(900);
    expect(r.cellTempC).toBeGreaterThan(50);
    expect(r.acKW).toBeLessThanOrEqual(cap + 1e-9);
    expect(r.acKW).toBeGreaterThan(0.95 * cap);
  });

  it("monótona na irradiância e decrescente na temperatura", () => {
    const a = instantPower(jan, { time: noon, ghiWm2: 300, tempC: 25 });
    const b = instantPower(jan, { time: noon, ghiWm2: 600, tempC: 25 });
    const c = instantPower(jan, { time: noon, ghiWm2: 600, tempC: 40 });
    expect(b.acKW).toBeGreaterThan(a.acKW);
    expect(c.acKW).toBeLessThan(b.acKW);
  });

  it("aceita DHI/DNI informadas ou decompõe pela correlação de Erbs", () => {
    const t = new Date("2027-10-15T12:30:00Z");
    const auto = instantPower(jan, { time: t, ghiWm2: 600, tempC: 28 });
    const withDhi = instantPower(jan, { time: t, ghiWm2: 600, dhiWm2: 150, tempC: 28 });
    const withBoth = instantPower(jan, { time: t, ghiWm2: 600, dhiWm2: 150, dniWm2: 700, tempC: 28 });
    for (const r of [auto, withDhi, withBoth]) {
      expect(r.acKW).toBeGreaterThan(0);
      expect(r.poaWm2).toBeGreaterThan(400);
      expect(r.poaWm2).toBeLessThan(900);
    }
  });

  it("seguidor capta mais que a estrutura fixa no início da manhã", () => {
    const morning = new Date("2027-10-15T11:00:00Z"); // ≈ 08h solares
    const fixedBjl = withTech(bjl, { mounting: "fixed", tiltDeg: 13, azimuthDeg: 0 });
    const tr = instantPower(bjl, { time: morning, ghiWm2: 450, tempC: 25 });
    const fx = instantPower(fixedBjl, { time: morning, ghiWm2: 450, tempC: 25 });
    expect(tr.poaWm2).toBeGreaterThan(fx.poaWm2 * 1.2);
  });

  it("degradação conforme a idade da usina (Petrolina, em operação desde 2024)", () => {
    const pet = getPlant("ufv-petrolina-1")!;
    const input = { ghiWm2: 500, tempC: 25 };
    const y1 = instantPower(pet, { ...input, time: new Date("2024-10-15T13:30:00Z") });
    const y11 = instantPower(pet, { ...input, time: new Date("2034-10-15T13:30:00Z") });
    expect(y11.acKW / y1.acKW).toBeLessThan(0.96);
    expect(y11.acKW / y1.acKW).toBeGreaterThan(0.93);
  });
});
