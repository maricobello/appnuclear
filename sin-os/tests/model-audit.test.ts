import { describe, expect, it } from "vitest";
import { auditModels, type ModelAuditInput } from "../src/lib/audit/models";
import type { ForecastResult } from "../src/lib/market/forecast";
import type { RegimeBacktestResult } from "../src/lib/market/regime-backtest";

const NOW = Date.parse("2026-10-16T15:00:00Z");

function forecast(over: Partial<ForecastResult["backtest"]> = {}, extra: Partial<ForecastResult> = {}): ForecastResult {
  return {
    lastObservedDate: "2026-10-15",
    warnings: [],
    backtest: {
      days: 60,
      maeModel: 42,
      maeLear: 45,
      maeNaive: 50,
      rmae: 0.84,
      rmaeLear: 0.9,
      dmVsLear: { statistic: -1, pValue: 0.2 },
      smape: 0.1,
      rmse: 60,
      dm: { statistic: -2.5, pValue: 0.01 },
      aci: { coverage: 0.89, halfWidth: 40, alpha: 0.1, kupiecP: 0.3, deff: 1.5, christoffersenP: 0.4, pi01: 0.1, pi11: 0.12 },
      qraCrps: 20,
      qraCoverage90: 0.88,
      horizonErrors: [
        { day: 1, mae: 30, n: 60, spread: 1 },
        { day: 7, mae: 55, n: 60, spread: 1.6 },
      ],
      regimeMae: { floor: 5, offFloor: 60, floorShare: 0.4 },
      ...over,
    },
    garch: { dailyVolPct: 12, forecastVolPct: [12], persistence: 0.93, halfLifeDays: 9, alpha: 0.1, beta: 0.83, n: 300 },
    mrjd: {
      kappaPerHour: 0.05,
      halfLifeHours: 14,
      sigma: 0.2,
      jumpsPerDay: 0.4,
      jumpMean: 0.1,
      jumpSd: 0.3,
      dayLevelSd: 0.1,
      dayPhi: 0.6,
      calibratedOn: "resíduos do backtest (marginais empíricas + dependência de dois fatores)",
      fit: { dayQTarget: 40, dayQSim: 42, tvReal: 300, tvSim: 320, depReal: 0.5, depSim: 0.55 },
    },
    regime: { labels: ["Piso", "Base", "Pico"], meansRS: [60, 150, 600], current: [0.1, 0.7, 0.2], in24h: [0.1, 0.7, 0.2], in7d: [0.2, 0.6, 0.2], transition: [[0.9, 0.1, 0], [0.05, 0.9, 0.05], [0, 0.2, 0.8]], durationsH: [10, 10, 5], recentPath: [1, 1] },
    dataQuality: { windowDays: 90, imputedDays: 1, recentImputed: ["2026-09-05"] },
    ...extra,
  } as unknown as ForecastResult;
}

/** `worst` vai num regime conhecido antes de prever; a faixa do PLD realizado (piso) fica sempre pior. */
const regime = (overall: number, worst: number, p = 0.01): RegimeBacktestResult =>
  ({
    sub: "SE",
    from: "2025-10-15",
    to: "2026-10-14",
    days: 365,
    method: "walk-forward",
    overall: { group: "estacao", key: "total", label: "Todos", hours: 8760, maeModel: 1, maeNaive: 1, rmae: overall, smallSample: false },
    dm: { statistic: -3, pValue: p },
    buckets: [
      { group: "estacao", key: "seco", label: "Período seco", hours: 5000, maeModel: 1, maeNaive: 1, rmae: worst, smallSample: false },
      { group: "piso_recente", key: "piso_sim", label: "Piso recente", hours: 2000, maeModel: 1, maeNaive: 1, rmae: 0.99, smallSample: false },
      { group: "faixa_pld", key: "piso", label: "PLD no piso", hours: 3000, maeModel: 1, maeNaive: 1, rmae: 1.45, smallSample: false },
      { group: "reservatorio", key: "raro", label: "Raro", hours: 10, maeModel: 1, maeNaive: 1, rmae: 9, smallSample: true },
    ],
  }) as unknown as RegimeBacktestResult;

