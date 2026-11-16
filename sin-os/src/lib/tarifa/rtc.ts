/**
 * Camada oficial da reforma tributária do consumo (CBS, IBS e Imposto Seletivo) para energia elétrica.
 *
 * Fonte: Calculadora RTC da Receita Federal (repositório público ReceitaFederal/calculadora-rtc-regime-regular,
 * licença MIT; base de dados oficial versão V0059 de 30/09/2026). Este módulo não executa nem copia o código
 * da calculadora: transcreve as linhas das tabelas oficiais que valem para energia elétrica (NCM 2716.00.00)
 * e reproduz em TypeScript a regra da base de cálculo (BaseCalculoService.calcularCibs) e das expressões do
 * tratamento tributário ("baseCalculo*aliquotaEfetiva", arredondamento HALF_EVEN em 2 casas para moeda).
 */

export const RTC_FONTE = {
  nome: "Calculadora RTC (regime regular) da Receita Federal",
  repositorio: "github.com/ReceitaFederal/calculadora-rtc-regime-regular",
  licenca: "MIT",
  versaoBase: "V0059",
  dataBase: "2026-09-30",
  ncmEnergia: "2716.00.00",
} as const;

export type TributoRtc = "CBS" | "IBSUF" | "IBSMun";

/** Tabela ALIQUOTA_REFERENCIA (valores em %): a base oficial só publica 2026, o ano de teste. */
export const ALIQ_REFERENCIA_OFICIAL: { tributo: TributoRtc; pct: number; inicio: string; fim: string }[] = [
  { tributo: "CBS", pct: 0.9, inicio: "2026-01-01", fim: "2026-12-31" },
  { tributo: "IBSUF", pct: 0.1, inicio: "2026-01-01", fim: "2026-12-31" },
  { tributo: "IBSMun", pct: 0, inicio: "2026-01-01", fim: "2026-12-31" },
];

/** Alíquotas oficiais (fração) do ano, ou null quando a Receita ainda não publicou (2027 em diante). */
export function aliquotasOficiais(ano: number): { cbs: number; ibsUf: number; ibsMun: number } | null {
  const d = `${ano}-07-01`;
  const v = (t: TributoRtc) => ALIQ_REFERENCIA_OFICIAL.find((a) => a.tributo === t && a.inicio <= d && d <= a.fim)?.pct;
  const cbs = v("CBS");
  const ibsUf = v("IBSUF");
  const ibsMun = v("IBSMun");
  if (cbs === undefined || ibsUf === undefined || ibsMun === undefined) return null;
  const f = (x: number) => Number((x / 100).toFixed(10));
  return { cbs: f(cbs), ibsUf: f(ibsUf), ibsMun: f(ibsMun) };
}

export type OperacaoEnergia = "consumo" | "cadeia" | "compensada";

export interface ClassificacaoEnergia {
  cst: string;
  situacao: string;
  cClassTrib: string;
  descricao: string;
  tipoAliquota: string;
  fundamento: string;
  resumo: string;
}

/** Linhas de CLASSIFICACAO_TRIBUTARIA / SITUACAO_TRIBUTARIA / FUNDAMENTACAO_LEGAL que tratam de energia elétrica. */
export const CLASSIF_ENERGIA: Record<OperacaoEnergia, ClassificacaoEnergia> = {
  consumo: {
    cst: "000",
    situacao: "Tributação integral",
    cClassTrib: "000001",
    descricao: "Situações tributadas integralmente pelo IBS e CBS.",
    tipoAliquota: "Padrão",
    fundamento: "LC 214/2025, regra geral; art. 28, § 1º, I (o recolhimento ocorre no fornecimento para consumo)",
    resumo: "Fornecimento da distribuidora (ou comercializadora) ao consumidor final: CBS e IBS cheios sobre a base.",
  },
  cadeia: {
    cst: "510",
    situacao: "Diferimento",
    cClassTrib: "510001",
    descricao: "Operações, sujeitas a diferimento, com energia elétrica, relativas à importação, geração, comercialização, distribuição e transmissão",
    tipoAliquota: "Padrão",
    fundamento: "LC 214/2025, art. 28, § 1º",
    resumo: "Venda de geração, comercialização, transmissão e distribuição entre contribuintes do regime regular: o imposto é calculado e diferido em 100%; só é recolhido no fornecimento para consumo ou para quem não está no regime regular.",
  },
  compensada: {
    cst: "830",
    situacao: "Exclusão de base de cálculo",
    cClassTrib: "830001",
    descricao: "Documento com exclusão da BC da CBS e do IBS de energia elétrica fornecida pela distribuidora à UC",
    tipoAliquota: "Sem alíquota",
    fundamento: "LC 214/2025, art. 28, §§ 3º e 4º",
    resumo: "Energia compensada no SCEE (Lei 14.300/2022) sai da base da CBS e do IBS, só para micro e minigeração até 1 MW, e só na parte do custo da energia.",
  },
};

