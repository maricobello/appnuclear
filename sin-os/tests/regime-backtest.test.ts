import { describe, expect, it } from "vitest";
import { regimeBreakdown } from "../src/lib/market/regime-backtest";

const flat = (v: number) => new Array(24).fill(v);

describe("backtest por regime", () => {
  it("separa por período hidrológico, reservatório e faixa de PLD, com rMAE por grupo", () => {
    // janeiro (úmido, EAR 70%): PLD no piso, modelo erra 10, ingênuo erra 0
    // julho (seco, EAR 35%): PLD a 400, modelo erra 20, ingênuo erra 40
    const r = regimeBreakdown({
      dates: ["2026-01-10", "2026-07-10"],
      actuals: [flat(57.31), flat(400)],
      model: [flat(67.31), flat(420)],
      naive: [flat(57.31), flat(440)],
      ear: new Map([["2026-01-10", 70], ["2026-07-10", 35]]),
      floor: 57.31,
    });
    const by = Object.fromEntries(r.buckets.map((b) => [`${b.group}:${b.key}`, b]));
    expect(by["estacao:umido"]).toMatchObject({ hours: 24, maeModel: 10, maeNaive: 0, rmae: null });
    expect(by["estacao:seco"]).toMatchObject({ hours: 24, maeModel: 20, maeNaive: 40, rmae: 0.5 });
    expect(by["reservatorio:ear_alto"].hours).toBe(24);
    expect(by["reservatorio:ear_baixo"].rmae).toBe(0.5);
    expect(by["faixa_pld:piso"].maeModel).toBe(10);
    expect(by["faixa_pld:acima300"].rmae).toBe(0.5);
    expect(by["reservatorio:ear_medio"]).toBeUndefined(); // sem horas, fora da lista
    expect(r.overall).toMatchObject({ hours: 48, maeModel: 15, maeNaive: 20, rmae: 0.75 });
    expect(by["estacao:seco"].smallSample).toBe(true); // 1 dia só
  });

  it("dia sem EAR conhecido fica fora do grupo de reservatório, mas entra nos outros", () => {
    const r = regimeBreakdown({ dates: ["2026-05-01"], actuals: [flat(100)], model: [flat(110)], naive: [flat(120)], ear: new Map(), floor: 57.31 });
    expect(r.buckets.some((b) => b.group === "reservatorio")).toBe(false);
    expect(r.buckets.find((b) => b.key === "ate150")!.rmae).toBe(0.5);
  });
});
