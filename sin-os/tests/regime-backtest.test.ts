import { describe, expect, it } from "vitest";
import { combinePath, FLOOR_SNAP, floorOn, snapToFloor } from "../src/lib/market/forecast";
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

  it("piso recente (ex ante) vira um grupo próprio", () => {
    const r = regimeBreakdown({
      dates: ["2026-05-01"],
      actuals: [flat(57.31)],
      model: [flat(60)],
      naive: [flat(57.31)],
      ear: new Map(),
      floor: 57.31,
      floorRecent: [Array.from({ length: 24 }, (_, h) => h < 12)],
    });
    expect(r.buckets.find((b) => b.key === "piso_sim")!.hours).toBe(12);
    expect(r.buckets.find((b) => b.key === "piso_nao")!.hours).toBe(12);
  });
});

describe("ajuste ao piso", () => {
  const F = 57.31;
  const day = (atFloorHours: number[]) => Array.from({ length: 24 }, (_, h) => (atFloorHours.includes(h) ? F : 200));
  const week = (n: number) => Array.from({ length: 7 }, (_, j) => ({ row: day(j < n ? [0, 1] : []), floor: F }));

  it("publica o piso quando a hora ficou no piso em 4 dos 7 dias e a previsão está perto dele", () => {
    const row = flat(F + 30);
    row[1] = F + 80; // longe demais do piso: fica
    const out = snapToFloor(row, week(FLOOR_SNAP.minDays), F);
    expect(out[0]).toBe(F);
    expect(out[1]).toBe(F + 80);
    expect(out[2]).toBe(F + 30); // hora que não ficou no piso
  });

  it("3 dias no piso não bastam", () => {
    expect(snapToFloor(flat(F + 10), week(FLOOR_SNAP.minDays - 1), F)[0]).toBe(F + 10);
  });

  it("usa o piso do ano de cada dia (o limite muda na virada do ano)", () => {
    expect(floorOn("2025-12-31")).toBe(58.6);
    expect(floorOn("2026-01-01")).toBe(57.31);
    const prev = Array.from({ length: 7 }, () => ({ row: flat(58.6), floor: 58.6 }));
    expect(snapToFloor(flat(70), prev, 57.31)[5]).toBe(57.31);
  });

  it("na trajetória, o dia ajustado conta como dia no piso para os seguintes", () => {
    const hist = Array.from({ length: 7 }, (_, j) => (j >= 3 ? flat(F) : flat(200)));
    const lear = [flat(F + 20), flat(F + 20)];
    const out = combinePath(lear, hist, [2, 3], { hist: hist.map(() => F), path: [F, F] });
    expect(out[0][0]).toBe(F); // 4 dos 7 no piso; combinação (F+20 e ingênuo F) perto do piso
    expect(out[1][0]).toBe(F);
    const plain = combinePath(lear, hist, [2, 3]);
    expect(plain[0][0]).toBeCloseTo(F + 10);
  });
});
