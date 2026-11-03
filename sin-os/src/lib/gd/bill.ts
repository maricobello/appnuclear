import { CUSTO_DISPONIBILIDADE, enquadrar, parcelaNaoCompensada, type Enquadramento, type Ligacao } from "./rules";
import type { FaturaGD, UcGD } from "./types";

/**
 * Fatura esperada de uma UC do grupo B na GD e conferência de faturas reais (uma ou um
 * lote inteiro). Tudo determinístico: a Iara chama e recebe só o resumo — nenhuma fatura
 * passa pelo modelo de linguagem.
 */

const r2 = (v: number) => Math.round(v * 100) / 100;
const r0 = (v: number) => Math.round(v);
const pos = (v: number) => (v > 0 ? v : 0);

export interface TarifasB {
  /** TE e TUSD sem tributos (R$/kWh). */
  te: number;
  tusd: number;
  /** Fio B sem tributos (R$/kWh); sem valor ⇒ estimado em 30% de TE+TUSD. */
  fioB?: number | null;
  /** Fio A e encargos P&D/TFSEE (R$/kWh) — só entram no GD III. */
  fioA?: number | null;
  encargosGd3?: number | null;
  /** Adicional de bandeira (R$/kWh, sem tributos). */
  bandeira?: number;
  icms?: number;
  pis?: number;
  cofins?: number;
}

export interface EntradaFaturaB {
  enquadramento: Enquadramento;
  ano: number;
  transicaoAte?: number;
  consumoKwh: number;
  /** Injetada no mês + créditos recebidos de outras UCs. */
  creditosMesKwh: number;
  saldoAnteriorKwh: number;
  ligacao: Ligacao;
  tarifas: TarifasB;
  icmsCompensada?: "isento" | "tusd" | "integral";
  pisCofinsCompensada?: "isento" | "integral";
  cipRs?: number;
  outrosRs?: number;
}

export interface FaturaEsperada {
  compensadaKwh: number;
  saldoFinalKwh: number;
  /** kWh pagos com a tarifa cheia (consumo não compensado). */
  faturadaKwh: number;
  minimoAplicado: boolean;
  fioBPct: number;
  linhas: { item: string; kwh?: number; valorRs: number }[];
  tributos: { icms: number; pis: number; cofins: number };
  totalRs: number;
  /** Total que a mesma UC pagaria sem GD (para a economia). */
  semGdRs: number;
  premissas: string[];
}

/** Bases tributadas "por dentro": cada base b com o conjunto de tributos S vale b/(1−ΣS). */
function grossUp(bases: { valor: number; icms: boolean; pisCofins: boolean }[], t: { icms: number; pis: number; cofins: number }) {
  const out = { icms: 0, pis: 0, cofins: 0 };
  for (const b of bases) {
    if (b.valor <= 0) continue;
    const rate = (b.icms ? t.icms : 0) + (b.pisCofins ? t.pis + t.cofins : 0);
    if (rate <= 0 || rate >= 0.9) continue;
    const gross = b.valor / (1 - rate);
    if (b.icms) out.icms += gross * t.icms;
    if (b.pisCofins) {
      out.pis += gross * t.pis;
      out.cofins += gross * t.cofins;
    }
  }
  return out;
}

