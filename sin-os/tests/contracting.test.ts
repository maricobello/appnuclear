import { describe, expect, it } from "vitest";
import {
  costHistogram,
  counterpartyExposure,
  hourlyPrices,
  impliedRho,
  lognormal,
  monthlyLevels,
  optimize,
  quantile,
  riskAt,
  shocks,
  simulate,
  spreadRatio,
  typicalProfile,
  type ContractMonth,
  type LoadProfile,
} from "@/lib/market/contracting";
import { parseLoadCsv, parseNumber, profileFromCurve } from "@/lib/market/loadcurve";
import { BANDEIRAS_RS_MWH, MIGRACAO, RADAR, radarSorted } from "@/lib/market/radar";

const LIM = { min: 57.31, maxHourly: 1611.04 };
const MONTHS = ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10"];
const months = (p50: number, p90: number): ContractMonth[] => MONTHS.map((mes) => ({ mes, band: { mes, p10: LIM.min, p50, p90 }, lim: LIM }));
/** Forma horária típica de 2026: meio-dia barato (solar), fim de tarde caro. */
const DEV = Array.from({ length: 12 }, () => Array.from({ length: 24 }, (_, h): number => (h >= 10 && h <= 15 ? -80 : h >= 18 && h <= 21 ? 120 : 0)).map((x, _, a) => x - a.reduce((s, y) => s + y, 0) / 24));
const flatLoad = (mw: number): LoadProfile => ({ mw: Array.from({ length: 12 }, () => new Array(24).fill(mw)), covered: new Array(12).fill(true) });

