import { brtDate, brtHour } from "../sources/time";
import { SUBS, type Sub, type SubPanel } from "../sources/types";
import { num, subOfId, wallClockToTs } from "./renewables";

/**
 * Despacho térmico por motivo (ONS, geracao_termica_despacho_2_ho) com o CVU de cada usina por
 * semana operativa (ONS, cvu_usitermica_se) e a estimativa dos Encargos de Serviços do Sistema
 * (ESS) pela regra de ressarcimento da CCEE: a usina despachada fora da ordem de mérito recebe a
 * diferença entre o seu custo (CVU) e o PLD; a despachada por mérito e cortada (constrained-off)
 * recebe a margem que perdeu (PLD − CVU). Só usinas com CVU não nulo têm direito.
 */

/** Motivos do despacho verificado (as colunas val_verif* do ONS); somados dão a geração da usina. */
export const REASONS = [
  { key: "merit", col: "val_verifordemmerito", label: "Ordem de mérito", oom: false, ess: false },
  { key: "inflex", col: "val_verifinflexpura", label: "Inflexibilidade", oom: false, ess: false },
  { key: "uc", col: "val_verifunitcommitment", label: "Unit commitment", oom: true, ess: true },
  { key: "electric", col: "val_verifrazaoeletrica", label: "Razão elétrica", oom: true, ess: true },
  { key: "security", col: "val_verifgarantiaenergetica", label: "Segurança energética", oom: true, ess: true },
  { key: "gfom", col: "val_verifgfom", label: "GFOM (combustível)", oom: true, ess: false },
  { key: "reserve", col: "val_verifreservapotencia", label: "Reserva de potência", oom: true, ess: false },
  { key: "losses", col: "val_verifreposicaoperdas", label: "Reposição de perdas", oom: true, ess: false },
  { key: "gsub", col: "val_verifgsub", label: "Substituição", oom: false, ess: false },
  { key: "export", col: "val_verifexportacao", label: "Exportação", oom: false, ess: false },
] as const;
export type ReasonKey = (typeof REASONS)[number]["key"];
export const ESS_KEYS = ["uc", "electric", "security", "off"] as const;
export type EssKey = (typeof ESS_KEYS)[number];
export const ESS_LABEL: Record<EssKey, string> = { uc: "Unit commitment", electric: "Restrição elétrica", security: "Segurança energética", off: "Constrained-off" };

export const THERMAL_COLUMNS = [
  "din_instante",
  "id_subsistema",
  "nom_usina",
  "cod_usinaplanejamento",
  "nom_combustivel",
  "nom_tipocombustivel",
  "val_verifgeracao",
  "val_verifconstrainedoff",
  "val_progdisponibilidade",
  ...REASONS.map((r) => r.col),
];

/** Soma dos motivos × geração total: acima disto (fração) o dia não fecha. */
export const THERMAL_CHECKS = { identityTol: 0.01, cvuCoverageMin: 0.99 } as const;

export interface ThermalRow {
  ts: number;
  sub: Sub;
  code: number;
  name: string;
  fuel: string;
  /** Geração verificada total, MWmed na hora. */
  gen: number;
  reasons: Record<ReasonKey, number>;
  /** Corte verificado de usina despachada por mérito, MWmed. */
  off: number;
  /** Disponibilidade declarada na programação, MWmed. */
  avail: number | null;
}

export interface CvuRow {
  /** Semana operativa (sábado a sexta), AAAA-MM-DD. */
  from: string;
  to: string;
  code: number;
  sub: Sub | null;
  name: string;
  cvu: number;
  study: string;
}

const dateOf = (v: unknown): string | null => {
  if (v instanceof Date && Number.isFinite(v.getTime())) return v.toISOString().slice(0, 10);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? ""));
  return m ? m[1] : null;
};

export function thermalRowFrom(o: Record<string, unknown>): ThermalRow | null {
  const ts = wallClockToTs(o.din_instante);
  const sub = subOfId(o.id_subsistema);
  const code = num(o.cod_usinaplanejamento);
  if (ts === null || !sub || code === null) return null;
  const reasons = Object.fromEntries(REASONS.map((r) => [r.key, num(o[r.col]) ?? 0])) as Record<ReasonKey, number>;
  return {
    ts,
    sub,
    code,
    name: String(o.nom_usina ?? "").trim(),
    // o dicionário do ONS chama de nom_tipocombustivel; os arquivos de 2026 trazem nom_combustivel
    fuel: String(o.nom_combustivel ?? o.nom_tipocombustivel ?? "").trim(),
    gen: num(o.val_verifgeracao) ?? 0,
    reasons,
    off: Math.abs(num(o.val_verifconstrainedoff) ?? 0),
    avail: num(o.val_progdisponibilidade),
  };
}

