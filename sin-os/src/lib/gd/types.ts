import { z } from "zod";

/**
 * Carteira de GD do usuário (fica no navegador): UCs com contrato e tarifas, e faturas já
 * lidas pelo parser determinístico. Vai no corpo da requisição para as ferramentas da Iara
 * calcularem no servidor — o modelo de linguagem só recebe o resumo. Sem nome, CPF ou
 * endereço do titular (LGPD): o parser não extrai esses campos.
 */
const num = z.number().finite().optional();
const kwh = z.number().finite().min(-1e9).max(1e9).optional();
const str = (n: number) => z.string().max(n).optional();

export const ENQ = z.enum(["GD I", "GD II", "GD III", "sem GD"]);
export const LIGACAO = z.enum(["mono", "bi", "tri"]);

export const FATURA_GD = z.object({
  id: z.string().min(1).max(40),
  arquivo: str(120),
  uc: str(40),
  distribuidora: str(40),
  /** Mês de referência AAAA-MM. */
  ref: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  vencimento: str(10),
  grupo: z.enum(["A", "B"]).optional(),
  subgrupo: str(6),
  modalidadeTarifaria: str(20),
  ligacao: LIGACAO.optional(),
  classe: str(30),
  enquadramento: ENQ.optional(),
  dias: num,
  leituraEstimada: z.boolean().optional(),
  consumoKwh: kwh,
  consumoPontaKwh: kwh,
  consumoForaPontaKwh: kwh,
  injetadaKwh: kwh,
  compensadaKwh: kwh,
  creditosRecebidosKwh: kwh,
  saldoAnteriorKwh: kwh,
  saldoKwh: kwh,
  saldoExpirarKwh: kwh,
  /** Preços unitários lidos na fatura (R$/kWh) e se vinham com tributos. */
  teRsKwh: num,
  tusdRsKwh: num,
  tarifasComTributos: z.boolean().optional(),
  energiaRs: num,
  compensacaoRs: num,
  fioBRs: num,
  disponibilidadeRs: num,
  bandeira: str(20),
  bandeiraRs: num,
  icmsRs: num,
  icmsPct: num,
  pisRs: num,
  cofinsRs: num,
  pisPct: num,
  cofinsPct: num,
  cipRs: num,
  multasRs: num,
  totalRs: num,
  demandaKw: num,
  demandaPontaKw: num,
  demandaContratadaKw: num,
  ultrapassagemRs: num,
  reativoRs: num,
  confianca: z.number().min(0).max(1),
  faltando: z.array(z.string().max(30)).max(40),
});
export type FaturaGD = z.infer<typeof FATURA_GD>;

export const CONTRATO_GD = z.object({
  tipo: z.enum(["proprio", "assinatura", "locacao", "consorcio", "cooperativa"]),
  descontoPct: z.number().min(0).max(100).optional(),
  aluguelRsMes: z.number().min(0).max(1e8).optional(),
  fioBPorConta: z.enum(["assinante", "gerador"]).optional(),
  baseDesconto: z.enum(["tarifa_cheia", "tarifa_liquida"]).optional(),
  reajuste: str(30),
  inicio: str(10),
  prazoMeses: z.number().int().min(1).max(600).optional(),
});
export type ContratoGD = z.infer<typeof CONTRATO_GD>;

export const UC_GD = z.object({
  uc: z.string().min(1).max(40),
  apelido: str(60),
  distribuidora: str(40),
  uf: str(2),
  grupo: z.enum(["A", "B"]).optional(),
  ligacao: LIGACAO.optional(),
  papel: z.enum(["geradora", "beneficiaria", "consumidora"]).optional(),
  enquadramento: ENQ.optional(),
  dataProtocolo: str(10),
  potenciaKw: z.number().min(0).max(1e5).optional(),
  fonte: str(30),
  rateioPct: z.number().min(0).max(100).optional(),
  /** Tarifas sem tributos (R$/kWh) e alíquotas (fração) informadas pelo usuário. */
  teRsKwh: num,
  tusdRsKwh: num,
  fioBRsKwh: num,
  icms: z.number().min(0).max(0.5).optional(),
  pis: z.number().min(0).max(0.1).optional(),
  cofins: z.number().min(0).max(0.2).optional(),
  tarifaDemandaRsKw: num,
  contrato: CONTRATO_GD.optional(),
});
export type UcGD = z.infer<typeof UC_GD>;

export const CARTEIRA_GD = z.object({
  ucs: z.array(UC_GD).max(300).default([]),
  faturas: z.array(FATURA_GD).max(800).default([]),
});
export type CarteiraGD = z.infer<typeof CARTEIRA_GD>;

export const EMPTY_CARTEIRA: CarteiraGD = { ucs: [], faturas: [] };
