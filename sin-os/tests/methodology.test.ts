import { describe, expect, it } from "vitest";
import { AUDIT_THRESHOLDS, CHECK_WEIGHTS } from "@/lib/audit/checks";
import { CHECK_RULES, DATA_DICTIONARY, methodology } from "@/lib/methodology";
import { parsePldRecords } from "@/lib/sources/ccee";
import { VALID_RANGES } from "@/lib/sources/ranges";
import { SOURCES } from "@/lib/sources/registry";

describe("metodologia publicada", () => {
  const m = methodology({ VERCEL_GIT_COMMIT_SHA: "abcdef1234567", VERCEL_GIT_REPO_OWNER: "o", VERCEL_GIT_REPO_SLUG: "r" });

  it("cobre todas as fontes do catálogo com colunas, instante e transformações", () => {
    expect(Object.keys(DATA_DICTIONARY).sort()).toEqual(Object.keys(SOURCES).sort());
    for (const s of m.sources) {
      expect(s.fields.length, s.id).toBeGreaterThan(0);
      expect(s.steps.length, s.id).toBeGreaterThan(0);
      expect(s.time.length, s.id).toBeGreaterThan(0);
      expect(s.version.length, s.id).toBeGreaterThan(0);
    }
  });

  it("publica os mesmos limites que o código aplica", () => {
    expect(Object.values(CHECK_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(CHECK_RULES.map((r) => r.id).sort()).toEqual(Object.keys(CHECK_WEIGHTS).sort());
    expect(m.audit.thresholds).toBe(AUDIT_THRESHOLDS);
    for (const s of m.sources) expect([s.range.min, s.range.max]).toEqual(VALID_RANGES[s.id].range);
    // o parser do PLD usa exatamente a faixa publicada
    const { quality } = parsePldRecords([{ MES_REFERENCIA: "202610", DIA: 1, HORA: 0, SUBMERCADO: "SUDESTE", PLD_HORA: 100 }]);
    expect(quality.range).toEqual(VALID_RANGES.ccee_pld.range);
  });

  it("sobrevive ao JSON (faixa aberta vira null, não Infinity) e aponta o commit", () => {
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
    expect(m.forecast.regimes.reservatorio.map((b) => [b.min, b.max])).toEqual([
      [0, 40],
      [40, 60],
      [60, null],
    ]);
    expect(m.version).toEqual({ commit: "abcdef1", url: "https://github.com/o/r/commit/abcdef1234567" });
    expect(methodology({}).version.commit).toBeNull();
  });
});

describe("política de dados faltantes", () => {
  it("o texto publicado sai das constantes e descreve o que toDayMatrix faz", async () => {
    const { dataPolicy } = await import("@/lib/methodology");
    const { MAX_GAP_DAYS, MAX_GAP_HOURS, toDayMatrix } = await import("@/lib/market/brazil");
    const { brtToUtc } = await import("@/lib/sources/time");
    const p = dataPolicy();
    expect(p.missing[0]).toContain(`até ${MAX_GAP_HOURS} horas`);
    expect(p.missing[1]).toContain(`até ${MAX_GAP_DAYS} dias`);
    expect(p.missing.length + p.invalidation.length + p.revisions.length + p.fallbacks.length).toBeGreaterThan(15);

    // 25/set completo e 4 dias ausentes (26–29/set): quebra, a série recomeça em 30/set.
    // 1º/out com 2 horas faltando (completado); 2/out com 3 faltando (vira dia ausente, imputado);
    // 4–6/out ausentes (3 dias, imputados)
    const days = ["2026-09-25", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-07"];
    const ts: number[] = [];
    const v: (number | null)[] = [];
    for (const d of days) {
      const [y, m, dd] = d.split("-").map(Number);
      for (let h = 0; h < 24; h++) {
        ts.push(brtToUtc(y, m, dd, h));
        const miss = (d === "2026-10-01" && (h === 5 || h === 6)) || (d === "2026-10-02" && h < 3);
        v.push(miss ? null : 100 + h);
      }
    }
    const panel = { ts, unit: "R$/MWh", values: { SE: v, S: v, NE: v, N: v } };
    const dm = toDayMatrix(panel, "SE");
    expect(dm.dates[0]).toBe("2026-09-30");
    expect(dm.rows[dm.dates.indexOf("2026-10-01")][5]).toBe((104 + 107) / 2);
    expect(dm.imputed).toEqual(["2026-10-02", "2026-10-04", "2026-10-05", "2026-10-06"]);
    expect(dm.dates.at(-1)).toBe("2026-10-07");
  });
});
