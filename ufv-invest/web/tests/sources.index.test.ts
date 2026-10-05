import { beforeEach, describe, expect, it } from "vitest";
import { plants } from "@/data/plants";
import {
  clearSourceCache,
  getLiveWeather,
  getLocationInfo,
  getMarketRates,
  getPvgisCrossCheck,
  getSolarResource,
  type SourceOptions,
} from "@/lib/sources";
import { createMockFetch, networkError, route } from "./fixtures/sources/mock-fetch";

beforeEach(() => clearSourceCache());

describe("API pública offline (todas as requisições falham)", () => {
  const offline = (): SourceOptions => ({ fetchImpl: createMockFetch([route(() => true, networkError("ENETUNREACH"))]), backoffMs: 0 });

  it.each(plants.map((p) => [p.slug, p] as const))("%s: nenhuma função lança; fallbacks marcados", async (_slug, plant) => {
    const [resource, pvgis, market, location, weather] = await Promise.all([
      getSolarResource(plant, offline()),
      getPvgisCrossCheck(plant, offline()),
      getMarketRates(offline()),
      getLocationInfo(plant, offline()),
      getLiveWeather(plant, offline()),
    ]);
    expect(resource.monthly.ghiKWhM2Day).toEqual(plant.fallbackClimate.ghiKWhM2Day);
    expect(resource.provenance.every((p) => p.status === "fallback")).toBe(true);
    expect(pvgis).toBeNull();
    expect(weather).toBeNull();
    expect(market.usdtBrl).toBe(market.usdBrl);
    expect(market.provenance.every((p) => p.status === "fallback" || p.status === "error")).toBe(true);
    expect(location).toMatchObject({ municipio: plant.location.municipio, uf: plant.location.uf, ibgeCode: plant.location.ibgeCode });
    expect(location.provenance[0].status).toBe("fallback");
    for (const p of [...resource.provenance, ...market.provenance, ...location.provenance]) {
      expect(p.url).toMatch(/^https:\/\//);
      expect(Number.isFinite(Date.parse(p.fetchedAt))).toBe(true);
    }
  });
});
