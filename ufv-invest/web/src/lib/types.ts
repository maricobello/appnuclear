/**
 * Tipos do domínio UFV Invest — o contrato entre as fontes de dados (lib/sources), os modelos
 * (lib/solar, lib/finance), o relatório PDF (lib/report) e a interface.
 *
 * Convenções:
 *  - Energia em MWh (anual/mensal) ou kWh (específica); irradiação em kWh/m²; potência em kW/kWp.
 *  - Percentuais como número em pontos percentuais (12.5 = 12,5 %), nunca fração, salvo quando o
 *    nome terminar em `Frac`.
 *  - Moeda em R$ (BRL) salvo sufixo explícito (USDT, USD).
 *  - Meses indexados 0..11 (jan..dez) em arrays de 12 posições.
 *  - Azimute em convenção de bússola: 0 = Norte, 90 = Leste, 180 = Sul, 270 = Oeste.
 *    No Brasil (hemisfério Sul) o ótimo é ~0 (módulos voltados para o Norte). Os adaptadores
 *    convertem para a convenção de cada API (PVGIS/Open-Meteo usam 0 = Sul).
 */

export type ISODate = string;
export type Address = `0x${string}`;

// ─── Procedência dos dados ──────────────────────────────────────────────────────────────────

/** live = resposta da API agora; cache = resposta recente guardada; fallback = valor de referência embarcado; error = falhou sem substituto */
export type SourceStatus = "live" | "cache" | "fallback" | "error";

export interface Provenance {
  /** identificador estável, ex.: "nasa-power-climatology" */
  id: string;
  /** nome legível, ex.: "NASA POWER — climatologia 2001–2020" */
  name: string;
  /** URL exata consultada (sem chaves) ou referência bibliográfica no fallback */
  url: string;
  fetchedAt: ISODate;
  status: SourceStatus;
  note?: string;
}

export interface Sourced<T> {
  data: T;
  provenance: Provenance;
}

// ─── Catálogo de usinas ─────────────────────────────────────────────────────────────────────

export type PlantStatus = "captacao" | "construcao" | "operacao";
export type Submercado = "SE/CO" | "S" | "NE" | "N";

export interface PlantLocation {
  municipio: string;
  uf: string;
  /** código IBGE do município (7 dígitos) */
  ibgeCode: number;
  lat: number;
  lon: number;
  distribuidora: string;
  submercado: Submercado;
}

/** Perdas do sistema em % (cada uma aplicada multiplicativamente) */
export interface LossBudget {
  soilingPct: number;
  shadingPct: number;
  mismatchPct: number;
  dcWiringPct: number;
  acWiringPct: number;
  transformerPct: number;
  /** indisponibilidade (paradas, manutenção, rede) */
  unavailabilityPct: number;
}

export interface PlantTech {
  dcKWp: number;
  acKW: number;
  module: {
    model: string;
    wp: number;
    count: number;
    /** coeficiente de temperatura de Pmax, %/°C (negativo, ex.: -0.34) */
    gammaPmaxPctPerC: number;
    /** NOCT/NMOT do datasheet, °C */
    noctC: number;
    efficiencyPct: number;
    bifacial: boolean;
  };
  inverter: { model: string; kw: number; count: number; euroEfficiencyPct: number };
  mounting: "fixed" | "single-axis";
  /** inclinação dos módulos (fixo) */
  tiltDeg: number;
  /** azimute em bússola (0 = Norte) */
  azimuthDeg: number;
  /** ângulo máximo de rotação do tracker (single-axis), graus */
  trackerMaxAngleDeg?: number;
  albedo: number;
  losses: LossBudget;
  degradation: { firstYearPct: number; annualPct: number };
  landAreaHa: number;
  modalidade: "geracao-compartilhada" | "autoconsumo-remoto" | "acl-ppa";
  /** Código CEG na ANEEL, quando já outorgado */
  ceg?: string;
  commissioning: ISODate;
}

export interface PlantFinance {
  revenueModel: "gd-assinatura" | "ppa";
  /** Tarifa B1 da distribuidora com impostos, R$/kWh (base do crédito compensado) */
  tariffBRLPerKWh: number;
  /** Componente TUSD Fio B, R$/kWh (cobrança gradual da Lei 14.300/2022) */
  fioBBRLPerKWh: number;
  /** ano da solicitação de acesso — define a regra de transição do Fio B */
  accessRequestYear: number;
  /** desconto concedido ao assinante sobre o valor do crédito */
  clientDiscountPct: number;
  /** energia não compensada + inadimplência */
  revenueLossPct: number;
  /** PPA (modelo "ppa"), R$/MWh */
  ppaPriceBRLPerMWh?: number;
  /** crescimento real anual da tarifa acima do IPCA */
  tariffRealGrowthPct: number;
  omBRLPerKWpYear: number;
  insurancePctCapex: number;
  landLeaseBRLYear: number;
  /** taxa de gestão da SPE/plataforma sobre a receita */
  adminFeePctRevenue: number;
  inverterReplacementYear: number;
  inverterReplacementBRLPerKW: number;
  /** carga tributária efetiva sobre a receita (lucro presumido: PIS/COFINS + IRPJ/CSLL) */
  taxPctRevenue: number;
  horizonYears: number;
  /** primeiro ano-calendário de operação */
  startYear: number;
}

