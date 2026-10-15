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
