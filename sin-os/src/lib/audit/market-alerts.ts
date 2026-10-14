import { SUBS, type Sub } from "../sources/types";
import type { HealthMessage } from "./health";

/**
 * Alertas de MERCADO (não de sistema): regras simples e auditáveis sobre o PLD do dia-alvo
 * (amanhã quando já publicado, senão hoje) e sobre o corte de renováveis do último dia fechado.
 * Cada alerta tem um id estável (regra + data), usado para mandar uma vez só.
 */
export interface AlertThresholds {
  /** Máximo horário do PLD acima disto (R$/MWh) em algum submercado. */
  pldMax: number;
  /** Diferença entre o submercado mais caro e o mais barato na mesma hora (R$/MWh). */
  spread: number;
  /** Diferença entre a hora mais cara e a mais barata do dia no mesmo submercado (R$/MWh). */
  intraday: number;
  /** Corte do dia ≥ este múltiplo da mediana dos 7 dias anteriores... */
  curtailFactor: number;
  /** ...e ≥ este volume (GWh) para não alertar ruído. */
  curtailMinGWh: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = { pldMax: 300, spread: 100, intraday: 200, curtailFactor: 1.5, curtailMinGWh: 50 };

export function thresholdsFromEnv(env: Record<string, string | undefined> = process.env): AlertThresholds {
  const n = (k: string, d: number) => {
    const v = Number(env[k]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return {
    pldMax: n("ALERT_PLD_MAX", DEFAULT_THRESHOLDS.pldMax),
    spread: n("ALERT_SPREAD", DEFAULT_THRESHOLDS.spread),
    intraday: n("ALERT_INTRADAY", DEFAULT_THRESHOLDS.intraday),
    curtailFactor: n("ALERT_CURTAIL_FACTOR", DEFAULT_THRESHOLDS.curtailFactor),
    curtailMinGWh: n("ALERT_CURTAIL_MIN_GWH", DEFAULT_THRESHOLDS.curtailMinGWh),
  };
}

export interface MarketAlert {
  id: string;
  rule: "pld_max" | "spread" | "intraday" | "curtailment";
  message: HealthMessage;
}

export interface MarketAlertInput {
  /** Dia completo (24 h por submercado) de hoje ou amanhã. */
  day: { date: string; values: Record<Sub, number[]>; official: boolean } | null;
  today: string;
  /** Corte diário (MWh, eólica + solar, todos os submercados), em ordem de data; o último é o dia avaliado. */
  curtailDaily: { date: string; mwh: number }[];
  baseUrl: string;
}

const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const gwh = (mwh: number) => `${(mwh / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GWh`;
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const median = (x: number[]) => {
  const s = x.slice().sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

export function evaluateMarketAlerts(inp: MarketAlertInput, th: AlertThresholds = DEFAULT_THRESHOLDS): MarketAlert[] {
  const out: MarketAlert[] = [];
  const { day } = inp;
  if (day) {
    const when = day.date > inp.today ? "amanhã" : "hoje";
    const src = day.official ? "oficial CCEE" : "estimado pelo CMO/ONS";
    const head = `PLD de ${when} (${ddmm(day.date)}, ${src})`;

    const peaks = SUBS.map((s) => {
      const v = day.values[s];
      const max = Math.max(...v);
      return { s, max, h: v.indexOf(max), min: Math.min(...v), hMin: v.indexOf(Math.min(...v)) };
    });
    const hot = peaks.filter((p) => p.max >= th.pldMax);
    if (hot.length)
      out.push({
        id: `pld_max_${day.date}`,
        rule: "pld_max",
        message: {
          kind: "market",
          title: `Pico de PLD ${when}: ${hot.map((p) => p.s).join(", ")} acima de ${brl(th.pldMax)}`,
          text: `🔺 ${head}\n${hot.map((p) => `${p.s}: máx ${brl(p.max)} às ${p.h}h`).join("\n")}\n${inp.baseUrl}/sin`,
        },
      });

    // descolamento entre submercados na mesma hora
    let best = { h: -1, gap: 0, hi: "SE" as Sub, lo: "SE" as Sub };
    for (let h = 0; h < 24; h++) {
      const vals = SUBS.map((s) => ({ s, v: day.values[s][h] }));
      const hi = vals.reduce((a, b) => (b.v > a.v ? b : a));
      const lo = vals.reduce((a, b) => (b.v < a.v ? b : a));
      if (hi.v - lo.v > best.gap) best = { h, gap: hi.v - lo.v, hi: hi.s, lo: lo.s };
    }
    if (best.gap >= th.spread)
      out.push({
        id: `spread_${day.date}`,
        rule: "spread",
        message: {
          kind: "market",
          title: `Descolamento ${best.lo}→${best.hi} de ${brl(best.gap)} ${when}`,
          text: `↔️ ${head}\nÀs ${best.h}h: ${best.hi} ${brl(day.values[best.hi][best.h])} vs ${best.lo} ${brl(day.values[best.lo][best.h])} (spread ${brl(best.gap)}). Sem FTR no SIN: risco para quem compra num submercado e vende em outro.\n${inp.baseUrl}/arbitragem`,
        },
      });

    // janela de bateria: diferença entre a hora mais cara e a mais barata do dia
    const wide = peaks.filter((p) => p.max - p.min >= th.intraday).sort((a, b) => b.max - b.min - (a.max - a.min));
    if (wide.length)
      out.push({
        id: `intraday_${day.date}`,
        rule: "intraday",
        message: {
          kind: "market",
          title: `Janela de bateria ${when}: ${wide[0].s} com ${brl(wide[0].max - wide[0].min)} entre mín e máx`,
          text: `🔋 ${head}\n${wide.map((p) => `${p.s}: carrega às ${p.hMin}h (${brl(p.min)}) · descarrega às ${p.h}h (${brl(p.max)}) · Δ ${brl(p.max - p.min)}`).join("\n")}\n${inp.baseUrl}/bess?sub=${wide[0].s}`,
        },
      });
  }

  const cd = inp.curtailDaily;
  if (cd.length >= 4) {
    const last = cd[cd.length - 1];
    const base = median(cd.slice(-8, -1).map((x) => x.mwh));
    if (Number.isFinite(base) && base > 0 && last.mwh >= th.curtailFactor * base && last.mwh >= th.curtailMinGWh * 1000)
      out.push({
        id: `curtail_${last.date}`,
        rule: "curtailment",
        message: {
          kind: "market",
          title: `Corte de renováveis disparou em ${ddmm(last.date)}: ${gwh(last.mwh)}`,
          text: `🌬️ ONS cortou ${gwh(last.mwh)} de eólica + solar em ${ddmm(last.date)} — ${(last.mwh / base).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}× a mediana dos 7 dias anteriores (${gwh(base)}).\n${inp.baseUrl}/renovaveis`,
        },
      });
  }
  return out;
}