export function faturaEsperadaB(e: EntradaFaturaB): FaturaEsperada {
  const premissas: string[] = [];
  const { te, tusd } = e.tarifas;
  const T = te + tusd;
  let fioB = e.tarifas.fioB ?? null;
  if (fioB === null) {
    fioB = 0.3 * T;
    premissas.push("Fio B estimado em 30% de TE+TUSD — informe o valor da distribuidora para precisão");
  }
  const p = parcelaNaoCompensada(e.enquadramento, e.ano, e.transicaoAte);
  if (p.pendenteArt17) premissas.push("ano na regra do art. 17 (valoração ainda pendente): suposto 100% do Fio B");
  let k = p.fioB * fioB;
  if (e.enquadramento === "GD III") {
    const fioA = e.tarifas.fioA ?? 0.08 * T;
    if (e.tarifas.fioA == null) premissas.push("Fio A estimado em 8% de TE+TUSD (GD III paga 40% dele)");
    k += p.fioA * fioA + (e.tarifas.encargosGd3 ?? 0);
    if (e.tarifas.encargosGd3 == null) premissas.push("P&D/EE e TFSEE do GD III não informados (somados como zero)");
  }
  k = Math.min(k, T);
  const C = pos(e.consumoKwh);
  const D = CUSTO_DISPONIBILIDADE[e.ligacao];
  const disp = pos(e.creditosMesKwh) + pos(e.saldoAnteriorKwh);

  let E = 0;
  if (e.enquadramento === "GD I") E = Math.min(disp, pos(C - D));
  else if (e.enquadramento !== "sem GD") {
    const E0 = Math.min(disp, C);
    if ((C - E0) * T + E0 * k >= D * T) E = E0;
    else if (C > D && T > k) E = Math.min(E0, ((C - D) * T) / (T - k));
  }
  const cheia = C - E;
  const valorEnergia = cheia * T;
  const valorFioB = E * k;
  const complemento = pos(D * T - (valorEnergia + valorFioB));
  const bandeiraKwh = cheia + (complemento > 0 && T > 0 ? complemento / T : 0);
  const bandeiraRs = (e.tarifas.bandeira ?? 0) * bandeiraKwh;
  const tx = { icms: e.tarifas.icms ?? 0, pis: e.tarifas.pis ?? 0, cofins: e.tarifas.cofins ?? 0 };
  if (!e.tarifas.icms) premissas.push("ICMS não informado (zero)");
  const bases = [
    { valor: valorEnergia + complemento + bandeiraRs, icms: true, pisCofins: true },
    // o Fio B sobre a compensada é energia faturada: tratado como tributável (conferir no estado)
    { valor: valorFioB, icms: true, pisCofins: true },
  ];
  const trib = grossUp(bases, tx);
  if (e.icmsCompensada === "tusd" || e.icmsCompensada === "integral") {
    const b = E * (e.icmsCompensada === "tusd" ? tusd : T);
    trib.icms += tx.icms > 0 && tx.icms < 0.9 ? (b * tx.icms) / (1 - tx.icms) : 0;
    premissas.push(e.icmsCompensada === "tusd" ? "ICMS cobrado sobre a TUSD da energia compensada" : "ICMS cobrado sobre toda a energia compensada");
  }
  if (e.pisCofinsCompensada === "integral") {
    const rate = tx.pis + tx.cofins;
    const b = E * T;
    if (rate > 0 && rate < 0.9) {
      trib.pis += (b * tx.pis) / (1 - rate);
      trib.cofins += (b * tx.cofins) / (1 - rate);
    }
    premissas.push("PIS/Cofins sobre a energia compensada (sem a alíquota zero da Lei 13.169)");
  }
  const outros = (e.cipRs ?? 0) + (e.outrosRs ?? 0);
  const total = valorEnergia + valorFioB + complemento + bandeiraRs + trib.icms + trib.pis + trib.cofins + outros;

  const semBase = Math.max(C, D) * T + (e.tarifas.bandeira ?? 0) * Math.max(C, D);
  const semTrib = grossUp([{ valor: semBase, icms: true, pisCofins: true }], tx);
  const semGd = semBase + semTrib.icms + semTrib.pis + semTrib.cofins + outros;

  const linhas: FaturaEsperada["linhas"] = [{ item: "Energia faturada (TE+TUSD)", kwh: r2(cheia), valorRs: r2(valorEnergia) }];
  if (valorFioB > 0) linhas.push({ item: `Fio B sobre a compensada (${Math.round(p.fioB * 100)}%)`, kwh: r2(E), valorRs: r2(valorFioB) });
  if (complemento > 0) linhas.push({ item: "Complemento até o custo de disponibilidade", kwh: r2(complemento / (T || 1)), valorRs: r2(complemento) });
  if (bandeiraRs > 0) linhas.push({ item: "Adicional de bandeira", kwh: r2(bandeiraKwh), valorRs: r2(bandeiraRs) });
  if (outros > 0) linhas.push({ item: "CIP e outros", valorRs: r2(outros) });
  return {
    compensadaKwh: r2(E),
    saldoFinalKwh: r2(disp - E),
    faturadaKwh: r2(cheia),
    minimoAplicado: complemento > 0 || (E > 0 && E < Math.min(disp, C) - 1e-6),
    fioBPct: Math.round(p.fioB * 100),
    linhas,
    tributos: { icms: r2(trib.icms), pis: r2(trib.pis), cofins: r2(trib.cofins) },
    totalRs: r2(total),
    semGdRs: r2(semGd),
    premissas,
  };
}

