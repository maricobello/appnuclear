import { faturaEsperadaB } from "./bill";
import type { CarteiraGD, FaturaGD, UcGD, UsinaGD } from "./types";

/**
 * Resultados financeiros da GD por UC e por usina, mês a mês: o que a UC gastou com a GD
 * (fatura da distribuidora + a SUA parte dos custos da usina, pelo percentual de rateio)
 * contra o cativo simulado (quanto pagaria sem GD) e contra a economia assegurada em
 * contrato. Custo da usina inteira lançado numa UC só é o erro clássico de relatório —
 * aqui o rateio é explícito e conferido.
 */

const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;

export type OrigemCativo = "tarifa da fatura" | "fatura + créditos" | "itens de energia" | "tarifas da UC";

export interface CustosMes {
  geracaoRs: number;
  locacaoRs: number;
  terrenoRs: number;
  omRs: number;
  variavelRs: number;
  /** Pagamento direto da UC (assinatura ou aluguel da própria UC). */
  contratoRs: number;
}

export interface LinhaResultado {
  ref: string;
  rateioPct: number | null;
  assegPct: number | null;
  consumoKwh: number | null;
  compensadaKwh: number | null;
  distribuidoraRs: number | null;
  custos: CustosMes;
  custosGdRs: number;
  despesaRs: number | null;
  cativoRs: number | null;
  cativoOrigem: OrigemCativo | null;
  economiaRs: number | null;
  economiaPct: number | null;
  /** Cativo com o desconto assegurado: o teto que a despesa deveria respeitar. */
  assegRs: number | null;
  /** Despesa acima do teto assegurado (positivo = garantia não cumprida no mês). */
  faltaAssegRs: number | null;
}

export interface AlertaGestao {
  codigo: "rateio_ausente" | "rateio_suspeito" | "garantia" | "economia_negativa" | "cativo_faltando" | "rateio_soma";
  sev: "alta" | "media" | "baixa";
  msg: string;
  impactoRs?: number;
}

export interface Totais {
  meses: number;
  consumoKwh: number;
  compensadaKwh: number;
  distribuidoraRs: number;
  custosGdRs: number;
  despesaRs: number;
  cativoRs: number;
  economiaRs: number;
  economiaPct: number | null;
  assegRs: number;
  faltaAssegRs: number;
}

export interface ResultadoUc {
  uc: string;
  apelido?: string;
  usinaId?: string;
  usinaNome?: string;
  linhas: LinhaResultado[];
  total: Totais;
  alertas: AlertaGestao[];
}

export interface ResultadoUsina {
  id: string;
  nome: string;
  ucs: string[];
  rateioSomaPct: number;
  linhas: { ref: string; despesaRs: number; cativoRs: number; economiaRs: number; economiaPct: number | null; custosGdRs: number }[];
  total: Totais;
  alertas: AlertaGestao[];
}

const fmtRs = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ucKey = (s: string | undefined) => (s ? s.replace(/\D/g, "") || s : "sem UC");