export interface PlantToken {
  symbol: string;
  name: string;
  totalCotas: number;
  cotaPriceBRL: number;
  /** preço on-chain da cota no token de pagamento (USDT BEP-20) */
  cotaPriceUSDT: number;
  minCotas: number;
  softCapCotas: number;
  /** custo de estruturação (jurídico, auditoria, plataforma) embutido na captação */
  structuringFeePct: number;
  chainId: 56 | 97;
  tokenAddress?: Address;
  offeringAddress?: Address;
  offeringStart?: ISODate;
  offeringEnd?: ISODate;
}

export interface Plant {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  status: PlantStatus;
  /** true = projeto ilustrativo (dados técnicos e financeiros hipotéticos; recurso solar real) */
  illustrative: boolean;
  sponsor: { name: string; cnpj?: string };
  location: PlantLocation;
  tech: PlantTech;
  finance: PlantFinance;
  token: PlantToken;
  /** climatologia de referência embarcada, usada quando as APIs não respondem */
  fallbackClimate: MonthlyClimate & { source: string; interannualCvPct: number };
  /** histórico de geração medida (usinas em operação), MWh por mês */
  measured?: { month: string; energyMWh: number }[];
}

// ─── Recurso solar ──────────────────────────────────────────────────────────────────────────

export interface MonthlyClimate {
  /** irradiação global horizontal, média diária do mês, kWh/m²/dia (12 valores) */
  ghiKWhM2Day: number[];
  /** irradiação difusa horizontal, kWh/m²/dia (opcional; o modelo estima se faltar) */
  dhiKWhM2Day?: number[];
  /** temperatura média do ar a 2 m, °C */
  tempC: number[];
  tempMaxC?: number[];
  tempMinC?: number[];
  windMs?: number[];
}

export interface SolarResource {
  monthly: MonthlyClimate;
  annualGhiKWhM2: number;
  /** coeficiente de variação interanual da irradiação anual, % */
  interannualCvPct: number;
  annualSeries?: { year: number; ghiKWhM2: number }[];
  provenance: Provenance[];
}

/** Resultado de referência do PVGIS (JRC) para validação cruzada */
export interface PvgisCrossCheck {
  annualKWhPerKWp: number;
  monthlyKWhPerKWp: number[];
  interannualSdKWhPerKWp?: number;
  provenance: Provenance;
}

// ─── Saída do modelo de geração ─────────────────────────────────────────────────────────────

export interface MonthlyGeneration {
  month: number; // 0..11
  /** irradiação no plano dos módulos no mês, kWh/m² */
  poaKWhM2: number;
  energyMWh: number;
  prPct: number;
  /** temperatura média ponderada da célula nas horas de sol, °C */
  cellTempC: number;
}

export interface LossWaterfallItem {
  label: string;
  /** perda relativa da etapa, % (positivo = perda) */
  pct: number;
  /** energia após a etapa, MWh/ano */
  energyMWhAfter: number;
}

export interface GenerationResult {
  monthly: MonthlyGeneration[];
  /** ano 1, P50 */
  annualP50MWh: number;
  p75MWh: number;
  p90MWh: number;
  p99MWh: number;
  /** P90 da média de 10 anos (variabilidade interanual dividida por √10) */
  p90TenYearMWh: number;
  specificYieldKWhPerKWp: number;
  performanceRatioPct: number;
  capacityFactorPct: number;
  annualPoaKWhM2: number;
  annualGhiKWhM2: number;
  uncertainty: { interannualPct: number; resourceDataPct: number; modelPct: number; degradationPct: number; totalPct: number };
  lossWaterfall: LossWaterfallItem[];
  /** P50 por ano de operação com degradação (1..horizonte) */
  yearly: { year: number; energyMWh: number }[];
  crossCheck?: { source: string; annualMWh: number; deviationPct: number };
  /** CO₂ evitado no ano 1, t (fator de emissão do SIN) */
  co2AvoidedTonsYear: number;
  method: string[];
}

// ─── Mercado / macro ────────────────────────────────────────────────────────────────────────

export interface MarketRates {
  /** Selic meta, % a.a. */
  selicPct: number;
  /** CDI anualizado, % a.a. */
  cdiPct: number;
  /** IPCA acumulado em 12 meses, % */
  ipca12mPct: number;
  /** expectativa de IPCA de longo prazo usada no modelo, % a.a. */
  ipcaLongTermPct: number;
  /** juro real de longo prazo (NTN-B / Tesouro IPCA+), % a.a. */
  realRatePct: number;
  usdBrl: number;
  usdtBrl: number;
  bnbBrl?: number;
  provenance: Provenance[];
}

