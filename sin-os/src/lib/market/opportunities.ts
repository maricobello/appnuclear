import { SUBS, type Sub } from "../sources/types";

/**
 * Scanner de oportunidades da Sala de Comando — tudo calculado do PLD horário publicado
 * (D ou D+1) e das análises já existentes; nada de números inventados. Fórmulas:
 *
 *  BESS intraday: k = E/P horas; compra = média das k horas mais baratas, venda = média das k
 *    mais caras; receita/dia = venda·E·√η − compra·E/√η (1 ciclo); margem = receita/P.
 *  Peak capture: prêmio da ponta (18–21h) sobre a média do dia, 3 h por MW.
 *  Load shifting: ponta (18–21h) − madrugada (0–6h), 3 MWh deslocados por MW.
 *  Curtailment → storage: carregar nas horas no PISO regulatório (excedente) e vender nas k
 *    mais caras.
 *  Spread entre submercados: indicador de risco (sem FTR no SIN) — sem margem monetizável.
 *  Internacional: bateria 1 MW/2 MWh no day-ahead europeu convertida pelo câmbio (referência).
 */
export interface Opportunity {
  id: string;
  kind: "bess" | "peak" | "shift" | "floor" | "spread" | "intl";
  strategy: string;
  market: string;
  /** R$/MWh */
  spread: number | null;
  /** R$/MW·dia (bruto, antes do custo do ativo) */
  margin: number | null;
  /** Custo nivelado do ativo em R$/MW·dia (para comparar com a margem), quando se aplica. */
  costPerMWDay: number | null;
  mw: number | null;
  liquidity: string;
  confidence: number | null;
  confidenceNote: string;
  detail: string;
  action: { label: string; href: string };
}

export interface DayPrices {
  date: string;
  /** "amanhã" | "hoje" | "último dia" */
  label: string;
  published: boolean;
  values: Record<Sub, number[]>;
}

export interface SpreadLike {
  a: Sub;
  b: Sub;
  current: number | null;
  z: number | null;
  adfP: number | null;
  cointegrated: boolean | null;
  halfLifeH: number | null;
}