function input(over: Partial<ModelAuditInput> = {}): ModelAuditInput {
  const f = forecast();
  return {
    now: NOW,
    forecasts: { SE: f, S: f, NE: f, N: f },
    regimes: { SE: regime(0.9, 1.02) },
    bess: { days: [{ date: "2026-10-14", revenue: 100, naive: 80, chargedMWh: 1, dischargedMWh: 1, cycles: 1, opHours: 8, spread: 100, imputed: false }], maxCycles: 1 },
    arbitrage: { captureRatio: 0.7 },
    selfEval: { precisionMacro: 1, recallMacro: 0.95, total: 14 },
    pld: { ts: [Date.parse("2026-10-14T12:00:00-03:00")], values: { SE: [100], S: [100], NE: [100], N: [100] } },
    limits: { min: 57.31, maxHourly: 1611.04 },
    pldSource: "PLD estimado pelo CMO",
    ...over,
  };
}

const byId = (a: ReturnType<typeof auditModels>, id: string) => a.checks.find((c) => c.id === id)!;

describe("auditoria dos modelos", () => {
  it("modelo bom em dados bons passa em tudo", () => {
    const a = auditModels(input());
    expect(a.counts.fail).toBe(0);
    expect(a.counts.warn).toBe(0);
    for (const id of ["prev.rmae.SE", "banda.cob.SE", "mrjd.SE", "garch.SE", "dados.lacunas.SE", "regime.geral.SE", "regime.pior.SE", "bess.otimo"]) expect(byId(a, id).status).toBe("pass");
    expect(a.score).toBe(100);
  });

  it("perder do ingênuo de forma significativa, banda descalibrada e erros agrupados reprovam", () => {
    const bad = forecast({ rmae: 1.1, dm: { statistic: 2, pValue: 0.98 }, aci: { coverage: 0.75, halfWidth: 1, alpha: 0.1, kupiecP: 0.001, deff: 1, christoffersenP: 0.002, pi01: 0.05, pi11: 0.4 } });
    const a = auditModels(input({ forecasts: { SE: bad } }));
    for (const id of ["prev.rmae.SE", "banda.cob.SE", "banda.kupiec.SE", "banda.chr.SE"]) expect(byId(a, id).status).toBe("fail");
    expect(byId(a, "banda.chr.SE").detail).toContain("40%");
    expect(byId(a, "prev.S").status).toBe("fail"); // submercado sem previsão
  });

  it("perder por pouco em 4 semanas, sem significância, é só atenção", () => {
    const close = forecast({ rmae: 1.04, dm: { statistic: 0.5, pValue: 0.7 } });
    expect(byId(auditModels(input({ forecasts: { SE: close } })), "prev.rmae.SE").status).toBe("warn");
    const far = forecast({ rmae: 1.2, dm: { statistic: 1.2, pValue: 0.88 } });
    expect(byId(auditModels(input({ forecasts: { SE: far } })), "prev.rmae.SE").status).toBe("fail");
  });

  it("D+7 bem melhor que D+1 levanta suspeita de vazamento", () => {
    const leak = forecast({ horizonErrors: [{ day: 1, mae: 50, n: 60, spread: 1 }, { day: 7, mae: 20, n: 60, spread: 1 }] });
    expect(byId(auditModels(input({ forecasts: { SE: leak } })), "prev.horiz.SE").status).toBe("warn");
  });

  it("GARCH não estacionário e probabilidades que não somam 1 reprovam; α ≈ 0 é volatilidade constante e passa", () => {
    const f = forecast({}, { garch: { dailyVolPct: 1, forecastVolPct: [1], persistence: 1.01, halfLifeDays: 1, alpha: 0.5, beta: 0.51, n: 10 }, regime: { labels: ["a", "b"], meansRS: [1, 2], current: [0.5, 0.6], in24h: [], in7d: [], transition: [[1, 0], [0, 1]], durationsH: [1, 1], recentPath: [] } });
    const a = auditModels(input({ forecasts: { SE: f } }));
    expect(byId(a, "garch.SE").status).toBe("fail");
    expect(byId(a, "hmm.SE").status).toBe("fail");
    const flat = forecast({}, { garch: { dailyVolPct: 30, forecastVolPct: [30], persistence: 1, halfLifeDays: Infinity, alpha: 0.001, beta: 0.999, n: 300 } });
    const g = byId(auditModels(input({ forecasts: { SE: flat } })), "garch.SE");
    expect(g.status).toBe("pass");
    expect(g.display).toContain("constante");
  });

  it("cenários julgados pela calibração: fora do alvo reprova, calibração de reserva fica em atenção", () => {
    const base = forecast().mrjd!;
    const off = forecast({}, { mrjd: { ...base, fit: { dayQTarget: 40, dayQSim: 70, tvReal: 300, tvSim: 310, depReal: 0.5, depSim: 0.2 } } });
    expect(byId(auditModels(input({ forecasts: { SE: off } })), "mrjd.SE").status).toBe("fail");
    // meia-vida longa não reprova quando a calibração bate (no modo cópula é parâmetro de suavidade)
    const smooth = forecast({}, { mrjd: { ...base, halfLifeHours: 200_000, kappaPerHour: 3e-6 } });
    expect(byId(auditModels(input({ forecasts: { SE: smooth } })), "mrjd.SE").status).toBe("pass");
    const reserve = forecast({}, { mrjd: { ...base, fit: null, calibratedOn: "desvios sazonais" } });
    expect(byId(auditModels(input({ forecasts: { SE: reserve } })), "mrjd.SE").status).toBe("warn");
  });

  it("muitos dias faltando na fonte reprovam", () => {
    const gaps = forecast({}, { dataQuality: { windowDays: 90, imputedDays: 12, recentImputed: ["2026-10-01"] } });
    expect(byId(auditModels(input({ forecasts: { SE: gaps } })), "dados.lacunas.SE").status).toBe("fail");
  });

  it("PLD fora do teto, LP abaixo da regra simples e captura acima de 100% reprovam", () => {
    const a = auditModels(
      input({
        pld: { ts: [Date.parse("2026-10-14T12:00:00-03:00")], values: { SE: [2000], S: [100], NE: [100], N: [100] } },
        bess: { days: [{ date: "2026-10-14", revenue: 50, naive: 80, chargedMWh: 1, dischargedMWh: 1, cycles: 1.5, opHours: 8, spread: 1, imputed: false }], maxCycles: 1 },
        arbitrage: { captureRatio: 1.2 },
      }),
    );
    expect(byId(a, "pld.limites").status).toBe("fail");
    expect(byId(a, "bess.otimo").status).toBe("fail");
    expect(byId(a, "bess.ciclos").status).toBe("fail");
    expect(byId(a, "arb.captura").status).toBe("fail");
  });

  it("o pior regime usa só recortes conhecidos antes de prever e reprova acima de 1,20", () => {
    const ok = byId(auditModels(input()), "regime.pior.SE");
    expect(ok.display).toContain("Período seco"); // a faixa "PLD no piso" (1,45, pelo realizado) não entra
    expect(ok.detail).toContain("1,45");
    const a = auditModels(input({ regimes: { SE: regime(0.95, 1.3) } }));
    expect(byId(a, "regime.pior.SE").status).toBe("fail");
  });

  it("um ano sem vantagem significativa é atenção; significativamente pior reprova", () => {
    expect(byId(auditModels(input({ regimes: { SE: regime(0.99, 1, 0.3) } })), "regime.geral.SE").status).toBe("warn");
    expect(byId(auditModels(input({ regimes: { SE: regime(1.02, 1, 0.97) } })), "regime.geral.SE").status).toBe("fail");
  });
});
