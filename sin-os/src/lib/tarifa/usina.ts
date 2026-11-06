import { parcelaNaoCompensada, type Enquadramento } from "../gd/rules";
import { num } from "./calc";

/**
 * Fatura esperada da unidade onde fica a USINA (gerador) no grupo A, para conferir item a
 * item com a fatura real. Duas situações:
 *  - "SCEE": mini/microgeração distribuída (Lei 14.300/2022; REN 1.000 com a REN 1.059/2023):
 *    energia compensada por posto (com ajuste entre postos pela razão das TE), parcela não
 *    compensada por enquadramento (Fio B do ano na GD II; GD III com 40% do Fio A e P&D/TFSEE),
 *    demanda de consumo (TUSD) e de geração (TUSDg), ultrapassagens e tributos;
 *  - "fora": central geradora fora do SCEE: uso do sistema pela TUSDg (MUSD contratado) e o
 *    consumo próprio da rede faturado como consumidor comum, sem compensação.
 * Pontos marcados "conferir" ficam como opção, nunca como regra escondida.
 */

export type Posto = "ponta" | "fora";
export interface ComponentesFio {
  /** R$/MWh na tarifa de ENERGIA do posto (detalhe "Não se aplica"). */
  fioB: number;
  fioA: number;
  ped: number;
  tfsee: number;
}

export interface TarifaUsina {
  modalidade: "Verde" | "Azul";
  /** Energia por posto (R$/MWh). */
  energia: Record<Posto, { te: number; tusd: number }>;
  /** Demanda de consumo (R$/kW): Verde tem uma só; Azul tem ponta e fora ponta. */
  demanda: { unica?: number; ponta?: number; fora?: number };
  /** TUSDg (R$/kW) da modalidade "Geração" do subgrupo; null se a distribuidora não publicou. */
  tusdg: number | null;
  /** Componentes da energia por posto, para a parcela não compensada. Sem eles, a parcela fica 0 e um alerta avisa. */
  fio: Record<Posto, ComponentesFio> | null;
}

export interface EntradaUsina {
  regime: "SCEE" | "fora";
  enquadramento: Enquadramento;
  ano: number;
  /** kWh do ciclo. */
  consumo: Record<Posto, number>;
  injecao: Record<Posto, number>;
  /** Saldo de créditos anteriores usado neste ciclo (kWh equivalentes de fora ponta). */
  creditoAnteriorKwh: number;
  /** kWh de excedente que o titular aloca a outras UCs (rateio). */
  alocadoOutrasKwh: number;
  /** kW. Verde: `consumo.unica`; Azul: ponta/fora. */
  demandaContratada: { unica?: number; ponta?: number; fora?: number };
  demandaMedida: { unica?: number; ponta?: number; fora?: number };
  /** Demanda de geração (injeção) contratada e medida (kW). No regime "fora", contratada = MUSD. */
  demandaGerContratada: number;
  demandaInjMedida: number;
  /** "excedente": TUSDg só sobre a injeção que passa da demanda de consumo; "total": sobre toda a injeção (conferir §7º do art. 655-J). */
  modoDemandaGeracao: "excedente" | "total";
  /** Adicional da bandeira (R$/MWh), sobre o consumo faturado (após a compensação). */
  bandeiraMwh: number;
  /** Frações (0,18 = 18%). */
  tributos: { icms: number; pis: number; cofins: number };
  /** Convênio ICMS 16/2015: isenção do ICMS na energia compensada (padrão sim). */
  icmsIsentaCompensada: boolean;
  /** O estado cobra ICMS sobre a parcela de Fio B não compensada? (varia: conferir o RICMS). */
  icmsSobreNaoCompensada: boolean;
  /** Valores lançados direto da fatura (R$, já com tributos). */
  reativoRs: number;
  cipRs: number;
  outrosRs: number;
}

export interface LinhaUsina {
  id: string;
  grupo: "Energia" | "Não compensado" | "Demanda" | "Geração (TUSDg)" | "Bandeira" | "Outros";
  descricao: string;
  quantidade: number;
  unidade: string;
  /** Tarifa sem tributos na unidade da quantidade (R$/kWh ou R$/kW). */
  tarifa: number | null;
  liquido: number;
  icms: number;
  pisCofins: number;
  total: number;
  nota?: string;
}