export function cvuRowFrom(o: Record<string, unknown>): CvuRow | null {
  const from = dateOf(o.dat_iniciosemana);
  const to = dateOf(o.dat_fimsemana);
  const code = num(o.cod_usinaplanejamento);
  const cvu = num(o.val_cvu);
  if (!from || !to || code === null || cvu === null) return null;
  return { from, to, code, sub: subOfId(o.id_subsistema), name: String(o.nom_usina ?? "").trim(), cvu, study: String(o.nom_semanaoperativa ?? "").trim() };
}

/** CVU vigente de cada usina por dia (BRT): a semana operativa que contém o dia; revisão mais recente vence. */
export function cvuLookup(rows: CvuRow[]) {
  const byCode = new Map<number, CvuRow[]>();
  for (const r of rows) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r]);
  for (const list of byCode.values()) list.sort((a, b) => a.from.localeCompare(b.from));
  return (code: number, day: string): CvuRow | null => {
    const list = byCode.get(code);
    if (!list) return null;
    let hit: CvuRow | null = null;
    for (const r of list) if (r.from <= day && day <= r.to) hit = r;
    return hit;
  };
}

/** PLD (ou CMO) do submercado na hora, a partir de um painel horário. */
export function panelLookup(panel: SubPanel | null) {
  const at = new Map<number, number>();
  panel?.ts.forEach((t, i) => at.set(t, i));
  return (sub: Sub, ts: number): number | null => {
    const i = at.get(ts);
    const v = i === undefined ? null : panel!.values[sub][i];
    return v === null || v === undefined || !Number.isFinite(v) ? null : v;
  };
}

export type EssBreakdown = Record<EssKey, number>;
const zeroEss = (): EssBreakdown => ({ uc: 0, electric: 0, security: 0, off: 0 });

/**
 * ESS de uma usina numa hora (R$): fora da ordem de mérito (unit commitment, restrição elétrica,
 * segurança energética) vale max(0, CVU − PLD) × geração; constrained-off vale max(0, PLD − CVU) ×
 * corte. Usina com CVU nulo não tem direito; sem PLD na hora, não se estima.
 */
export function essOf(r: ThermalRow, cvu: number | null, pld: number | null): EssBreakdown {
  const e = zeroEss();
  if (cvu === null || cvu <= 0 || pld === null) return e;
  const up = Math.max(0, cvu - pld);
  e.uc = up * r.reasons.uc;
  e.electric = up * r.reasons.electric;
  e.security = up * r.reasons.security;
  e.off = Math.max(0, pld - cvu) * r.off;
  return e;
}

export interface ThermalDay {
  date: string;
  hours: number;
  /** MWmed do dia por motivo (SIN). */
  reasons: Record<ReasonKey, number>;
  gen: number;
  off: number;
  ess: EssBreakdown & { total: number };
  /** |soma dos motivos − geração| ÷ geração. */
  identityGap: number;
}

export interface MeritStep {
  name: string;
  fuel: string;
  cvu: number;
  avail: number;
  gen: number;
  /** Motivo com mais geração na hora. */
  reason: ReasonKey | null;
}

export interface MeritStack {
  sub: Sub;
  ts: number;
  cmo: number | null;
  steps: MeritStep[];
  /** Térmica marginal pelo preço: a mais cara gerando por mérito com CVU até o CMO da hora. */
  marginal: { name: string; cvu: number } | null;
  /**
   * Geração que o ONS classificou como mérito com CVU acima do CMO desta hora (MW). O ONS classifica
   * na programação com a sua referência de despacho; nem o CMO horário nem o semanal por patamar a
   * explicam por inteiro (≈ 20% da geração por mérito em out/2025).
   */
  meritAboveCmo: number;
  /** Próxima térmica disponível acima do CMO: quanto o custo precisa subir para ela ligar por mérito. */
  next: { name: string; cvu: number; gapToCmo: number | null } | null;
}

export interface PlantEss {
  code: number;
  name: string;
  sub: Sub;
  fuel: string;
  cvu: number | null;
  mwh: Record<EssKey, number>;
  ess: number;
}

export interface ThermalReport {
  from: string | null;
  to: string | null;
  days: ThermalDay[];
  bySub: Record<Sub, { gen: number; oom: number; ess: number }>;
  /** Médias da janela (MWmed) e ESS acumulado (R$). */
  totals: { gen: number; oomShare: number | null; ess: EssBreakdown & { total: number }; offMwh: number };
  plants: PlantEss[];
  merit: MeritStack[];
  checks: { identityMaxGap: number | null; cvuCoverage: number | null; pldCoverage: number | null; hours: number };
}

