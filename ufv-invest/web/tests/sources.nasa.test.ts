import { beforeEach, describe, expect, it } from "vitest";
import { getPlant } from "@/data/plants";
import { clearSourceCache } from "@/lib/sources/http";
import {
  annualFromMonthly,
  interannualCvPct,
  nasaClimatologyUrl,
  parseClimatology,
  parseMonthlySeries,
  powerResponseSchema,
  getSolarResource,
  type PowerResponse,
} from "@/lib/sources/nasaPower";
import { clone, createMockFetch, fixture, hang, json, route, status } from "./fixtures/sources/mock-fetch";

const plant = getPlant("ufv-janauba-1")!;
const NOW = () => new Date("2026-10-04T12:00:00Z");
const CLIM = /\/climatology\/point/;
const SERIES = /\/monthly\/point/;

const climFixture = () => powerResponseSchema.parse(fixture("nasa-power-climatology.json"));
const seriesFixture = () => powerResponseSchema.parse(fixture("nasa-power-monthly.json"));

beforeEach(() => clearSourceCache());

describe("parseClimatology", () => {
  it("lê os 12 meses de cada parâmetro e o período 2001–2020", () => {
    const r = parseClimatology(climFixture(), plant.fallbackClimate);
    expect(r.monthly.ghiKWhM2Day).toHaveLength(12);
    expect(r.monthly.ghiKWhM2Day[0]).toBe(6.18);
    expect(r.monthly.ghiKWhM2Day[11]).toBe(5.84);
    expect(r.monthly.dhiKWhM2Day?.[5]).toBe(1.12);
    expect(r.monthly.tempC[6]).toBe(21.55);
    expect(r.monthly.tempMaxC?.[9]).toBe(33.48);
    expect(r.monthly.tempMinC?.[6]).toBe(14.36);
    expect(r.monthly.windMs?.[8]).toBe(2.79);
    expect(r.period).toBe("2001–2020");
    expect(r.notes).toEqual([]);
  });

  it("−999 em parâmetros opcionais os omite; T2M incompleto usa a temperatura do fallback", () => {
    const r = parseClimatology(powerResponseSchema.parse(fixture("nasa-power-climatology-fill.json")), plant.fallbackClimate);
    expect(r.monthly.ghiKWhM2Day[0]).toBe(6.18);
    expect(r.monthly.dhiKWhM2Day).toBeUndefined();
    expect(r.monthly.tempMaxC).toBeUndefined();
    expect(r.monthly.tempC).toEqual(plant.fallbackClimate.tempC);
    expect(r.monthly.windMs).toHaveLength(12);
    expect(r.notes.join(" ")).toContain("T2M ausente");
    expect(r.notes.join(" ")).toContain("difusa");
  });

  it("GHI com −999 é erro (não há como usar climatologia parcial)", () => {
    const j = clone(climFixture());
    j.properties.parameter.ALLSKY_SFC_SW_DWN.MAR = -999;
    expect(() => parseClimatology(j, plant.fallbackClimate)).toThrow(/−999/);
  });

  it("converte MJ/m²/dia (community AG) para kWh/m²/dia", () => {
    const j = clone(climFixture()) as PowerResponse;
    for (const k of Object.keys(j.properties.parameter.ALLSKY_SFC_SW_DWN)) {
      j.properties.parameter.ALLSKY_SFC_SW_DWN[k] = Number(j.properties.parameter.ALLSKY_SFC_SW_DWN[k]) * 3.6;
    }
    (j.parameters as Record<string, unknown>).ALLSKY_SFC_SW_DWN = { units: "MJ/m^2/day" };
    const r = parseClimatology(j, plant.fallbackClimate);
    expect(r.monthly.ghiKWhM2Day[0]).toBeCloseTo(6.18, 6);
  });

  it("GHI fora da faixa plausível é rejeitado", () => {
    const j = clone(climFixture());
    j.properties.parameter.ALLSKY_SFC_SW_DWN.JAN = 250; // W/m² rotulado como kWh
    expect(() => parseClimatology(j, plant.fallbackClimate)).toThrow(/faixa/);
  });
});

