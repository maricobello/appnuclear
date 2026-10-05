import { beforeEach, describe, expect, it } from "vitest";
import { getPlant } from "@/data/plants";
import { clearSourceCache } from "@/lib/sources/http";
import { getPvgisCrossCheck, parsePvgis, pvgisResponseSchema, pvgisSystemLossPct, pvgisUrl } from "@/lib/sources/pvgis";
import { clone, createMockFetch, fixture, hang, json, route, status } from "./fixtures/sources/mock-fetch";

const fixedPlant = getPlant("ufv-janauba-1")!;
const trackerPlant = getPlant("ufv-bom-jesus-da-lapa-1")!;
const SARAH = /raddatabase=PVGIS-SARAH3/;
const ERA5 = /raddatabase=PVGIS-ERA5/;

beforeEach(() => clearSourceCache());

describe("parâmetros da consulta PVcalc", () => {
  it("perda do sistema = perdas da usina + inversor, compostas", () => {
    const l = fixedPlant.tech.losses;
    const kept = [l.soilingPct, l.shadingPct, l.mismatchPct, l.dcWiringPct, l.acWiringPct, l.transformerPct, l.unavailabilityPct, 100 - 98.4].reduce(
      (acc, p) => acc * (1 - p / 100),
      1,
    );
    expect(pvgisSystemLossPct(fixedPlant)).toBeCloseTo((1 - kept) * 100, 2);
    expect(pvgisSystemLossPct(fixedPlant)).toBeGreaterThan(9);
    expect(pvgisSystemLossPct(fixedPlant)).toBeLessThan(11);
  });

  it("usina fixa voltada ao Norte ⇒ angle = tilt e aspect = 180", () => {
    const u = new URL(pvgisUrl(fixedPlant, "PVGIS-SARAH3"));
    expect(u.origin + u.pathname).toBe("https://re.jrc.ec.europa.eu/api/v5_3/PVcalc");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      lat: "-15.8350",
      lon: "-43.2780",
      peakpower: "1",
      loss: String(pvgisSystemLossPct(fixedPlant)),
      angle: "15",
      aspect: "180",
      mountingplace: "free",
      outputformat: "json",
      raddatabase: "PVGIS-SARAH3",
    });
  });

  it("seguidor de um eixo ⇒ inclined_axis=1, inclinedaxisangle=0, sem aspect", () => {
    const u = new URL(pvgisUrl(trackerPlant, "PVGIS-ERA5"));
    expect(u.searchParams.get("inclined_axis")).toBe("1");
    expect(u.searchParams.get("inclinedaxisangle")).toBe("0");
    expect(u.searchParams.has("aspect")).toBe(false);
    expect(u.searchParams.get("raddatabase")).toBe("PVGIS-ERA5");
  });
});

describe("parsePvgis", () => {
  it("sistema fixo: E_y, E_m (jan..dez) e SD_y", () => {
    const r = parsePvgis(pvgisResponseSchema.parse(fixture("pvgis-pvcalc-fixed.json")), "fixed");
    expect(r.annualKWhPerKWp).toBe(1722.05);
    expect(r.monthlyKWhPerKWp).toHaveLength(12);
    expect(r.monthlyKWhPerKWp[0]).toBe(146.01);
    expect(r.monthlyKWhPerKWp[11]).toBe(136.09);
    expect(r.monthlyKWhPerKWp.reduce((a, b) => a + b, 0)).toBeCloseTo(r.annualKWhPerKWp, 1);
    expect(r.interannualSdKWhPerKWp).toBe(38.41);
    expect(r.radiationDb).toBe("PVGIS-SARAH3");
    expect(r.period).toBe("2005–2023");
  });

  it("seguidor: lê o bloco inclined_axis (ignora o fixed devolvido junto)", () => {
    const r = parsePvgis(pvgisResponseSchema.parse(fixture("pvgis-pvcalc-tracker.json")), "inclined_axis");
    expect(r.annualKWhPerKWp).toBe(2031.19);
    expect(r.monthlyKWhPerKWp[0]).toBe(186.31);
    expect(r.interannualSdKWhPerKWp).toBe(47.85);
  });

  it("meses fora de ordem são ordenados; números em texto são aceitos", () => {
    const j = clone(fixture<{ outputs: { monthly: { fixed: { month: number | string; E_m: number | string }[] } } }>("pvgis-pvcalc-fixed.json"));
    j.outputs.monthly.fixed.reverse();
    j.outputs.monthly.fixed[0].E_m = "136.09";
    j.outputs.monthly.fixed[0].month = "12";
    const r = parsePvgis(pvgisResponseSchema.parse(j), "fixed");
    expect(r.monthlyKWhPerKWp[0]).toBe(146.01);
    expect(r.monthlyKWhPerKWp[11]).toBe(136.09);
  });

  it("bloco ausente ⇒ erro", () => {
    expect(() => parsePvgis(pvgisResponseSchema.parse(fixture("pvgis-pvcalc-fixed.json")), "inclined_axis")).toThrow(/inclined_axis/);
  });
});

