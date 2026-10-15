import { describe, expect, it } from "vitest";
import { brtTicks, C, LIGHT_OF, SUB_COLOR, themeOption, themedText, withBrtTicks } from "@/lib/chart";
import { brtHour } from "@/lib/sources/time";

describe("tema dos gráficos", () => {
  it("toda cor da paleta escura tem uma variante clara (sem conflito)", () => {
    for (const s of Object.values(SUB_COLOR)) expect(LIGHT_OF.has(s.toLowerCase())).toBe(true);
    for (const c of [C.ink, C.muted, C.grid, C.tooltip, C.accentSoft, ...C.seq]) expect(LIGHT_OF.get(c.toLowerCase())).toBeDefined();
    // no claro, o texto principal é escuro e a escala sequencial começa clara
    expect(LIGHT_OF.get(C.ink)).toBe("#1d1d1f");
    expect(LIGHT_OF.get(C.seq[0])).toBe("#eaf2fd");
  });

  it("no escuro devolve a própria opção; no claro troca cores e o HTML dos formatters", () => {
    const opt = { color: C.ink, series: [{ itemStyle: { color: SUB_COLOR.SE } }], tooltip: { formatter: () => `<span style="color:${C.muted}">x</span>` } };
    expect(themeOption(opt, "dark")).toBe(opt);
    const light = themeOption(opt, "light");
    expect(light.color).toBe("#1d1d1f");
    expect(light.series[0].itemStyle.color).toBe("#007aff");
    expect(light.tooltip.formatter()).toBe('<span style="color:#6e6e73">x</span>');
    expect(themedText(`a ${C.tooltip} b`)).toBe("a rgba(255,255,255,0.97) b");
  });
});

describe("marcas do eixo de tempo em Brasília", () => {
  const day = (iso: string) => Date.parse(`${iso}T00:00:00-03:00`);

  it("janelas longas: uma marca por meia-noite BRT, no máximo ~8", () => {
    const t = brtTicks(day("2026-10-01") + 5 * 3600_000, day("2026-10-08") + 12 * 3600_000);
    expect(t[0]).toBe(day("2026-10-02"));
    expect(t.every((x) => brtHour(x) === 0)).toBe(true);
    expect(t.length).toBeLessThanOrEqual(8);
    const year = brtTicks(day("2025-10-15"), day("2026-10-15"));
    expect(year.length).toBeLessThanOrEqual(9);
    expect(year.every((x) => brtHour(x) === 0)).toBe(true);
  });

  it("janelas curtas: a cada 6 h a partir da meia-noite BRT", () => {
    const t = brtTicks(day("2026-10-15"), day("2026-10-16"));
    expect(t.map(brtHour)).toEqual([0, 6, 12, 18, 0]);
  });

  it("aplica nos eixos de tempo usando o intervalo dos dados", () => {
    const opt = { xAxis: { type: "time" }, series: [{ data: [[day("2026-10-01"), 1], [day("2026-10-05"), 2]] }] };
    const out = withBrtTicks(opt) as unknown as { xAxis: { axisLabel: { customValues: number[] } } };
    expect(out.xAxis.axisLabel.customValues[0]).toBe(day("2026-10-01"));
    expect(withBrtTicks({ xAxis: { type: "category" } })).toEqual({ xAxis: { type: "category" } });
  });
});