export interface OppInput {
  day: DayPrices | null;
  floor: number;
  asset: { pow: number; cap: number; rte: number; lcos: number };
  spreads?: SpreadLike[];
  intl?: { name: string; bzn: string; eurPerMWDay: number; spreadEur: number; fx: number; date: string } | null;
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

export function bessDay(prices: number[], asset: OppInput["asset"]) {
  const k = Math.min(12, Math.max(1, Math.round(asset.cap / Math.max(1e-9, asset.pow))));
  const sorted = prices.slice().sort((a, b) => a - b);
  const buy = mean(sorted.slice(0, k));
  const sell = mean(sorted.slice(-k));
  const eta = Math.sqrt(asset.rte / 100);
  const revenue = sell * asset.cap * eta - (buy * asset.cap) / eta;
  return { k, buy, sell, revenue, perMW: revenue / asset.pow };
}

/** Dia-alvo: amanhã publicado > hoje completo > último dia completo do painel. */
export function pickDay(ts: number[], values: Record<Sub, (number | null)[]>, today: string, brtDate: (t: number) => string, brtHour: (t: number) => number): DayPrices | null {
  const byDay = new Map<string, Record<Sub, (number | null)[]>>();
  ts.forEach((t, i) => {
    const d = brtDate(t);
    const row = byDay.get(d) ?? (Object.fromEntries(SUBS.map((s) => [s, new Array<number | null>(24).fill(null)])) as Record<Sub, (number | null)[]>);
    for (const s of SUBS) row[s][brtHour(t)] = values[s][i];
    byDay.set(d, row);
  });
  const complete = [...byDay.entries()].filter(([, r]) => SUBS.every((s) => r[s].every((v) => v !== null && Number.isFinite(v)))).sort(([a], [b]) => a.localeCompare(b));
  if (!complete.length) return null;
  const tomorrow = complete.find(([d]) => d > today);
  const cur = complete.find(([d]) => d === today);
  const [date, row] = tomorrow ?? cur ?? complete[complete.length - 1];
  return { date, label: tomorrow ? "amanhã" : cur ? "hoje" : "último dia", published: !!(tomorrow || cur), values: row as Record<Sub, number[]> };
}

export function buildOpportunities(inp: OppInput): Opportunity[] {
  const rows: Opportunity[] = [];
  const { day, asset } = inp;
  const eta = Math.sqrt(asset.rte / 100);
  const costPerMWDay = (asset.lcos * asset.cap * eta) / asset.pow; // 1 ciclo/dia pelo custo nivelado
  if (day) {
    const conf = day.published ? 0.95 : 0.6;
    const confNote = day.published ? `PLD publicado (${day.label})` : "último dia disponível — PLD de hoje ainda não publicado";
    const when = day.label;
    for (const s of SUBS) {
      const b = bessDay(day.values[s], asset);
      rows.push({
        id: `bess-${s}`,
        kind: "bess",
        strategy: "BESS intraday",
        market: s,
        spread: b.sell - b.buy,
        margin: b.perMW,
        costPerMWDay,
        mw: asset.pow,
        liquidity: "MCP · CCEE",
        confidence: conf,
        confidenceNote: confNote,
        detail: `${when}: compra ${b.k} h a ${b.buy.toFixed(0)} · venda ${b.k} h a ${b.sell.toFixed(0)} R$/MWh · η ${asset.rte}%`,
        action: { label: "Simular", href: `/bess?sub=${s}` },
      });
    }
    const peak = SUBS.map((s) => {
      const v = day.values[s];
      return { s, premium: mean(v.slice(18, 21)) - mean(v), shift: mean(v.slice(18, 21)) - mean(v.slice(0, 6)) };
    });
    const bestPeak = peak.slice().sort((a, b) => b.premium - a.premium)[0];
    if (bestPeak && bestPeak.premium > 0) {
      rows.push({
        id: "peak",
        kind: "peak",
        strategy: "Peak capture",
        market: bestPeak.s,
        spread: bestPeak.premium,
        margin: 3 * bestPeak.premium,
        costPerMWDay: null,
        mw: null,
        liquidity: "MCP · CCEE",
        confidence: conf,
        confidenceNote: confNote,
        detail: `prêmio da ponta 18–21h sobre a média do dia (${when})`,
        action: { label: "Ver curva", href: "/sin" },
      });
    }
    const bestShift = peak.slice().sort((a, b) => b.shift - a.shift)[0];
    if (bestShift && bestShift.shift > 0) {
      rows.push({
        id: "shift",
        kind: "shift",
        strategy: "Load shifting",
        market: bestShift.s,
        spread: bestShift.shift,
        margin: 3 * bestShift.shift,
        costPerMWDay: null,
        mw: null,
        liquidity: "Consumidor livre · MCP",
        confidence: conf,
        confidenceNote: confNote,
        detail: `deslocar 3 MWh/MW da ponta (18–21h) para a madrugada (0–6h) · ${when}`,
        action: { label: "Ver curva", href: "/sin" },
      });
    }
    const floorHours = SUBS.map((s) => ({ s, n: day.values[s].filter((v) => v <= inp.floor * 1.005).length })).sort((a, b) => b.n - a.n)[0];
    const fv = floorHours ? day.values[floorHours.s] : [];
    const kf = Math.min(12, Math.max(1, Math.round(asset.cap / asset.pow)));
    const sellF = fv.length ? mean(fv.slice().sort((a, b) => a - b).slice(-kf)) : 0;
    // só é oportunidade se há horas no piso E horas acima dele para vender
    if (floorHours && floorHours.n >= 2 && sellF > inp.floor * 1.02) {
      const sell = sellF;
      const perMW = (sell * asset.cap * eta - (inp.floor * asset.cap) / eta) / asset.pow;
      rows.push({
        id: "floor",
        kind: "floor",
        strategy: "Curtailment → Storage",
        market: floorHours.s,
        spread: sell - inp.floor,
        margin: perMW,
        costPerMWDay,
        mw: asset.pow,
        liquidity: "MCP · CCEE",
        confidence: conf,
        confidenceNote: confNote,
        detail: `${floorHours.n} h no piso (R$ ${inp.floor.toFixed(2)}) — energia excedente para carregar · ${when}`,
        action: { label: "Simular", href: `/bess?sub=${floorHours.s}` },
      });
    }
  }
  for (const sp of (inp.spreads ?? []).filter((x) => x.current !== null && x.z !== null).sort((x, y) => Math.abs(y.z!) - Math.abs(x.z!)).slice(0, 2)) {
    const [lo, hi] = sp.current! >= 0 ? [sp.b, sp.a] : [sp.a, sp.b];
    rows.push({
      id: `spread-${sp.a}-${sp.b}`,
      kind: "spread",
      strategy: `Spread ${lo} → ${hi}`,
      market: `${sp.a}/${sp.b}`,
      spread: Math.abs(sp.current!),
      margin: null,
      costPerMWDay: null,
      mw: null,
      liquidity: "Bilateral · sem FTR",
      confidence: sp.cointegrated ? 1 - (sp.adfP ?? 0.5) : 0.4,
      confidenceNote: `z = ${sp.z!.toFixed(2)}${sp.halfLifeH ? ` · meia-vida ${sp.halfLifeH.toFixed(1)} h` : ""}${sp.cointegrated ? " · cointegrados" : " · sem cointegração"}`,
      detail: "indicador de risco entre submercados (não há FTR no SIN)",
      action: { label: "Analisar", href: "/arbitragem" },
    });
  }
  if (inp.intl) {
    rows.push({
      id: "intl",
      kind: "intl",
      strategy: "Arbitragem internacional",
      market: `${inp.intl.bzn}`,
      spread: inp.intl.spreadEur * inp.intl.fx,
      margin: inp.intl.eurPerMWDay * inp.intl.fx,
      costPerMWDay: null,
      mw: 1,
      liquidity: "Referência · sem acesso",
      confidence: 0.9,
      confidenceNote: `day-ahead publicado (${inp.intl.date}) · câmbio BCB`,
      detail: `bateria 1 MW/2 MWh em ${inp.intl.name} (ótimo exato), convertida a R$ ${inp.intl.fx.toFixed(2)}/€`,
      action: { label: "Ver mercado", href: "/global" },
    });
  }
  return rows.sort((a, b) => (b.margin ?? -Infinity) - (a.margin ?? -Infinity));
}
