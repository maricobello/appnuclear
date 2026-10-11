/**
 * Premissas do modelo econômico da plataforma (Prontuário Econômico-Financeiro).
 *
 * TODA premissa editável do modelo fica aqui. Ao mudar um número, o próximo prontuário emitido
 * recalcula tudo (otimização da tabela, KPIs, DRE e pareceres). Valores de custo são estimativas de
 * mercado para uma operação enxuta no Brasil e DEVEM ser confirmados com o plano de negócios e o
 * contador antes de uso externo.
 */

export const MODEL_VERSION = "1.0.0";

/**
 * Tabela de remuneração da plataforma.
 *
 *  - Estruturação (sucesso): % da captação, retido apenas se a oferta for bem-sucedida. A usina
 *    (CAPEX) é a mesma: a captação necessária vira CAPEX ÷ (1 − estruturação).
 *  - Gestão: % da receita bruta da usina, todo ano (paga pela SPE à gestora antes da distribuição).
 *  - Performance: % do caixa distribuível que exceder o "hurdle" do ano — retorno preferencial de
 *    (1 + hurdle real)(1 + IPCA LP) − 1 sobre o capital investido, com déficit acumulado (anos abaixo
 *    do hurdle precisam ser compensados antes de haver performance).
 */
export interface FeeSchedule {
  id: string;
  label: string;
  structuringPct: number;
  managementPct: number;
  performancePct: number;
  hurdleRealPct: number;
}

/** Tabela praticada hoje no catálogo (estruturação 4 % e gestão 8 % da receita, sem performance). */
export const CURRENT_SCHEDULE: FeeSchedule = {
  id: "atual",
  label: "Tabela atual",
  structuringPct: 4,
  managementPct: 8,
  performancePct: 0,
  hurdleRealPct: 0,
};

/**
 * Grade de tabelas candidatas avaliadas pelo otimizador (produto cartesiano), limitada às faixas
 * praticadas no mercado: estruturação de 3 % a 8 % da captação (plataformas de oferta pública de
 * investimento cobram tipicamente 5 % a 10 % do emissor), gestão de 6 % a 12 % da receita (gestoras de
 * geração compartilhada) e performance de até 25 % sobre um retorno preferencial de IPCA + 6 % ou + 8 %
 * (o "20 % sobre 8 %" é o padrão de fundos de participação).
 */
export const CANDIDATE_GRID = {
  structuringPct: [3, 4, 5, 6, 7, 8],
  managementPct: [6, 8, 10, 12],
  performancePct: [0, 10, 15, 20, 25],
  hurdleRealPct: [6, 8],
};

/**
 * Travas de atratividade e equidade para o investidor. A tabela recomendada é a de maior VPL para a
 * plataforma que respeita TODAS as travas em TODAS as ofertas abertas. Afrouxar uma trava aumenta a
 * receita da plataforma e reduz a competitividade da oferta.
 */
export const GUARDRAILS = {
  /** TIR nominal P50 do investidor ≥ CDI médio projetado no horizonte + este prêmio (p.p.) */
  minIrrSpreadOverCdiPp: 4,
  /** TIR real no cenário P90 de geração ≥ juro real de longo prazo (NTN-B) + este prêmio (p.p.) */
  minRealIrrP90OverNtnbPp: 0,
  /** payback simples do investidor no P50, anos */
  maxPaybackYears: 7,
  /** participação máxima da plataforma no caixa da usina (taxas ÷ (taxas + distribuições)), % */
  maxPlatformSharePct: 25,
};

/** Custos da plataforma (estimativas de mercado; confirmar com o plano de negócios). */
export const PLATFORM_COSTS = {
  /** custos fixos anuais: equipe enxuta, compliance, jurídico recorrente, infraestrutura e auditorias */
  fixedAnnualBRL: 1_300_000,
  fixedBreakdown: [
    { item: "Equipe (5 pessoas, com encargos)", annualBRL: 900_000 },
    { item: "Jurídico, compliance e taxas regulatórias", annualBRL: 140_000 },
    { item: "Auditorias (contratos inteligentes e demonstrações)", annualBRL: 120_000 },
    { item: "Infraestrutura, ferramentas e segurança", annualBRL: 60_000 },
    { item: "Marca e relacionamento institucional", annualBRL: 80_000 },
  ],
  /** por oferta: SPE e documentos, due diligence técnica independente, avaliação e lançamento */
  perOfferingBRL: 150_000,
  /** por investidor: verificação KYC/AML no provedor e atendimento de cadastro */
  perInvestorBRL: 35,
  /** custo de aquisição (marketing de performance) por investidor */
  cacPerInvestorBRL: 150,
  /** ticket médio por investidor (define o número de investidores de cada oferta) */
  avgTicketBRL: 10_000,
  /** custo de operar a gestão da SPE (cobrança dos assinantes, compensação de créditos), % da receita */
  speOperationPctRevenue: 3,
  /** contabilidade e auditoria anual de cada SPE */
  speFixedAnnualBRL: 30_000,
  /** tributos sobre a receita de serviços da plataforma (lucro presumido com ISS 5 % e adicional de IRPJ) */
  taxOnFeesPct: 19.53,
  /** taxa de originação paga pelo patrocinador ao listar a usina (não reembolsável) */
  originationFeeBRL: 60_000,
};

/** Horizonte da DRE projetada da plataforma, anos */
export const PNL_YEARS = 10;

/** Faixas de referência dos indicadores da plataforma (painel de exames). */
export const PLATFORM_REFERENCES = {
  /** receita recorrente anual ÷ capital captado (take rate), % a.a. */
  takeRateMinPct: 1,
  takeRateMaxPct: 4,
  /** margem líquida no ano 3 da carteira (resultado ÷ receita bruta) */
  netMarginYear3MinPct: 25,
  /** maior oferta ÷ captação total da carteira */
  maxConcentrationPct: 30,
  /** meses para a plataforma recuperar os custos de uma oferta */
  maxOfferingPaybackMonths: 12,
};