describe("getPvgisCrossCheck", () => {
  it("SARAH3 ao vivo", async () => {
    const mock = createMockFetch([route(SARAH, json(fixture("pvgis-pvcalc-fixed.json")))]);
    const r = await getPvgisCrossCheck(fixedPlant, { fetchImpl: mock });
    expect(r).not.toBeNull();
    expect(r!.annualKWhPerKWp).toBe(1722.05);
    expect(r!.monthlyKWhPerKWp).toHaveLength(12);
    expect(r!.interannualSdKWhPerKWp).toBe(38.41);
    expect(r!.provenance).toMatchObject({ id: "pvgis-5.3", status: "live" });
    expect(r!.provenance.name).toContain("PVGIS-SARAH3 2005–2023");
    expect(r!.provenance.note).toContain("aspect 180°");
    expect(mock.calls).toHaveLength(1);
  });

  it("SARAH3 'location not covered' (400) ⇒ repete com ERA5", async () => {
    const era5 = clone(fixture<{ inputs: { meteo_data: { radiation_db: string } } }>("pvgis-pvcalc-tracker.json"));
    era5.inputs.meteo_data.radiation_db = "PVGIS-ERA5";
    const mock = createMockFetch([route(SARAH, status(400, fixture("pvgis-error-not-covered.json"))), route(ERA5, json(era5))]);
    const r = await getPvgisCrossCheck(trackerPlant, { fetchImpl: mock, backoffMs: 0 });
    expect(mock.calls.map((c) => (SARAH.test(c.url) ? "SARAH3" : "ERA5"))).toEqual(["SARAH3", "ERA5"]);
    expect(r!.annualKWhPerKWp).toBe(2031.19);
    expect(r!.provenance.url).toMatch(ERA5);
    expect(r!.provenance.name).toContain("PVGIS-ERA5");
    expect(r!.provenance.note).toContain("SARAH3 indisponível (HTTP 400 — Location not covered");
    expect(r!.provenance.note).toContain("seguidor");
  });

  it("resposta sem o bloco esperado ⇒ tenta ERA5; se também falhar ⇒ null", async () => {
    const mock = createMockFetch([route(SARAH, json(fixture("pvgis-pvcalc-fixed.json"))), route(ERA5, status(400))]);
    expect(await getPvgisCrossCheck(trackerPlant, { fetchImpl: mock, backoffMs: 0 })).toBeNull();
    expect(mock.calls).toHaveLength(2);
  });

  it("HTTP 500 ⇒ null sem tentar ERA5 (servidor fora do ar)", async () => {
    const mock = createMockFetch([route(/jrc\.ec\.europa\.eu/, status(500))]);
    expect(await getPvgisCrossCheck(fixedPlant, { fetchImpl: mock, backoffMs: 0 })).toBeNull();
    expect(mock.callsTo(ERA5)).toHaveLength(0);
    expect(mock.callsTo(SARAH)).toHaveLength(2); // 1 nova tentativa
  });

  it("timeout ⇒ null", async () => {
    const mock = createMockFetch([route(/jrc\.ec\.europa\.eu/, hang())]);
    expect(await getPvgisCrossCheck(fixedPlant, { fetchImpl: mock, timeoutMs: 20, backoffMs: 0 })).toBeNull();
  });

  it("cache: segunda chamada não consulta a API", async () => {
    const mock = createMockFetch([route(SARAH, json(fixture("pvgis-pvcalc-fixed.json")))]);
    await getPvgisCrossCheck(fixedPlant, { fetchImpl: mock });
    const r = await getPvgisCrossCheck(fixedPlant, { fetchImpl: mock });
    expect(r!.provenance.status).toBe("cache");
    expect(mock.calls).toHaveLength(1);
  });
});