/** Texto da exclusão da GD (FUNDAMENTACAO_LEGAL), para o laudo e a Iara. */
export const ART28_P3_P4 =
  "Art. 28, § 3º: exclui-se da base de cálculo da CBS e do IBS a energia elétrica fornecida pela distribuidora à unidade consumidora, na quantidade correspondente à energia injetada pela mesma UC, acrescida dos créditos de energia originados na própria UC no mesmo mês, em meses anteriores ou em outra UC do mesmo titular. § 4º: só para participantes do SCEE (Lei 14.300/2022); só para micro (até 75 kW) e minigeração (acima de 75 kW até 1 MW); não se aplica ao custo de disponibilidade, à energia reativa, à demanda, aos encargos de conexão ou de uso do sistema de distribuição, às componentes tarifárias não associadas ao custo da energia nem a outros valores cobrados pela distribuidora.";

/** Potência máxima (kW) para a exclusão do art. 28, § 4º, II. */
export const LIMITE_EXCLUSAO_KW = 1000;

/**
 * Enquadramento da operação com energia. A energia compensada só vai para o 830001 quando a geração
 * é micro ou mini até 1 MW; acima disso volta a ser tributação integral (000001).
 */
export function classificarEnergia(op: OperacaoEnergia, potenciaKw?: number | null): ClassificacaoEnergia & { alerta?: string } {
  if (op === "compensada" && potenciaKw != null && potenciaKw > LIMITE_EXCLUSAO_KW) {
    return {
      ...CLASSIF_ENERGIA.consumo,
      alerta: `Geração de ${potenciaKw.toLocaleString("pt-BR")} kW passa de 1 MW: a energia compensada não tem a exclusão do art. 28, § 3º (§ 4º, II) e é tributada normalmente.`,
    };
  }
  return CLASSIF_ENERGIA[op];
}

/** Arredondamento bancário (HALF_EVEN), como o ArredondamentoUtils da calculadora oficial. */
export function arredondar(v: number, casas = 2): number {
  const f = 10 ** casas;
  const x = v * f;
  const r = Math.round(x);
  const exato = Math.abs(x - Math.trunc(x)) - 0.5;
  if (Math.abs(exato) < 1e-9) {
    const piso = Math.floor(x);
    return (piso % 2 === 0 ? piso : piso + 1) / f;
  }
  return r / f;
}

export const ANO_INICIO_CBS_IBS = 2026;
export const ANO_EXTINCAO_PIS_COFINS = 2027;
export const ANO_EXTINCAO_ICMS_ISS = 2033;

export interface EntradaBaseCibs {
  ano: number;
  /** Valor do fornecimento (energia, uso da rede, bandeira, demanda) com os tributos de hoje embutidos. */
  valor: number;
  ajusteAcrescimos?: number;
  juros?: number;
  multas?: number;
  encargos?: number;
  impostoSeletivo?: number;
  outrosTributos?: number;
  demaisImportancias?: number;
  /** Contribuição de iluminação pública (não integra a base). */
  cosip?: number;
  descontoIncondicional?: number;
  pis?: number;
  cofins?: number;
  icms?: number;
}

export interface BaseCibs {
  integra: number;
  naoIntegra: number;
  base: number;
  erros: string[];
}

/**
 * Base de cálculo da CBS e do IBS (BaseCalculoService.calcularCibs): integra valor, acréscimos, juros,
 * multas, encargos, IS e demais importâncias; não integra COSIP, desconto incondicional, PIS, Cofins e ICMS.
 * PIS/Cofins só são aceitos até 2026 e ICMS até 2032, como na validação oficial.
 */
export function baseCibs(e: EntradaBaseCibs): BaseCibs {
  const z = (v?: number) => (Number.isFinite(v) ? (v as number) : 0);
  const erros: string[] = [];
  if (e.ano < ANO_INICIO_CBS_IBS) erros.push(`Para CBS/IBS, o ano do fato gerador deve ser ${ANO_INICIO_CBS_IBS} ou superior`);
  if (e.ano >= ANO_EXTINCAO_PIS_COFINS && (z(e.pis) > 0 || z(e.cofins) > 0)) erros.push(`PIS e Cofins não existem a partir de ${ANO_EXTINCAO_PIS_COFINS}`);
  if (e.ano >= ANO_EXTINCAO_ICMS_ISS && z(e.icms) > 0) erros.push(`ICMS não existe a partir de ${ANO_EXTINCAO_ICMS_ISS}`);
  const integra = z(e.valor) + z(e.ajusteAcrescimos) + z(e.juros) + z(e.multas) + z(e.encargos) + z(e.impostoSeletivo) + z(e.outrosTributos) + z(e.demaisImportancias);
  const naoIntegra = z(e.cosip) + z(e.descontoIncondicional) + z(e.pis) + z(e.cofins) + z(e.icms);
  const base = integra - naoIntegra;
  if (base < 0) erros.push("A base de cálculo ficou negativa: confira os valores informados");
  return { integra: arredondar(integra), naoIntegra: arredondar(naoIntegra), base: arredondar(Math.max(0, base)), erros };
}