// ─── Saída do modelo financeiro ─────────────────────────────────────────────────────────────

export interface CashFlowYear {
  /** 0 = investimento; 1..N = operação */
  year: number;
  calendarYear: number;
  energyMWh: number;
  /** receita efetiva por kWh gerado, R$/kWh */
  priceBRLPerKWh: number;
  /** parcela do Fio B cobrada no ano (Lei 14.300), % */
  fioBChargedPct: number;
  revenueBRL: number;
  taxesBRL: number;
  opexBRL: number;
  /** investimento (ano 0) e reposições (inversores), valor positivo = saída */
  capexBRL: number;
  netCashFlowBRL: number;
  cumulativeBRL: number;
  discountedCashFlowBRL: number;
}

export interface Benchmark {
  name: string;
  annualPct: number;
  /** valor final de R$ 1.000 no horizonte, líquido de IR quando aplicável */
  finalValueOf1000BRL: number;
  note: string;
}

export interface MonteCarloSummary {
  runs: number;
  seed: number;
  irrP10Pct: number;
  irrP50Pct: number;
  irrP90Pct: number;
  npvP10BRL: number;
  npvP50BRL: number;
  npvP90BRL: number;
  probIrrBelowCdiPct: number;
  probNpvNegativePct: number;
  histogram: { fromPct: number; toPct: number; count: number }[];
  variables: string[];
}

export interface SensitivityRow {
  variable: string;
  lowLabel: string;
  highLabel: string;
  irrLowPct: number;
  irrHighPct: number;
  npvLowBRL: number;
  npvHighBRL: number;
}

export interface FinancialResult {
  /** captação total (= cotas × preço) */
  investmentBRL: number;
  /** CAPEX da usina (captação − estruturação) */
  capexBRL: number;
  discountRatePct: number;
  cashFlows: CashFlowYear[];
  npvBRL: number;
  irrNominalPct: number;
  irrRealPct: number;
  paybackYears: number | null;
  discountedPaybackYears: number | null;
  /** custo nivelado da energia, R$/MWh */
  lcoeBRLPerMWh: number;
  /** (Σ fluxos líquidos − investimento) / investimento */
  roiTotalPct: number;
  /** múltiplo sobre o capital (Σ distribuições / investimento) */
  moic: number;
  firstYearYieldPct: number;
  avgYieldPct: number;
  perCota: {
    priceBRL: number;
    firstYearIncomeBRL: number;
    avgMonthlyIncomeBRL: number;
    totalIncomeBRL: number;
  };
  benchmarks: Benchmark[];
  monteCarlo: MonteCarloSummary;
  sensitivity: SensitivityRow[];
  assumptions: { label: string; value: string }[];
}

// ─── Local ──────────────────────────────────────────────────────────────────────────────────

export interface LocationInfo {
  municipio: string;
  uf: string;
  ufNome?: string;
  ibgeCode: number;
  regiaoImediata?: string;
  regiaoIntermediaria?: string;
  regiao?: string;
  populacao?: number;
  populacaoAno?: number;
  pibPerCapitaBRL?: number;
  pibAno?: number;
  elevationM?: number;
  provenance: Provenance[];
}

// ─── Condições ao vivo e previsão ───────────────────────────────────────────────────────────

export interface LiveConditions {
  time: ISODate;
  ghiWm2: number;
  /** irradiância no plano dos módulos (GTI), W/m² */
  poaWm2: number;
  tempC: number;
  cloudCoverPct: number;
  isDay: boolean;
  estimatedPowerKW: number;
  /** próximos dias: energia prevista da usina */
  forecast: { date: string; ghiKWhM2: number; poaKWhM2: number; energyMWh: number; tempMaxC: number; cloudCoverPct: number }[];
  provenance: Provenance;
}

// ─── Análise completa (o que a página e o PDF consomem) ─────────────────────────────────────

export interface PlantAnalysis {
  plant: Plant;
  generatedAt: ISODate;
  location: LocationInfo;
  resource: SolarResource;
  pvgis?: PvgisCrossCheck | null;
  generation: GenerationResult;
  market: MarketRates;
  finance: FinancialResult;
  live?: LiveConditions | null;
  provenance: Provenance[];
  /** SHA-256 (hex) do JSON canônico das entradas e resultados — impresso no PDF e ancorável on-chain */
  dataHash: string;
}

/** Estado on-chain lido do contrato (preenchido no cliente ou no servidor via RPC) */
export interface OnChainState {
  chainId: number;
  tokenAddress: Address;
  offeringAddress?: Address;
  totalSupply: bigint;
  maxSupply: bigint;
  cotasSold: bigint;
  raisedUSDT: bigint;
  offeringState: "pending" | "active" | "succeeded" | "failed" | "finalized" | "cancelled";
  documents: { name: string; uri: string; hash: `0x${string}`; timestamp: number }[];
}