/* --------------------------------------------------------------- conferência */

export type Severidade = "alta" | "media" | "baixa";
export interface Alerta {
  uc: string;
  ref: string;
  codigo: string;
  sev: Severidade;
  msg: string;
  impactoRs?: number;
}

const SEV_W: Record<Severidade, number> = { alta: 3, media: 2, baixa: 1 };
const median = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmtKwh = (v: number) => `${Math.round(v).toLocaleString("pt-BR")} kWh`;
const fmtRs = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Enquadramento efetivo: o da fatura, o da UC ou derivado do protocolo. */
export function enqDe(f: FaturaGD, uc?: UcGD): Enquadramento {
  if (f.enquadramento) return f.enquadramento;
  if (uc?.enquadramento) return uc.enquadramento;
  if (uc?.dataProtocolo) return enquadrar({ dataProtocolo: uc.dataProtocolo, potenciaKw: uc.potenciaKw, fonte: uc.fonte }).enquadramento;
  const temGd = (f.injetadaKwh ?? 0) > 0 || (f.compensadaKwh ?? 0) > 0 || (f.creditosRecebidosKwh ?? 0) > 0 || (f.saldoKwh ?? 0) > 0;
  return temGd ? "GD II" : "sem GD";
}

/** Preço médio pago por kWh faturado (com tributos), para estimar impacto em R$. */
function precoMedio(f: FaturaGD): number | null {
  // itens de energia somam o consumo bruto (antes do crédito): valor ÷ kWh consumidos
  if (f.energiaRs && f.consumoKwh && f.consumoKwh > 5) return f.energiaRs / f.consumoKwh;
  if (f.teRsKwh && f.tusdRsKwh) return f.tarifasComTributos ? f.teRsKwh + f.tusdRsKwh : (f.teRsKwh + f.tusdRsKwh) / 0.75;
  const cheia = (f.consumoKwh ?? 0) - (f.compensadaKwh ?? 0);
  const base = (f.totalRs ?? 0) - (f.cipRs ?? 0) - (f.multasRs ?? 0);
  return base > 0 && cheia > 5 ? base / cheia : null;
}

