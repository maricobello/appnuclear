import { conferirLote, enqDe, faturaEsperadaB, otimizarDemanda } from "../gd/bill";
import { analisarAssinatura, viabilidade } from "../gd/finance";
import { cronogramaFioB, enquadrar, garantiaFielCumprimento, GD_TEMA_LIST, GD_TEMAS, type GdTema, type Ligacao, type Modalidade } from "../gd/rules";
import type { CarteiraGD, FaturaGD, UcGD } from "../gd/types";
import type { ToolDef } from "./groq";

/**
 * Ferramentas de geração distribuída da Iara. Calculam tudo no servidor sobre a carteira
 * que o navegador manda (faturas já lidas sem IA) e devolvem só o essencial — o modelo
 * nunca recebe a fatura inteira. Descrições curtas de propósito: cada token aqui é pago
 * em toda pergunta que carrega o domínio GD.
 */
export type GdAction = { type: "gd_uc"; patch: Partial<UcGD> & { uc: string }; label: string; confirm: true };
export interface GdOutcome {
  result: unknown;
  actions?: GdAction[];
}

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDef => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false } },
});
const N = (d: string) => ({ type: "number", description: d });
const S = (d: string) => ({ type: "string", description: d });
const LIG = { type: "string", enum: ["mono", "bi", "tri"], description: "tipo de ligação" };
const MOD = { type: "string", enum: ["local", "remoto", "compartilhada", "emuc"] };
const ENQ = { type: "string", enum: ["GD I", "GD II", "GD III", "sem GD"] };

