import { describe, expect, it } from "vitest";
import { bookSummary, hoursInMonth, monthlyPldFromPanel, monthsBetween, settleContract, type Contract } from "../src/lib/market/book";
import { brtToUtc } from "../src/lib/sources/time";
import { SUBS, type SubPanel } from "../src/lib/sources/types";

describe("carteira: liquidação e MtM contra o PLD", () => {
  it("horas do mês e meses no intervalo (com ano bissexto)", () => {
    expect(hoursInMonth("2026-01")).toBe(31 * 24);
    expect(hoursInMonth("2024-02")).toBe(29 * 24); // bissexto
    expect(hoursInMonth("2026-02")).toBe(28 * 24);
    expect(monthsBetween("2026-01", "2026-03")).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(monthsBetween("2026-03", "2026-01")).toEqual([]);
  });

  it("comprador ganha quando PLD > preço; vendedor é o simétrico exato", () => {
    const pld = { byMonth: { "2026-01": { SE: 200 } }, months: ["2026-01"] };
    const base: Contract = { id: "1", submarket: "SE", side: "compra", volumeMWm: 10, priceRS: 150, start: "2026-01", end: "2026-01" };
    const buy = settleContract(base, pld);
    const energy = 10 * 31 * 24;
    expect(buy.months[0].energyMWh).toBe(energy);
    expect(buy.settledRS).toBeCloseTo((200 - 150) * energy, 6); // + a favor do comprador
    const sell = settleContract({ ...base, side: "venda" }, pld);
    expect(sell.settledRS).toBeCloseTo(-buy.settledRS, 6);
  });

  it("meses sem PLD realizado ficam em aberto (dependem da curva a termo)", () => {
    const pld = { byMonth: { "2026-01": { SE: 100 } }, months: ["2026-01"] };
    const r = settleContract({ id: "1", submarket: "SE", side: "compra", volumeMWm: 5, priceRS: 90, start: "2026-01", end: "2026-03" }, pld);
    expect(r.coveredMonths).toBe(1);
    expect(r.openMonths).toBe(2);
    expect(r.months[1].settlementRS).toBeNull();
  });

  it("PLD mensal a partir do painel: média das horas do mês por submercado", () => {
    const ts: number[] = [];
    for (let d = 1; d <= 25; d++) for (let h = 0; h < 24; h++) ts.push(brtToUtc(2026, 6, d, h));
    const values = Object.fromEntries(SUBS.map((s) => [s, ts.map((_, i) => (s === "SE" ? 100 + (i % 24) : 80))])) as SubPanel["values"];
    const m = monthlyPldFromPanel({ ts, values, unit: "R$/MWh" });
    expect(m.months).toContain("2026-06");
    expect(m.byMonth["2026-06"].SE).toBeCloseTo(100 + 23 / 2, 6); // média de 100..123
    expect(m.byMonth["2026-06"].S).toBeCloseTo(80, 6);
  });

  it("resumo agrega liquidação e exposição líquida por submercado", () => {
    const pld = { byMonth: { "2026-01": { SE: 200, S: 200 } }, months: ["2026-01"] };
    const cs: Contract[] = [
      { id: "1", submarket: "SE", side: "compra", volumeMWm: 10, priceRS: 150, start: "2026-01", end: "2026-01" },
      { id: "2", submarket: "SE", side: "venda", volumeMWm: 4, priceRS: 150, start: "2026-01", end: "2026-01" },
      { id: "3", submarket: "S", side: "compra", volumeMWm: 7, priceRS: 150, start: "2026-01", end: "2026-01" },
    ];
    const b = bookSummary(cs, pld);
    expect(b.exposure.find((e) => e.submarket === "SE")!.netMWm).toBe(6); // 10 compra - 4 venda
    expect(b.exposure.find((e) => e.submarket === "S")!.netMWm).toBe(7);
    expect(b.settledRS).toBeCloseTo(b.results.reduce((s, r) => s + r.settledRS, 0), 6);
  });
});