export function conferirFatura(f: FaturaGD, ctx: { uc?: UcGD; anterior?: FaturaGD; historico?: FaturaGD[] } = {}): Alerta[] {
  const out: Alerta[] = [];
  const uc = f.uc ?? "?";
  const ref = f.ref ?? "?";
  const add = (codigo: string, sev: Severidade, msg: string, impactoRs?: number) => out.push({ uc, ref, codigo, sev, msg, ...(impactoRs && impactoRs > 0 ? { impactoRs: r2(impactoRs) } : {}) });
  const enq = enqDe(f, ctx.uc);
  const lig = f.ligacao ?? ctx.uc?.ligacao;
  const D = lig ? CUSTO_DISPONIBILIDADE[lig] : null;
  const C = f.consumoKwh;
  const E = f.compensadaKwh ?? 0;
  const preco = precoMedio(f);
  const ano = Number(ref.slice(0, 4)) || new Date().getFullYear();

  if (f.confianca < 0.5) add("leitura_incompleta", "baixa", `Leitura da fatura incompleta (faltando: ${f.faltando.slice(0, 6).join(", ") || "vários campos"}) — confira os valores`);
  if (f.leituraEstimada) add("leitura_estimada", "media", "Leitura estimada ou pela média: a compensação e o saldo podem estar errados até a leitura real");
  if (f.dias && (f.dias < 27 || f.dias > 33)) add("dias_fora", "baixa", `Ciclo de ${f.dias} dias (normal 27–33): pode distorcer consumo e custo de disponibilidade`);

  // créditos parados enquanto a UC pagava energia cheia
  if (C !== undefined && enq !== "sem GD") {
    const disp = (f.saldoAnteriorKwh ?? 0) + (f.injetadaKwh ?? 0) + (f.creditosRecebidosKwh ?? 0);
    const sobra = f.saldoKwh ?? (disp > 0 ? disp - E : 0);
    const cheia = C - E;
    const piso = (D ?? 0) * 1.05 + 2;
    if (sobra > 5 && cheia > piso) {
      const kwhPerdidos = Math.min(sobra, cheia - (D ?? 0));
      add("creditos_nao_usados", "alta", `Havia ${fmtKwh(sobra)} de crédito e ${fmtKwh(cheia)} foram faturados cheios — a compensação deveria ir até o mínimo`, preco ? kwhPerdidos * preco : undefined);
    }
  }

  // Fio B: GD I não paga; GD II/III com percentual do ano
  if (f.fioBRs && f.fioBRs > 0.5) {
    if (enq === "GD I") add("fio_b_gd1", "alta", `Cobrança de Fio B (${fmtRs(f.fioBRs)}) numa UC GD I — o GD I compensa integralmente até 2045`, f.fioBRs);
    else if (E > 0 && ctx.uc?.fioBRsKwh) {
      const esperado = parcelaNaoCompensada(enq, ano).fioB;
      const implicito = f.fioBRs / (E * ctx.uc.fioBRsKwh * (f.tarifasComTributos === false ? 1 : 1 / 0.75));
      if (Math.abs(implicito - esperado) > 0.08)
        add("fio_b_percentual", "media", `Fio B cobrado equivale a ~${Math.round(implicito * 100)}% (esperado ${Math.round(esperado * 100)}% em ${ano} para ${enq})`, implicito > esperado ? f.fioBRs * (1 - esperado / implicito) : undefined);
    }
  }

  // custo de disponibilidade junto com Fio B (GD II/III): a ANEEL diz que não há duplicidade
  if ((enq === "GD II" || enq === "GD III") && (f.fioBRs ?? 0) > 0.5) {
    const cheia = C !== undefined ? C - E : null;
    const pagouMinimo = (f.disponibilidadeRs ?? 0) > 0.5 || (D !== null && cheia !== null && Math.abs(cheia - D) <= 2 && E > 0);
    if (pagouMinimo) {
      const imp = Math.min(f.disponibilidadeRs || (D && preco ? D * preco : 0), f.fioBRs ?? 0);
      add("disponibilidade_duplicada", "alta", "Custo de disponibilidade e Fio B cobrados juntos — na GD II paga-se o maior dos dois, não a soma (confirmar com a distribuidora)", imp || undefined);
    }
  }

  // tributos sobre a energia compensada: base implícita maior que a própria fatura
  const tributavel = (f.totalRs ?? 0) - (f.cipRs ?? 0) - (f.multasRs ?? 0);
  if (E > 0 && tributavel > 0) {
    if (f.pisRs && f.cofinsRs && f.pisPct && f.cofinsPct) {
      const base = (f.pisRs + f.cofinsRs) / (f.pisPct + f.cofinsPct);
      if (base > tributavel * 1.15) add("pis_cofins_compensada", "media", `PIS/Cofins calculados sobre ${fmtRs(base)}, acima do valor da fatura — possível incidência sobre a energia compensada (Lei 13.169/2015, art. 8º)`, (base - tributavel) * (f.pisPct + f.cofinsPct));
    }
    if (f.icmsRs && f.icmsPct) {
      const base = f.icmsRs / f.icmsPct;
      if (base > tributavel * 1.15) add("icms_compensada", "media", `ICMS calculado sobre ${fmtRs(base)}, acima do valor da fatura — ICMS sobre a energia compensada? Depende do estado (Convênio ICMS 16/2015)`, (base - tributavel) * f.icmsPct);
    }
  }

  if (f.saldoExpirarKwh && f.saldoExpirarKwh > 0) add("creditos_expirando", "alta", `${fmtKwh(f.saldoExpirarKwh)} de crédito a expirar — realocar o rateio ou antecipar consumo`, preco ? f.saldoExpirarKwh * preco : undefined);

  // grupo A
  if (f.ultrapassagemRs && f.ultrapassagemRs > 0) add("ultrapassagem", "alta", `Ultrapassagem de demanda cobrada (${fmtRs(f.ultrapassagemRs)}) — rever a demanda contratada`, f.ultrapassagemRs);
  else if (f.demandaKw && f.demandaContratadaKw && f.demandaKw > f.demandaContratadaKw * 1.05) add("ultrapassagem", "alta", `Demanda medida ${r0(f.demandaKw)} kW acima de 105% da contratada (${r0(f.demandaContratadaKw)} kW)`);
  if (f.reativoRs && f.reativoRs > 0) add("reativo", "media", `Energia reativa excedente cobrada (${fmtRs(f.reativoRs)}): fator de potência abaixo de 0,92 — avaliar banco de capacitores`, f.reativoRs);

  // comparação com o mês anterior e o histórico da UC
  if (ctx.anterior?.saldoKwh !== undefined && f.saldoAnteriorKwh !== undefined) {
    const diff = f.saldoAnteriorKwh - ctx.anterior.saldoKwh;
    if (Math.abs(diff) > 5 && Math.abs(diff) > 0.02 * Math.max(1, ctx.anterior.saldoKwh)) add("saldo_inconsistente", "media", `Saldo anterior (${fmtKwh(f.saldoAnteriorKwh)}) difere do saldo final do mês passado (${fmtKwh(ctx.anterior.saldoKwh)})`, diff < 0 && preco ? -diff * preco : undefined);
  }
  const hist = ctx.historico ?? [];
  if (hist.length >= 3) {
    const mc = median(hist.map((h) => h.consumoKwh ?? NaN));
    if (mc && C !== undefined && mc > 20 && (C > mc * 1.5 || C < mc * 0.5)) add("consumo_atipico", "baixa", `Consumo de ${fmtKwh(C)} fora do padrão (mediana ${fmtKwh(mc)}) — conferir leitura ou mudança de uso`);
    const mi = median(hist.map((h) => h.injetadaKwh ?? NaN));
    if (mi && f.injetadaKwh !== undefined && mi > 50 && f.injetadaKwh < mi * 0.6) add("injecao_queda", "media", `Injeção caiu para ${fmtKwh(f.injetadaKwh)} (mediana ${fmtKwh(mi)}) — verificar usina (inversor, sujeira, sombra) ou medição`);
    const saldos = [...hist.slice(-2).map((h) => h.saldoKwh ?? NaN), f.saldoKwh ?? NaN];
    if (saldos.every(Number.isFinite) && saldos[0] < saldos[1] && saldos[1] < saldos[2] && mc && saldos[2] > mc * 2)
      add("saldo_acumulando", "baixa", `Saldo crescendo há 3 meses (${fmtKwh(saldos[2])}): sobra de créditos — avaliar rateio para outra UC ou o dimensionamento`);
  }
  return out;
}

