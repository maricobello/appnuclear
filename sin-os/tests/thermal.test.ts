import { describe, expect, it } from "vitest";
import { cvuLookup, cvuRowFrom, essOf, thermalReport, thermalRowFrom, type CvuRow, type ThermalRow } from "@/lib/market/thermal";
import { brtToUtc } from "@/lib/sources/time";
import type { SubPanel } from "@/lib/sources/types";

const reasons = (o: Partial<ThermalRow["reasons"]> = {}): ThermalRow["reasons"] => ({ merit: 0, inflex: 0, uc: 0, electric: 0, security: 0, gfom: 0, reserve: 0, losses: 0, gsub: 0, export: 0, ...o });

describe("despacho térmico por motivo (ONS)", () => {
  it("lê a linha do parquet com números em texto e as duas grafias do combustível", () => {
    const r = thermalRowFrom({
      din_instante: new Date(Date.UTC(2026, 9, 15, 19)),
      id_subsistema: "NE",
      nom_usina: " Porto de Sergipe I ",
      cod_usinaplanejamento: 87,
      nom_tipocombustivel: "Gás",
      val_verifgeracao: "1037.167",
      val_verifordemmerito: "0.000",
      val_verifunitcommitment: "1037.167",
      val_verifconstrainedoff: "-12.5",
      val_progdisponibilidade: "1500.000",
    })!;
    expect(r).toMatchObject({ ts: brtToUtc(2026, 10, 15, 19), sub: "NE", code: 87, name: "Porto de Sergipe I", fuel: "Gás", gen: 1037.167, off: 12.5, avail: 1500 });
    expect(r.reasons.uc).toBe(1037.167);
    expect(thermalRowFrom({ din_instante: "x", id_subsistema: "NE", cod_usinaplanejamento: 1 })).toBeNull();
  });

  it("CVU da semana operativa que contém o dia", () => {
    const rows = [
      { dat_iniciosemana: new Date(Date.UTC(2026, 9, 10)), dat_fimsemana: new Date(Date.UTC(2026, 9, 16)), cod_usinaplanejamento: 87, id_subsistema: "NE", nom_usina: "PSE", val_cvu: 315.46, nom_semanaoperativa: "PMO Outubro 2026 - Revisão 2" },
      { dat_iniciosemana: new Date(Date.UTC(2026, 9, 17)), dat_fimsemana: new Date(Date.UTC(2026, 9, 23)), cod_usinaplanejamento: 87, id_subsistema: "NE", nom_usina: "PSE", val_cvu: 320.1, nom_semanaoperativa: "PMO Outubro 2026 - Revisão 3" },
    ].map(cvuRowFrom) as CvuRow[];
    const at = cvuLookup(rows);
    expect(at(87, "2026-10-16")?.cvu).toBe(315.46);
    expect(at(87, "2026-10-17")?.cvu).toBe(320.1);
    expect(at(87, "2026-10-24")).toBeNull();
    expect(at(99, "2026-10-16")).toBeNull();
  });

  it("ESS: (CVU − PLD) fora do mérito, (PLD − CVU) no constrained-off, nada para CVU nulo ou sem PLD", () => {
    const r: ThermalRow = { ts: 0, sub: "SE", code: 1, name: "X", fuel: "Gás", gen: 30, reasons: reasons({ uc: 10, electric: 5, security: 15 }), off: 4, avail: 100 };
    expect(essOf(r, 300, 100)).toEqual({ uc: 2000, electric: 1000, security: 3000, off: 0 });
    expect(essOf(r, 300, 400)).toEqual({ uc: 0, electric: 0, security: 0, off: 400 });
    expect(essOf(r, 0, 100)).toEqual({ uc: 0, electric: 0, security: 0, off: 0 });
    expect(essOf(r, 300, null)).toEqual({ uc: 0, electric: 0, security: 0, off: 0 });
  });

  it("relatório: só dias fechados, identidade, ESS, pilha de mérito com térmica marginal e próxima", () => {
    const day = (d: number, hours: number) => Array.from({ length: hours }, (_, h) => brtToUtc(2026, 10, d, h));
    const rows: ThermalRow[] = [];
    for (const ts of [...day(14, 24), ...day(15, 24), ...day(16, 10)]) {
      rows.push({ ts, sub: "SE", code: 1, name: "Barata", fuel: "Gás", gen: 500, reasons: reasons({ merit: 500 }), off: 0, avail: 600 });
      rows.push({ ts, sub: "SE", code: 2, name: "Cara", fuel: "Óleo", gen: 100, reasons: reasons({ uc: 100 }), off: 0, avail: 300 });
      rows.push({ ts, sub: "SE", code: 3, name: "Parada", fuel: "Diesel", gen: 0, reasons: reasons(), off: 0, avail: 200 });
    }
    const week = (code: number, cvu: number): CvuRow => ({ from: "2026-10-10", to: "2026-10-16", code, sub: "SE", name: String(code), cvu, study: "PMO" });
    const cvus = [week(1, 150), week(2, 600), week(3, 900)];
    const ts = [...new Set(rows.map((r) => r.ts))].sort((a, b) => a - b);
    const flat = (v: number): SubPanel => ({ ts, unit: "R$/MWh", values: { SE: ts.map(() => v), S: ts.map(() => v), NE: ts.map(() => v), N: ts.map(() => v) } });
    const r = thermalReport(rows, cvus, flat(200), flat(250), 7);
    expect(r.days.map((d) => d.date)).toEqual(["2026-10-14", "2026-10-15"]); // 16/out tem 10 horas
    expect(r.checks.identityMaxGap).toBe(0);
    expect(r.checks.cvuCoverage).toBe(1);
    expect(r.checks.pldCoverage).toBe(1);
    // unit commitment: (600 − 200) × 100 MW × 48 h
    expect(r.totals.ess.uc).toBe(400 * 100 * 48);
    expect(r.totals.oomShare).toBeCloseTo(100 / 600, 10);
    const se = r.merit.find((m) => m.sub === "SE")!;
    expect(se.steps.map((s) => s.name)).toEqual(["Barata", "Cara", "Parada"]);
    expect(se.marginal).toEqual({ name: "Barata", cvu: 150 });
    expect(se.meritAboveCmo).toBe(0);
    expect(se.next).toEqual({ name: "Cara", cvu: 600, gapToCmo: 350 });
    expect(r.plants[0]).toMatchObject({ name: "Cara", mwh: { uc: 4800 } });
  });
});