export interface TributoCalculado {
  tributo: TributoRtc;
  aliquota: number;
  valor: number;
  diferido: number;
  devido: number;
}

export interface CalculoCibs {
  classificacao: ClassificacaoEnergia & { alerta?: string };
  base: number;
  tributos: TributoCalculado[];
  totalDestacado: number;
  totalDevido: number;
  /** Ano de teste: destacado na nota e sem custo novo (compensado/dispensado). */
  teste: boolean;
  oficial: boolean;
  memoria: string;
}

/**
 * Calcula CBS e IBS de uma operação com energia. Usa a alíquota oficial do ano quando publicada;
 * senão, as estimativas recebidas (frações). Tributação integral: tributo = base × alíquota;
 * diferimento: 100% diferido; exclusão: base zero.
 */
export function calcularCibs(
  op: OperacaoEnergia,
  ano: number,
  base: number,
  opts: { potenciaKw?: number | null; estimativa?: { cbs: number; ibsUf: number; ibsMun: number } } = {},
): CalculoCibs {
  const classificacao = classificarEnergia(op, opts.potenciaKw);
  const oficial = aliquotasOficiais(ano);
  const aliq = oficial ?? opts.estimativa ?? { cbs: 0, ibsUf: 0, ibsMun: 0 };
  const excluida = classificacao.cClassTrib === "830001";
  const diferida = classificacao.cClassTrib === "510001";
  const b = excluida ? 0 : arredondar(base);
  const tributos: TributoCalculado[] = (
    [
      ["CBS", aliq.cbs],
      ["IBSUF", aliq.ibsUf],
      ["IBSMun", aliq.ibsMun],
    ] as const
  ).map(([tributo, aliquota]) => {
    const valor = arredondar(b * aliquota);
    const diferido = diferida ? valor : 0;
    return { tributo, aliquota, valor, diferido, devido: arredondar(valor - diferido) };
  });
  const totalDestacado = arredondar(tributos.reduce((s, t) => s + t.valor, 0));
  const totalDevido = arredondar(tributos.reduce((s, t) => s + t.devido, 0));
  const pct = (v: number) => (v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  const memoria = excluida
    ? `Operação com enquadramento legal em ${classificacao.fundamento}, tributada conforme ${classificacao.situacao.toLowerCase()}. A base de cálculo utilizada é de R$ ${b.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}, sendo que esta operação não possui alíquota.`
    : `Operação de consumo com enquadramento legal em ${classificacao.fundamento}, tributada conforme ${classificacao.situacao.toLowerCase()}. A base de cálculo utilizada é de R$ ${b.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}, com alíquota de ${pct(aliq.cbs)}% (CBS), ${pct(aliq.ibsUf)}% (IBS UF) e ${pct(aliq.ibsMun)}% (IBS município)${diferida ? "; valor 100% diferido" : ""}.`;
  return { classificacao, base: b, tributos, totalDestacado, totalDevido, teste: ano === 2026, oficial: oficial !== null, memoria };
}

/**
 * Parte da energia compensada que sai da base da CBS/IBS (art. 28, § 3º): só a componente de custo da
 * energia (TE), sem TUSD, demanda, disponibilidade e reativo (§ 4º, III). Retorna R$ a excluir.
 */
export function exclusaoCompensada(kwhCompensado: number, teKwhSemTributos: number, potenciaKw?: number | null): { exclusao: number; elegivel: boolean; motivo: string } {
  if (potenciaKw != null && potenciaKw > LIMITE_EXCLUSAO_KW) {
    return { exclusao: 0, elegivel: false, motivo: "geração acima de 1 MW: sem exclusão (art. 28, § 4º, II)" };
  }
  const kwh = Math.max(0, kwhCompensado || 0);
  return {
    exclusao: arredondar(kwh * Math.max(0, teKwhSemTributos || 0)),
    elegivel: true,
    motivo: "energia compensada no SCEE: sai da base só a parte do custo da energia (TE); TUSD, demanda, disponibilidade e reativo continuam na base (art. 28, § 4º, III)",
  };
}
