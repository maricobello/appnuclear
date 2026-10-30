import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { hourlyShape, sddpRho } from "@/lib/market/free-market";
import { PlanReportSchema } from "@/lib/planning/report";
import { brtToUtc } from "@/lib/sources/time";
import { SUBS, type Sub } from "@/lib/sources/types";

describe("insumos do simulador de contratação", () => {
  it("forma horária: desvio da média do dia por mês civil, só dias completos", () => {
    const ts: number[] = [];
    const vals: Record<Sub, (number | null)[]> = { SE: [], S: [], NE: [], N: [] };
    // 10 dias de março com noite cara e meio-dia barato; 1 dia de abril incompleto
    for (let d = 1; d <= 10; d++)
      for (let h = 0; h < 24; h++) {
        ts.push(brtToUtc(2026, 3, d, h));
        for (const s of SUBS) vals[s].push(h >= 18 && h <= 21 ? 300 : h >= 10 && h <= 15 ? 57.31 : 150);
      }
    for (let h = 0; h < 12; h++) {
      ts.push(brtToUtc(2026, 4, 1, h));
      for (const s of SUBS) vals[s].push(999);
    }
    const f = hourlyShape({ ts, values: vals, unit: "R$/MWh" });
    const mar = f.SE.dev[2];
    expect(f.SE.dias[2]).toBe(10);
    expect(f.SE.dias[3]).toBe(0);
    expect(Math.abs(mar.reduce((a, b) => a + b, 0))).toBeLessThan(0.15); // 24 horas arredondadas a 2 casas
    expect(mar[19]).toBeGreaterThan(100);
    expect(mar[12]).toBeLessThan(-50);
    // mês sem dias completos usa a média dos meses com dado
    expect(f.SE.dev[3]).toEqual(f.SE.dev[0]);
  });

  it("correlação entre meses implícita nos cenários do SDDP do relatório real", () => {
    const r = PlanReportSchema.parse(JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/planejamento.json"), "utf8")));
    const rho = sddpRho(r);
    for (const s of SUBS) {
      expect(rho[s]).not.toBeNull();
      expect(rho[s]!).toBeGreaterThanOrEqual(0);
      expect(rho[s]!).toBeLessThanOrEqual(1);
    }
  }, 60_000);
});
