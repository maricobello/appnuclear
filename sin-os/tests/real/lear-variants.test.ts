import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { parquetReadObjects } from "hyparquet";
import { learBacktest, type LearOptions } from "../../src/lib/quant/lear";
import { dieboldMariano, mae } from "../../src/lib/quant/metrics";
import { capDailyMean, PLD_LIMITS, pldFromCmo, toDayMatrix } from "../../src/lib/market/brazil";
import { brtToUtc } from "../../src/lib/sources/time";
import { SUBS, type Sub, type SubPanel } from "../../src/lib/sources/types";

const DIR = process.env.ONS_DATA_DIR ?? "data/ons";
const N_TEST = Number(process.env.N_TEST ?? 90);
const YEARS = [0, 1, 2].map((k) => new Date().getUTCFullYear() - 2 + k);

function loadPanel(): SubPanel {
  const acc = new Map<number, Partial<Record<Sub, number[]>>>();
  for (const y of YEARS) {
    const lines = readFileSync(`${DIR}/cmo_${y}.csv`, "utf8").trim().split("\n").slice(1);
    for (const ln of lines) {
      const [sub, , din, val] = ln.split(";");
      const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):/.exec(din);
      if (!m) continue;
      const ts = brtToUtc(+m[1], +m[2], +m[3], +m[4]);
      const row = acc.get(ts) ?? {};
      (row[sub as Sub] ??= []).push(Number(val));
      acc.set(ts, row);
    }
  }
  const ts = [...acc.keys()].sort((a, b) => a - b);
  const values = Object.fromEntries(SUBS.map((s) => [s, ts.map((t) => { const v = acc.get(t)?.[s]; return v?.length ? v.reduce((a, b) => a + b, 0) / v.length : null; })])) as SubPanel["values"];
  return { ts, values, unit: "R$/MWh" };
}

async function weekly(): Promise<{ date: string; sub: string; med: number; leve: number; pes: number }[]> {
  const out: { date: string; sub: string; med: number; leve: number; pes: number }[] = [];
  for (const y of YEARS) {
    const buf = readFileSync(`${DIR}/cmo_se_${y}.parquet`);
    const rows = await parquetReadObjects({ file: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
    for (const r of rows as Record<string, unknown>[]) {
      out.push({ date: new Date(r.din_instante as Date).toISOString().slice(0, 10), sub: String(r.id_subsistema), med: Number(r.val_cmomediasemanal), leve: Number(r.val_cmoleve), pes: Number(r.val_cmopesada) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Avaliação fora da amostra do LEAR em dados reais (ONS CMO → PLD pela regra ANEEL).
 * Rode com `npm run eval:real` (baixa os dados). Variantes: VARIANTS=V0_global_90,V1_hourly_90,...
 */
describe.skipIf(!process.env.REAL)("dados reais", () => it("variantes do LEAR: MAE e Diebold–Mariano", async () => {
  const panel = pldFromCmo(loadPanel());
  const wk = await weekly();
  const clip: [number, number] = [PLD_LIMITS.min, PLD_LIMITS.maxHourly];
  const report: Record<string, unknown> = {};
  for (const sub of SUBS) {
    const dm = toDayMatrix(panel, sub);
    // exógena do dia d: última semana operativa com data de referência ≤ d−1 (conhecida na véspera)
    const wkSub = wk.filter((w) => w.sub === sub);
    const exog = dm.dates.map((d) => {
      const prev = new Date(Date.parse(`${d}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10);
      const w = [...wkSub].reverse().find((x) => x.date <= prev);
      return w ? [w.med, w.leve, w.pes].map((v) => Math.min(clip[1], Math.max(clip[0], v))) : [NaN, NaN, NaN];
    });
    const all: Record<string, LearOptions> = {
      V0_global_90: { scaling: "global", calibrationDays: 90 },
      V1_hourly_90: { scaling: "hourly", calibrationDays: 90 },
      V2_global_ens: { scaling: "global", windows: [56, 84, 182, 364] },
      V3_hourly_ens: { scaling: "hourly", windows: [56, 84, 182, 364] },
      V4_global_90_exog: { scaling: "global", calibrationDays: 90, exog },
      V5_best_exog: { scaling: (process.env.BEST_SCALING ?? "global") as "global" | "hourly", windows: [56, 84, 182, 364], exog },
    };
    const pickNames = (process.env.VARIANTS ?? "V0_global_90,V1_hourly_90").split(",");
    const variants = Object.fromEntries(pickNames.map((n) => [n, all[n]]));
    const res: Record<string, { mae: number; rmae: number; dmP: number | null; secs: number }> = {};
    let base: number[] | null = null;
    let naiveMae = 0;
    for (const [name, o] of Object.entries(variants)) {
      const t0 = Date.now();
      const raw = learBacktest(dm.rows, dm.dows, N_TEST, { ...o, clip, post: capDailyMean });
      const ok = raw.dayIndex.map((d) => !dm.imputed.includes(dm.dates[d]));
      const f = <T,>(a: T[]) => a.filter((_, i) => ok[i]);
      const bt = { actuals: f(raw.actuals), forecasts: f(raw.forecasts), naive: f(raw.naive) };
      const dayLoss = bt.actuals.map((a, d) => mae(a, bt.forecasts[d]));
      naiveMae = mae(bt.actuals.flat(), bt.naive.flat());
      const m = mae(bt.actuals.flat(), bt.forecasts.flat());
      res[name] = { mae: m, rmae: m / naiveMae, dmP: base ? dieboldMariano(dayLoss, base).pValue : null, secs: (Date.now() - t0) / 1000 };
      if (!base) base = dayLoss;
      console.log("  ", sub, name, JSON.stringify(res[name]));
    }
    report[sub] = { imputedInTest: dm.imputed.filter((d) => d >= dm.dates[dm.dates.length - N_TEST]).length, firstTestDay: dm.dates[dm.dates.length - N_TEST], lastDay: dm.dates.at(-1), naiveMae, ...res };
    console.log(sub, JSON.stringify(report[sub]));
  }
  writeFileSync(`${DIR}/report-lear.json`, JSON.stringify(report, null, 1));
}, 3_600_000));
