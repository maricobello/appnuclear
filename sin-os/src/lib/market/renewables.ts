import { brtDate, brtHour, brtToUtc } from "../sources/time";
import { SUBS, type DailySubPanel, type Sub } from "../sources/types";

/**
 * Curtailment (constrained-off) de eólica e solar e carga líquida, a partir das bases abertas do
 * ONS — com as lições que a comunidade de dados de energia levantou:
 *  - o volume cortado usa a "geração não realizada apurada" do próprio ONS (e a geração de
 *    referência final para checagem), nunca a flag de dado inválido, que não é atualizada
 *    depois da contestação;
 *  - a "não realizada apurada" do ONS é exatamente max(0, referência − geração), com a referência
 *    BRUTA — que às vezes passa da disponibilidade do conjunto (a referência final já vem limitada,
 *    a apurada não). Mostramos o corte como faixa: o oficial (teto) e o limitado à disponibilidade
 *    (piso conservador), e quanto do oficial está acima do que o conjunto tinha disponível;
 *  - convenção de hora explícita e testada: o instante marca o INÍCIO do intervalo de meia hora
 *    (H:00 e H:30 formam a hora H), validado contra o balanço horário (correlação ≈ 1 no
 *    alinhamento 0 e ≈ 0,95 deslocando 1 h);
 *  - no parquet do ONS o horário é de Brasília gravado "sem fuso": ler como UTC desloca 3 h.
 */
export type Tech = "eolica" | "solar";
export type Reason = "REL" | "CNF" | "ENE";
export const REASONS: Reason[] = ["REL", "CNF", "ENE"];
export const REASON_LABEL: Record<Reason, string> = {
  REL: "confiabilidade elétrica",
  CNF: "atendimento a requisitos da rede",
  ENE: "razão energética (sobra de energia)",
};

export interface CurtRow {
  sub: Sub;
  tech: Tech;
  /** Início da meia hora (UTC ms). */
  ts: number;
  geracao: number | null;
  disp: number | null;
  /** Geração de referência bruta (MW) — base da apurada. */
  ref: number | null;
  /** Referência final (já limitada à disponibilidade pelo ONS; só nos intervalos restritos). */
  refFinal: number | null;
  /** MW médios na meia hora (só nos intervalos com restrição). */
  apurada: number | null;
  razao: Reason | null;
}

