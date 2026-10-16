import { SUBS, type Sub, type SubPanel } from "../sources/types";
import { brtDate } from "../sources/time";
import { num, subOfId, wallClockToTs, type BalanceRow } from "./renewables";

/**
 * Intercâmbio entre subsistemas (ONS, intercambio_nacional_ho): fluxo medido e programado de hora
 * em hora nas quatro interligações. O arquivo traz uma linha por par e hora no sentido em que a
 * energia passou (valor medido sempre ≥ 0); o programado vem no mesmo sentido e fica negativo
 * quando o programa era o contrário. Aqui cada par tem um sentido de referência fixo e o sinal
 * diz para onde a energia foi.
 */
export const PAIRS = ["N-NE", "N-SE", "NE-SE", "S-SE"] as const;
export type Pair = (typeof PAIRS)[number];
export const PAIR_SUBS: Record<Pair, [Sub, Sub]> = { "N-NE": ["N", "NE"], "N-SE": ["N", "SE"], "NE-SE": ["NE", "SE"], "S-SE": ["S", "SE"] };
export const PAIR_NAMES: Record<Pair, string> = {
  "N-NE": "Norte → Nordeste",
  "N-SE": "Norte → Sudeste/CO",
  "NE-SE": "Nordeste → Sudeste/CO",
  "S-SE": "Sul → Sudeste/CO",
};
/** Diferença de PLD entre os dois lados (R$/MWh) a partir da qual o par está descolado. */
export const DECOUPLE_BRL = 1;
/** Intercâmbio nacional × intercâmbio do balanço: no N, NE e SE os dois são o mesmo número. */
export const IDENTITY_TOL_MW = 1;

export interface InterchangeRow {
  ts: number;
  pair: Pair;
  /** MWmed medido, positivo no sentido de referência do par. */
  real: number | null;
  /** MWmed programado, mesmo sentido. */
  prog: number | null;
}

/** Linha do parquet → linha no sentido de referência; null se inválida (par desconhecido, hora ou subsistema). */
export function interchangeRowFrom(o: Record<string, unknown>): InterchangeRow | null {
  const a = subOfId(o.id_subsistema_origem);
  const b = subOfId(o.id_subsistema_destino);
  const ts = wallClockToTs(o.din_instante);
  if (!a || !b || ts === null) return null;
  const fwd = PAIRS.find((p) => PAIR_SUBS[p][0] === a && PAIR_SUBS[p][1] === b);
  const rev = PAIRS.find((p) => PAIR_SUBS[p][0] === b && PAIR_SUBS[p][1] === a);
  const pair = fwd ?? rev;
  if (!pair) return null;
  const s = fwd ? 1 : -1;
  const real = num(o.val_intercambiomwmed);
  const prog = num(o.val_intercambioprogmwmed);
  return { ts, pair, real: real === null ? null : s * real, prog: prog === null ? null : s * prog };
}

export interface PairStats {
  pair: Pair;
  name: string;
  hours: number;
  latest: { ts: number; real: number | null; prog: number | null } | null;
  meanReal: number | null;
  /** Maior fluxo medido na janela, em módulo (não é o limite da interligação). */
  maxAbsReal: number | null;
  /** Erro médio absoluto medido − programado. */
  maeProg: number | null;
  /** Horas com PLD dos dois lados. */
  pricedHours: number;
  decoupledHours: number;
  decoupledShare: number | null;
  /** PLD do destino − PLD da origem, média nas horas descoladas (R$/MWh). */
  meanSpreadDecoupled: number | null;
  meanRealDecoupled: number | null;
  meanRealCoupled: number | null;
  /** Fração das horas descoladas em que a energia foi do lado barato para o caro (o esperado). */
  towardExpensive: number | null;
}

