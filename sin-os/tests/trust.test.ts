import { describe, expect, it } from "vitest";
import { closedDates, completeness, diffDigest, digestDaily, digestHourly, digestSource, sealOf } from "../src/lib/audit/trust";
import { brtToUtc } from "../src/lib/sources/time";
import { SUBS, type DailySubPanel, type Sub, type SubPanel } from "../src/lib/sources/types";

const NOW = brtToUtc(2026, 10, 8, 12, 0);

function hourly(days: string[], f: (d: number, h: number, k: number) => number | null, hours = 24): SubPanel {
  const ts: number[] = [];
  const values = Object.fromEntries(SUBS.map((s) => [s, [] as (number | null)[]])) as Record<Sub, (number | null)[]>;
  days.forEach((d, di) => {
    const [y, m, dd] = d.split("-").map(Number);
    for (let h = 0; h < (di === days.length - 1 ? hours : 24); h++) {
      ts.push(brtToUtc(y, m, dd, h));
      SUBS.forEach((s, k) => values[s].push(f(di, h, k)));
    }
  });
  return { ts, values, unit: "MW" };
}

describe("camada de confiança", () => {
  it("datas fechadas excluem hoje", () => {
    expect(closedDates(NOW, 3)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
  });

  it("impressão digital do dia: completa, determinística e sensível a centavos", () => {
    const days = ["2026-10-06", "2026-10-07"];
    const a = digestHourly("ons_carga", hourly(days, (_d, h) => 1000 + h), days);
    const b = digestHourly("ons_carga", hourly(days, (_d, h) => 1000 + h), days);
    expect(a).toHaveLength(2);
    expect(a[0].present).toBe(96);
    expect(a[0].hash).toBe(b[0].hash);
    const c = digestHourly("ons_carga", hourly(days, (d, h) => 1000 + h + (d === 0 && h === 5 ? 0.02 : 0)), days);
    expect(c[0].hash).not.toBe(a[0].hash);
    expect(c[1].hash).toBe(a[1].hash);
  });

  it("revisão retroativa: conta pontos, maior mudança absoluta/relativa e deslocamento da média", () => {
    const days = ["2026-10-07"];
    const old = digestHourly("ons_cmo", hourly(days, () => 100), days)[0];
    const novo = digestHourly("ons_cmo", hourly(days, (_d, h, k) => (h === 18 && k === 0 ? 150 : 100)), days)[0];
    const rev = diffDigest(old, novo, NOW)!;
    expect(rev.changedPoints).toBe(1);
    expect(rev.maxAbsDiff).toBe(50);
    expect(rev.maxRelDiff).toBe(0.5);
    expect(rev.meanShift).toBeCloseTo(50 / 96, 2);
    expect(diffDigest(old, old, NOW)).toBeNull();
  });

  it("dia que perdeu pontos não é revisão (é lacuna); ponto que apareceu depois conta como preenchimento tardio", () => {
    const days = ["2026-10-07"];
    const full = digestHourly("ons_carga", hourly(days, () => 500), days)[0];
    const holes = digestHourly("ons_carga", hourly(days, (_d, h) => (h === 3 ? null : 500)), days)[0];
    expect(diffDigest(full, holes, NOW)).toBeNull();
    const late = diffDigest(holes, full, NOW)!;
    expect(late.changedPoints).toBe(4);
    expect(late.maxAbsDiff).toBe(0);
  });

  it("séries diárias (EAR/ENA)", () => {
    const p: DailySubPanel = { dates: ["2026-10-06", "2026-10-07"], values: { SE: [50, 51], S: [60, 61], NE: [40, 41], N: [70, 71] }, unit: "%" };
    const d = digestDaily("ons_ear", p, ["2026-10-06", "2026-10-07", "2026-10-08"]);
    expect(d.map((x) => x.date)).toEqual(["2026-10-06", "2026-10-07"]);
    expect(d[0].values).toEqual([50, 60, 40, 70]);
    const revised = digestDaily("ons_ear", { ...p, values: { ...p.values, SE: [50, 52] } }, ["2026-10-07"])[0];
    expect(diffDigest(d[1], revised, NOW)?.maxAbsDiff).toBe(1);
    expect(digestSource("ons_ena", null, NOW)).toEqual([]);
  });

  it("selo: alta sem problemas; média com lacuna; baixa com revisão grande", () => {
    const dates = ["2026-10-05", "2026-10-06", "2026-10-07"];
    const days = ["2026-10-05", "2026-10-07"]; // falta 06
    const comp = completeness(digestHourly("ons_carga", hourly(days, () => 1), days), dates, "ons_carga");
    expect(comp.incomplete).toEqual(["2026-10-06"]);
    expect(sealOf("ons_carga", [], { ...comp, incomplete: [], completeDays: 3 }).level).toBe("alta");
    expect(sealOf("ons_carga", [], comp).level).toBe("média");
    const old = digestHourly("ons_carga", hourly(["2026-10-07"], () => 100), ["2026-10-07"])[0];
    const novo = digestHourly("ons_carga", hourly(["2026-10-07"], () => 130), ["2026-10-07"])[0];
    const big = diffDigest(old, novo, NOW)!;
    const seal = sealOf("ons_carga", [big], null);
    expect(seal.level).toBe("baixa");
    expect(seal.reasons[0]).toContain("30%");
  });
});
