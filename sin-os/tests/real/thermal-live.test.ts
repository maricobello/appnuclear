import { describe, expect, it } from "vitest";
import { CCEE_VALIDATION, cvuRowFrom, THERMAL_COLUMNS, thermalReport, thermalRowFrom, type ThermalRow } from "@/lib/market/thermal";
import { wallClockToTs } from "@/lib/market/renewables";
import { ONS_S3 } from "@/lib/sources/ons";
import { readParquet } from "@/lib/sources/ons-renewables";
import { cvuUrl, fetchThermal, thermalUrl } from "@/lib/sources/ons-thermal";
import { SUBS, type Sub, type SubPanel } from "@/lib/sources/types";

const LIM_2025 = { min: 58.6, max: 1542.23 };

/** PLD 2025 pelo CMO semi-horário do ONS: média da hora limitada ao piso e ao teto (como nos boletins). */
async function pld2025(): Promise<SubPanel> {
  const { rows } = await readParquet(`${ONS_S3}/cmo_tm/CMO_SEMIHORARIO_2025.parquet`);
  const acc = new Map<string, { s: number; n: number }>();
  for (const o of rows) {
    const t = wallClockToTs(o.din_instante);
    const sub = String(o.id_subsistema ?? "").trim() as Sub;
    if (t === null || !SUBS.includes(sub)) continue;
    const h = t - (t % 3600_000);
    const k = `${sub}|${h}`;
    const a = acc.get(k) ?? { s: 0, n: 0 };
    a.s += Number(o.val_cmo);
    a.n++;
    acc.set(k, a);
  }
  const ts = [...new Set([...acc.keys()].map((k) => Number(k.split("|")[1])))].sort((a, b) => a - b);
  const values = Object.fromEntries(SUBS.map((s) => [s, ts.map((t) => { const a = acc.get(`${s}|${t}`); return a ? Math.min(LIM_2025.max, Math.max(LIM_2025.min, a.s / a.n)) : null; })])) as SubPanel["values"];
  return { ts, values, unit: "R$/MWh" };
}

describe.skipIf(!process.env.REAL)("dados reais — térmicas e ESS", () => {
  it("reproduz a estimativa validada contra os boletins InfoPLD da CCEE", async () => {
    const pld = await pld2025();
    const { rows: cvRaw } = await readParquet(cvuUrl(2025));
    const cvus = cvRaw.map(cvuRowFrom).filter((x) => x !== null);
    for (const v of CCEE_VALIDATION) {
      const [y, m] = v.week.from.split("-").map(Number);
      const { rows: raw } = await readParquet(thermalUrl(y, m), THERMAL_COLUMNS);
      const from = wallClockToTs(`${v.week.from} 00:00`)!;
      const to = wallClockToTs(`${v.week.to} 23:59`)!;
      const rows = raw.map(thermalRowFrom).filter((x): x is ThermalRow => !!x && x.ts >= from && x.ts <= to);
      const r = thermalReport(rows, cvus, pld, null, 7);
      const uc = r.totals.ess.uc / 1e6;
      const off = r.totals.ess.off / 1e6;
      console.log(v.bulletin, { uc: uc.toFixed(2), off: off.toFixed(2), ccee: v.ccee, gap: r.checks.identityMaxGap, cvu: r.checks.cvuCoverage });
      expect(r.days).toHaveLength(7);
      // mesma conta do script de validação (Python) e do que a tela publica
      expect(uc).toBeCloseTo(v.model.uc, 1);
      expect(off).toBeCloseTo(v.model.off, 1);
      // contra a CCEE: unit commitment dentro de 10%, constrained-off dentro de 40%
      expect(Math.abs(uc / v.ccee.uc - 1)).toBeLessThan(0.1);
      expect(Math.abs(off / v.ccee.off - 1)).toBeLessThan(0.4);
      expect(r.checks.identityMaxGap!).toBeLessThan(0.01);
    }
  }, 240_000);

  it("janela atual: soma dos motivos fecha e toda geração tem CVU", async () => {
    const r = await fetchThermal(10);
    expect(r.ok, r.error).toBe(true);
    const rep = thermalReport(r.data!.rows, r.data!.cvus, null, null, 7);
    console.log({ from: rep.from, to: rep.to, gen: Math.round(rep.totals.gen), oom: rep.totals.oomShare, checks: rep.checks, merit: rep.merit.map((m) => [m.sub, m.steps.length, m.marginal?.name]) });
    expect(rep.checks.identityMaxGap!).toBeLessThan(0.01);
    expect(rep.checks.cvuCoverage!).toBeGreaterThan(0.99);
  }, 240_000);
});