/** Quanto a UC pagaria no mês sem a GD (energia cheia com tributos + bandeira + CIP). */
export function cativoSimulado(f: FaturaGD, uc?: UcGD): { rs: number; origem: OrigemCativo } | null {
  const C = f.consumoKwh;
  // sem GD a bandeira incidiria sobre o consumo todo, não só sobre a parte faturada
  const faturadoKwh = C !== undefined && f.compensadaKwh ? C - f.compensadaKwh : C;
  const bandeiraCheia = f.bandeiraRs && C && faturadoKwh && faturadoKwh > 0 ? (f.bandeiraRs * C) / faturadoKwh : (f.bandeiraRs ?? 0);
  const extras = bandeiraCheia + (f.cipRs ?? 0);
  // "fatura + créditos": tira o que só existe por causa da GD (Fio B, custo de disponibilidade) e completa a bandeira
  const faturaMaisCreditos = () => f.totalRs! + Math.abs(f.compensacaoRs ?? 0) - (f.fioBRs ?? 0) - (f.disponibilidadeRs ?? 0) + (bandeiraCheia - (f.bandeiraRs ?? 0));
  const grupoA = f.grupo === "A" || f.demandaKw !== undefined;
  // grupo A: a demanda não muda com a GD — o pago + o valor dos créditos é o cativo
  if (grupoA) return f.totalRs !== undefined && f.compensacaoRs ? { rs: faturaMaisCreditos(), origem: "fatura + créditos" } : f.totalRs !== undefined && !f.compensadaKwh ? { rs: f.totalRs, origem: "fatura + créditos" } : null;
  const preco = (f.teRsKwh ?? 0) + (f.tusdRsKwh ?? 0);
  if (C && preco > 0 && f.tarifasComTributos !== false) return { rs: C * preco + extras, origem: "tarifa da fatura" };
  if (f.totalRs !== undefined && f.compensacaoRs) return { rs: faturaMaisCreditos(), origem: "fatura + créditos" };
  if (f.energiaRs && f.energiaRs > 0) return { rs: f.energiaRs + extras, origem: "itens de energia" };
  const lig = f.ligacao ?? uc?.ligacao;
  if (C && uc?.teRsKwh && uc?.tusdRsKwh && lig) {
    const e = faturaEsperadaB({ enquadramento: "sem GD", ano: Number((f.ref ?? "2026").slice(0, 4)), consumoKwh: C, creditosMesKwh: 0, saldoAnteriorKwh: 0, ligacao: lig, tarifas: { te: uc.teRsKwh, tusd: uc.tusdRsKwh, icms: uc.icms, pis: uc.pis, cofins: uc.cofins }, cipRs: f.cipRs });
    return { rs: e.semGdRs, origem: "tarifas da UC" };
  }
  return null;
}

function custosMes(f: FaturaGD, ref: string, uc: UcGD | undefined, usina: UsinaGD | undefined, rateio: number | null, cativoKwh: number | null): CustosMes {
  const m = (ref && usina?.meses?.[ref]) || {};
  const r = rateio ?? 0;
  const v = (mes: number | undefined, base: number | undefined) => (mes ?? base ?? 0) * r;
  const comp = f.compensadaKwh ?? 0;
  let contratoRs = 0;
  const c = uc?.contrato;
  if (c?.tipo === "assinatura" && c.descontoPct !== undefined && comp > 0 && cativoKwh) contratoRs = comp * cativoKwh * (1 - c.descontoPct / 100);
  else if (c?.aluguelRsMes) contratoRs = c.aluguelRsMes;
  return {
    geracaoRs: v(m.faturaGeracaoRs, undefined),
    locacaoRs: v(m.locacaoRsMes, usina?.locacaoRsMes),
    terrenoRs: v(m.terrenoRsMes, usina?.terrenoRsMes),
    omRs: v(m.omRsMes, usina?.omRsMes),
    variavelRs: v(m.variavelRsMes, usina?.variavelRsMes) + (usina?.variavelRsKwh ?? 0) * comp,
    contratoRs,
  };
}

function totais(ls: LinhaResultado[]): Totais {
  const s = (sel: (l: LinhaResultado) => number | null) => r2(ls.reduce((a, l) => a + (sel(l) ?? 0), 0));
  const comCativo = ls.filter((l) => l.cativoRs !== null && l.despesaRs !== null);
  const cativo = r2(comCativo.reduce((a, l) => a + l.cativoRs!, 0));
  const despesaC = r2(comCativo.reduce((a, l) => a + l.despesaRs!, 0));
  return {
    meses: ls.length,
    consumoKwh: s((l) => l.consumoKwh),
    compensadaKwh: s((l) => l.compensadaKwh),
    distribuidoraRs: s((l) => l.distribuidoraRs),
    custosGdRs: s((l) => l.custosGdRs),
    despesaRs: s((l) => l.despesaRs),
    cativoRs: cativo,
    economiaRs: r2(cativo - despesaC),
    economiaPct: cativo > 0 ? r1(((cativo - despesaC) / cativo) * 100) : null,
    assegRs: s((l) => l.assegRs),
    faltaAssegRs: r2(ls.reduce((a, l) => a + Math.max(0, l.faltaAssegRs ?? 0), 0)),
  };
}