export interface BalanceRow {
  sub: Sub;
  /** Início da hora (UTC ms). */
  ts: number;
  hidro: number | null;
  termica: number | null;
  eolica: number | null;
  solar: number | null;
  carga: number | null;
  intercambio: number | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/**
 * Instante do ONS (horário de Brasília "de parede") → UTC ms. Aceita o Date que o leitor de
 * parquet devolve (campos UTC = relógio de Brasília) e o texto "AAAA-MM-DD HH:MM:SS" do CSV.
 */
export function wallClockToTs(v: unknown): number | null {
  if (v instanceof Date && Number.isFinite(v.getTime())) {
    return brtToUtc(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate(), v.getUTCHours(), v.getUTCMinutes());
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(v ?? ""));
  return m ? brtToUtc(+m[1], +m[2], +m[3], +m[4], +m[5]) : null;
}

const subOfId = (v: unknown): Sub | null => {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "SE" || s === "S" || s === "NE" || s === "N" ? s : null;
};

export function curtRowFrom(o: Record<string, unknown>, tech: Tech): CurtRow | null {
  const sub = subOfId(o.id_subsistema);
  const ts = wallClockToTs(o.din_instante);
  if (!sub || ts === null) return null;
  const r = String(o.cod_razaorestricao ?? "").trim().toUpperCase();
  return {
    sub,
    tech,
    ts,
    geracao: num(o.val_geracao),
    disp: num(o.val_disponibilidade),
    ref: num(o.val_geracaoreferencia),
    refFinal: num(o.val_geracaoreferenciafinal),
    apurada: num(o.val_geracaonaorealizadaapurada),
    razao: r === "REL" || r === "CNF" || r === "ENE" ? r : null,
  };
}

export function balanceRowFrom(o: Record<string, unknown>): BalanceRow | null {
  const sub = subOfId(o.id_subsistema);
  const ts = wallClockToTs(o.din_instante);
  if (!sub || ts === null) return null;
  return {
    sub,
    ts,
    hidro: num(o.val_gerhidraulica),
    termica: num(o.val_gertermica),
    eolica: num(o.val_gereolica),
    solar: num(o.val_gersolar),
    carga: num(o.val_carga),
    intercambio: num(o.val_intercambio),
  };
}

/**
 * Corte diário (MWh, eólica + solar) por submercado, para a camada de confiança detectar quando o
 * ONS republica um dia passado (ex.: depois de contestações). Dia sem as 48 meias horas fica nulo.
 */
export function curtailmentDailyPanel(rows: CurtRow[]): DailySubPanel {
  const acc = new Map<string, { v: Record<Sub, number>; slots: Set<number> }>();
  for (const r of rows) {
    const d = brtDate(r.ts);
    const a = acc.get(d) ?? { v: Object.fromEntries(SUBS.map((s) => [s, 0])) as Record<Sub, number>, slots: new Set<number>() };
    a.slots.add(r.ts);
    if (r.razao) a.v[r.sub] += Math.max(0, r.apurada ?? 0) * 0.5;
    acc.set(d, a);
  }
  const dates = [...acc.keys()].sort();
  return {
    dates,
    values: Object.fromEntries(SUBS.map((s) => [s, dates.map((d) => (acc.get(d)!.slots.size >= 48 ? acc.get(d)!.v[s] : null))])) as Record<Sub, (number | null)[]>,
    unit: "MWh",
  };
}

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const zeros = () => Object.fromEntries(SUBS.map((s) => [s, 0])) as Record<Sub, number>;

export interface CurtailmentSummary {
  from: string | null;
  to: string | null;
  days: number;
  /** MWh por dia e submercado (eólica + solar). */
  daily: { date: string; eolica: Record<Sub, number>; solar: Record<Sub, number> }[];
  totals: {
    eolicaMWh: number;
    solarMWh: number;
    /** Piso conservador: referência limitada à disponibilidade do conjunto. */
    cappedMWh: number;
    byReason: Record<Reason, number>;
    bySub: Record<Sub, number>;
  };
  /** % da geração potencial (gerada + cortada) que foi cortada, por tecnologia. */
  curtailedSharePct: Record<Tech, number | null>;
  /** MWh médio cortado por hora do dia (BRT), por submercado: em que horas sobra energia. */
  hourlyProfile: Record<Sub, number[]>;
  quality: {
    restrictedIntervals: number;
    /** Intervalos restritos com referência bruta acima de 102% da disponibilidade do conjunto. */
    refAboveAvailIntervals: number;
    /** MWh da apurada acima do que o conjunto tinha disponível (oficial − piso) e sua parcela do oficial. */
    inflatedMWh: number;
    inflatedSharePct: number;
    /** Erro médio (MW) da apurada contra max(0, referência − geração): ≈ 0 confirma o método do ONS. */
    methodMAE: number | null;
    methodN: number;
  };
}

/** Resumo dos últimos `days` dias fechados (exclui hoje). */
export function curtailmentSummary(rows: CurtRow[], now: number, days = 14): CurtailmentSummary {
  const today = brtDate(now);
  const first = brtDate(now - days * 86400_000);
  const inWin = rows.filter((r) => {
    const d = brtDate(r.ts);
    return d >= first && d < today;
  });
  const dailyMap = new Map<string, { eolica: Record<Sub, number>; solar: Record<Sub, number> }>();
  const byReason = { REL: 0, CNF: 0, ENE: 0 } as Record<Reason, number>;
  const bySub = zeros();
  const gen: Record<Tech, number> = { eolica: 0, solar: 0 };
  const cut: Record<Tech, number> = { eolica: 0, solar: 0 };
  const prof = Object.fromEntries(SUBS.map((s) => [s, new Array(24).fill(0)])) as Record<Sub, number[]>;
  let restricted = 0;
  let refAbove = 0;
  let inflated = 0;
  let capped = 0;
  let maeSum = 0;
  let maeN = 0;
  for (const r of inWin) {
    if (r.geracao !== null) gen[r.tech] += r.geracao * 0.5;
    if (!r.razao) continue;
    restricted++;
    const mwh = Math.max(0, r.apurada ?? 0) * 0.5;
    cut[r.tech] += mwh;
    byReason[r.razao] += mwh;
    bySub[r.sub] += mwh;
    const d = brtDate(r.ts);
    const day = dailyMap.get(d) ?? { eolica: zeros(), solar: zeros() };
    day[r.tech][r.sub] += mwh;
    dailyMap.set(d, day);
    prof[r.sub][brtHour(r.ts)] += mwh;
    // piso: a mesma conta com a referência limitada à disponibilidade do conjunto
    const cap = r.ref !== null && r.disp !== null && r.geracao !== null ? Math.min(mwh, Math.max(0, Math.min(r.ref, r.disp) - r.geracao) * 0.5) : mwh;
    capped += cap;
    inflated += mwh - cap;
    if (r.ref !== null && r.disp !== null && r.disp > 0 && r.ref > r.disp * 1.02) refAbove++;
    if (r.ref !== null && r.geracao !== null && r.apurada !== null) {
      maeSum += Math.abs(r.apurada - Math.max(0, r.ref - r.geracao));
      maeN++;
    }
  }
  const dates = [...dailyMap.keys()].sort();
  const nDays = Math.max(1, new Set(inWin.map((r) => brtDate(r.ts))).size);
  const total = cut.eolica + cut.solar;
  const share = (t: Tech) => (gen[t] + cut[t] > 0 ? round((100 * cut[t]) / (gen[t] + cut[t]), 1) : null);
  return {
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    days: dates.length,
    daily: dates.map((date) => {
      const d = dailyMap.get(date)!;
      const rnd = (x: Record<Sub, number>) => Object.fromEntries(SUBS.map((s) => [s, round(x[s])])) as Record<Sub, number>;
      return { date, eolica: rnd(d.eolica), solar: rnd(d.solar) };
    }),
    totals: {
      eolicaMWh: round(cut.eolica),
      solarMWh: round(cut.solar),
      cappedMWh: round(capped),
      byReason: Object.fromEntries(REASONS.map((k) => [k, round(byReason[k])])) as Record<Reason, number>,
      bySub: Object.fromEntries(SUBS.map((s) => [s, round(bySub[s])])) as Record<Sub, number>,
    },
    curtailedSharePct: { eolica: share("eolica"), solar: share("solar") },
    hourlyProfile: Object.fromEntries(SUBS.map((s) => [s, prof[s].map((v) => round(v / nDays))])) as Record<Sub, number[]>,
    quality: {
      restrictedIntervals: restricted,
      refAboveAvailIntervals: refAbove,
      inflatedMWh: round(inflated),
      inflatedSharePct: total > 0 ? round((100 * inflated) / total, 1) : 0,
      methodMAE: maeN ? round(maeSum / maeN, 2) : null,
      methodN: maeN,
    },
  };
}

export interface NetLoadSummary {
  days: number;
  /** Perfil médio por hora do dia (BRT), MW médios: carga e carga líquida (carga − eólica − solar). */
  profile: Record<Sub | "SIN", { carga: number[]; liquida: number[] }>;
  /** Rampa da noite: maior subida da carga líquida em 3 h no dia, média dos dias (MW), SIN. */
  eveningRampMW: number | null;
  /** Hora típica (BRT) do mínimo da carga líquida do SIN. */
  minHour: number | null;
  /** Participação média de eólica + solar na carga do SIN (%). */
  renewableSharePct: number | null;
  quality: {
    hours: number;
    /** Horas em que geração − intercâmbio difere da carga em mais de 1% (identidade do balanço). */
    identityBreaks: number;
  };
}

export function netLoadSummary(rows: BalanceRow[], now: number, days = 14): NetLoadSummary {
  const today = brtDate(now);
  const first = brtDate(now - days * 86400_000);
  const inWin = rows.filter((r) => {
    const d = brtDate(r.ts);
    return d >= first && d < today;
  });
  const keys = [...SUBS, "SIN"] as const;
  const acc = Object.fromEntries(keys.map((k) => [k, { c: new Array(24).fill(0), l: new Array(24).fill(0), n: new Array(24).fill(0) }])) as Record<
    Sub | "SIN",
    { c: number[]; l: number[]; n: number[] }
  >;
  const sinByTs = new Map<number, { c: number; l: number; ren: number; subs: number }>();
  let breaks = 0;
  let hours = 0;
  for (const r of inWin) {
    if (r.carga === null) continue;
    hours++;
    const ren = (r.eolica ?? 0) + (r.solar ?? 0);
    const liq = r.carga - ren;
    const h = brtHour(r.ts);
    acc[r.sub].c[h] += r.carga;
    acc[r.sub].l[h] += liq;
    acc[r.sub].n[h]++;
    const s = sinByTs.get(r.ts) ?? { c: 0, l: 0, ren: 0, subs: 0 };
    s.c += r.carga;
    s.l += liq;
    s.ren += ren;
    s.subs++;
    sinByTs.set(r.ts, s);
    const g = (r.hidro ?? 0) + (r.termica ?? 0) + (r.eolica ?? 0) + (r.solar ?? 0);
    if (r.intercambio !== null && r.carga > 0 && Math.abs(g - r.intercambio - r.carga) > 0.01 * r.carga) breaks++;
  }
  // SIN: só horas com os 4 submercados
  const byDay = new Map<string, number[]>();
  let renSum = 0;
  let cSum = 0;
  for (const [ts, s] of sinByTs) {
    if (s.subs < 4) continue;
    const h = brtHour(ts);
    acc.SIN.c[h] += s.c;
    acc.SIN.l[h] += s.l;
    acc.SIN.n[h]++;
    renSum += s.ren;
    cSum += s.c;
    const d = brtDate(ts);
    const arr = byDay.get(d) ?? new Array(24).fill(NaN);
    arr[h] = s.l;
    byDay.set(d, arr);
  }
  const ramps: number[] = [];
  const mins: number[] = [];
  for (const arr of byDay.values()) {
    if (arr.some((v) => !Number.isFinite(v))) continue;
    let best = -Infinity;
    for (let h = 0; h + 3 < 24; h++) best = Math.max(best, arr[h + 3] - arr[h]);
    ramps.push(best);
    mins.push(arr.indexOf(Math.min(...arr)));
  }
  const mode = (xs: number[]) => {
    const c = new Map<number, number>();
    for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const profile = Object.fromEntries(
    keys.map((k) => [k, { carga: acc[k].c.map((v, h) => (acc[k].n[h] ? round(v / acc[k].n[h], 0) : 0)), liquida: acc[k].l.map((v, h) => (acc[k].n[h] ? round(v / acc[k].n[h], 0) : 0)) }]),
  ) as NetLoadSummary["profile"];
  return {
    days: byDay.size,
    profile,
    eveningRampMW: ramps.length ? round(ramps.reduce((a, b) => a + b, 0) / ramps.length, 0) : null,
    minHour: mode(mins),
    renewableSharePct: cSum > 0 ? round((100 * renSum) / cSum, 1) : null,
    quality: { hours, identityBreaks: breaks },
  };
}

const corr = (a: number[], b: number[]) => {
  const n = a.length;
  if (n < 3) return null;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num2 = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num2 += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num2 / Math.sqrt(da * db) : null;
};

export interface HourConventionCheck {
  sub: Sub;
  n: number;
  /** Correlação da geração eólica dos conjuntos (agregada por hora de início) com o balanço, por defasagem. */
  corrByLag: Record<"-1" | "0" | "1", number | null>;
  bestLag: number | null;
  ok: boolean;
}

/**
 * Verifica, com os próprios dados, que a meia hora carimbada em H:MM pertence à hora H (início do
 * intervalo): a geração eólica dos conjuntos agregada assim deve casar com o balanço horário sem
 * defasagem. Se um dia o ONS mudar a convenção, o melhor alinhamento muda e a checagem acusa.
 */
export function hourConventionCheck(curt: CurtRow[], bal: BalanceRow[], sub: Sub = "NE"): HourConventionCheck {
  const byHour = new Map<number, { s: number; n: number }>();
  for (const r of curt) {
    if (r.sub !== sub || r.tech !== "eolica" || r.geracao === null) continue;
    const h = Math.floor(r.ts / 3600_000) * 3600_000;
    const c = byHour.get(h) ?? { s: 0, n: 0 };
    c.s += r.geracao;
    c.n++;
    byHour.set(h, c);
  }
  const balMap = new Map(bal.filter((b) => b.sub === sub && b.eolica !== null).map((b) => [b.ts, b.eolica as number]));
  const out: Record<"-1" | "0" | "1", number | null> = { "-1": null, "0": null, "1": null };
  let n = 0;
  for (const lag of [-1, 0, 1] as const) {
    const a: number[] = [];
    const b: number[] = [];
    for (const [h, c] of byHour) {
      if (c.n < 2) continue;
      const v = balMap.get(h + lag * 3600_000);
      if (v === undefined) continue;
      a.push(c.s / 2);
      b.push(v);
    }
    out[String(lag) as "-1" | "0" | "1"] = corr(a, b);
    if (lag === 0) n = a.length;
  }
  const entries = (Object.entries(out) as [string, number | null][]).filter((e): e is [string, number] => e[1] !== null);
  const best = entries.sort((x, y) => y[1] - x[1])[0];
  const bestLag = best ? Number(best[0]) : null;
  return { sub, n, corrByLag: out, bestLag, ok: bestLag === 0 && (out["0"] ?? 0) > 0.98 };
}

type PldPanel = { ts: number[]; values: Record<Sub, (number | null)[]> };

export interface CurtailmentPld {
  sub: Sub;
  /** Horas com corte ≥ minMWh e PLD conhecido; quantas com PLD no piso. */
  hours: number;
  atFloor: number;
  sharePct: number | null;
  /** Energia cortada com PLD conhecido, preço médio ponderado e valor a PLD (R$). */
  mwhPriced: number;
  avgPld: number | null;
  valueBRL: number;
}

/**
 * Cruza o corte com o PLD da mesma hora: em quantas horas de corte relevante o preço estava no
 * piso (energia sobrando = preço mínimo) e quanto vale a energia cortada a PLD.
 */
export function curtailmentVsFloor(rows: CurtRow[], pld: PldPanel | null, floor: number, sub: Sub = "NE", minMWh = 50): CurtailmentPld | null {
  if (!pld) return null;
  const byHour = new Map<number, number>();
  for (const r of rows) {
    if (r.sub !== sub || !r.razao) continue;
    const h = Math.floor(r.ts / 3600_000) * 3600_000;
    byHour.set(h, (byHour.get(h) ?? 0) + Math.max(0, r.apurada ?? 0) * 0.5);
  }
  const pldAt = new Map(pld.ts.map((t, i) => [t, pld.values[sub][i]]));
  let hours = 0;
  let atFloor = 0;
  let mwhPriced = 0;
  let value = 0;
  for (const [h, mwh] of byHour) {
    const p = pldAt.get(h);
    if (p === null || p === undefined) continue;
    mwhPriced += mwh;
    value += mwh * p;
    if (mwh < minMWh) continue;
    hours++;
    if (p <= floor + 0.01) atFloor++;
  }
  return {
    sub,
    hours,
    atFloor,
    sharePct: hours ? round((100 * atFloor) / hours, 1) : null,
    mwhPriced: round(mwhPriced),
    avgPld: mwhPriced > 0 ? round(value / mwhPriced, 2) : null,
    valueBRL: Math.round(value),
  };
}

/** PLD médio por hora do dia (BRT) nos dias [from, to], por submercado. */
export function pldHourlyProfile(pld: PldPanel | null, from: string, to: string): Record<Sub, (number | null)[]> | null {
  if (!pld) return null;
  const acc = Object.fromEntries(SUBS.map((s) => [s, { v: new Array(24).fill(0), n: new Array(24).fill(0) }])) as Record<Sub, { v: number[]; n: number[] }>;
  pld.ts.forEach((t, i) => {
    const d = brtDate(t);
    if (d < from || d > to) return;
    const h = brtHour(t);
    for (const s of SUBS) {
      const v = pld.values[s][i];
      if (v === null) continue;
      acc[s].v[h] += v;
      acc[s].n[h]++;
    }
  });
  return Object.fromEntries(SUBS.map((s) => [s, acc[s].v.map((v, h) => (acc[s].n[h] ? round(v / acc[s].n[h], 2) : null))])) as Record<Sub, (number | null)[]>;
}
