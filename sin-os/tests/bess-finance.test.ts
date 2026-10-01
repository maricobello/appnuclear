import { describe, expect, it } from "vitest";
import { bessFinance, irr, npvAt, payback, type FinanceInputs } from "../src/lib/market/bess-finance";
import { bessStudy } from "../src/lib/market/bess-study";
import { brtToUtc } from "../src/lib/sources/time";
import { SUBS, type SubPanel } from "../src/lib/sources/types";

const BASE: FinanceInputs = { powerMW: 100, capacityMWh: 400, rte: 0.88, degPctYear: 0.5, lcos: 312.45, waccPct: 10, lifeYears: 20, opexPctCapex: 2, refCyclesPerDay: 1 };

describe("modelo econômico do BESS", () => {
  it("TIR, VPL e payback batem com casos de livro", () => {
    expect(irr([-100, 60, 60])!).toBeCloseTo(0.1307, 3);
    expect(npvAt([-100, 60, 60], 0.1307)).toBeCloseTo(0, 1);
    expect(payback([-100, 30, 30, 30, 30])).toBeCloseTo(3 + 10 / 30, 6);
    expect(payback([-100, 10, 10])).toBeNull();
    expect(irr([-100, 10, 10])).toBeNull();
  });

  it("CAPEX implícito reproduz o LCOS informado pela definição (perfil de referência)", () => {
    const f = bessFinance(BASE, 0, 0);
    const r = 0.1, d = 0.005;
    let q = 0, a = 0;
    for (let t = 1; t <= 20; t++) { q += (365 * 400 * Math.sqrt(0.88) * (1 - d) ** (t - 1)) / (1 + r) ** t; a += 1 / (1 + r) ** t; }
    expect((f.capex + f.opexYear * a) / q).toBeCloseTo(312.45, 6);
    expect(f.capexPerKWh).toBeGreaterThan(500);
    expect(f.capexPerKWh).toBeLessThan(1500);
  });

  it("LCOS de equilíbrio zera o VPL; receita maior ⇒ TIR maior e payback menor", () => {
    const rev = 60e6;
    const f = bessFinance(BASE, rev, 146000);
    const g = bessFinance({ ...BASE, lcos: f.breakevenLcos }, rev, 146000);
    expect(g.npv / g.capex).toBeCloseTo(0, 6);
    expect(g.irr!).toBeCloseTo(0.1, 4); // TIR = WACC no equilíbrio
    const h = bessFinance(BASE, rev * 1.3, 146000);
    expect((h.irr ?? -1) > (f.irr ?? -1)).toBe(true);
    if (f.paybackYears !== null && h.paybackYears !== null) expect(h.paybackYears).toBeLessThan(f.paybackYears);
    // menos ciclos que o perfil de referência ⇒ custo efetivo por MWh maior que o LCOS informado
    const full = 365 * 400 * Math.sqrt(0.88);
    expect(bessFinance(BASE, rev, full / 2).effectiveLcos!).toBeCloseTo(2 * 312.45, 6);
  });
});

describe("estudo do BESS no PLD", () => {
  it("despacha no PLD, anualiza e monta cenários coerentes", async () => {
    // 40 dias: vale de madrugada (60) e pico às 19h (400) — spread limpo
    const ts: number[] = [];
    for (let d = 1; d <= 40; d++) for (let h = 0; h < 24; h++) ts.push(brtToUtc(2026, 6, d, h));
    const price = (t: number) => { const h = new Date(t - 3 * 3600_000).getUTCHours(); return h >= 17 && h <= 21 ? 400 : 60; };
    const values = Object.fromEntries(SUBS.map((s) => [s, ts.map(price)])) as SubPanel["values"];
    const st = await bessStudy({ ts, values, unit: "R$/MWh" }, { ...BASE, sub: "SE", maxCyclesPerDay: 1, days: 30 }, Date.parse("2026-07-10T15:00:00Z"));
    expect(st.window.days).toBe(30);
    // 1 ciclo/dia: tira 400 MWh do armazenamento (400·√η na rede) e carrega 400/√η da rede
    const eta = Math.sqrt(0.88);
    expect(st.last30.cyclesPerDay).toBeCloseTo(1, 4);
    expect(st.margin.avgSell).toBeCloseTo(400, 6);
    expect(st.margin.avgBuy).toBeCloseTo(60, 6);
    expect(st.margin.netSpread!).toBeCloseTo(400 - 60 / 0.88, 6);
    const perDay = 400 * eta * 400 - (400 / eta) * 60;
    expect(st.last30.revenuePerDay).toBeCloseTo(perDay, 0);
    expect(st.finance.revenueYear1).toBeCloseTo(perDay * 365, -2);
    expect(st.refDay?.soc.length).toBe(24);
    const [c, p, o] = st.scenarios;
    expect(c.revenueYear).toBeLessThanOrEqual(p.revenueYear + 1e-6);
    expect(o.revenueYear).toBeGreaterThanOrEqual(p.revenueYear - 1e-6);
    expect(st.notes.some((n) => n.includes("anualizada"))).toBe(true);
  });
});