/* ------------------------------------------------------------- demanda (grupo A) */

/** Demanda contratada que minimiza o custo anual (faturamento pela maior entre medida e contratada + ultrapassagem acima de 105%). */
export function otimizarDemanda(medidasKw: number[], tarifaRsKw: number, contratadaAtualKw?: number) {
  const m = medidasKw.filter((x) => Number.isFinite(x) && x > 0);
  if (m.length < 3 || !(tarifaRsKw > 0)) return null;
  const custo = (dc: number) => m.reduce((s, d) => s + Math.max(d, dc) * tarifaRsKw + (d > dc * 1.05 ? (d - dc) * 2 * tarifaRsKw : 0), 0) * (12 / m.length);
  const lo = Math.floor(Math.min(...m) * 0.8);
  const hi = Math.ceil(Math.max(...m) * 1.1);
  const step = Math.max(1, Math.round((hi - lo) / 600));
  let best = hi;
  let bestC = custo(hi);
  for (let dc = Math.max(1, lo); dc <= hi; dc += step) {
    const c = custo(dc);
    if (c < bestC - 1e-9) {
      best = dc;
      bestC = c;
    }
  }
  const atual = contratadaAtualKw && contratadaAtualKw > 0 ? custo(contratadaAtualKw) : null;
  return { otimaKw: best, custoAnualRs: r2(bestC), atualKw: contratadaAtualKw ?? null, custoAtualRs: atual === null ? null : r2(atual), economiaAnoRs: atual === null ? null : r2(atual - bestC), meses: m.length };
}

/* ------------------------------------------------------------------- lote */

export interface ResumoUc {
  uc: string;
  apelido?: string;
  meses: number;
  de: string | null;
  ate: string | null;
  enquadramento: Enquadramento;
  consumoKwh: number;
  injetadaKwh: number;
  compensadaKwh: number;
  saldoFinalKwh: number | null;
  totalRs: number;
  alertas: { alta: number; media: number; baixa: number };
  impactoRs: number;
  demanda?: ReturnType<typeof otimizarDemanda>;
}

