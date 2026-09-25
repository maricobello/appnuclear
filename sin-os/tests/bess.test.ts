import { describe, expect, it } from "vitest";
import { optimizeStorageLP } from "../src/lib/quant/bess";
import { optimizeStorageDP, type StorageSpec } from "../src/lib/quant/storage";

const spec: StorageSpec = { capacityMWh: 4, powerMW: 1, etaCharge: 0.95, etaDischarge: 0.95, socInit: 0.5, socEnd: 0.5, degradationCost: 3 };
const prices = Array.from({ length: 72 }, (_, t) => 180 + 140 * Math.sin((2 * Math.PI * (t - 6)) / 24) + 25 * Math.cos(t / 3));

describe("despacho exato de armazenamento (LP/HiGHS)", () => {
  it("é ótimo: nunca pior que a DP em grade e converge para ela quando a grade é fina", async () => {
    const lp = await optimizeStorageLP(prices, spec);
    expect(lp.status).toBe("Optimal");
    const dp = optimizeStorageDP(prices, { ...spec, levels: 38 }); // ΔE = P·Δt·η_c/9.5 → passos exatos
    expect(lp.value).toBeGreaterThanOrEqual(dp.value - 1e-6);
    expect((lp.value - dp.value) / lp.value).toBeLessThan(0.01);
    expect(lp.revenue - lp.degradation).toBeCloseTo(lp.value, 6);
  });

  it("respeita potência, SoC, balanço de energia e SoC final", async () => {
    const r = await optimizeStorageLP(prices, spec);
    let e = spec.capacityMWh * spec.socInit!;
    r.chargeMW.forEach((c, t) => {
      const d = r.dischargeMW[t];
      expect(c).toBeGreaterThanOrEqual(-1e-9);
      expect(d).toBeLessThanOrEqual(spec.powerMW + 1e-9);
      e += spec.etaCharge * c - d / spec.etaDischarge;
      expect(r.soc[t] * spec.capacityMWh).toBeCloseTo(e, 6);
      expect(Math.min(c, d)).toBeLessThan(1e-6); // sem carga e descarga simultâneas
    });
    expect(r.soc.at(-1)!).toBeGreaterThanOrEqual(0.5 - 1e-9);
  });

  it("limite de ciclos e rampa reduzem o valor sem violar as restrições", async () => {
    const free = await optimizeStorageLP(prices, spec);
    const tight = await optimizeStorageLP(prices, spec, { maxCyclesPerDay: 0.5, rampMW: 0.5 });
    expect(tight.value).toBeLessThanOrEqual(free.value + 1e-6);
    expect(tight.cycles / 3).toBeLessThanOrEqual(0.5 / spec.etaDischarge + 1e-6);
    for (let t = 1; t < prices.length; t++) {
      const net = (x: number) => tight.dischargeMW[x] - tight.chargeMW[x];
      expect(Math.abs(net(t) - net(t - 1))).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });

  it("preço negativo: MILP impede carga e descarga simultâneas", async () => {
    const neg = [-50, -80, -60, 20, 150, 200, 90, -30];
    const r = await optimizeStorageLP(neg, { ...spec, capacityMWh: 2, socInit: 0, socEnd: 0 });
    expect(r.mip).toBe(true);
    r.chargeMW.forEach((c, t) => expect(Math.min(c, r.dischargeMW[t])).toBeLessThan(1e-6));
    expect(r.value).toBeGreaterThan(0);
  });

  it("valor terminal côncavo: guarda energia quando o futuro paga mais", async () => {
    const flat = new Array(24).fill(100);
    const keep = await optimizeStorageLP(flat, { ...spec, socInit: 0, socEnd: 0 }, { terminalValue: [{ mwh: 4, value: 160 }] });
    expect(keep.soc.at(-1)!).toBeCloseTo(1, 6); // compra a 100, vale 160 amanhã
    const sell = await optimizeStorageLP(flat, { ...spec, socInit: 1, socEnd: 0 }, { terminalValue: [{ mwh: 4, value: 50 }] });
    expect(sell.soc.at(-1)!).toBeCloseTo(0, 6); // vende a 100, vale 50 amanhã
  });
});