/** Dias fechados (24 horas) da janela, do mais antigo ao mais recente. */
export function thermalReport(rows: ThermalRow[], cvus: CvuRow[], pld: SubPanel | null, cmo: SubPanel | null, days: number): ThermalReport {
  const cvuOf = cvuLookup(cvus);
  const pldAt = panelLookup(pld);
  const cmoAt = panelLookup(cmo);
  const hoursByDay = new Map<string, Set<number>>();
  for (const r of rows) {
    const d = brtDate(r.ts);
    hoursByDay.set(d, (hoursByDay.get(d) ?? new Set()).add(brtHour(r.ts)));
  }
  const closed = [...hoursByDay.entries()].filter(([, h]) => h.size === 24).map(([d]) => d).sort().slice(-days);
  const inWindow = new Set(closed);

  const acc = new Map<string, ThermalDay & { parts: number }>();
  const bySub = Object.fromEntries(SUBS.map((s) => [s, { gen: 0, oom: 0, ess: 0 }])) as ThermalReport["bySub"];
  const plants = new Map<number, PlantEss>();
  let genWithCvu = 0;
  let genAll = 0;
  let essHours = 0;
  let essHoursPriced = 0;
  for (const r of rows) {
    const d = brtDate(r.ts);
    if (!inWindow.has(d)) continue;
    const day = acc.get(d) ?? {
      date: d,
      hours: 24,
      reasons: Object.fromEntries(REASONS.map((x) => [x.key, 0])) as Record<ReasonKey, number>,
      gen: 0,
      off: 0,
      ess: { ...zeroEss(), total: 0 },
      identityGap: 0,
      parts: 0,
    };
    for (const x of REASONS) {
      day.reasons[x.key] += r.reasons[x.key] / 24;
      day.parts += r.reasons[x.key];
    }
    day.gen += r.gen / 24;
    day.off += r.off / 24;
    const c = cvuOf(r.code, d);
    const p = pldAt(r.sub, r.ts);
    genAll += r.gen;
    if (c) genWithCvu += r.gen;
    const needsPrice = r.reasons.uc + r.reasons.electric + r.reasons.security + r.off > 0;
    if (needsPrice) {
      essHours++;
      if (p !== null) essHoursPriced++;
    }
    const e = essOf(r, c?.cvu ?? null, p);
    const eTot = e.uc + e.electric + e.security + e.off;
    for (const k of ESS_KEYS) day.ess[k] += e[k];
    day.ess.total += eTot;
    const oom = REASONS.filter((x) => x.oom).reduce((a, x) => a + r.reasons[x.key], 0);
    bySub[r.sub].gen += r.gen;
    bySub[r.sub].oom += oom;
    bySub[r.sub].ess += eTot;
    if (needsPrice) {
      const pl = plants.get(r.code) ?? { code: r.code, name: r.name, sub: r.sub, fuel: r.fuel, cvu: null, mwh: { ...zeroEss() }, ess: 0 };
      pl.mwh.uc += r.reasons.uc;
      pl.mwh.electric += r.reasons.electric;
      pl.mwh.security += r.reasons.security;
      pl.mwh.off += r.off;
      pl.ess += eTot;
      if (c) pl.cvu = c.cvu;
      plants.set(r.code, pl);
    }
    acc.set(d, day);
  }
  const dayList: ThermalDay[] = closed
    .map((d) => acc.get(d))
    .filter((x): x is ThermalDay & { parts: number } => !!x)
    .map(({ parts, ...day }) => ({ ...day, identityGap: day.gen > 0 ? Math.abs(parts / 24 - day.gen) / day.gen : 0 }));

  const n = dayList.length || 1;
  const ess = { ...zeroEss(), total: 0 };
  for (const d of dayList) {
    for (const k of ESS_KEYS) ess[k] += d.ess[k];
    ess.total += d.ess.total;
  }
  const genAvg = dayList.reduce((a, d) => a + d.gen, 0) / n;
  const oomAvg = dayList.reduce((a, d) => a + REASONS.filter((x) => x.oom).reduce((s, x) => s + d.reasons[x.key], 0), 0) / n;

  return {
    from: closed[0] ?? null,
    to: closed.at(-1) ?? null,
    days: dayList,
    bySub,
    totals: { gen: genAvg, oomShare: genAvg > 0 ? oomAvg / genAvg : null, ess, offMwh: dayList.reduce((a, d) => a + d.off * 24, 0) },
    plants: [...plants.values()].sort((a, b) => b.ess - a.ess || b.mwh.uc + b.mwh.electric + b.mwh.security - (a.mwh.uc + a.mwh.electric + a.mwh.security)).slice(0, 15),
    merit: meritStacks(rows, closed.at(-1) ?? null, cvuOf, cmoAt),
    checks: {
      identityMaxGap: dayList.length ? Math.max(...dayList.map((d) => d.identityGap)) : null,
      cvuCoverage: genAll > 0 ? genWithCvu / genAll : null,
      pldCoverage: essHours ? essHoursPriced / essHours : null,
      hours: dayList.length * 24,
    },
  };
}

