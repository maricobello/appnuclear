import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { buildForecast } from "../../src/lib/market/forecast";
import { bessArbitrage } from "../../src/lib/market/arbitrage";
import { pldFromCmo, toDayMatrix } from "../../src/lib/market/brazil";
import { brtToUtc } from "../../src/lib/sources/time";
import { SUBS, type Sub, type SubPanel } from "../../src/lib/sources/types";

const DIR = process.env.ONS_DATA_DIR ?? "data/ons";
function loadPanel(): SubPanel {
  const acc = new Map<number, Partial<Record<Sub, number[]>>>();
  for (const y of [1, 0].map((k) => new Date().getUTCFullYear() - k)) {
    for (const ln of readFileSync(`${DIR}/cmo_${y}.csv`, "utf8").trim().split("\n").slice(1)) {
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

/**
 * Simula a produção no passado: em 20 origens históricas roda a previsão completa só com
 * os dados até aquela data e mede a cobertura das bandas D+1…D+7 contra o realizado.
 */
describe.skipIf(!process.env.REAL)("dados reais", () => it("cobertura fora da amostra das bandas D+1…D+7", async () => {
  const full = pldFromCmo(loadPanel());
  const subs = (process.env.SUBS ?? "SE,N").split(",") as Sub[];
  for (const sub of subs) {
    const dmFull = toDayMatrix(full, sub);
    const truth = new Map(dmFull.dates.map((d, i) => [d, dmFull.rows[i]]));
    const imputed = new Set(dmFull.imputed);
    const cov = Array.from({ length: 7 }, () => ({ aci: 0, mc: 0, n: 0 }));
    let extr = 0, intr = 0, nb = 0;
    const origins = Array.from({ length: 20 }, (_, i) => dmFull.dates.length - 8 - i * 4);
    for (const oi of origins) {
      const cutoff = Date.parse(`${dmFull.dates[oi]}T23:59:00-03:00`);
      const n = full.ts.findIndex((t) => t > cutoff);
      const panel: SubPanel = { ts: full.ts.slice(0, n), unit: full.unit, values: Object.fromEntries(SUBS.map((s) => [s, full.values[s].slice(0, n)])) as SubPanel["values"] };
      const fc = buildForecast(panel, sub, 7, 400);
      fc.horizon.ts.forEach((t, j) => {
        const k = Math.floor(j / 24);
        const date = new Date(t - 3 * 3600_000).toISOString().slice(0, 10);
        const row = truth.get(date);
        if (!row || imputed.has(date)) return;
        const a = row[j % 24];
        cov[k].n++;
        if (a >= fc.horizon.aciLo[j] && a <= fc.horizon.aciHi[j]) cov[k].aci++;
        if (a >= fc.horizon.mc.p05[j] && a <= fc.horizon.mc.p95[j]) cov[k].mc++;
      });
      if (oi === origins[0] || oi === origins[10]) {
        const b = await bessArbitrage(fc);
        extr += b.extrinsicRS; intr += b.intrinsicRS; nb++;
        console.log(sub, dmFull.dates[oi], "MRJD:", fc.mrjd?.calibratedOn, "spread por horizonte:", fc.backtest.horizonErrors.map((h) => h.spread.toFixed(2)).join(" "), "MAE por horizonte:", fc.backtest.horizonErrors.map((h) => (h.mae ?? NaN).toFixed(1)).join(" "));
      }
    }
    console.log(sub, "cobertura ACI 90% por horizonte:", cov.map((c) => (c.aci / c.n).toFixed(3)).join(" "));
    console.log(sub, "cobertura MC 5–95% por horizonte:", cov.map((c) => (c.mc / c.n).toFixed(3)).join(" "));
    console.log(sub, "opcionalidade / intrínseco:", (extr / intr).toFixed(3), "(", nb, "avaliações )");
  }
}, 3_600_000));
