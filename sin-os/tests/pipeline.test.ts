import { describe, expect, it } from "vitest";
import { buildForecast } from "../src/lib/market/forecast";
import { bessArbitrage, euBattery, euBorders, globalLens, submarketSpreads } from "../src/lib/market/arbitrage";
import { PLD_LIMITS, toDayMatrix } from "../src/lib/market/brazil";
import { simEu, simFx, simPld, simUkMid } from "../src/lib/sources/simulate";
import { parseCsv, num } from "../src/lib/sources/csv";
import { subOf } from "../src/lib/sources/ckan";

describe("pipeline completo sobre dados simulados", () => {
  const pld = simPld(120);

  it("matriz dia×hora contígua e dentro dos limites regulatórios", () => {
    const dm = toDayMatrix(pld, "SE");
    expect(dm.rows.length).toBeGreaterThanOrEqual(100);
    for (const r of dm.rows) for (const v of r) {
      expect(v).toBeGreaterThanOrEqual(PLD_LIMITS.min);
      expect(v).toBeLessThanOrEqual(PLD_LIMITS.maxHourly);
    }
  });

  it("previsão: LEAR + ACI + QRA + MC + HMM + GARCH", () => {
    const t0 = Date.now();
    const fc = buildForecast(pld, "SE", 7, 400);
    const ms = Date.now() - t0;
    expect(fc.horizon.lear).toHaveLength(168);
    expect(fc.horizon.mc.p05.every((v, i) => v <= fc.horizon.mc.p95[i] + 1e-9)).toBe(true);
    expect(fc.horizon.qraNextDay.quantiles).toHaveLength(24);
    expect(fc.backtest.days).toBeGreaterThan(5);
    expect(fc.backtest.aci.coverage).toBeGreaterThan(0.6);
    expect(fc.regime?.current.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(fc.paths.length).toBe(400);
    expect(ms).toBeLessThan(20_000);

    const bess = bessArbitrage(fc);
    expect(bess.intrinsicRS).toBeGreaterThan(0);
    expect(bess.perfectForesightRS).toBeGreaterThanOrEqual(bess.intrinsicRS - 1e-6);
    expect(bess.risk.cvar95).toBeGreaterThanOrEqual(bess.risk.var95 - 1e-6);
  });

  it("spreads entre submercados, bateria europeia, fronteiras e lente global", () => {
    const spreads = submarketSpreads(pld, 30);
    expect(spreads).toHaveLength(6);
    const eu = simEu(7);
    const bat = euBattery(eu);
    expect(bat.length).toBeGreaterThan(5);
    expect(bat[0].bessEurPerMWDay).toBeGreaterThan(0);
    expect(euBorders(eu).length).toBeGreaterThan(3);
    const lens = globalLens(pld, eu, simUkMid(2), simFx());
    expect(lens.find((l) => l.market === "PLD SE")).toBeTruthy();
  });
});

describe("parsers", () => {
  it("CSV ONS com ';' e aspas", () => {
    const { header, rows } = parseCsv('id_subsistema;nom_subsistema;din_instante;val_cmo\r\nSE;"SUDESTE";2026-09-24 00:00:00;312.5\nNE;NORDESTE;2026-09-24 00:30:00;57.31\n');
    expect(header).toEqual(["id_subsistema", "nom_subsistema", "din_instante", "val_cmo"]);
    expect(rows).toHaveLength(2);
    expect(rows[0][1]).toBe("SUDESTE");
  });

  it("números BR/US e submercados", () => {
    expect(num("1.234,56")).toBeCloseTo(1234.56);
    expect(num("1,234.56")).toBeCloseTo(1234.56);
    expect(num("57,31")).toBeCloseTo(57.31);
    expect(num("312.5")).toBeCloseTo(312.5);
    expect(subOf("SUDESTE")).toBe("SE");
    expect(subOf("Nordeste")).toBe("NE");
    expect(subOf("N")).toBe("N");
    expect(subOf("SUL")).toBe("S");
  });
});