/**
 * Pilha de mérito de cada submercado na hora de maior geração térmica do último dia: usinas por CVU
 * com a disponibilidade declarada e o que geraram, contra o CMO da hora.
 */
function meritStacks(rows: ThermalRow[], day: string | null, cvuOf: ReturnType<typeof cvuLookup>, cmoAt: ReturnType<typeof panelLookup>): MeritStack[] {
  if (!day) return [];
  const dayRows = rows.filter((r) => brtDate(r.ts) === day);
  const byHour = new Map<number, number>();
  for (const r of dayRows) byHour.set(r.ts, (byHour.get(r.ts) ?? 0) + r.gen);
  const ts = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (ts === undefined) return [];
  return SUBS.map((sub): MeritStack => {
    const cmo = cmoAt(sub, ts);
    const steps: MeritStep[] = dayRows
      .filter((r) => r.ts === ts && r.sub === sub)
      .map((r) => {
        const c = cvuOf(r.code, day);
        const top = REASONS.map((x) => [x.key, r.reasons[x.key]] as const).sort((a, b) => b[1] - a[1])[0];
        return { name: r.name, fuel: r.fuel, cvu: c?.cvu ?? NaN, avail: Math.max(0, r.avail ?? 0), gen: r.gen, reason: top && top[1] > 0 ? top[0] : null };
      })
      .filter((s) => Number.isFinite(s.cvu) && (s.avail > 0 || s.gen > 0))
      .sort((a, b) => a.cvu - b.cvu || a.name.localeCompare(b.name));
    const merit = steps.filter((s) => s.reason === "merit" && s.gen > 0);
    const priced = cmo === null ? merit : merit.filter((s) => s.cvu <= cmo + 0.5);
    const marginal = priced.length ? priced[priced.length - 1] : null;
    const meritAboveCmo = cmo === null ? 0 : merit.filter((s) => s.cvu > cmo + 0.5).reduce((a, s) => a + s.gen, 0);
    const nxt = steps.find((s) => s.avail - s.gen > 1 && cmo !== null && s.cvu > cmo) ?? null;
    return {
      sub,
      ts,
      cmo,
      steps,
      marginal: marginal ? { name: marginal.name, cvu: marginal.cvu } : null,
      meritAboveCmo,
      next: nxt ? { name: nxt.name, cvu: nxt.cvu, gapToCmo: cmo === null ? null : nxt.cvu - cmo } : null,
    };
  });
}

/**
 * Conferência com os boletins InfoPLD da CCEE (estimativa semanal de ESS por componente), com o
 * modelo rodado sobre os arquivos do ONS das mesmas semanas operativas e o PLD a partir do CMO do
 * ONS limitado ao piso e ao teto de 2025. Reproduzido em tests/real/thermal-live.test.ts.
 */
export const CCEE_VALIDATION = [
  {
    bulletin: "InfoPLD nº 716",
    url: "https://www.ccee.org.br/documents/80415/30094498/716%20-%20InfoPLD_2025_06_sem3.pdf/e34b8436-587b-776d-9c4c-8c258d0886cc",
    week: { from: "2025-06-14", to: "2025-06-20" },
    ccee: { uc: 2.57, off: 1.37, electric: 1.05, security: 2.71, total: 7.7 },
    model: { uc: 2.62, off: 1.83, electric: 0, security: 0 },
  },
  {
    bulletin: "InfoPLD nº 734",
    url: "https://www.ccee.org.br/documents/80415/30898213/734%20-%20InfoPLD_2025_10_sem4.pdf/5add86b1-a58c-9975-c462-9f4c0d5ec9b0",
    week: { from: "2025-10-18", to: "2025-10-24" },
    ccee: { uc: 22.68, off: 5.9, electric: 1.74, security: 0, total: 30.32 },
    model: { uc: 22.0, off: 4.34, electric: 0, security: 0 },
  },
] as const;
