import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { addDays, dayType } from "@/lib/market/calendar";
import { contractDeviations, hourlyShape, sddpRho, subCorrelation } from "@/lib/market/free-market";
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

  it("cada hora do contrato vem do dia equivalente do histórico; submercados correlacionados pelas variações mensais", () => {
    const ts: number[] = [];
    const vals: Record<Sub, (number | null)[]> = { SE: [], S: [], NE: [], N: [] };
    // set/2025 a out/2026: nível que muda de mês a mês; dia útil com noite cara, fim de semana e feriado mais baratos
    for (let i = 0; i < 424; i++) {
      const day = addDays("2025-09-01", i);
      const [y, mo, d] = day.split("-").map(Number);
      const lvl = 100 + 60 * Math.sin((y * 12 + mo) * 1.3);
      for (let h = 0; h < 24; h++) {
        ts.push(brtToUtc(y, mo, d, h));
        const dev = dayType(day) === "util" ? (h === 19 ? 80 : h === 12 ? -40 : 0) : -20;
        vals.SE.push(lvl + dev);
        vals.S.push(lvl + 10 + dev);
        vals.NE.push(400 - 1.5 * lvl + dev);
        vals.N.push(150);
      }
    }
    const panel = { ts, values: vals, unit: "R$/MWh" };
    const months = ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10"];
    const dev = contractDeviations(panel, months);
    expect(dev.SE.dev).toHaveLength(365 * 24);
    expect(dev.SE.equivalentes).toBe(365);
    expect(dev.SE.semEquivalente).toBe(0);
    const at = (date: string, h: number) => dev.SE.dev[(Date.parse(`${date}T00:00:00Z`) - Date.parse("2026-11-01T00:00:00Z")) / 864e5 * 24 + h];
    expect(at("2026-11-19", 19)).toBeGreaterThan(70); // quinta útil ← quinta útil de 2025
    expect(at("2026-11-20", 19)).toBeLessThan(0); // feriado (Consciência Negra) ← feriado de 2025
    expect(at("2026-11-22", 12)).toBeLessThan(0); // domingo
    const corr = subCorrelation(panel);
    expect(corr.SE.SE).toBe(1);
    expect(corr.SE.S!).toBeGreaterThan(0.95);
    expect(corr.SE.NE!).toBeLessThan(-0.5);
    expect(corr.SE.N).toBeNull(); // PLD constante: sem variação para correlacionar
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