export interface Lote {
  faturas: number;
  ucs: ResumoUc[];
  alertas: Alerta[];
  totais: { consumoKwh: number; injetadaKwh: number; compensadaKwh: number; totalRs: number; impactoRs: number; alta: number; media: number; baixa: number };
}

export function conferirLote(faturas: FaturaGD[], ucs: UcGD[] = []): Lote {
  const byUc = new Map<string, FaturaGD[]>();
  for (const f of faturas) {
    const k = f.uc ?? "sem UC";
    byUc.set(k, [...(byUc.get(k) ?? []), f]);
  }
  const ucMap = new Map(ucs.map((u) => [u.uc, u]));
  const alertas: Alerta[] = [];
  const resumo: ResumoUc[] = [];
  for (const [k, fs] of byUc) {
    // duplicadas (mesmo mês lido duas vezes): fica a de maior confiança
    const porRef = new Map<string, FaturaGD>();
    for (const f of fs) {
      const rk = f.ref ?? f.id;
      const cur = porRef.get(rk);
      if (!cur || f.confianca > cur.confianca) porRef.set(rk, f);
    }
    const list = [...porRef.values()].sort((a, b) => (a.ref ?? "").localeCompare(b.ref ?? ""));
    const uc = ucMap.get(k);
    const ucAlerts: Alerta[] = [];
    list.forEach((f, i) => ucAlerts.push(...conferirFatura(f, { uc, anterior: i > 0 ? list[i - 1] : undefined, historico: list.slice(Math.max(0, i - 6), i) })));
    const sum = (sel: (f: FaturaGD) => number | undefined) => r2(list.reduce((s, f) => s + (sel(f) ?? 0), 0));
    const cnt = { alta: 0, media: 0, baixa: 0 };
    ucAlerts.forEach((a) => cnt[a.sev]++);
    const grupoA = list.some((f) => f.grupo === "A" || f.demandaKw !== undefined);
    const demanda = grupoA && uc?.tarifaDemandaRsKw ? otimizarDemanda(list.map((f) => f.demandaKw ?? NaN), uc.tarifaDemandaRsKw, list.at(-1)?.demandaContratadaKw) : undefined;
    resumo.push({
      uc: k,
      apelido: uc?.apelido,
      meses: list.length,
      de: list[0]?.ref ?? null,
      ate: list.at(-1)?.ref ?? null,
      enquadramento: list.length ? enqDe(list.at(-1)!, uc) : "sem GD",
      consumoKwh: sum((f) => f.consumoKwh),
      injetadaKwh: sum((f) => f.injetadaKwh),
      compensadaKwh: sum((f) => f.compensadaKwh),
      saldoFinalKwh: list.at(-1)?.saldoKwh ?? null,
      totalRs: sum((f) => f.totalRs),
      alertas: cnt,
      impactoRs: r2(ucAlerts.reduce((s, a) => s + (a.impactoRs ?? 0), 0)),
      ...(demanda ? { demanda } : {}),
    });
    alertas.push(...ucAlerts);
  }
  alertas.sort((a, b) => SEV_W[b.sev] - SEV_W[a.sev] || (b.impactoRs ?? 0) - (a.impactoRs ?? 0));
  const totais = {
    consumoKwh: r2(resumo.reduce((s, u) => s + u.consumoKwh, 0)),
    injetadaKwh: r2(resumo.reduce((s, u) => s + u.injetadaKwh, 0)),
    compensadaKwh: r2(resumo.reduce((s, u) => s + u.compensadaKwh, 0)),
    totalRs: r2(resumo.reduce((s, u) => s + u.totalRs, 0)),
    impactoRs: r2(resumo.reduce((s, u) => s + u.impactoRs, 0)),
    alta: alertas.filter((a) => a.sev === "alta").length,
    media: alertas.filter((a) => a.sev === "media").length,
    baixa: alertas.filter((a) => a.sev === "baixa").length,
  };
  return { faturas: faturas.length, ucs: resumo.sort((a, b) => b.impactoRs - a.impactoRs || b.totalRs - a.totalRs), alertas, totais };
}