describe("série mensal e variabilidade interanual", () => {
  it("total anual = Σ média diária do mês × dias (bissexto incluso)", () => {
    const raw = fixture<{ properties: { parameter: { ALLSKY_SFC_SW_DWN: Record<string, number> } } }>("nasa-power-monthly.json");
    const p = raw.properties.parameter.ALLSKY_SFC_SW_DWN;
    const series = parseMonthlySeries(seriesFixture());
    expect(series).toHaveLength(25);
    expect(series[0].year).toBe(2001);
    expect(series.at(-1)!.year).toBe(2025);
    const days2004 = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const expected2004 = days2004.reduce((acc, d, i) => acc + p[`2004${String(i + 1).padStart(2, "0")}`] * d, 0);
    expect(series.find((s) => s.year === 2004)!.ghiKWhM2).toBeCloseTo(expected2004, 1);
  });

  it("ano com mês −999 é descartado; ano só com o mês 13 usa média × dias do ano", () => {
    const j = clone(seriesFixture());
    const P = j.properties.parameter.ALLSKY_SFC_SW_DWN;
    P["200307"] = -999;
    for (let m = 1; m <= 12; m++) delete P[`2005${String(m).padStart(2, "0")}`];
    P["200513"] = 5.5;
    const series = parseMonthlySeries(j);
    expect(series.find((s) => s.year === 2003)).toBeUndefined();
    expect(series.find((s) => s.year === 2005)!.ghiKWhM2).toBeCloseTo(5.5 * 365, 1);
    expect(series).toHaveLength(24);
  });

  it("CV interanual = desvio-padrão amostral ÷ média", () => {
    const s = [1900, 2000, 2100, 1950, 2050].map((g, i) => ({ year: 2001 + i, ghiKWhM2: g }));
    // média 2000; Σ(x−m)² = 10000+0+10000+2500+2500 = 25000; s = √(25000/4) = 79,057
    expect(interannualCvPct(s)).toBeCloseTo(3.95, 2);
  });

  it("menos de 5 anos válidos ⇒ erro", () => {
    expect(() => interannualCvPct([{ year: 2020, ghiKWhM2: 2000 }])).toThrow(/mínimo/);
  });

  it("irradiação anual da climatologia = Σ mês × dias (365)", () => {
    expect(annualFromMonthly(new Array(12).fill(5))).toBe(1825);
  });
});