export interface Compensacao {
  /** kWh compensados por posto (inclui ajuste entre postos e créditos anteriores). */
  compensado: Record<Posto, number>;
  faturado: Record<Posto, number>;
  /** kWh de fora ponta usados para cobrir a ponta (e vice-versa), antes da conversão. */
  transferencias: { foraParaPonta: number; pontaParaFora: number };
  creditoUsadoKwh: number;
  /** Excedente que sobra (kWh equivalentes de fora ponta) e o saldo após o rateio. */
  excedenteKwh: number;
  novoSaldoKwh: number;
  fatorPontaFora: number;
}

export interface AlertaUsina {
  nivel: "alta" | "media" | "info";
  texto: string;
}

export interface FaturaUsina {
  linhas: LinhaUsina[];
  compensacao: Compensacao;
  parcela: ReturnType<typeof parcelaNaoCompensada>;
  totalLiquido: number;
  totalTributos: number;
  total: number;
  alertas: AlertaUsina[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const pos = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

/** Compensação por posto, com o ajuste entre postos pela razão das TE (FAQ ANEEL; conferir REN 1.059). */
export function compensar(t: TarifaUsina, e: Pick<EntradaUsina, "consumo" | "injecao" | "creditoAnteriorKwh" | "alocadoOutrasKwh" | "regime">): Compensacao {
  const cons = { ponta: pos(e.consumo.ponta), fora: pos(e.consumo.fora) };
  const inj = { ponta: pos(e.injecao.ponta), fora: pos(e.injecao.fora) };
  const teP = t.energia.ponta.te || 1;
  const teF = t.energia.fora.te || 1;
  const fator = teF / teP; // 1 kWh de fora ponta vale `fator` kWh na ponta
  if (e.regime === "fora") {
    return { compensado: { ponta: 0, fora: 0 }, faturado: cons, transferencias: { foraParaPonta: 0, pontaParaFora: 0 }, creditoUsadoKwh: 0, excedenteKwh: 0, novoSaldoKwh: 0, fatorPontaFora: r4(fator) };
  }
  const comp = { ponta: Math.min(cons.ponta, inj.ponta), fora: Math.min(cons.fora, inj.fora) };
  const sobra = { ponta: inj.ponta - comp.ponta, fora: inj.fora - comp.fora };
  const falta = () => ({ ponta: cons.ponta - comp.ponta, fora: cons.fora - comp.fora });
  // sobra de fora ponta cobre a ponta (convertida pela razão das TE)
  let f = falta();
  const cobrePonta = Math.min(f.ponta, sobra.fora * fator);
  const usadoFora = cobrePonta / fator;
  comp.ponta += cobrePonta;
  sobra.fora -= usadoFora;
  // sobra de ponta cobre o fora ponta
  f = falta();
  const cobreFora = Math.min(f.fora, sobra.ponta / fator);
  const usadoPonta = cobreFora * fator;
  comp.fora += cobreFora;
  sobra.ponta -= usadoPonta;
  // créditos anteriores (kWh de fora ponta): primeiro o fora ponta, depois a ponta
  let cred = pos(e.creditoAnteriorKwh);
  f = falta();
  const c1 = Math.min(f.fora, cred);
  comp.fora += c1;
  cred -= c1;
  f = falta();
  const c2 = Math.min(f.ponta, cred * fator);
  comp.ponta += c2;
  cred -= c2 / fator;
  const creditoUsado = pos(e.creditoAnteriorKwh) - cred;
  const excedente = sobra.fora + sobra.ponta / fator;
  return {
    compensado: { ponta: r4(comp.ponta), fora: r4(comp.fora) },
    faturado: { ponta: r4(cons.ponta - comp.ponta), fora: r4(cons.fora - comp.fora) },
    transferencias: { foraParaPonta: r4(usadoFora), pontaParaFora: r4(usadoPonta) },
    creditoUsadoKwh: r4(creditoUsado),
    excedenteKwh: r4(excedente),
    // saldo = excedente do mês + crédito anterior que sobrou − o que foi alocado às outras UCs
    novoSaldoKwh: r4(Math.max(0, excedente + (pos(e.creditoAnteriorKwh) - creditoUsado) - pos(e.alocadoOutrasKwh))),
    fatorPontaFora: r4(fator),
  };
}

export function faturaUsina(t: TarifaUsina, e: EntradaUsina): FaturaUsina {
  const alertas: AlertaUsina[] = [];
  const linhas: LinhaUsina[] = [];
  const { icms, pis, cofins } = e.tributos;
  const pc = pis + cofins;
  /** Tributos por dentro, linha a linha (cada linha com as alíquotas que valem para ela). */
  const add = (l: Omit<LinhaUsina, "icms" | "pisCofins" | "total">, aplica: { icms: boolean; pc: boolean }) => {
    const ri = aplica.icms ? icms : 0;
    const rp = aplica.pc ? pc : 0;
    const bruto = ri + rp < 0.95 ? l.liquido / (1 - ri - rp) : l.liquido;
    linhas.push({ ...l, liquido: r2(l.liquido), icms: r2(bruto * ri), pisCofins: r2(bruto * rp), total: r2(bruto) });
  };

  const c = compensar(t, e);
  const parcela = e.regime === "SCEE" ? parcelaNaoCompensada(e.enquadramento, e.ano) : { fioB: 0, fioA: 0, encargos: false, pendenteArt17: false };

  // 1. energia faturada (consumo da rede menos o compensado), por posto
  for (const p of ["ponta", "fora"] as Posto[]) {
    const kwh = c.faturado[p];
    const nome = p === "ponta" ? "ponta" : "fora ponta";
    if (kwh > 0) {
      add({ id: `te_${p}`, grupo: "Energia", descricao: `Consumo ${nome} faturado - TE`, quantidade: kwh, unidade: "kWh", tarifa: r4(t.energia[p].te / 1000), liquido: (kwh * t.energia[p].te) / 1000 }, { icms: true, pc: true });
      add({ id: `tusd_${p}`, grupo: "Energia", descricao: `Consumo ${nome} faturado - TUSD`, quantidade: kwh, unidade: "kWh", tarifa: r4(t.energia[p].tusd / 1000), liquido: (kwh * t.energia[p].tusd) / 1000 }, { icms: true, pc: true });
    }
  }

  // 2. parcela não compensada sobre a energia compensada (GD II / GD III)
  if (e.regime === "SCEE" && (parcela.fioB > 0 || parcela.fioA > 0 || parcela.encargos)) {
    if (!t.fio) alertas.push({ nivel: "media", texto: "Componentes da tarifa indisponíveis: a parcela não compensada (Fio B) não foi calculada." });
    for (const p of ["ponta", "fora"] as Posto[]) {
      const kwh = c.compensado[p];
      const f = t.fio?.[p];
      if (!f || kwh <= 0) continue;
      const rsMwh = parcela.fioB * f.fioB + parcela.fioA * f.fioA + (parcela.encargos ? f.ped + f.tfsee : 0);
      if (rsMwh <= 0) continue;
      const partes = [parcela.fioB ? `${Math.round(parcela.fioB * 100)}% Fio B` : "", parcela.fioA ? `${Math.round(parcela.fioA * 100)}% Fio A` : "", parcela.encargos ? "P&D + TFSEE" : ""].filter(Boolean).join(" + ");
      add(
        { id: `nc_${p}`, grupo: "Não compensado", descricao: `Energia compensada ${p === "ponta" ? "ponta" : "fora ponta"} - ${partes}`, quantidade: kwh, unidade: "kWh", tarifa: r4(rsMwh / 1000), liquido: (kwh * rsMwh) / 1000, nota: `${e.enquadramento} em ${e.ano}` },
        { icms: e.icmsSobreNaoCompensada, pc: true },
      );
    }
    if (t.fio && t.fio.fora.fioB === 0 && t.fio.ponta.fioB === 0) alertas.push({ nivel: "info", texto: `Na modalidade ${t.modalidade} a energia não carrega Fio B (ele está na demanda): a parcela não compensada da ${e.enquadramento} fica perto de zero.` });
  }
  if (parcela.pendenteArt17) alertas.push({ nivel: "media", texto: `A partir de ${e.enquadramento === "GD I" ? 2046 : 2029} vale o art. 17 da Lei 14.300 (valoração da ANEEL ainda a confirmar): a simulação usa a hipótese de 100% do Fio B.` });
  if (e.regime === "SCEE" && e.enquadramento === "GD III") alertas.push({ nivel: "info", texto: "GD III (acima de 500 kW, fonte não despachável, autoconsumo remoto ou compartilhada com titular ≥ 25%): 100% Fio B + 40% Fio A + P&D/TFSEE até 2028. Conferir o enquadramento." });

  // 3. demanda de consumo (TUSD R$/kW): faturada pelo maior entre medida e contratada; ultrapassagem acima de 5%
  const postosDem: ("unica" | "ponta" | "fora")[] = t.modalidade === "Verde" ? ["unica"] : ["ponta", "fora"];
  let demConsFaturada = 0;
  for (const k of postosDem) {
    const tar = t.demanda[k];
    const contr = pos(e.demandaContratada[k] ?? 0);
    const med = pos(e.demandaMedida[k] ?? 0);
    if (tar === undefined || (!contr && !med)) continue;
    const fat = Math.max(contr, med);
    if (k !== "fora") demConsFaturada = Math.max(demConsFaturada, fat);
    else if (!demConsFaturada) demConsFaturada = fat;
    const nome = k === "unica" ? "" : k === "ponta" ? " ponta" : " fora ponta";
    // ICMS só sobre a demanda efetivamente utilizada (Súmula 391 do STJ; Tema 176 do STF); a parte contratada e não usada paga só PIS/Cofins
    const usada = med > 0 ? Math.min(med, fat) : fat;
    add({ id: `dem_${k}`, grupo: "Demanda", descricao: `Demanda de consumo${nome}${fat > usada ? " (utilizada)" : ""}`, quantidade: usada, unidade: "kW", tarifa: r4(tar), liquido: usada * tar }, { icms: true, pc: true });
    if (fat > usada) add({ id: `dem_${k}_nu`, grupo: "Demanda", descricao: `Demanda de consumo${nome} contratada e não utilizada (sem ICMS)`, quantidade: fat - usada, unidade: "kW", tarifa: r4(tar), liquido: (fat - usada) * tar, nota: "Súmula 391 do STJ" }, { icms: false, pc: true });
    if (contr > 0 && med > contr * 1.05) {
      const ult = med - contr;
      add({ id: `ult_${k}`, grupo: "Demanda", descricao: `Ultrapassagem de demanda${nome} (2x)`, quantidade: ult, unidade: "kW", tarifa: r4(tar * 2), liquido: ult * tar * 2, nota: "medida acima de 105% da contratada" }, { icms: true, pc: true });
      alertas.push({ nivel: "alta", texto: `Ultrapassagem de demanda${nome}: ${r2(med)} kW medidos para ${r2(contr)} kW contratados.` });
    }
  }

  // 4. demanda de geração (TUSDg R$/kW)
  if (t.tusdg === null) {
    if (pos(e.demandaGerContratada) || pos(e.demandaInjMedida)) alertas.push({ nivel: "media", texto: "A distribuidora não publicou TUSDg para este subgrupo nos dados abertos: informe o valor da fatura." });
  } else {
    const contrG = pos(e.demandaGerContratada);
    const medG = pos(e.demandaInjMedida);
    const ger = Math.max(contrG, medG);
    const base = e.regime === "fora" || e.modoDemandaGeracao === "total" ? ger : Math.max(0, ger - demConsFaturada);
    if (base > 0) {
      add(
        { id: "tusdg", grupo: "Geração (TUSDg)", descricao: e.regime === "fora" ? "Uso do sistema (MUSD) - TUSDg" : `Demanda de geração - TUSDg${e.modoDemandaGeracao === "excedente" ? " (excedente sobre a de consumo)" : ""}`, quantidade: base, unidade: "kW", tarifa: r4(t.tusdg), liquido: base * t.tusdg },
        { icms: true, pc: true },
      );
    }
    if (contrG > 0 && medG > contrG * 1.05) {
      const ult = medG - contrG;
      add({ id: "ult_ger", grupo: "Geração (TUSDg)", descricao: "Ultrapassagem da demanda de geração (2x)", quantidade: ult, unidade: "kW", tarifa: r4(t.tusdg * 2), liquido: ult * t.tusdg * 2, nota: "injeção acima de 105% da contratada" }, { icms: true, pc: true });
      alertas.push({ nivel: "alta", texto: `Injeção de ${r2(medG)} kW acima da demanda de geração contratada (${r2(contrG)} kW): revise o contrato (CUSD).` });
    }
    if (e.regime === "SCEE" && !contrG && medG > 0) alertas.push({ nivel: "media", texto: "Há injeção medida sem demanda de geração contratada: no grupo A a contratação é obrigatória (FAQ ANEEL)." });
  }

  // 5. bandeira: só sobre o consumo faturado (não incide sobre a energia compensada)
  const kwhFat = c.faturado.ponta + c.faturado.fora;
  if (e.bandeiraMwh > 0 && kwhFat > 0) add({ id: "bandeira", grupo: "Bandeira", descricao: "Adicional de bandeira (sobre o consumo faturado)", quantidade: kwhFat, unidade: "kWh", tarifa: r4(e.bandeiraMwh / 1000), liquido: (kwhFat * e.bandeiraMwh) / 1000 }, { icms: true, pc: true });

  // 6. itens lançados da fatura
  const fixo = (id: string, descricao: string, v: number, nota: string) => {
    if (v > 0) linhas.push({ id, grupo: "Outros", descricao, quantidade: 1, unidade: "-", tarifa: null, liquido: r2(v), icms: 0, pisCofins: 0, total: r2(v), nota });
  };
  fixo("reativo", "Reativo excedente (UFER/DMCR)", e.reativoRs, "lançado da fatura; não compensável nem isento (Conv. ICMS 16/2015)");
  fixo("cip", "Contribuição de iluminação pública (CIP)", e.cipRs, "lei municipal");
  fixo("outros", "Outros (multas, juros, serviços)", e.outrosRs, "lançado da fatura");

  // estado sem a isenção do Convênio ICMS 16/2015 (ou acima do limite): ICMS sobre a energia compensada (PIS/Cofins seguem zerados, Lei 13.169/2015)
  if (e.regime === "SCEE" && !e.icmsIsentaCompensada && icms > 0 && icms < 0.95) {
    const base = (c.compensado.ponta * (t.energia.ponta.te + t.energia.ponta.tusd) + c.compensado.fora * (t.energia.fora.te + t.energia.fora.tusd)) / 1000;
    const v = (base * icms) / (1 - icms);
    if (v > 0) linhas.push({ id: "icms_comp", grupo: "Energia", descricao: "ICMS sobre a energia compensada (estado sem isenção)", quantidade: c.compensado.ponta + c.compensado.fora, unidade: "kWh", tarifa: null, liquido: 0, icms: r2(v), pisCofins: 0, total: r2(v), nota: "base: kWh compensados × (TE + TUSD)" });
  }
  if (e.regime === "SCEE" && pos(e.alocadoOutrasKwh) > c.excedenteKwh + (pos(e.creditoAnteriorKwh) - c.creditoUsadoKwh) + 1)
    alertas.push({ nivel: "alta", texto: `Rateio de ${Math.round(pos(e.alocadoOutrasKwh)).toLocaleString("pt-BR")} kWh maior que o excedente do mês mais o saldo (${Math.round(c.excedenteKwh + pos(e.creditoAnteriorKwh) - c.creditoUsadoKwh).toLocaleString("pt-BR")} kWh): confira a alocação.` });
  if (e.regime === "SCEE" && !e.icmsIsentaCompensada) alertas.push({ nivel: "media", texto: "ICMS sobre a energia compensada marcado como devido: confira a adesão do estado ao Convênio ICMS 16/2015 (limite de 1 MW no texto do CONFAZ)." });
  if (e.regime === "SCEE" && c.excedenteKwh > 0) alertas.push({ nivel: "info", texto: `Excedente de ${Math.round(c.excedenteKwh).toLocaleString("pt-BR")} kWh (equiv. fora ponta) vira crédito por 60 meses; após o rateio, saldo de ${Math.round(c.novoSaldoKwh).toLocaleString("pt-BR")} kWh.` });

  const totalLiquido = r2(linhas.reduce((s, l) => s + l.liquido, 0));
  const total = r2(linhas.reduce((s, l) => s + l.total, 0));
  return { linhas, compensacao: c, parcela, totalLiquido, totalTributos: r2(total - totalLiquido), total, alertas };
}

/* ------------------------------------------------- montagem a partir dos dados da ANEEL */

export interface LinhaTarifa {
  modalidade: string;
  detalhe: string;
  posto: string;
  unidade: string;
  tusd: number;
  te: number;
  acessante?: string;
}

/** Junta as linhas da tarifa vigente (Verde ou Azul, detalhe "Não se aplica") e a TUSDg do subgrupo. */
export function tarifaUsinaDe(linhas: LinhaTarifa[], modalidade: "Verde" | "Azul", fio: Record<Posto, ComponentesFio> | null): TarifaUsina | null {
  const nsa = (l: LinhaTarifa) => l.detalhe === "Não se aplica" && (!l.acessante || l.acessante === "Não se aplica");
  const m = linhas.filter((l) => l.modalidade === modalidade && nsa(l));
  const en = (posto: string) => m.find((l) => l.unidade === "MWh" && l.posto === posto);
  const dm = (posto: string) => m.find((l) => l.unidade === "kW" && l.posto === posto)?.tusd;
  const p = en("Ponta");
  const f = en("Fora ponta");
  if (!p || !f) return null;
  const geracao = linhas.filter((l) => l.modalidade === "Geração" && l.unidade === "kW");
  const g = geracao.find((l) => !l.acessante || l.acessante === "Não se aplica") ?? geracao.find((l) => /GD \(GRUPO A\)/i.test(l.acessante ?? "")) ?? null;
  return {
    modalidade,
    energia: { ponta: { te: p.te, tusd: p.tusd }, fora: { te: f.te, tusd: f.tusd } },
    demanda: modalidade === "Verde" ? { unica: dm("Não se aplica") } : { ponta: dm("Ponta"), fora: dm("Fora ponta") },
    tusdg: g ? g.tusd : null,
    fio,
  };
}

const FIO_A = new Set(["TUSD_RB", "TUSD_CCT", "TUSD_FR", "TUSD_CUSD"]);
/** Fio B, Fio A, P&D e TFSEE (R$/MWh) a partir dos componentes de um posto (registros da ANEEL). */
export function fioDe(registros: { DscComponenteTarifario: string; VlrComponenteTarifario: unknown }[]): ComponentesFio {
  const vistos = new Map<string, number>();
  for (const r of registros) if (!vistos.has(r.DscComponenteTarifario)) vistos.set(r.DscComponenteTarifario, num(r.VlrComponenteTarifario));
  let fioA = 0;
  for (const [k, v] of vistos) if (FIO_A.has(k)) fioA += v;
  return { fioB: r4(vistos.get("TUSD_FioB") ?? 0), fioA: r4(fioA), ped: r4(vistos.get("TUSD_PeD") ?? 0), tfsee: r4(vistos.get("TUSD_TFSEE") ?? 0) };
}

/** Conferência item a item: valores da fatura real (R$, com tributos) contra o esperado. */
export function conferirUsina(f: FaturaUsina, real: Partial<Record<string, number>>, totalReal?: number) {
  const itens = f.linhas.map((l) => {
    const v = real[l.id];
    const dif = v === undefined || !Number.isFinite(v) ? null : r2(v - l.total);
    return { id: l.id, descricao: l.descricao, esperado: l.total, real: v ?? null, dif, pct: dif === null || !l.total ? null : Math.round((dif / l.total) * 1000) / 10 };
  });
  const tot = totalReal !== undefined && Number.isFinite(totalReal) && totalReal > 0 ? { real: totalReal, dif: r2(totalReal - f.total), pct: f.total ? Math.round(((totalReal - f.total) / f.total) * 1000) / 10 : null } : null;
  const status = (pct: number | null) => (pct === null ? "—" : Math.abs(pct) <= 1 ? "conforme" : Math.abs(pct) <= 3 ? "atenção" : "divergente");
  return { itens: itens.map((i) => ({ ...i, status: status(i.pct) })), total: tot ? { ...tot, status: status(tot.pct) } : null };
}
