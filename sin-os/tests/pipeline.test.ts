import { describe, expect, it } from "vitest";
import { buildForecast } from "../src/lib/market/forecast";
import { bessArbitrage, euBattery, euBorders, globalLens, submarketSpreads } from "../src/lib/market/arbitrage";
import { PLD_LIMITS, pldFromCmo, toDayMatrix } from "../src/lib/market/brazil";
import { brtToUtc } from "../src/lib/sources/time";
import { SUBS, type SubPanel } from "../src/lib/sources/types";
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

describe("PLD pela regra da ANEEL a partir do CMO", () => {
  const { min, maxStructural, maxHourly } = PLD_LIMITS;
  // dia 1: escassez (média acima do teto estrutural); dia 2: sobra (abaixo do piso); dia 3: só 6 horas
  const ts = [...Array.from({ length: 48 }, (_, h) => brtToUtc(2026, 9, 1, 0) + h * 3600_000), ...Array.from({ length: 6 }, (_, h) => brtToUtc(2026, 9, 3, h))];
  const cmoAt = (i: number) => (i < 24 ? (i >= 17 && i <= 21 ? 2500 : 700 + 10 * i) : i < 48 ? 5 : 3000);
  const cmo: SubPanel = { ts, unit: "R$/MWh", values: Object.fromEntries(SUBS.map((s) => [s, ts.map((_, i) => cmoAt(i))])) as SubPanel["values"] };
  const pld = pldFromCmo(cmo).values.SE as number[];

  it("limita a média diária ao PLD máximo estrutural mantendo o perfil e o piso", () => {
    const day1 = pld.slice(0, 24);
    expect(day1.reduce((a, b) => a + b, 0) / 24).toBeCloseTo(maxStructural, 6);
    expect(Math.max(...day1)).toBeLessThanOrEqual(maxHourly);
    expect(Math.min(...day1)).toBeGreaterThanOrEqual(min);
    for (let h = 1; h < 24; h++) expect(Math.sign(day1[h] - day1[h - 1])).toBe(Math.sign(Math.min(maxHourly, cmoAt(h)) - Math.min(maxHourly, cmoAt(h - 1))));
  });

  it("aplica o piso e não mexe em dias incompletos além do teto horário", () => {
    expect(pld.slice(24, 48).every((v) => v === min)).toBe(true);
    expect(pld.slice(48).every((v) => v === maxHourly)).toBe(true);
  });
});
