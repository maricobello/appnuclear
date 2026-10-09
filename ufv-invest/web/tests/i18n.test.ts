import { describe, expect, it } from "vitest";
import { interpolate, LOCALES, matchLocale } from "@/i18n/config";
import { getDict } from "@/i18n/dicts";
import { makeFmt } from "@/lib/fmt";

function leaves(o: unknown, prefix = ""): [string, string][] {
  if (typeof o === "string") return [[prefix, o]];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

describe("i18n", () => {
  const pt = leaves(getDict("pt"));
  const keys = pt.map(([k]) => k).sort();

  it.each(LOCALES)("%s tem todas as chaves, sem texto vazio e com os mesmos marcadores", (l) => {
    const dict = leaves(getDict(l));
    expect(dict.map(([k]) => k).sort()).toEqual(keys);
    const ptMap = new Map(pt);
    for (const [k, v] of dict) {
      expect(v.trim().length, k).toBeGreaterThan(0);
      const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(vars(v), `${l}:${k}`).toEqual(vars(ptMap.get(k)!));
    }
  });

  it("escolhe o idioma pelo Accept-Language", () => {
    expect(matchLocale("en-US,en;q=0.9")).toBe("en");
    expect(matchLocale("de-CH, fr;q=0.8")).toBe("de");
    expect(matchLocale("ru-RU, es;q=0.5")).toBe("es");
    expect(matchLocale("zh-TW")).toBe("zh");
    expect(matchLocale("ko-KR")).toBe("pt");
    expect(matchLocale(null)).toBe("pt");
    expect(matchLocale("fr;q=0.2, ja;q=0.9")).toBe("ja");
  });

  it("interpola marcadores", () => {
    expect(interpolate("{n} de {t}", { n: 3, t: 10 })).toBe("3 de 10");
    expect(interpolate("sem {x}")).toBe("sem {x}");
  });

  it("formata números e reais no padrão de cada idioma", () => {
    expect(makeFmt("pt").brl(1000, 0)).toMatch(/R\$\s?1\.000/);
    expect(makeFmt("en").brl(1000, 0)).toMatch(/R\$\s?1,000/);
    expect(makeFmt("de").num(1234.5, 1)).toBe("1.234,5");
    expect(makeFmt("en").pct(20, 1)).toBe("20.0%");
    expect(makeFmt("pt").pct(20, 1)).toBe("20,0%");
    expect(makeFmt("en").years(6.5)).toBe("6 years 6 months");
    expect(makeFmt("pt").nYears(1)).toBe("1 ano");
    expect(makeFmt("ja").months).toHaveLength(12);
  });
});