describe("pilha de mérito", () => {
  it("térmica marginal pelo preço; mérito acima do CMO fica separado", () => {
    const ts = Array.from({ length: 24 }, (_, h) => brtToUtc(2026, 10, 15, h));
    const rows: ThermalRow[] = ts.flatMap((t) => [
      { ts: t, sub: "N" as const, code: 1, name: "Abaixo", fuel: "Gás", gen: 200, reasons: reasons({ merit: 200 }), off: 0, avail: 200 },
      { ts: t, sub: "N" as const, code: 2, name: "AcimaDoCmo", fuel: "Óleo", gen: 80, reasons: reasons({ merit: 80 }), off: 0, avail: 80 },
    ]);
    const cvus: CvuRow[] = [
      { from: "2026-10-10", to: "2026-10-16", code: 1, sub: "N", name: "1", cvu: 400, study: "PMO" },
      { from: "2026-10-10", to: "2026-10-16", code: 2, sub: "N", name: "2", cvu: 2000, study: "PMO" },
    ];
    const cmo: SubPanel = { ts, unit: "R$/MWh", values: { SE: ts.map(() => 1400), S: ts.map(() => 1400), NE: ts.map(() => 1400), N: ts.map(() => 1400) } };
    const n = thermalReport(rows, cvus, null, cmo, 7).merit.find((m) => m.sub === "N")!;
    expect(n.marginal).toEqual({ name: "Abaixo", cvu: 400 });
    expect(n.meritAboveCmo).toBe(80);
  });
});
