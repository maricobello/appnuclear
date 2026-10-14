import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, evaluateMarketAlerts, thresholdsFromEnv } from "../src/lib/audit/market-alerts";
import { SUBS, type Sub } from "../src/lib/sources/types";

const flat = (v: number) => new Array(24).fill(v);
const day = (over: Partial<Record<Sub, number[]>> = {}) => ({
  date: "2026-10-15",
  official: false,
  values: { ...(Object.fromEntries(SUBS.map((s) => [s, flat(57.31)])) as Record<Sub, number[]>), ...over },
});
const base = { today: "2026-10-14", curtailDaily: [], baseUrl: "https://x" };

describe("alertas de mercado", () => {
  it("dia todo no piso: nenhum alerta", () => {
    expect(evaluateMarketAlerts({ ...base, day: day() })).toEqual([]);
  });

  it("pico de PLD, descolamento e janela de bateria, com ids estáveis por data", () => {
    const se = flat(60);
    se[19] = 420;
    const a = evaluateMarketAlerts({ ...base, day: day({ SE: se }) });
    expect(a.map((x) => x.id)).toEqual(["pld_max_2026-10-15", "spread_2026-10-15", "intraday_2026-10-15"]);
    expect(a[0].message.title).toContain("amanhã");
    expect(a[0].message.text).toContain("SE: máx R$ 420,00 às 19h");
    expect(a[1].message.title).toBe("Descolamento S→SE de R$ 362,69 amanhã"); // empate no piso: o primeiro mais barato na ordem SE, S, NE, N
    expect(a[2].message.text).toContain("carrega às 0h (R$ 60,00) · descarrega às 19h (R$ 420,00)");
    expect(a.every((x) => x.message.kind === "market")).toBe(true);
  });

  it("corte dispara só acima do múltiplo da mediana E do volume mínimo", () => {
    const hist = [70, 80, 75, 90, 85, 60, 72].map((g, i) => ({ date: `2026-10-0${i + 1}`, mwh: g * 1000 }));
    const quiet = evaluateMarketAlerts({ ...base, day: null, curtailDaily: [...hist, { date: "2026-10-08", mwh: 100_000 }] });
    expect(quiet).toEqual([]); // 100 GWh < 1,5 × 75
    const jump = evaluateMarketAlerts({ ...base, day: null, curtailDaily: [...hist, { date: "2026-10-08", mwh: 190_000 }] });
    expect(jump).toHaveLength(1);
    expect(jump[0].message.title).toBe("Corte de renováveis disparou em 08/10: 190 GWh");
    const small = evaluateMarketAlerts({ ...base, day: null, curtailDaily: [...hist.map((h) => ({ ...h, mwh: h.mwh / 10 })), { date: "2026-10-08", mwh: 30_000 }] });
    expect(small).toEqual([]); // 4× a mediana, mas abaixo de 50 GWh
  });

  it("limiares configuráveis por variável de ambiente, com padrão seguro", () => {
    expect(thresholdsFromEnv({})).toEqual(DEFAULT_THRESHOLDS);
    expect(thresholdsFromEnv({ ALERT_PLD_MAX: "500", ALERT_SPREAD: "abc" })).toMatchObject({ pldMax: 500, spread: 100 });
  });
});