export const GD_TOOL_DEFS: ToolDef[] = [
  fn("gd_carteira", "Resumo da carteira de GD do usuário: UCs, meses lidos, consumo, injeção, compensação, saldo, total pago e alertas por UC.", { uc: S("filtra uma UC (opcional)") }),
  fn(
    "gd_conferir_faturas",
    "Confere EM LOTE as faturas da carteira: créditos não usados, Fio B indevido, custo de disponibilidade em dobro, PIS/Cofins/ICMS sobre compensada, saldo inconsistente, ultrapassagem, reativo, queda de injeção. Devolve os principais alertas com impacto em R$.",
    { uc: S("só uma UC (opcional)"), max: { type: "integer", minimum: 1, maximum: 20, description: "quantos alertas (padrão 8)" } },
  ),
  fn(
    "gd_fatura_esperada",
    "Fatura esperada de UC do grupo B na GD (Fio B do ano, mínimo sem duplicidade, tributos). Com 'uc', usa a última fatura e as tarifas cadastradas; os demais campos sobrescrevem.",
    {
      uc: S("UC da carteira"),
      consumo_kwh: N("consumo do mês"),
      creditos_kwh: N("injetada + recebida no mês"),
      saldo_anterior_kwh: N("saldo de créditos"),
      ligacao: LIG,
      enquadramento: ENQ,
      ano: { type: "integer" },
      te: N("TE sem tributos R$/kWh"),
      tusd: N("TUSD sem tributos R$/kWh"),
      fio_b: N("Fio B sem tributos R$/kWh"),
      icms_pct: N("%"),
      pis_pct: N("%"),
      cofins_pct: N("%"),
      bandeira_rs_kwh: N("adicional de bandeira"),
      cip_rs: N("iluminação pública"),
      icms_compensada: { type: "string", enum: ["isento", "tusd", "integral"] },
    },
  ),
  fn(
    "gd_enquadramento",
    "Enquadra um sistema em GD I/II/III (Lei 14.300) pela data do protocolo, potência, fonte e modalidade: Fio B ano a ano, porte, garantia de fiel cumprimento e avisos.",
    { data_protocolo: S("AAAA-MM-DD"), potencia_kw: N("kW em CA"), fonte: S("solar, eólica, hídrica, biomassa…"), modalidade: MOD, maior_titular_pct: N("geração compartilhada: maior participação de um titular (%)") },
  ),
  fn(
    "gd_viabilidade",
    "Viabilidade de sistema de GD: economia no ano 1, VPL, TIR, payback simples e descontado, LCOE, com a transição do Fio B. Premissas omitidas vêm com valores de referência declarados.",
    {
      potencia_kwp: N("kWp"),
      tarifa_rs_kwh: N("tarifa com tributos"),
      capex_rs_kwp: N("R$/kWp"),
      geracao_kwh_kwp_mes: N("kWh/kWp·mês"),
      simultaneidade_pct: N("% consumido na hora da geração"),
      fio_b_rs_kwh: N("sem tributos"),
      wacc_pct: N("% a.a."),
      reajuste_pct: N("% a.a."),
      data_protocolo: S("AAAA-MM-DD"),
      modalidade: MOD,
    },
    ["potencia_kwp", "tarifa_rs_kwh"],
  ),
  fn(
    "gd_contrato_assinatura",
    "Contrato de assinatura/geração compartilhada: desconto efetivo do assinante ano a ano conforme o Fio B sobe; mostra quanto paga ao gerador e à distribuidora.",
    {
      tarifa_rs_kwh: N("tarifa com tributos"),
      desconto_pct: N("desconto contratado"),
      creditos_kwh_mes: N("créditos por mês"),
      fio_b_por_conta: { type: "string", enum: ["assinante", "gerador"] },
      base_desconto: { type: "string", enum: ["tarifa_cheia", "tarifa_liquida"] },
      fio_b_rs_kwh: N("sem tributos"),
      anos: { type: "integer", minimum: 1, maximum: 15 },
    },
    ["tarifa_rs_kwh", "desconto_pct", "creditos_kwh_mes"],
  ),
  fn("gd_regras", "Regra de GD por tema, com a norma (texto curto). Use em vez de responder de memória.", { tema: { type: "string", enum: GD_TEMA_LIST } }, ["tema"]),
  fn(
    "gd_otimizar_demanda",
    "Grupo A: demanda contratada ótima pelo histórico de demanda medida (da carteira ou lista) e a economia anual com ultrapassagem.",
    { uc: S("UC da carteira"), medidas_kw: { type: "array", items: { type: "number" }, maxItems: 24 }, tarifa_rs_kw: N("tarifa de demanda R$/kW"), contratada_kw: N("demanda contratada hoje") },
  ),
  fn(
    "gd_registrar_uc",
    "Registra/atualiza dados de uma UC na carteira (apelido, papel, enquadramento, protocolo, potência, ligação, tarifas, contrato). O usuário confirma no painel antes de gravar.",
    {
      uc: S("número da UC"),
      apelido: S("nome curto"),
      papel: { type: "string", enum: ["geradora", "beneficiaria", "consumidora"] },
      enquadramento: ENQ,
      data_protocolo: S("AAAA-MM-DD"),
      potencia_kw: N("kW"),
      ligacao: LIG,
      te: N("R$/kWh sem tributos"),
      tusd: N("R$/kWh sem tributos"),
      fio_b: N("R$/kWh sem tributos"),
      icms_pct: N("%"),
      tarifa_demanda_rs_kw: N("grupo A"),
      contrato_tipo: { type: "string", enum: ["proprio", "assinatura", "locacao", "consorcio", "cooperativa"] },
      desconto_pct: N("%"),
      fio_b_por_conta: { type: "string", enum: ["assinante", "gerador"] },
    },
    ["uc"],
  ),
];
export const GD_TOOL_NAMES = GD_TOOL_DEFS.map((t) => t.function.name);

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v.replace(",", "."))) ? Number(v.replace(",", ".")) : undefined);
const str = (v: unknown, n = 60): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
const pct = (v: unknown) => {
  const x = num(v);
  return x === undefined ? undefined : x > 1 ? x / 100 : x;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const ucKey = (s: string | undefined) => (s ? s.replace(/\D/g, "") || s : undefined);
const VAZIA = "carteira de GD vazia: peça para o usuário anexar as faturas (clipe no painel da Iara ou tela /gd)";

function findUc(c: CarteiraGD, uc?: string) {
  const k = ucKey(uc);
  if (!k) return { faturas: c.faturas, uc: undefined as UcGD | undefined };
  const fs = c.faturas.filter((f) => ucKey(f.uc) === k || (f.uc ?? "").endsWith(k));
  return { faturas: fs, uc: c.ucs.find((u) => ucKey(u.uc) === k) };
}

const lastOf = (fs: FaturaGD[]) => [...fs].sort((a, b) => (a.ref ?? "").localeCompare(b.ref ?? "")).at(-1);

function carteira(args: Record<string, unknown>, c: CarteiraGD): GdOutcome {
  if (!c.faturas.length && !c.ucs.length) return { result: { erro: VAZIA } };
  const { faturas } = findUc(c, str(args.uc));
  const lote = conferirLote(faturas, c.ucs);
  return {
    result: {
      faturas: faturas.length,
      incompletas: faturas.filter((f) => f.confianca < 0.5).length,
      ucs: lote.ucs.slice(0, 12).map((u) => ({ uc: u.uc, ...(u.apelido ? { apelido: u.apelido } : {}), enq: u.enquadramento, meses: u.meses, de: u.de, ate: u.ate, consumo: u.consumoKwh, injetada: u.injetadaKwh, compensada: u.compensadaKwh, saldo: u.saldoFinalKwh, pagoRs: u.totalRs, alertas: u.alertas })),
      ...(lote.ucs.length > 12 ? { maisUcs: lote.ucs.length - 12 } : {}),
      totais: lote.totais,
      cadastradas: c.ucs.length,
    },
  };
}

function conferir(args: Record<string, unknown>, c: CarteiraGD): GdOutcome {
  if (!c.faturas.length) return { result: { erro: VAZIA } };
  const { faturas } = findUc(c, str(args.uc));
  if (!faturas.length) return { result: { erro: `nenhuma fatura da UC ${args.uc} na carteira` } };
  const max = Math.min(20, Math.max(1, Math.round(num(args.max) ?? 8)));
  const lote = conferirLote(faturas, c.ucs);
  const porCodigo: Record<string, number> = {};
  for (const a of lote.alertas) porCodigo[a.codigo] = (porCodigo[a.codigo] ?? 0) + 1;
  return {
    result: {
      faturas: lote.faturas,
      totais: lote.totais,
      porCodigo,
      principais: lote.alertas.slice(0, max).map((a) => ({ uc: a.uc, ref: a.ref, sev: a.sev, msg: a.msg, ...(a.impactoRs ? { rs: a.impactoRs } : {}) })),
      ...(lote.alertas.length > max ? { outros: lote.alertas.length - max } : {}),
      demanda: lote.ucs.filter((u) => u.demanda).map((u) => ({ uc: u.uc, ...u.demanda })),
      aviso: "indícios para revisar com a distribuidora, não erro confirmado",
    },
  };
}

function esperada(args: Record<string, unknown>, c: CarteiraGD): GdOutcome {
  const { faturas, uc } = findUc(c, str(args.uc));
  const f = str(args.uc) ? lastOf(faturas) : undefined;
  const ano = Math.round(num(args.ano) ?? (f?.ref ? Number(f.ref.slice(0, 4)) : new Date().getFullYear()));
  const te = num(args.te) ?? uc?.teRsKwh ?? (f?.teRsKwh && f.tarifasComTributos === false ? f.teRsKwh : undefined);
  const tusd = num(args.tusd) ?? uc?.tusdRsKwh ?? (f?.tusdRsKwh && f.tarifasComTributos === false ? f.tusdRsKwh : undefined);
  const consumo = num(args.consumo_kwh) ?? f?.consumoKwh;
  const lig = (str(args.ligacao) as Ligacao | undefined) ?? f?.ligacao ?? uc?.ligacao;
  const faltam = [te === undefined && "te (sem tributos)", tusd === undefined && "tusd (sem tributos)", consumo === undefined && "consumo_kwh", !lig && "ligacao"].filter(Boolean);
  if (faltam.length) return { result: { erro: `faltam dados: ${faltam.join(", ")} — pergunte ao usuário ou cadastre a UC com gd_registrar_uc` } };
  const enq = (str(args.enquadramento) as ReturnType<typeof enqDe> | undefined) ?? (f ? enqDe(f, uc) : (uc?.enquadramento ?? "GD II"));
  const icms = pct(args.icms_pct) ?? uc?.icms ?? f?.icmsPct;
  const out = faturaEsperadaB({
    enquadramento: enq,
    ano,
    consumoKwh: consumo!,
    creditosMesKwh: num(args.creditos_kwh) ?? (f ? (f.injetadaKwh ?? 0) + (f.creditosRecebidosKwh ?? 0) : 0),
    saldoAnteriorKwh: num(args.saldo_anterior_kwh) ?? f?.saldoAnteriorKwh ?? 0,
    ligacao: lig!,
    tarifas: { te: te!, tusd: tusd!, fioB: num(args.fio_b) ?? uc?.fioBRsKwh ?? null, bandeira: num(args.bandeira_rs_kwh), icms, pis: pct(args.pis_pct) ?? uc?.pis ?? f?.pisPct, cofins: pct(args.cofins_pct) ?? uc?.cofins ?? f?.cofinsPct },
    icmsCompensada: (str(args.icms_compensada) as "isento" | "tusd" | "integral" | undefined) ?? "isento",
    cipRs: num(args.cip_rs) ?? f?.cipRs,
  });
  return { result: { enquadramento: enq, ano, ...out, ...(f?.totalRs !== undefined ? { faturaRealRs: f.totalRs, diferencaRs: r2(f.totalRs - out.totalRs) } : {}) } };
}

function enquadramento(args: Record<string, unknown>): GdOutcome {
  const potencia = num(args.potencia_kw);
  const modalidade = str(args.modalidade) as Modalidade | undefined;
  const e = enquadrar({ dataProtocolo: str(args.data_protocolo, 10), potenciaKw: potencia, fonte: str(args.fonte), modalidade, maiorTitularPct: num(args.maior_titular_pct) });
  const ano = new Date().getFullYear();
  return {
    result: {
      ...e,
      fioB: cronogramaFioB(e.enquadramento, Math.max(2023, ano - 1), ano + 5, e.transicaoAte),
      ...(potencia ? { garantia: garantiaFielCumprimento(potencia, modalidade) } : {}),
      creditosValidadeMeses: 60,
    },
  };
}

function viab(args: Record<string, unknown>): GdOutcome {
  const p = num(args.potencia_kwp);
  const t = num(args.tarifa_rs_kwh);
  if (!p || !t) return { result: { erro: "informe potencia_kwp e tarifa_rs_kwh (com tributos)" } };
  return {
    result: viabilidade({
      potenciaKwp: p,
      tarifaRsKwh: t,
      capexRsKwp: num(args.capex_rs_kwp),
      geracaoKwhKwpMes: num(args.geracao_kwh_kwp_mes),
      simultaneidadePct: num(args.simultaneidade_pct),
      fioBRsKwh: num(args.fio_b_rs_kwh),
      waccPctAno: num(args.wacc_pct),
      reajustePctAno: num(args.reajuste_pct),
      dataProtocolo: str(args.data_protocolo, 10),
      modalidade: str(args.modalidade) as Modalidade | undefined,
    }),
  };
}

function assinatura(args: Record<string, unknown>): GdOutcome {
  const t = num(args.tarifa_rs_kwh);
  const d = num(args.desconto_pct);
  const k = num(args.creditos_kwh_mes);
  if (!t || d === undefined || !k) return { result: { erro: "informe tarifa_rs_kwh, desconto_pct e creditos_kwh_mes" } };
  return {
    result: analisarAssinatura({
      tarifaRsKwh: t,
      descontoPct: d,
      creditosKwhMes: k,
      fioBRsKwh: num(args.fio_b_rs_kwh),
      fioBPorConta: str(args.fio_b_por_conta) as "assinante" | "gerador" | undefined,
      baseDesconto: str(args.base_desconto) as "tarifa_cheia" | "tarifa_liquida" | undefined,
      anos: num(args.anos),
    }),
  };
}

function regras(args: Record<string, unknown>): GdOutcome {
  const t = str(args.tema) as GdTema | undefined;
  if (!t || !(t in GD_TEMAS)) return { result: { erro: `tema desconhecido; use: ${GD_TEMA_LIST.join(", ")}` } };
  return { result: { tema: t, texto: GD_TEMAS[t], aviso: "triagem; confirme a redação vigente e a prática da distribuidora" } };
}

function demanda(args: Record<string, unknown>, c: CarteiraGD): GdOutcome {
  const { faturas, uc } = findUc(c, str(args.uc));
  const medidas = Array.isArray(args.medidas_kw) ? (args.medidas_kw as unknown[]).map(num).filter((x): x is number => x !== undefined) : faturas.map((f) => f.demandaKw).filter((x): x is number => x !== undefined);
  const tarifa = num(args.tarifa_rs_kw) ?? uc?.tarifaDemandaRsKw;
  if (!tarifa) return { result: { erro: "informe tarifa_rs_kw (tarifa de demanda sem tributos) ou cadastre na UC" } };
  const r = otimizarDemanda(medidas, tarifa, num(args.contratada_kw) ?? lastOf(faturas)?.demandaContratadaKw);
  return { result: r ?? { erro: "precisa de pelo menos 3 meses de demanda medida" } };
}

function registrar(args: Record<string, unknown>): GdOutcome {
  const uc = ucKey(str(args.uc, 40));
  if (!uc) return { result: { erro: "informe a UC" } };
  const patch: Partial<UcGD> & { uc: string } = { uc };
  const put = <K extends keyof UcGD>(k: K, v: UcGD[K] | undefined) => {
    if (v !== undefined) patch[k] = v;
  };
  put("apelido", str(args.apelido));
  put("papel", str(args.papel) as UcGD["papel"]);
  put("enquadramento", str(args.enquadramento) as UcGD["enquadramento"]);
  const dp = str(args.data_protocolo, 10);
  if (dp && /^\d{4}-\d{2}-\d{2}$/.test(dp)) patch.dataProtocolo = dp;
  put("potenciaKw", num(args.potencia_kw));
  put("ligacao", str(args.ligacao) as UcGD["ligacao"]);
  put("teRsKwh", num(args.te));
  put("tusdRsKwh", num(args.tusd));
  put("fioBRsKwh", num(args.fio_b));
  put("icms", pct(args.icms_pct));
  put("tarifaDemandaRsKw", num(args.tarifa_demanda_rs_kw));
  const tipo = str(args.contrato_tipo) as NonNullable<UcGD["contrato"]>["tipo"] | undefined;
  if (tipo) patch.contrato = { tipo, descontoPct: num(args.desconto_pct), fioBPorConta: str(args.fio_b_por_conta) as "assinante" | "gerador" | undefined };
  const campos = Object.keys(patch).filter((k) => k !== "uc");
  if (!campos.length) return { result: { erro: "nenhum campo para registrar" } };
  return { result: { ok: true, pendente: "aguardando o usuário confirmar no painel", campos }, actions: [{ type: "gd_uc", patch, label: `UC ${uc}: ${campos.join(", ")}`, confirm: true }] };
}

export function executeGdTool(name: string, args: Record<string, unknown>, c: CarteiraGD): GdOutcome | null {
  switch (name) {
    case "gd_carteira":
      return carteira(args, c);
    case "gd_conferir_faturas":
      return conferir(args, c);
    case "gd_fatura_esperada":
      return esperada(args, c);
    case "gd_enquadramento":
      return enquadramento(args);
    case "gd_viabilidade":
      return viab(args);
    case "gd_contrato_assinatura":
      return assinatura(args);
    case "gd_regras":
      return regras(args);
    case "gd_otimizar_demanda":
      return demanda(args, c);
    case "gd_registrar_uc":
      return registrar(args);
    default:
      return null;
  }
}

/** Uma linha para o prompt: o que há na carteira (ou nada, quando vazia). */
export function carteiraLinha(c: CarteiraGD | undefined): string | null {
  if (!c || (!c.faturas.length && !c.ucs.length)) return null;
  const refs = c.faturas.map((f) => f.ref).filter((r): r is string => !!r).sort();
  const ucs = new Set(c.faturas.map((f) => f.uc ?? "?"));
  const inc = c.faturas.filter((f) => f.confianca < 0.5).length;
  return `Carteira GD do usuário: ${c.faturas.length} fatura(s) de ${ucs.size} UC(s)${refs.length ? ` (${refs[0]} a ${refs.at(-1)})` : ""}${inc ? `, ${inc} com leitura incompleta` : ""}; ${c.ucs.length} UC(s) cadastrada(s). Use gd_carteira / gd_conferir_faturas.`;
}
