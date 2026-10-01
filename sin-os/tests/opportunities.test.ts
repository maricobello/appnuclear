import { describe, expect, it } from "vitest";
import { bessDay, buildOpportunities, pickDay } from "../src/lib/market/opportunities";
import { brtDate, brtHour, brtToUtc } from "../src/lib/sources/time";
import { SUBS, type Sub } from "../src/lib/sources/types";

const flat = (v: number) => Array.from({ length: 24 }, () => v);
const curve = (base: number, peak: number) => Array.from({ length: 24 }, (_, h) => (h >= 18 && h <= 20 ? peak : base));

describe("scanner de oportunidades", () => {
  it("BESS intraday: k = E/P horas, receita com perdas simétricas", () => {
    const b = bessDay(curve(100, 400), { pow: 100, cap: 300, rte: 81, lcos: 0 });
    expect(b.k).toBe(3);
    expect(b.buy).toBe(100);
    expect(b.sell).toBe(400);
    expect(b.revenue).toBeCloseTo(400 * 300 * 0.9 - (100 * 300) / 0.9, 6);
  });

  it("escolhe amanhã publicado, ordena por margem e não inventa margem para spreads", () => {
    const ts: number[] = [];
    const values = Object.fromEntries(SUBS.map((s) => [s, [] as number[]])) as Record<Sub, number[]>;
    for (const d of [26, 27]) for (let h = 0; h < 24; h++) {
      ts.push(brtToUtc(2026, 9, d, h));
      values.SE.push(d === 27 ? curve(100, 500)[h] : 90);
      values.S.push(d === 27 ? curve(100, 300)[h] : 90);
      values.NE.push(d === 27 ? (h < 10 ? 57.31 : 200) : 90);
      values.N.push(d === 27 ? flat(80)[h] : 90);
    }
    const day = pickDay(ts, values, "2026-09-26", brtDate, brtHour);
    expect(day?.date).toBe("2026-09-27");
    expect(day?.label).toBe("amanhã");
    const rows = buildOpportunities({
      day,
      floor: 57.31,
      asset: { pow: 100, cap: 400, rte: 88, lcos: 312.45 },
      spreads: [{ a: "SE", b: "S", current: 50, z: 2.5, adfP: 0.01, cointegrated: true, halfLifeH: 6 }],
    });
    const margins = rows.map((r) => r.margin).filter((m): m is number => m !== null);
    expect(margins).toEqual(margins.slice().sort((a, b) => b - a));
    expect(rows.find((r) => r.kind === "bess")!.market).toBe("SE"); // maior spread entre as linhas BESS
    expect(rows.find((r) => r.kind === "shift")!.margin).toBeCloseTo(3 * 400, 6); // (500 − 100) × 3 h
    const floor = rows.find((r) => r.kind === "floor");
    expect(floor?.market).toBe("NE");
    const sp = rows.find((r) => r.kind === "spread")!;
    expect(sp.margin).toBeNull();
    expect(sp.strategy).toBe("Spread S → SE");
    expect(sp.confidence).toBeCloseTo(0.99, 6);
    expect(rows.find((r) => r.kind === "bess" && r.market === "N")!.margin!).toBeLessThan(0); // preço plano: só perdas
  });
});
