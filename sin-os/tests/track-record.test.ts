import { describe, expect, it } from "vitest";
import { auditModels } from "../src/lib/audit/models";
import { appendLog, evaluateTrackRecord, TRACK_MIN_DAYS, type LoggedForecast } from "../src/lib/audit/track-record";
import type { DayMatrix } from "../src/lib/market/brazil";

const flat = (v: number) => new Array(24).fill(v);
const date = (i: number) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);

/** 30 dias: realizado = 100 em todas as horas; ingênuo (ontem/semana) também 100, exceto onde mudamos. */
function matrix(rows: number[][]): DayMatrix {
  return { dates: rows.map((_, i) => date(i)), dows: rows.map((_, i) => new Date(`${date(i)}T12:00:00Z`).getUTCDay()), rows, imputed: [] };
}

const entry = (i: number, over: Partial<LoggedForecast> = {}): LoggedForecast => ({
  date: date(i),
  issuedAt: 0,
  basedOn: date(i - 1),
  point: flat(100),
  lo: flat(90),
  hi: flat(110),
  dayLo: 95,
  dayHi: 105,
  mcLo: 96,
  mcHi: 104,
  ...over,
});

describe("registro das previsões publicadas", () => {
  it("vale a primeira previsão de cada dia e guarda só os últimos dias", () => {
    let items: LoggedForecast[] = [];
    for (let i = 0; i < 5; i++) items = appendLog(items, entry(i), 3) ?? items;
    expect(items.map((x) => x.date)).toEqual([date(2), date(3), date(4)]);
    expect(appendLog(items, entry(4, { point: flat(1) }))).toBeNull();
  });

  it("confere cobertura e erro contra o PLD realizado e o ingênuo", () => {
    const rows = Array.from({ length: 30 }, (_, i) => (i === 20 ? flat(200) : flat(100)));
    const dm = matrix(rows);
    const items = [entry(19), entry(20), entry(21), entry(40)]; // dia 40 ainda não aconteceu
    const tr = evaluateTrackRecord(items, dm);
    expect(tr.days).toBe(3);
    expect(tr.from).toBe(date(19));
    expect(tr.hourCoverage).toBeCloseTo(2 / 3); // dia 20 (200) fora da banda 90–110
    expect(tr.dayCoverage).toBeCloseTo(2 / 3);
    // previsão erra 100 no dia 20; o ingênuo erra 100 no dia 20 (ontem = 100) e no 21 (ontem = 200)
    expect(tr.mae).toBeCloseTo(100 / 3);
    expect(tr.maeNaive).toBeCloseTo(200 / 3);
    expect(tr.rmae).toBeCloseTo(0.5);
  });

  it("dia no piso conta como dentro da faixa (arredondamento da média)", () => {
    const rows = Array.from({ length: 10 }, () => flat(57.31));
    const tr = evaluateTrackRecord([entry(8, { point: flat(57.31), lo: flat(57.31), hi: flat(80), dayLo: 57.31, dayHi: 70 })], matrix(rows));
    expect(tr.dayCoverage).toBe(1);
    expect(tr.hourCoverage).toBe(1);
  });

  it("só entra na nota com dias suficientes", () => {
    const tr = (days: number) => ({ days, from: date(0), to: date(days), mae: 10, maeNaive: 20, rmae: 0.5, hourCoverage: 0.9, dayCoverage: 0.9, mcDayCoverage: 0.8 });
    const base = { now: Date.parse("2026-10-16T15:00:00Z"), forecasts: {}, regimes: {}, bess: null, arbitrage: null, selfEval: null, pld: null, limits: { min: 57.31, maxHourly: 1611.04 }, pldSource: "x" };
    expect(auditModels({ ...base, trackRecords: { SE: tr(TRACK_MIN_DAYS - 1) } }).checks.some((c) => c.id.startsWith("registro."))).toBe(false);
    const a = auditModels({ ...base, trackRecords: { SE: tr(TRACK_MIN_DAYS) } });
    expect(a.checks.find((c) => c.id === "registro.rmae.SE")!.status).toBe("pass");
    expect(a.trackRecord.find((t) => t.sub === "SE")!.days).toBe(TRACK_MIN_DAYS);
  });
});
