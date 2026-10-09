import { beforeEach, describe, expect, it } from "vitest";
import { getPlant } from "@/data/plants";
import type { Plant } from "@/lib/types";
import { clearSourceCache } from "@/lib/sources/http";
import {
  getLocationInfo,
  ibgeMunicipioSchema,
  parseMunicipio,
  parseSidraSeries,
  pibPerCapita,
  sidraPopulationUrl,
  sidraSchema,
} from "@/lib/sources/location";
import { clone, createMockFetch, fixture, hang, json, route, status, type Route } from "./fixtures/sources/mock-fetch";

const plant = getPlant("ufv-janauba-1")!;
const NOW = () => new Date("2026-10-04T12:00:00Z");
const OPTS = { now: NOW, backoffMs: 0 };

const MUN = /localidades\/municipios\//;
const POP = /agregados\/6579\//;
const PIB = /agregados\/5938\//;
const ELEV = /open-meteo\.com\/v1\/elevation/;

function liveRoutes(): Route[] {
  return [
    route(MUN, json(fixture("ibge-municipio-3135100.json"))),
    route(POP, json(fixture("ibge-sidra-6579-populacao.json"))),
    route(PIB, json(fixture("ibge-sidra-5938-pib.json"))),
    route(ELEV, json(fixture("open-meteo-elevation.json"))),
  ];
}
const byId = (r: { provenance: { id: string }[] }, id: string) => r.provenance.find((p) => p.id === id) as Record<string, string> | undefined;

beforeEach(() => clearSourceCache());

describe("IBGE Localidades", () => {
  it("município completo", () => {
    const m = parseMunicipio(ibgeMunicipioSchema.parse(fixture("ibge-municipio-3135100.json")));
    expect(m).toEqual({
      municipio: "Janaúba",
      uf: "MG",
      ufNome: "Minas Gerais",
      regiao: "Sudeste",
      regiaoImediata: "Janaúba",
      regiaoIntermediaria: "Montes Claros",
    });
  });

  it("microrregiao null (município recente) ⇒ UF lida da região intermediária", () => {
    const m = parseMunicipio(ibgeMunicipioSchema.parse(fixture("ibge-municipio-null-fields.json")));
    expect(m).toEqual({
      municipio: "Boa Esperança do Norte",
      uf: "MT",
      ufNome: "Mato Grosso",
      regiao: "Centro-Oeste",
      regiaoImediata: "Sorriso",
      regiaoIntermediaria: "Sinop",
    });
  });

  it("todos os ramos regionais nulos ⇒ só o nome", () => {
    const m = parseMunicipio(ibgeMunicipioSchema.parse({ id: 1, nome: "X", microrregiao: null, "regiao-imediata": null }));
    expect(m).toEqual({ municipio: "X" });
  });

  it("array com 1 município é aceito; [] (código inexistente) é rejeitado", () => {
    expect(ibgeMunicipioSchema.safeParse([fixture("ibge-municipio-3135100.json")]).success).toBe(true);
    expect(ibgeMunicipioSchema.safeParse([]).success).toBe(false);
  });
});

describe("SIDRA agregados v3", () => {
  it("série de população: anos em ordem e unidade", () => {
    const s = parseSidraSeries(sidraSchema.parse(fixture("ibge-sidra-6579-populacao.json")));
    expect(s.unit).toBe("Pessoas");
    expect(s.points.map((p) => p.year)).toEqual([2018, 2019, 2020, 2021, 2024, 2025]);
    expect(s.points.at(-1)).toEqual({ year: 2025, value: 71794 });
  });

  it('valores "-", "..." e "X" (sigilo) são descartados; só ausentes ⇒ erro', () => {
    const j = clone(fixture<[{ resultados: [{ series: [{ serie: Record<string, string> }] }] }]>("ibge-sidra-6579-populacao.json"));
    j[0].resultados[0].series[0].serie = { "2024": "...", "2025": "-" };
    expect(() => parseSidraSeries(sidraSchema.parse(j))).toThrow(/sigiloso/);
    j[0].resultados[0].series[0].serie = { "2021": "X", "2024": "70.123" };
    expect(parseSidraSeries(sidraSchema.parse(j)).points).toEqual([{ year: 2024, value: 70.123 }]);
  });

  it("PIB em Mil Reais ⇒ per capita = PIB × 1000 ÷ população do ano mais próximo", () => {
    const pib = parseSidraSeries(sidraSchema.parse(fixture("ibge-sidra-5938-pib.json")));
    const pop = parseSidraSeries(sidraSchema.parse(fixture("ibge-sidra-6579-populacao.json"))).points;
    const r = pibPerCapita(pib, pop)!;
    // PIB 2023; anos disponíveis 2021 (|2|) e 2024 (|1|) ⇒ 2024 = 71 530 hab.
    expect(r.year).toBe(2023);
    expect(r.valueBRL).toBeCloseTo((1854321.512 * 1000) / 71530, 2);
    expect(r.note).toContain("população estimada 2024");
  });

  it("PIB em Reais (per capita) é usado direto; Mil Reais sem população ⇒ undefined", () => {
    expect(pibPerCapita({ unit: "Reais", points: [{ year: 2023, value: 25123.45 }] })).toMatchObject({ valueBRL: 25123.45, year: 2023 });
    expect(pibPerCapita({ unit: "Mil Reais", points: [{ year: 2023, value: 1 }] }, undefined)).toBeUndefined();
  });
});