export function resultadosUc(ucId: string, faturas: FaturaGD[], uc?: UcGD, usina?: UsinaGD): ResultadoUc {
  const porRef = new Map<string, FaturaGD>();
  for (const f of faturas) {
    const k = f.ref ?? f.id;
    const cur = porRef.get(k);
    if (!cur || f.confianca > cur.confianca) porRef.set(k, f);
  }
  const fs = [...porRef.values()].sort((a, b) => (a.ref ?? "").localeCompare(b.ref ?? ""));
  const rateio = uc?.rateioPct !== undefined ? uc.rateioPct / 100 : null;
  const assegPct = usina?.economiaAssegPct ?? (uc?.contrato?.tipo !== "assinatura" ? uc?.contrato?.descontoPct : undefined) ?? null;
  const linhas: LinhaResultado[] = fs.map((f) => {
    const cat = cativoSimulado(f, uc);
    const precoFatura = (f.teRsKwh ?? 0) + (f.tusdRsKwh ?? 0);
    const precoKwh = precoFatura > 0 && f.tarifasComTributos !== false ? precoFatura : cat && f.consumoKwh ? cat.rs / f.consumoKwh : null;
    const custos = custosMes(f, f.ref ?? "", uc, usina, usina ? rateio : null, precoKwh);
    const custosGdRs = r2(custos.geracaoRs + custos.locacaoRs + custos.terrenoRs + custos.omRs + custos.variavelRs + custos.contratoRs);
    const despesa = f.totalRs !== undefined ? r2(f.totalRs + custosGdRs) : null;
    const econ = cat && despesa !== null ? r2(cat.rs - despesa) : null;
    const asseg = cat && assegPct !== null ? r2(cat.rs * (1 - assegPct / 100)) : null;
    return {
      ref: f.ref ?? "?",
      rateioPct: uc?.rateioPct ?? null,
      assegPct,
      consumoKwh: f.consumoKwh ?? null,
      compensadaKwh: f.compensadaKwh ?? null,
      distribuidoraRs: f.totalRs ?? null,
      custos: { geracaoRs: r2(custos.geracaoRs), locacaoRs: r2(custos.locacaoRs), terrenoRs: r2(custos.terrenoRs), omRs: r2(custos.omRs), variavelRs: r2(custos.variavelRs), contratoRs: r2(custos.contratoRs) },
      custosGdRs,
      despesaRs: despesa,
      cativoRs: cat ? r2(cat.rs) : null,
      cativoOrigem: cat?.origem ?? null,
      economiaRs: econ,
      economiaPct: econ !== null && cat && cat.rs > 0 ? r1((econ / cat.rs) * 100) : null,
      assegRs: asseg,
      faltaAssegRs: asseg !== null && despesa !== null ? r2(despesa - asseg) : null,
    };
  });
  const total = totais(linhas);
  const alertas: AlertaGestao[] = [];
  if (usina && rateio === null) alertas.push({ codigo: "rateio_ausente", sev: "alta", msg: `UC ${ucId} ligada à usina ${usina.nome ?? usina.id} sem percentual de rateio: os custos da usina não entraram na conta` });
  const pior = linhas.filter((l) => l.economiaPct !== null).sort((a, b) => a.economiaPct! - b.economiaPct!)[0];
  if (pior && pior.economiaPct! < -50)
    alertas.push({ codigo: "rateio_suspeito", sev: "alta", msg: `Economia de ${pior.economiaPct!.toLocaleString("pt-BR")}% em ${pior.ref}: os custos lançados (${fmtRs(pior.custosGdRs)}) são muito maiores que o cativo (${fmtRs(pior.cativoRs!)}) — provável custo da usina inteira sem rateio` });
  const mesesFalta = linhas.filter((l) => l.faltaAssegRs !== null && l.cativoRs && l.faltaAssegRs > Math.max(1, 0.005 * l.cativoRs));
  if (mesesFalta.length)
    alertas.push({ codigo: "garantia", sev: "alta", msg: `Em ${mesesFalta.length} de ${linhas.length} mês(es) a despesa passou do valor com a economia assegurada de ${assegPct}%: faltaram ${fmtRs(total.faltaAssegRs)} — cobrar conforme o contrato`, impactoRs: total.faltaAssegRs });
  if (total.cativoRs > 0 && total.economiaRs < 0 && !alertas.some((a) => a.codigo === "rateio_suspeito"))
    alertas.push({ codigo: "economia_negativa", sev: "alta", msg: `A GD custou ${fmtRs(-total.economiaRs)} a mais do que o cativo no período`, impactoRs: -total.economiaRs });
  const sem = linhas.filter((l) => l.cativoRs === null).length;
  if (sem) alertas.push({ codigo: "cativo_faltando", sev: "baixa", msg: `${sem} mês(es) sem cativo simulado (faltam preços na fatura ou tarifas da UC): ficam fora da economia` });
  return { uc: ucId, apelido: uc?.apelido, usinaId: usina?.id, usinaNome: usina?.nome, linhas, total, alertas };
}

