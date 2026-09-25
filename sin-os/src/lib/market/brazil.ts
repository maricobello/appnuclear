import { brtDate, brtHour } from "../sources/time";
import { SUBS, type Sub, type SubPanel } from "../sources/types";

/**
 * Limites regulatórios do PLD para 2026 — ANEEL, Despacho nº 3.850/2025
 * (publicado em 23/12/2025): mínimo = maior entre TEO e TEO Itaipu.
 * Atualize anualmente (variáveis de ambiente sobrescrevem).
 */
export const PLD_LIMITS = {
  year: 2026,
  min: Number(process.env.PLD_MIN ?? 57.31),
  maxStructural: Number(process.env.PLD_MAX_ESTRUTURAL ?? 785.27),
  maxHourly: Number(process.env.PLD_MAX_HORARIO ?? 1611.04),
  source: "ANEEL — Despacho nº 3.850/2025",
};

export const clampPld = (v: number) => Math.min(PLD_LIMITS.maxHourly, Math.max(PLD_LIMITS.min, v));

export interface DayMatrix {
  dates: string[];
  dows: number[];
  rows: number[][]; // D×24
}

/**
 * Converte um painel horário em matriz dia×hora (BRT) apenas com dias completos;
 * lacunas isoladas (≤2h) são interpoladas linearmente.
 */
export function toDayMatrix(panel: SubPanel, sub: Sub): DayMatrix {
  const byDay = new Map<string, (number | null)[]>();
  panel.ts.forEach((t, i) => {
    const d = brtDate(t);
    const h = brtHour(t);
    const row = byDay.get(d) ?? new Array<number | null>(24).fill(null);
    row[h] = panel.values[sub][i];
    byDay.set(d, row);
  });
  const dates: string[] = [];
  const rows: number[][] = [];
  for (const d of [...byDay.keys()].sort()) {
    const r = byDay.get(d)!;
    const missing = r.filter((v) => v === null).length;
    if (missing > 2) continue;
    const filled = r.slice();
    for (let h = 0; h < 24; h++) {
      if (filled[h] !== null) continue;
      const prev = filled.slice(0, h).reverse().find((v) => v !== null) ?? null;
      const next = filled.slice(h + 1).find((v) => v !== null) ?? null;
      filled[h] = prev !== null && next !== null ? (prev + next) / 2 : (prev ?? next);
    }
    dates.push(d);
    rows.push(filled as number[]);
  }
  // mantém só a sequência contígua final (LEAR exige dias consecutivos)
  let start = 0;
  for (let i = dates.length - 1; i > 0; i--) {
    const gap = (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86400_000;
    if (gap !== 1) { start = i; break; }
  }
  const ds = dates.slice(start);
  return {
    dates: ds,
    dows: ds.map((d) => new Date(`${d}T12:00:00Z`).getUTCDay()),
    rows: rows.slice(start),
  };
}

export function latestBySub(panel: SubPanel, atOrBefore = Date.now()) {
  const out: Partial<Record<Sub, { ts: number; value: number }>> = {};
  for (const s of SUBS) {
    for (let i = panel.ts.length - 1; i >= 0; i--) {
      const v = panel.values[s][i];
      if (v !== null && panel.ts[i] <= atOrBefore) { out[s] = { ts: panel.ts[i], value: v }; break; }
    }
  }
  return out;
}

/**
 * PLD estimado a partir do CMO (DESSEM) pela regra de formação da ANEEL:
 *  1) cada hora limitada ao piso (PLD_min) e ao teto horário (PLD_max_horário);
 *  2) se a média do dia (24 h, BRT) passar do PLD_max_estrutural, a curva é ajustada
 *     de forma uniforme e proporcional acima do piso até a média ficar igual ao teto
 *     estrutural, mantendo o perfil horário (REN ANEEL 1.051/2022; Regras de
 *     Comercialização, módulo PLD). Dias incompletos só recebem o passo 1.
 */
export function pldFromCmo(cmo: SubPanel): SubPanel {
  const values = Object.fromEntries(
    SUBS.map((s) => [s, cmo.values[s].map((v) => (v === null ? null : clampPld(v)))]),
  ) as SubPanel["values"];
  const days = new Map<string, number[]>();
  cmo.ts.forEach((t, i) => {
    const d = brtDate(t);
    days.set(d, [...(days.get(d) ?? []), i]);
  });
  const { min, maxStructural } = PLD_LIMITS;
  for (const idx of days.values()) {
    if (idx.length !== 24) continue;
    for (const s of SUBS) {
      const day = idx.map((i) => values[s][i]);
      if (day.some((v) => v === null)) continue;
      const mean = (day as number[]).reduce((a, b) => a + b, 0) / 24;
      if (mean <= maxStructural) continue;
      const k = (maxStructural - min) / (mean - min);
      idx.forEach((i) => (values[s][i] = min + (values[s][i]! - min) * k));
    }
  }
  return { ts: cmo.ts, unit: "R$/MWh", values };
}
