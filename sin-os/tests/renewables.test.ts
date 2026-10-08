import { describe, expect, it } from "vitest";
import fx from "./fixtures/ons-renewables.json";
import {
  balanceRowFrom,
  curtailmentDailyPanel,
  curtailmentSummary,
  curtailmentVsFloor,
  curtRowFrom,
  hourConventionCheck,
  netLoadSummary,
  wallClockToTs,
  type CurtRow,
} from "@/lib/market/renewables";
import { digestSource } from "@/lib/audit/trust";
import { monthsFor } from "@/lib/sources/ons-renewables";
import { brtToUtc } from "@/lib/sources/time";

// Amostra real das bases abertas do ONS (out/2026), gerada a partir dos parquets publicados.
const curtNE: [string, number][] = fx.curtNE as [string, number][];
const balNE: [string, number][] = fx.balNE as [string, number][];

describe("instante do ONS", () => {
  it("parquet grava o relógio de Brasília como UTC: 07:00 'Z' é 07:00 BRT = 10:00 UTC", () => {
    expect(wallClockToTs(new Date("2026-10-01T07:00:00.000Z"))).toBe(Date.UTC(2026, 9, 1, 10, 0));
    expect(wallClockToTs("2026-10-01 07:00:00")).toBe(Date.UTC(2026, 9, 1, 10, 0));
    expect(wallClockToTs("lixo")).toBeNull();
  });
});

describe("curtailment (dados reais)", () => {
  const rows = fx.raw.map((o) => curtRowFrom(o, "eolica")!);

  it("a apurada do ONS é max(0, referência bruta − geração)", () => {
    for (const r of rows) expect(r.apurada).toBeCloseTo(Math.max(0, r.ref! - r.geracao!), 3);
  });

  it("separa o oficial (teto) do limitado à disponibilidade (piso)", () => {
    const now = brtToUtc(2026, 10, 8, 12);
    const s = curtailmentSummary(rows, now, 14);
    const official = rows.reduce((a, r) => a + r.apurada! * 0.5, 0);
    expect(s.totals.eolicaMWh).toBeCloseTo(official, 1);
    // linhas 1 e 4 têm referência acima da disponibilidade
    expect(s.quality.refAboveAvailIntervals).toBe(2);
    const capped = rows.reduce((a, r) => a + Math.max(0, Math.min(r.ref!, r.disp!) - r.geracao!) * 0.5, 0);
    expect(s.totals.cappedMWh).toBeCloseTo(capped, 1);
    expect(s.quality.inflatedMWh).toBeCloseTo(official - capped, 1);
    expect(s.quality.methodMAE).toBeLessThan(0.01);
    // meia hora → MWh = MW × 0,5 e a hora do perfil é a hora de início (BRT)
    expect(s.hourlyProfile.N[11]).toBeGreaterThan(0);
  });

  it("convenção de hora: a meia hora H:MM pertence à hora H (casa com o balanço sem defasagem)", () => {
    const curt: CurtRow[] = curtNE.map(([t, g]) => ({ sub: "NE", tech: "eolica", ts: wallClockToTs(t)!, geracao: g, disp: null, ref: null, refFinal: null, apurada: null, razao: null }));
    const bal = balNE.map(([t, v]) => balanceRowFrom({ id_subsistema: "NE ", din_instante: t, val_gereolica: v })!);
    const c = hourConventionCheck(curt, bal, "NE");
    expect(c.n).toBe(72);
    expect(c.bestLag).toBe(0);
    expect(c.corrByLag["0"]!).toBeGreaterThan(0.99);
    expect(c.ok).toBe(true);
    // deslocar o balanço em 1 h tem que piorar a correlação
    const shifted = bal.map((b) => ({ ...b, ts: b.ts + 3600_000 }));
    expect(hourConventionCheck(curt, shifted, "NE").bestLag).toBe(1);
  });
});

