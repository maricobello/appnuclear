import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { plants } from "@/data/plants";

/**
 * As ofertas on-chain (contracts/config/plants.json) precisam ter exatamente os números do site:
 * se um lado mudar e o outro não, o investidor veria um preço e pagaria outro.
 */
type Cfg = { slug: string; name: string; symbol: string; maxSupply: number; hardCapCotas?: number; softCapCotas: number; minCotas?: number; pricePerCotaUSDT?: string; startTime: string; endTime: string };
const file = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../contracts/config/plants.json"), "utf8")) as { defaults: { pricePerCotaUSDT: string; minCotas: number }; plants: Cfg[] };

describe("ofertas on-chain × catálogo do site", () => {
  const abertas = plants.filter((p) => p.status !== "encerrada");

  it("toda oferta aberta do site está no config dos contratos, e só elas", () => {
    expect(file.plants.map((p) => p.slug).sort()).toEqual(abertas.map((p) => p.slug).sort());
  });

  it.each(abertas.map((p) => [p.slug, p] as const))("%s: mesmos números do site", (slug, p) => {
    const c = file.plants.find((x) => x.slug === slug)!;
    expect(c.name).toBe(p.token.name);
    expect(c.symbol).toBe(p.token.symbol);
    expect(c.maxSupply).toBe(p.token.totalCotas);
    expect(c.hardCapCotas ?? c.maxSupply).toBe(p.token.totalCotas);
    expect(c.softCapCotas).toBe(p.token.softCapCotas);
    expect(c.minCotas ?? file.defaults.minCotas).toBe(p.token.minCotas);
    expect(Number(c.pricePerCotaUSDT ?? file.defaults.pricePerCotaUSDT)).toBe(p.token.cotaPriceUSDT);
    expect(Date.parse(c.startTime)).toBe(Date.parse(p.token.offeringStart!));
    expect(Date.parse(c.endTime)).toBe(Date.parse(p.token.offeringEnd!));
  });
});