describe("getLocationInfo", () => {
  it("tudo ao vivo", async () => {
    const mock = createMockFetch(liveRoutes());
    const r = await getLocationInfo(plant, { fetchImpl: mock, ...OPTS });
    expect(mock.unmatched).toEqual([]);
    expect(r).toMatchObject({
      municipio: "Janaúba",
      uf: "MG",
      ufNome: "Minas Gerais",
      ibgeCode: 3135100,
      regiao: "Sudeste",
      regiaoImediata: "Janaúba",
      regiaoIntermediaria: "Montes Claros",
      populacao: 71794,
      populacaoAno: 2025,
      pibAno: 2023,
      elevationM: 516,
    });
    expect(r.pibPerCapitaBRL).toBeCloseTo(25923.69, 1);
    expect(r.provenance.map((p) => [p.id, p.status])).toEqual([
      ["ibge-localidades", "live"],
      ["ibge-sidra-6579", "live"],
      ["ibge-sidra-5938", "live"],
      ["open-meteo-elevation", "live"],
    ]);
    expect(mock.callsTo(POP)[0].url).toBe(sidraPopulationUrl(3135100));
    expect(mock.callsTo(POP)[0].url).toContain("localidades=N6[3135100]");
    expect(mock.callsTo(MUN)[0].init?.next).toEqual({ revalidate: 30 * 86_400 });
  });

  it("IBGE devolve [] (código inexistente) ⇒ nomes do cadastro + tabela de UFs (fallback)", async () => {
    const mock = createMockFetch([route(MUN, json([])), ...liveRoutes()]);
    const r = await getLocationInfo(plant, { fetchImpl: mock, ...OPTS });
    expect(r).toMatchObject({ municipio: "Janaúba", uf: "MG", ufNome: "Minas Gerais", regiao: "Sudeste", ibgeCode: 3135100 });
    expect(r.regiaoImediata).toBeUndefined();
    expect(byId(r, "ibge-localidades")).toMatchObject({ status: "fallback" });
    expect(byId(r, "ibge-localidades")!.note).toContain("formato inesperado");
    expect(byId(r, "ibge-sidra-6579")!.status).toBe("live");
  });

  it("campos regionais nulos ⇒ live com nota", async () => {
    const p: Plant = { ...plant, location: { ...plant.location, ibgeCode: 5101837, municipio: "Boa Esperança do Norte", uf: "MT" } };
    const mock = createMockFetch([route(MUN, json(fixture("ibge-municipio-null-fields.json"))), ...liveRoutes()]);
    const r = await getLocationInfo(p, { fetchImpl: mock, ...OPTS });
    expect(r).toMatchObject({ municipio: "Boa Esperança do Norte", uf: "MT", ufNome: "Mato Grosso", regiao: "Centro-Oeste", regiaoIntermediaria: "Sinop" });
    expect(byId(r, "ibge-localidades")!.status).toBe("live");
  });

  it("SIDRA com dado ausente ⇒ população e PIB per capita omitidos (status error)", async () => {
    const pop = clone(fixture<[{ resultados: [{ series: [{ serie: Record<string, string> }] }] }]>("ibge-sidra-6579-populacao.json"));
    pop[0].resultados[0].series[0].serie = { "2025": "-" };
    const mock = createMockFetch([route(POP, json(pop)), ...liveRoutes()]);
    const r = await getLocationInfo(plant, { fetchImpl: mock, ...OPTS });
    expect(r.populacao).toBeUndefined();
    expect(r.pibPerCapitaBRL).toBeUndefined();
    expect(byId(r, "ibge-sidra-6579")!.status).toBe("error");
    expect(byId(r, "ibge-sidra-5938")!.status).toBe("error");
    expect(r.elevationM).toBe(516);
  });

  it("tudo fora (500, timeout, malformado) ⇒ nunca lança; fallback + error", async () => {
    const mock = createMockFetch([
      route(MUN, status(500)),
      route(POP, hang()),
      route(PIB, json({ erro: "x" })),
      route(ELEV, json({ elevation: [null] })),
    ]);
    const r = await getLocationInfo(plant, { fetchImpl: mock, ...OPTS, timeoutMs: 20 });
    expect(r).toMatchObject({ municipio: "Janaúba", uf: "MG", ibgeCode: 3135100, ufNome: "Minas Gerais" });
    expect(r.elevationM).toBeUndefined();
    expect(r.provenance.map((p) => [p.id, p.status])).toEqual([
      ["ibge-localidades", "fallback"],
      ["ibge-sidra-6579", "error"],
      ["ibge-sidra-5938", "error"],
      ["open-meteo-elevation", "error"],
    ]);
    expect(byId(r, "ibge-sidra-6579")!.note).toContain("tempo esgotado");
  });

  it("segunda chamada sai do cache", async () => {
    const mock = createMockFetch(liveRoutes());
    await getLocationInfo(plant, { fetchImpl: mock, ...OPTS });
    const r = await getLocationInfo(plant, { fetchImpl: mock, ...OPTS });
    expect(mock.calls).toHaveLength(4);
    expect(r.provenance.every((p) => p.status === "cache")).toBe(true);
  });
});