export function resultadosCarteira(c: CarteiraGD): { ucs: ResultadoUc[]; usinas: ResultadoUsina[] } {
  const byUc = new Map<string, FaturaGD[]>();
  for (const f of c.faturas) {
    const k = ucKey(f.uc);
    byUc.set(k, [...(byUc.get(k) ?? []), f]);
  }
  const ucMap = new Map(c.ucs.map((u) => [ucKey(u.uc), u]));
  const usinaMap = new Map((c.usinas ?? []).map((u) => [u.id, u]));
  const ucs = [...byUc.entries()]
    .map(([k, fs]) => {
      const uc = ucMap.get(k);
      return resultadosUc(k, fs, uc, uc?.usinaId ? usinaMap.get(uc.usinaId) : undefined);
    })
    .sort((a, b) => a.uc.localeCompare(b.uc));
  const usinas: ResultadoUsina[] = (c.usinas ?? []).map((u) => {
    const membros = c.ucs.filter((x) => x.usinaId === u.id);
    const soma = r1(membros.reduce((s, x) => s + (x.rateioPct ?? 0), 0));
    const rs = ucs.filter((r) => r.usinaId === u.id);
    const refs = [...new Set(rs.flatMap((r) => r.linhas.map((l) => l.ref)))].sort();
    const linhas = refs.map((ref) => {
      const ls = rs.map((r) => r.linhas.find((l) => l.ref === ref)).filter((l): l is LinhaResultado => !!l);
      const ok = ls.filter((l) => l.cativoRs !== null && l.despesaRs !== null);
      const cativo = r2(ok.reduce((s, l) => s + l.cativoRs!, 0));
      const desp = r2(ok.reduce((s, l) => s + l.despesaRs!, 0));
      return { ref, despesaRs: r2(ls.reduce((s, l) => s + (l.despesaRs ?? 0), 0)), cativoRs: cativo, economiaRs: r2(cativo - desp), economiaPct: cativo > 0 ? r1(((cativo - desp) / cativo) * 100) : null, custosGdRs: r2(ls.reduce((s, l) => s + l.custosGdRs, 0)) };
    });
    const total = totais(rs.flatMap((r) => r.linhas));
    const alertas: AlertaGestao[] = [];
    if (membros.length && Math.abs(soma - 100) > 0.5) alertas.push({ codigo: "rateio_soma", sev: "media", msg: `O rateio das UCs da usina ${u.nome ?? u.id} soma ${soma.toLocaleString("pt-BR")}% (deveria fechar 100%): parte dos custos fica sem dono ou é cobrada em dobro` });
    return { id: u.id, nome: u.nome ?? u.id, ucs: membros.map((m) => m.uc), rateioSomaPct: soma, linhas, total, alertas };
  });
  return { ucs, usinas };
}