describe("getSolarResource", () => {
  const liveRoutes = () => [route(CLIM, json(fixture("nasa-power-climatology.json"))), route(SERIES, json(fixture("nasa-power-monthly.json")))];

  it("tudo ao vivo: climatologia + CV da série, duas procedências live", async () => {
    const mock = createMockFetch(liveRoutes());
    const r = await getSolarResource(plant, { fetchImpl: mock, now: NOW });
    expect(mock.unmatched).toEqual([]);
    expect(r.monthly.ghiKWhM2Day[0]).toBe(6.18);
    expect(r.monthly.dhiKWhM2Day).toHaveLength(12);
    expect(r.annualGhiKWhM2).toBeCloseTo(annualFromMonthly(r.monthly.ghiKWhM2Day), 6);
    expect(r.annualGhiKWhM2).toBeGreaterThan(2000);
    expect(r.annualSeries).toHaveLength(25);
    expect(r.interannualCvPct).toBeGreaterThan(0.5);
    expect(r.interannualCvPct).toBeLessThan(8);
    expect(r.provenance.map((p) => [p.id, p.status])).toEqual([
      ["nasa-power-climatology", "live"],
      ["nasa-power-monthly", "live"],
    ]);
    expect(r.provenance[0].name).toContain("2001–2020");
    expect(r.provenance[1].name).toContain("2001–2025");
    expect(r.provenance[0].url).toBe(nasaClimatologyUrl(-15.835, -43.278));

    const climUrl = new URL(mock.callsTo(CLIM)[0].url);
    expect(climUrl.searchParams.get("community")).toBe("RE");
    expect(climUrl.searchParams.get("latitude")).toBe("-15.8350");
    expect(climUrl.searchParams.get("longitude")).toBe("-43.2780");
    expect(climUrl.searchParams.get("parameters")).toBe("ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DIFF,T2M,T2M_MAX,T2M_MIN,WS2M");
    const seriesUrl = new URL(mock.callsTo(SERIES)[0].url);
    expect(seriesUrl.searchParams.get("start")).toBe("2001");
    expect(seriesUrl.searchParams.get("end")).toBe("2025"); // último ano completo em 2026-10
  });

  it("série com 422 (ano ainda não processado) ⇒ repete com um ano a menos", async () => {
    const mock = createMockFetch([
      route(CLIM, json(fixture("nasa-power-climatology.json"))),
      route(/end=2025/, status(422, fixture("nasa-power-error-422.json"))),
      route(/end=2024/, json(fixture("nasa-power-monthly.json"))),
    ]);
    const r = await getSolarResource(plant, { fetchImpl: mock, now: NOW, backoffMs: 0 });
    expect(r.provenance[1].status).toBe("live");
    expect(r.provenance[1].url).toContain("end=2024");
  });

  it("climatologia ok + série com HTTP 500 ⇒ climatologia live e CV do fallback (status distintos)", async () => {
    const mock = createMockFetch([route(CLIM, json(fixture("nasa-power-climatology.json"))), route(SERIES, status(500))]);
    const r = await getSolarResource(plant, { fetchImpl: mock, now: NOW, backoffMs: 0 });
    expect(r.monthly.ghiKWhM2Day[0]).toBe(6.18);
    expect(r.interannualCvPct).toBe(plant.fallbackClimate.interannualCvPct);
    expect(r.annualSeries).toBeUndefined();
    expect(r.provenance.map((p) => p.status)).toEqual(["live", "fallback"]);
    expect(r.provenance[1].note).toContain("HTTP 500");
    expect(mock.callsTo(SERIES)).toHaveLength(2); // 1 nova tentativa em 5xx
  });

  it("timeout nas duas consultas ⇒ fallback completo, nunca lança", async () => {
    const mock = createMockFetch([route(/power\.larc/, hang())]);
    const r = await getSolarResource(plant, { fetchImpl: mock, now: NOW, timeoutMs: 20, backoffMs: 0 });
    const fb = plant.fallbackClimate;
    expect(r.monthly.ghiKWhM2Day).toEqual(fb.ghiKWhM2Day);
    expect(r.monthly.tempC).toEqual(fb.tempC);
    expect(r.interannualCvPct).toBe(fb.interannualCvPct);
    expect(r.annualGhiKWhM2).toBeCloseTo(annualFromMonthly(fb.ghiKWhM2Day), 6);
    expect(r.provenance.map((p) => p.status)).toEqual(["fallback", "fallback"]);
    expect(r.provenance[0].name).toBe(fb.source);
    expect(r.provenance[0].note).toContain("tempo esgotado");
    expect(r.provenance[0].fetchedAt).toBe("2026-10-04T12:00:00.000Z");
  });

  it("resposta malformada ⇒ fallback com motivo", async () => {
    const mock = createMockFetch([route(CLIM, json({ type: "Feature", properties: {} })), route(SERIES, json({ messages: ["erro"] }))]);
    const r = await getSolarResource(plant, { fetchImpl: mock, now: NOW });
    expect(r.provenance.map((p) => p.status)).toEqual(["fallback", "fallback"]);
    expect(r.provenance[0].note).toContain("formato inesperado");
  });

  it("segunda chamada sai do cache (status cache, fetchedAt original, sem nova requisição)", async () => {
    const mock = createMockFetch(liveRoutes());
    const first = await getSolarResource(plant, { fetchImpl: mock, now: NOW });
    const second = await getSolarResource(plant, { fetchImpl: mock, now: NOW });
    expect(mock.calls).toHaveLength(2);
    expect(second.provenance.map((p) => p.status)).toEqual(["cache", "cache"]);
    expect(second.provenance[0].fetchedAt).toBe(first.provenance[0].fetchedAt);
    expect(second.monthly).toEqual(first.monthly);
  });
});