describe("contratação ótima com CVaR", () => {
  it("cenários: mediana no P50, P90 no P90, piso respeitado e correlação controla a largura da média anual", () => {
    const bands = months(150, 300).map((m) => m.band);
    const sh = shocks(4000, 12, 1);
    const ind = monthlyLevels(bands, 0, sh, bands.map(() => LIM.min));
    const col = ind.map((x) => x[0]);
    expect(quantile(col, 0.5)).toBeCloseTo(150, -1);
    expect(quantile(col, 0.9)).toBeCloseTo(300, -1);
    expect(Math.min(...col)).toBeGreaterThanOrEqual(LIM.min);
    const r0 = spreadRatio(ind);
    const r1 = spreadRatio(monthlyLevels(bands, 0.95, sh, bands.map(() => LIM.min)));
    expect(r1).toBeGreaterThan(r0 + 0.3);
    // a calibração recupera o ρ que gerou a razão
    const target = spreadRatio(monthlyLevels(bands, 0.6, shocks(4000, 12, 9), bands.map(() => LIM.min)));
    expect(impliedRho(bands, target, bands.map(() => LIM.min), 4000)).toBeCloseTo(0.6, 1);
    expect(lognormal({ mes: "x", p10: null, p50: null, p90: null }, LIM.min).mu).toBeCloseTo(Math.log(LIM.min));
  });

  it("forma horária: média do mês preservada, piso e teto respeitados", () => {
    const p = hourlyPrices(90, DEV[0], LIM);
    expect(p.reduce((a, b) => a + b, 0) / 24).toBeCloseTo(90, 6);
    expect(Math.min(...p)).toBeGreaterThanOrEqual(LIM.min - 1e-9);
    expect(Math.max(...p)).toBeGreaterThan(150);
    expect([...hourlyPrices(40, DEV[0], LIM)].every((x) => x === LIM.min)).toBe(true);
  });

  it("custo afim no volume; sem aversão a risco a resposta é de canto; com aversão, protege perto da carga", () => {
    const sim = simulate(months(150, 320), DEV, flatLoad(10), 0.7, 1500);
    expect(sim.hours).toBe(365 * 24);
    expect(sim.energyMwh).toBeCloseTo(10 * 365 * 24, 6);
    const fair = optimize(sim, 100, 0).fairFlat;
    expect(fair).toBeGreaterThan(150); // média lognormal acima da mediana
    // preço abaixo do justo: compra tudo o que pode; acima: nada
    expect(optimize(sim, fair - 20, 0).qOpt).toBeGreaterThan(14.5);
    expect(optimize(sim, fair + 20, 0).qOpt).toBeLessThan(0.5);
    // com β = 1 (só CVaR) e preço justo, a carga flat é coberta por inteiro
    const hedge = optimize(sim, fair, 1);
    expect(hedge.hedgeRatio).toBeGreaterThan(0.95);
    expect(hedge.hedgeRatio).toBeLessThan(1.05);
    expect(hedge.opt.cvar).toBeLessThan(hedge.spot.cvar);
    // a carga flat não tem custo de perfil
    expect(Math.abs(hedge.profileCost)).toBeLessThan(1e-6);
    const r = riskAt(sim, 5, fair);
    expect(r.cvar).toBeGreaterThanOrEqual(r.var);
    expect(r.p95).toBeGreaterThanOrEqual(r.p05);
  });

  it("custo de perfil: carga de fim de tarde paga mais que o flat; de meio-dia, menos", () => {
    const evening: LoadProfile = { mw: Array.from({ length: 12 }, () => Array.from({ length: 24 }, (_, h) => (h >= 18 && h <= 21 ? 30 : 5))), covered: new Array(12).fill(true) };
    const noon: LoadProfile = { mw: Array.from({ length: 12 }, () => Array.from({ length: 24 }, (_, h) => (h >= 10 && h <= 15 ? 30 : 5))), covered: new Array(12).fill(true) };
    expect(optimize(simulate(months(150, 320), DEV, evening, 0.7, 800), 150, 0.5).profileCost).toBeGreaterThan(30);
    expect(optimize(simulate(months(150, 320), DEV, noon, 0.7, 800), 150, 0.5).profileCost).toBeLessThan(-30);
  });

  it("contraparte: exposição cai até o fim do contrato e PFE ≥ EE; preço alto do contrato reduz a exposição", () => {
    const sim = simulate(months(150, 320), DEV, flatLoad(10), 0.7, 1500);
    const ex = counterpartyExposure(sim, 10, 150);
    expect(ex).toHaveLength(12);
    expect(ex[0].ee).toBeGreaterThan(ex[11].ee);
    for (const e of ex) expect(e.pfe).toBeGreaterThanOrEqual(e.ee * 0.999);
    expect(counterpartyExposure(sim, 10, 300)[0].ee).toBeLessThan(ex[0].ee);
    const hist = costHistogram(sim, 150, [0, 10]);
    expect(hist.counts[0].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(hist.edges).toHaveLength(29);
  });

  it("perfil típico na média pedida", () => {
    const p = typicalProfile("comercial", 2);
    expect(p.mw[0].reduce((a, b) => a + b, 0) / 24).toBeCloseTo(2, 9);
  });
});

describe("curva de carga em CSV", () => {
  it("memória de massa brasileira: ; e vírgula decimal, data e hora separadas, 15 min em kWh", () => {
    const rows = ["Data;Hora;Consumo ativo (kWh)"];
    for (let d = 1; d <= 2; d++)
      for (let i = 0; i < 96; i++) {
        const h = Math.floor(i / 4);
        const m = (i % 4) * 15;
        rows.push(`0${d}/03/2026;${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")};${h >= 18 && h <= 20 ? "500,0" : "250,0"}`);
      }
    const c = parseLoadCsv(rows.join("\n"));
    expect(c.intervalMin).toBe(15);
    expect(c.unit).toBe("kWh");
    expect(c.unitGuessed).toBe(false);
    expect(c.hourly).toHaveLength(48);
    expect(c.hourly[0].mw).toBeCloseTo(1, 9); // 250 kWh a cada 15 min = 1 MW
    expect(c.hourly.find((p) => p.h === 19)!.mw).toBeCloseTo(2, 9);
    const { profile, stats } = profileFromCurve(c);
    expect(stats.peakMw).toBeCloseTo(2, 9);
    expect(stats.monthsCovered).toBe(0); // 2 dias: o perfil usa a média por hora em todos os meses
    expect(profile.mw[6][19]).toBeCloseTo(2, 9);
    expect(stats.peakShare).toBeCloseTo((3 * 2) / (21 * 1 + 3 * 2), 9);
  });

  it("ISO com vírgula como separador e ponto decimal, horária em kW; e hora 24:00 marca o fim do intervalo", () => {
    const iso = ["timestamp,demanda kW"];
    for (let h = 0; h < 48; h++) iso.push(`2026-07-${String(1 + Math.floor(h / 24)).padStart(2, "0")}T${String(h % 24).padStart(2, "0")}:00:00,${(1500.5).toFixed(1)}`);
    const a = parseLoadCsv(iso.join("\n"));
    expect(a.unit).toBe("kW");
    expect(a.intervalMin).toBe(60);
    expect(a.hourly[0].mw).toBeCloseTo(1.5005, 9);
    const end = ["data;valor"];
    for (let h = 1; h <= 24; h++) end.push(`2026-01-10 ${String(h).padStart(2, "0")}:00;100`);
    const b = parseLoadCsv(end.join("\n"));
    expect(b.hourly[0].h).toBe(0);
    expect(b.hourly[23].h).toBe(23);
    expect(b.unitGuessed).toBe(true);
    expect(() => parseLoadCsv("a;b\n1;2\n3;4")).toThrow();
    expect(parseNumber("1.234,5", true)).toBe(1234.5);
    expect(parseNumber("12.5", false)).toBe(12.5);
    expect(parseNumber("abc", true)).toBeNull();
  });
});

describe("radar regulatório", () => {
  it("datas válidas, fontes https, ids únicos e ordenação do mais recente", () => {
    const ids = new Set<string>();
    for (const r of RADAR) {
      expect(r.data).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
      expect(r.fontes.length).toBeGreaterThan(0);
      for (const f of r.fontes) expect(f.url).toMatch(/^https:\/\//);
      for (const m of r.marcos ?? []) expect(m.data).toMatch(/^\d{4}(-\d{2}(-\d{2})?)?$/);
      expect(ids.has(r.id)).toBe(false);
      ids.add(r.id);
    }
    const sorted = radarSorted();
    expect(sorted[0].id).toBe("open-energy");
    expect(BANDEIRAS_RS_MWH.vermelha2).toBeCloseTo(78.77);
    expect(MIGRACAO.map((m) => m.desde)).toEqual(["2024-01-01", "2027-11-25", "2028-11-25"]);
  });
});
