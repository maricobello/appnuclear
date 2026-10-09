/**
 * Valores de referência embarcados (fallback) — usados SOMENTE quando a fonte correspondente
 * não responde (ou, no caso do juro real, porque não há API aberta estável). Tudo que sai daqui
 * é marcado com `status: "fallback"` na procedência, na tela e no PDF.
 *
 * ⚠ Revisar periodicamente: atualize `value`, `asOf` e `DEFAULTS_REVIEWED_AT` juntos.
 * Os números são ordens de grandeza na data indicada em `asOf`, não cotações.
 */

/** Data da última revisão destes valores */
export const DEFAULTS_REVIEWED_AT = "2026-10-04";

export interface ReferenceValue {
  value: number;
  /** mês/data a que o valor se refere */
  asOf: string;
  /** de onde veio o número */
  source: string;
  /** onde conferir/atualizar */
  url: string;
}

export const MARKET_DEFAULTS = {
  /** Meta Selic definida pelo Copom (último nível confirmado na revisão) */
  selicPct: {
    value: 15.0,
    asOf: "2025-12",
    source: "Copom/BCB — meta da taxa Selic (valor de referência)",
    url: "https://www.bcb.gov.br/controleinflacao/historicotaxasjuros",
  },
  /** CDI ≈ Selic meta − 0,10 p.p. */
  cdiPct: {
    value: 14.9,
    asOf: "2025-12",
    source: "B3/BCB — CDI anualizado (≈ Selic meta − 0,10 p.p.)",
    url: "https://www.bcb.gov.br/estabilidadefinanceira/historicotaxasjuros",
  },
  /** IPCA acumulado em 12 meses */
  ipca12mPct: {
    value: 4.3,
    asOf: "2025-12",
    source: "IBGE — IPCA acumulado em 12 meses (aprox.)",
    url: "https://www.ibge.gov.br/explica/inflacao.php",
  },
  /** Expectativa de IPCA de longo prazo — medianas Focus para 3–4 anos à frente na faixa 3,5–4,0 % */
  ipcaLongTermPct: {
    value: 3.75,
    asOf: "2025-12",
    source: "BCB — Relatório Focus, mediana de IPCA de longo prazo (faixa 3,5–4,0 %)",
    url: "https://www.bcb.gov.br/publicacoes/focus",
  },
  /**
   * Juro real de longo prazo (NTN-B / Tesouro IPCA+ longo). Não há API aberta estável (o site do
   * Tesouro Direto bloqueia scraping via Cloudflare; o CSV do Tesouro Transparente tem >10 MB) —
   * por isso é SEMPRE fallback. Atualize com a taxa do Tesouro IPCA+ mais longo.
   */
  realRatePct: {
    value: 7.0,
    asOf: "2025-12",
    source: "Tesouro Direto — taxa real do Tesouro IPCA+ longo (NTN-B), referência",
    url: "https://www.tesourodireto.com.br/titulos/precos-e-taxas.htm",
  },
  /** Dólar PTAX venda */
  usdBrl: {
    value: 5.4,
    asOf: "2025-12",
    source: "BCB — dólar PTAX venda (aprox.)",
    url: "https://www.bcb.gov.br/estabilidadefinanceira/historicocotacoes",
  },
} as const satisfies Record<string, ReferenceValue>;

/** Spread usado para derivar CDI da Selic (ou vice-versa) quando só uma das séries responde, p.p. */
export const CDI_SELIC_SPREAD_PP = 0.1;

/** Referência bibliográfica da climatologia embarcada em `plant.fallbackClimate` */
export const CLIMATE_FALLBACK_URL = "https://labren.ccst.inpe.br/atlas_2017.html";

/** Unidades da federação — usado no fallback de `getLocationInfo` (nomes oficiais IBGE) */
export const UF_INFO: Record<string, { nome: string; regiao: string }> = {
  AC: { nome: "Acre", regiao: "Norte" },
  AL: { nome: "Alagoas", regiao: "Nordeste" },
  AP: { nome: "Amapá", regiao: "Norte" },
  AM: { nome: "Amazonas", regiao: "Norte" },
  BA: { nome: "Bahia", regiao: "Nordeste" },
  CE: { nome: "Ceará", regiao: "Nordeste" },
  DF: { nome: "Distrito Federal", regiao: "Centro-Oeste" },
  ES: { nome: "Espírito Santo", regiao: "Sudeste" },
  GO: { nome: "Goiás", regiao: "Centro-Oeste" },
  MA: { nome: "Maranhão", regiao: "Nordeste" },
  MT: { nome: "Mato Grosso", regiao: "Centro-Oeste" },
  MS: { nome: "Mato Grosso do Sul", regiao: "Centro-Oeste" },
  MG: { nome: "Minas Gerais", regiao: "Sudeste" },
  PA: { nome: "Pará", regiao: "Norte" },
  PB: { nome: "Paraíba", regiao: "Nordeste" },
  PR: { nome: "Paraná", regiao: "Sul" },
  PE: { nome: "Pernambuco", regiao: "Nordeste" },
  PI: { nome: "Piauí", regiao: "Nordeste" },
  RJ: { nome: "Rio de Janeiro", regiao: "Sudeste" },
  RN: { nome: "Rio Grande do Norte", regiao: "Nordeste" },
  RS: { nome: "Rio Grande do Sul", regiao: "Sul" },
  RO: { nome: "Rondônia", regiao: "Norte" },
  RR: { nome: "Roraima", regiao: "Norte" },
  SC: { nome: "Santa Catarina", regiao: "Sul" },
  SP: { nome: "São Paulo", regiao: "Sudeste" },
  SE: { nome: "Sergipe", regiao: "Nordeste" },
  TO: { nome: "Tocantins", regiao: "Norte" },
};