describe("carga líquida (dados reais)", () => {
  const rows = fx.balDay.map((o) => balanceRowFrom(o)).filter((r) => r !== null); // a linha "SIN" (total) é descartada
  const s = netLoadSummary(rows, brtToUtc(2026, 10, 6, 12), 5);

  it("fecha a identidade do balanço: hidro + térmica + eólica + solar − intercâmbio ≈ carga", () => {
    expect(s.quality.hours).toBe(96);
    expect(s.quality.identityBreaks).toBeLessThanOrEqual(2);
  });

  it("perfil do SIN: carga líquida menor que a carga, mínimo de dia (solar) e rampa à noite", () => {
    expect(s.days).toBe(1);
    const { carga, liquida } = s.profile.SIN;
    for (let h = 0; h < 24; h++) expect(liquida[h]).toBeLessThanOrEqual(carga[h]);
    expect(s.minHour).toBeGreaterThanOrEqual(9);
    expect(s.minHour).toBeLessThanOrEqual(15);
    expect(s.eveningRampMW).toBeGreaterThan(5000);
    expect(s.renewableSharePct).toBeGreaterThan(5);
    expect(s.renewableSharePct).toBeLessThan(80);
  });
});

describe("janela de arquivos", () => {
  it("no começo do mês lê também o mês anterior; na virada do ano, o ano anterior", () => {
    expect(monthsFor(brtToUtc(2026, 10, 3, 12), 14)).toEqual([
      { y: 2026, m: 9 },
      { y: 2026, m: 10 },
    ]);
    expect(monthsFor(brtToUtc(2026, 10, 20, 12), 14)).toEqual([{ y: 2026, m: 10 }]);
    expect(new Set(monthsFor(brtToUtc(2027, 1, 5, 12), 14).map((x) => x.y))).toEqual(new Set([2026, 2027]));
  });
});

describe("curtailment × PLD no piso", () => {
  it("conta só horas com corte relevante e PLD conhecido", () => {
    const t0 = brtToUtc(2026, 10, 4, 10);
    const mk = (ts: number, apurada: number): CurtRow => ({ sub: "NE", tech: "solar", ts, geracao: 0, disp: 0, ref: 0, refFinal: 0, apurada, razao: "ENE" });
    const rows = [mk(t0, 200), mk(t0 + 1800_000, 200), mk(t0 + 3600_000, 300), mk(t0 + 7200_000, 10)];
    const nulls = () => [null, null, null];
    const pld = { ts: [t0, t0 + 3600_000, t0 + 7200_000], values: { SE: nulls(), S: nulls(), N: nulls(), NE: [57.31, 120, 57.31] } };
    // hora t0: 200 MWh a 57,31 · t0+1h: 150 MWh a 120 · t0+2h: 5 MWh (abaixo do mínimo, mas entra no valor)
    expect(curtailmentVsFloor(rows, pld, 57.31, "NE")).toEqual({ sub: "NE", hours: 2, atFloor: 1, sharePct: 50, mwhPriced: 355, avgPld: Math.round(((200 * 57.31 + 150 * 120 + 5 * 57.31) / 355) * 100) / 100, valueBRL: Math.round(200 * 57.31 + 150 * 120 + 5 * 57.31) });
  });
});

describe("corte na camada de confiança", () => {
  it("vira painel diário (MWh por submercado) e só fecha o dia com as 48 meias horas", () => {
    const t0 = brtToUtc(2026, 10, 4, 0);
    const rows: CurtRow[] = [];
    for (let k = 0; k < 48; k++) rows.push({ sub: "NE", tech: "eolica", ts: t0 + k * 1800_000, geracao: 100, disp: 200, ref: 150, refFinal: 150, apurada: k === 20 ? 50 : 0, razao: k === 20 ? "ENE" : null });
    rows.push({ sub: "NE", tech: "solar", ts: t0 + 86400_000, geracao: 0, disp: 0, ref: 10, refFinal: 10, apurada: 10, razao: "CNF" }); // dia seguinte incompleto
    const p = curtailmentDailyPanel(rows);
    expect(p.dates).toEqual(["2026-10-04", "2026-10-05"]);
    expect(p.values.NE).toEqual([25, null]);
    expect(p.values.SE).toEqual([0, null]);
    const d = digestSource("ons_curtailment", rows, brtToUtc(2026, 10, 8, 12), 10);
    expect(d.find((x) => x.date === "2026-10-04")).toMatchObject({ expected: 4, present: 4 });
    expect(d.find((x) => x.date === "2026-10-05")).toMatchObject({ present: 0 });
  });
});