export interface InterchangeView {
  from: string | null;
  to: string | null;
  ts: number[];
  real: Record<Pair, (number | null)[]>;
  prog: Record<Pair, (number | null)[]>;
  /** PLD do destino − PLD da origem na mesma hora. */
  spread: Record<Pair, (number | null)[]>;
  pairs: PairStats[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const byPair = <T>(f: () => T) => Object.fromEntries(PAIRS.map((p) => [p, f()])) as Record<Pair, T>;

/** Séries alinhadas por hora e os números de cada par na janela; `pld` alinha pelo mesmo início de hora (UTC). */
export function interchangeView(rows: InterchangeRow[], pld: SubPanel | null): InterchangeView {
  // o mesmo par na mesma hora em dois sentidos (não acontece hoje) vira o líquido
  const acc = new Map<number, Record<Pair, { real: number | null; prog: number | null }>>();
  for (const r of rows) {
    const h = acc.get(r.ts) ?? byPair(() => ({ real: null as number | null, prog: null as number | null }));
    const c = h[r.pair];
    if (r.real !== null) c.real = (c.real ?? 0) + r.real;
    if (r.prog !== null) c.prog = (c.prog ?? 0) + r.prog;
    acc.set(r.ts, h);
  }
  const ts = [...acc.keys()].sort((a, b) => a - b);
  const real = byPair(() => [] as (number | null)[]);
  const prog = byPair(() => [] as (number | null)[]);
  const spread = byPair(() => [] as (number | null)[]);
  const pldAt = new Map<number, number>();
  pld?.ts.forEach((t, i) => pldAt.set(t, i));
  const price = (s: Sub, t: number) => {
    const i = pldAt.get(t);
    const v = i === undefined ? null : pld!.values[s][i];
    return v === null || v === undefined || !Number.isFinite(v) ? null : v;
  };
  for (const t of ts) {
    const h = acc.get(t)!;
    for (const p of PAIRS) {
      real[p].push(h[p].real);
      prog[p].push(h[p].prog);
      const [a, b] = PAIR_SUBS[p];
      const pa = price(a, t);
      const pb = price(b, t);
      spread[p].push(pa === null || pb === null ? null : Math.round((pb - pa) * 100) / 100);
    }
  }

  const pairs = PAIRS.map((p): PairStats => {
    const rv: number[] = [];
    const dev: number[] = [];
    const dec: number[] = [];
    const cou: number[] = [];
    const spr: number[] = [];
    let toward = 0;
    let priced = 0;
    let latest: PairStats["latest"] = null;
    ts.forEach((t, i) => {
      const r = real[p][i];
      const g = prog[p][i];
      const s = spread[p][i];
      if (r !== null) {
        rv.push(r);
        latest = { ts: t, real: r, prog: g };
        if (g !== null) dev.push(Math.abs(r - g));
      }
      if (s === null || r === null) return;
      priced++;
      if (Math.abs(s) > DECOUPLE_BRL) {
        dec.push(r);
        spr.push(s);
        // destino mais caro (s > 0) → a energia deveria ir no sentido de referência (r > 0)
        if (Math.sign(r) === Math.sign(s)) toward++;
      } else cou.push(r);
    });
    return {
      pair: p,
      name: PAIR_NAMES[p],
      hours: rv.length,
      latest,
      meanReal: mean(rv),
      maxAbsReal: rv.length ? Math.max(...rv.map(Math.abs)) : null,
      maeProg: mean(dev),
      pricedHours: priced,
      decoupledHours: dec.length,
      decoupledShare: priced ? dec.length / priced : null,
      meanSpreadDecoupled: mean(spr),
      meanRealDecoupled: mean(dec),
      meanRealCoupled: mean(cou),
      towardExpensive: dec.length ? toward / dec.length : null,
    };
  });
  return { from: ts.length ? brtDate(ts[0]) : null, to: ts.length ? brtDate(ts[ts.length - 1]) : null, ts, real, prog, spread, pairs };
}

export interface IdentityCheck {
  sub: Sub;
  hours: number;
  /** Maior |exportação pelo intercâmbio nacional − intercâmbio do balanço| (MW). */
  maxAbsDiff: number | null;
  /** Diferença média (MW): no Sul é o intercâmbio com Argentina e Uruguai, que não está no arquivo nacional. */
  meanDiff: number | null;
}

/**
 * Conferência entre duas bases do ONS: a exportação líquida de cada subsistema somando as
 * interligações tem de ser o intercâmbio do balanço de energia na mesma hora.
 */
export function identityChecks(rows: InterchangeRow[], balance: BalanceRow[]): IdentityCheck[] {
  const exp = new Map<string, number>();
  const seen = new Set<number>();
  for (const r of rows) {
    if (r.real === null) continue;
    const [a, b] = PAIR_SUBS[r.pair];
    exp.set(`${a}|${r.ts}`, (exp.get(`${a}|${r.ts}`) ?? 0) + r.real);
    exp.set(`${b}|${r.ts}`, (exp.get(`${b}|${r.ts}`) ?? 0) - r.real);
    seen.add(r.ts);
  }
  return SUBS.map((s) => {
    const d: number[] = [];
    for (const b of balance) {
      if (b.sub !== s || b.intercambio === null || !seen.has(b.ts)) continue;
      d.push((exp.get(`${s}|${b.ts}`) ?? 0) - b.intercambio);
    }
    return { sub: s, hours: d.length, maxAbsDiff: d.length ? Math.max(...d.map(Math.abs)) : null, meanDiff: mean(d) };
  });
}
