import { AUDIT_THRESHOLDS, CHECK_WEIGHTS } from "./audit/checks";
import { DEFAULT_THRESHOLDS } from "./audit/market-alerts";
import { TRUST_RULES, TRUST_SOURCES } from "./audit/trust";
import { PLD_LIMITS } from "./market/brazil";
import { LEAR_WEIGHT } from "./market/forecast";
import { EAR_BANDS, PLD_BANDS, SEASONS } from "./market/regime-backtest";
import { RENEWABLE_CHECKS } from "./market/renewables";
import { VALID_RANGES } from "./sources/ranges";
import { SOURCES } from "./sources/registry";
import type { SourceId } from "./sources/types";

/**
 * Metodologia publicada: dicionário de dados de cada fonte e regras do agente auditor.
 * Os limites vêm das mesmas constantes que o código aplica (checks, trust, ranges,
 * renewables, regime-backtest), então o que a página e /api/metodologia mostram é o que roda.
 */
export interface DictField {
  /** Coluna ou campo na origem. */
  col: string;
  /** Nome usado no app. */
  as: string;
  unit: string;
  note?: string;
}

export interface DictEntry {
  /** Arquivos ou rotas lidos, com o padrão do nome. */
  files: string[];
  /** Granularidade na origem e no app. */
  grain: string;
  /** Como o instante da origem é interpretado. */
  time: string;
  fields: DictField[];
  /** Transformações, na ordem em que são aplicadas. */
  steps: string[];
  /** Como a versão do dado é rastreada. */
  version: string;
}

const S3 = "ons-aws-prod-opendata.s3.amazonaws.com/dataset";
const SUB_COL: DictField = { col: "id_subsistema", as: "sub", unit: "SE · S · NE · N", note: "SE inclui o Centro-Oeste" };
const DIGEST = `impressão digital diária (seção Confiança): o dia fechado que volta diferente vira revisão registrada`;
const ETAG = "sem histórico próprio: vale a última resposta da API (o app guarda a hora da coleta)";

export const DATA_DICTIONARY: Record<SourceId, DictEntry> = {
  ccee_pld: {
    files: ["CKAN datastore_search do conjunto pld_horario (recursos anuais, os 2 mais recentes)"],
    grain: "hora × submercado",
    time: "MES_REFERENCIA + DIA + HORA no relógio de Brasília; HORA h = intervalo [h:00, h+1:00)",
    fields: [
      { col: "MES_REFERENCIA", as: "mês", unit: "AAAAMM" },
      { col: "DIA", as: "dia", unit: "1–31" },
      { col: "HORA", as: "hora", unit: "0–23" },
      { col: "SUBMERCADO", as: "sub", unit: "SUDESTE · SUL · NORDESTE · NORTE" },
      { col: "PLD_HORA", as: "pld", unit: "R$/MWh" },
    ],
    steps: [
      "nomes de coluna resolvidos por padrão (aceita DATA no lugar de MES_REFERENCIA + DIA); campo ausente reprova o schema",
      "registro sem submercado, data ou valor numérico conta como inválido; o mesmo submercado e hora repetido conta como duplicado",
      `se a CCEE não responde: Plataforma de Integração (se configurada) → dias oficiais já gravados pelo coletor → CMO do DESSEM limitado ao piso de R$ ${PLD_LIMITS.min} e ao teto horário de R$ ${PLD_LIMITS.maxHourly} → último dado bom persistido`,
      "a resposta sempre diz de onde veio cada trecho (campos note e fallback); estimativa nunca aparece como oficial",
    ],
    version: `${DIGEST}; dias gravados no Firestore com a origem (ccee ou ons-cmo)`,
  },
  ccee_pi: {
    files: ["SOAP listarPLD em servicos.ccee.org.br (certificado digital + usuário de agente)"],
    grain: "hora × submercado",
    time: "vigencia/inicio da resposta XML (Brasília) = início da hora",
    fields: [
      { col: "vigencia/inicio", as: "ts", unit: "início da hora" },
      { col: "submercado/nome · submercado/codigo", as: "sub", unit: "SUDESTE… · 1–4" },
      { col: "valor/valor (codigo BRL)", as: "pld", unit: "R$/MWh", note: "valores do tipo SEMANAL são ignorados" },
    ],
    steps: ["últimos 14 dias + D+1 publicados pela CCEE", "sobrepõe o histórico estimado: onde há oficial, vale o oficial"],
    version: DIGEST,
  },
  ons_cmo: {
    files: [`${S3}/cmo_tm/CMO_SEMIHORARIO_AAAA.csv (CKAN cmo-semi-horario como reserva)`],
    grain: "meia hora × subsistema → hora",
    time: "din_instante no relógio de Brasília (sem fuso no arquivo); marca o início da meia hora",
    fields: [
      SUB_COL,
      { col: "din_instante", as: "ts", unit: "AAAA-MM-DD hh:mm:ss" },
      { col: "val_cmo", as: "cmo", unit: "R$/MWh", note: "inclui a programação de D+1 do DESSEM" },
    ],
    steps: [
      "CSV com separador ';' e decimal '.'; um arquivo por ano",
      "hora h = média das meias horas h:00 e h:30",
      "PLD estimado = CMO limitado ao piso e ao teto horário; média diária limitada ao teto estrutural",
    ],
    version: DIGEST,
  },
  ons_ear: {
    files: [`${S3}/ear_subsistema_di/EAR_DIARIO_SUBSISTEMA_AAAA.csv`],
    grain: "dia × subsistema",
    time: "ear_data = dia de Brasília",
    fields: [SUB_COL, { col: "ear_data", as: "data", unit: "AAAA-MM-DD" }, { col: "ear_verif_subsistema_percentual", as: "ear", unit: "% da EARmax" }],
    steps: ["um valor por dia e subsistema; repetição conta como duplicado"],
    version: DIGEST,
  },
  ons_ena: {
    files: [`${S3}/ena_subsistema_di/ENA_DIARIO_SUBSISTEMA_AAAA.csv`],
    grain: "dia × subsistema",
    time: "ena_data = dia de Brasília",
    fields: [SUB_COL, { col: "ena_data", as: "data", unit: "AAAA-MM-DD" }, { col: "ena_bruta_regiao_percentualmlt", as: "ena", unit: "% da MLT" }],
    steps: ["um valor por dia e subsistema; repetição conta como duplicado"],
    version: DIGEST,
  },
  ons_carga: {
    files: [`${S3}/curva-carga-ho/CURVA_CARGA_AAAA.csv`],
    grain: "hora × subsistema",
    time: "din_instante no relógio de Brasília; marca o início da hora",
    fields: [SUB_COL, { col: "din_instante", as: "ts", unit: "AAAA-MM-DD hh:mm:ss" }, { col: "val_cargaenergiahomwmed", as: "carga", unit: "MWmed" }],
    steps: ["mesma agregação horária do CMO (aqui já é horário)"],
    version: DIGEST,
  },
  ons_curtailment: {
    files: [`${S3}/restricao_coff_eolica_tm/RESTRICAO_COFF_EOLICA_AAAA_MM.parquet`, `${S3}/restricao_coff_fotovoltaica_tm/RESTRICAO_COFF_FOTOVOLTAICA_AAAA_MM.parquet`],
    grain: "meia hora × conjunto (usina) → dia × submercado",
    time: "din_instante é o relógio de Brasília gravado como se fosse UTC; o app desfaz isso (+3 h). Marca o início da meia hora",
    fields: [
      SUB_COL,
      { col: "din_instante", as: "ts", unit: "timestamp" },
      { col: "val_geracao", as: "geracao", unit: "MW médio" },
      { col: "val_disponibilidade", as: "disp", unit: "MW médio" },
      { col: "val_geracaoreferencia", as: "ref", unit: "MW médio", note: "às vezes acima da disponibilidade" },
      { col: "val_geracaoreferenciafinal", as: "refFinal", unit: "MW médio" },
      { col: "cod_razaorestricao", as: "razao", unit: "REL · CNF · ENE", note: "confiabilidade · rede · sobra de energia" },
      { col: "val_geracaonaorealizadaapurada", as: "apurada", unit: "MW médio", note: "× 0,5 = MWh da meia hora" },
    ],
    steps: [
      "apurada oficial = max(0, referência − geração), reproduzida pelo app",
      "corte também calculado com a referência limitada à disponibilidade: o painel mostra a faixa entre os dois",
      "dia só fecha com as 48 meias horas",
    ],
    version: "um arquivo por mês: o Last-Modified do S3 é a versão; arquivo republicado com total diferente vira revisão com o total anterior",
  },
  ons_balanco: {
    files: [`${S3}/balanco_energia_subsistema_ho/BALANCO_ENERGIA_SUBSISTEMA_AAAA.parquet`],
    grain: "hora × subsistema",
    time: "din_instante no relógio de Brasília gravado como UTC (mesma correção do corte)",
    fields: [
      SUB_COL,
      { col: "val_gerhidraulica · val_gertermica", as: "hidro · termica", unit: "MWmed" },
      { col: "val_gereolica · val_gersolar", as: "eolica · solar", unit: "MWmed" },
      { col: "val_carga", as: "carga", unit: "MWmed" },
      { col: "val_intercambio", as: "intercambio", unit: "MWmed", note: "positivo = exportação" },
    ],
    steps: ["a linha SIN do arquivo é descartada: o SIN é a soma dos 4 submercados na mesma hora", "carga líquida = carga − eólica − solar"],
    version: "arquivo anual relido a cada 3 h; o app usa só a janela recente da página",
  },
  energy_charts: {
    files: ["api.energy-charts.info/price?bzn=ZONA&start&end (12 zonas)"],
    grain: "15 min (SDAC) por zona",
    time: "unix_seconds em UTC",
    fields: [{ col: "unix_seconds", as: "ts", unit: "s desde 1970 (UTC)" }, { col: "price", as: "preço", unit: "€/MWh" }],
    steps: ["no máximo 2 chamadas por minuto (limite da API); zona baixada fica guardada e é reaproveitada"],
    version: ETAG,
  },
  elexon_mid: {
    files: ["data.elexon.co.uk/bmrs/api/v1/balancing/pricing/market-index (APXMIDP, janelas de até 7 dias)"],
    grain: "30 min (settlement period)",
    time: "startTime em ISO 8601 UTC",
    fields: [{ col: "startTime", as: "ts", unit: "ISO 8601" }, { col: "price", as: "mid", unit: "£/MWh" }, { col: "volume", as: "volume", unit: "MWh", note: "período com preço e volume zero é ignorado" }],
    steps: ["mesmo período com preços diferentes conta como duplicado"],
    version: ETAG,
  },
  elexon_sysprice: {
    files: ["data.elexon.co.uk/bmrs/api/v1/balancing/settlement/system-prices/{data}"],
    grain: "30 min (settlement period)",
    time: "startTime em ISO 8601 UTC",
    fields: [
      { col: "settlementPeriod", as: "sp", unit: "1–50" },
      { col: "systemSellPrice · systemBuyPrice", as: "ssp · sbp", unit: "£/MWh" },
      { col: "netImbalanceVolume", as: "niv", unit: "MWh" },
    ],
    steps: ["uma chamada por dia"],
    version: ETAG,
  },
  uk_carbon: {
    files: ["api.carbonintensity.org.uk/intensity"],
    grain: "30 min",
    time: "from / to em ISO 8601 UTC",
    fields: [{ col: "intensity.forecast", as: "intensidade", unit: "gCO₂/kWh" }, { col: "intensity.index", as: "índice", unit: "very low … very high" }],
    steps: ["só o período corrente"],
    version: ETAG,
  },
  open_meteo: {
    files: ["api.open-meteo.com/v1/forecast (hubs do SIN, 16 dias)"],
    grain: "hora × local",
    time: "timezone=America/Sao_Paulo: horas já no relógio de Brasília",
    fields: [
      { col: "temperature_2m", as: "temp", unit: "°C" },
      { col: "wind_speed_100m", as: "wind100", unit: "m/s" },
      { col: "shortwave_radiation", as: "ghi", unit: "W/m²" },
      { col: "precipitation · precipitation_sum", as: "chuva", unit: "mm" },
    ],
    steps: ["é previsão numérica, não observação"],
    version: ETAG,
  },
  open_meteo_ens: {
    files: ["ensemble-api.open-meteo.com/v1/ensemble (ECMWF IFS 0,25°, 15 dias)"],
    grain: "hora × bacia × membro",
    time: "timezone=America/Sao_Paulo",
    fields: [{ col: "precipitation_memberNN", as: "chuva por membro", unit: "mm" }],
    steps: ["chuva acumulada por membro; quantis entre os 51 membros"],
    version: ETAG,
  },
  bcb_fx: {
    files: ["api.bcb.gov.br/dados/serie/bcdata.sgs.{1|21619|21623}/dados/ultimos/20"],
    grain: "dia útil",
    time: "data dd/mm/aaaa (Brasília)",
    fields: [{ col: "data", as: "data", unit: "dd/mm/aaaa" }, { col: "valor", as: "taxa", unit: "R$ por USD · EUR · GBP (venda)" }],
    steps: ["EUR/USD e GBP/USD implícitos conferidos na triangulação cambial"],
    version: ETAG,
  },
  eia: {
    files: ["api.eia.gov/v2 séries RNGWHHD (Henry Hub) e RBRTE (Brent)"],
    grain: "dia",
    time: "period AAAA-MM-DD (dia de negociação nos EUA)",
    fields: [{ col: "period", as: "data", unit: "AAAA-MM-DD" }, { col: "value", as: "preço", unit: "US$/MMBtu · US$/bbl" }],
    steps: ["só roda com EIA_API_KEY"],
    version: ETAG,
  },
};

const br = (x: number) => x.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const pct = (x: number) => `${br(Math.round(x * 1000) / 10)}%`;
const T = AUDIT_THRESHOLDS;

export interface CheckRule {
  id: keyof typeof CHECK_WEIGHTS;
  label: string;
  weight: number;
  pass: string;
  warn: string;
  fail: string;
}

export const CHECK_RULES: CheckRule[] = [
  { id: "availability", label: "Disponibilidade", weight: CHECK_WEIGHTS.availability, pass: "respondeu na primeira tentativa", warn: "respondeu depois de tentativas com falha (nota 0,8)", fail: "não respondeu: fonte fora, score 0" },
  {
    id: "freshness",
    label: "Frescor",
    weight: CHECK_WEIGHTS.freshness,
    pass: "observação mais recente dentro do SLA da fonte",
    warn: `até ${T.freshness.warnSlaFactor}× o SLA (nota 0,5)`,
    fail: `acima de ${T.freshness.warnSlaFactor}× o SLA ou sem data`,
  },
  { id: "schema", label: "Schema", weight: CHECK_WEIGHTS.schema, pass: "colunas esperadas presentes", warn: "coluna ausente ou renomeada (nota 0,4)", fail: "não reprova aqui: sem coluna essencial a coleta falha e reprova em Disponibilidade" },
  {
    id: "completeness",
    label: "Completude",
    weight: CHECK_WEIGHTS.completeness,
    pass: `≥ ${pct(T.completeness.passRatio)} da janela, sem duplicados, < ${pct(T.completeness.passInvalid)} inválidos`,
    warn: `≥ ${pct(T.completeness.warnRatio)} da janela e < ${pct(T.completeness.warnInvalid)} inválidos (nota 0,6)`,
    fail: "abaixo disso (nota 0,2)",
  },
  { id: "validity", label: "Validade", weight: CHECK_WEIGHTS.validity, pass: "100% dos valores na faixa da fonte", warn: `até ${pct(T.validity.warnOutside)} fora da faixa (nota 0,5)`, fail: `mais de ${pct(T.validity.warnOutside)} fora da faixa` },
  {
    id: "latency",
    label: "Latência",
    weight: CHECK_WEIGHTS.latency,
    pass: `< ${br(T.latency.passMs / 1000)} s (× ${T.latency.bigFactor} para download > ${br(T.latency.bigBytes / 1e6)} MB)`,
    warn: `< ${br(T.latency.warnMs / 1000)} s (nota 0,5)`,
    fail: "acima disso (nota 0,1)",
  },
  {
    id: "outliers",
    label: "Outliers (Hampel)",
    weight: CHECK_WEIGHTS.outliers,
    pass: `≤ ${pct(T.outliers.passShare)} dos pontos a mais de ${T.outliers.k} MADs da mediana móvel de ${T.outliers.window} pontos`,
    warn: "acima disso (nota 0,5): só alerta, pico real de preço existe",
    fail: `não reprova; precisa de ${T.outliers.minSample} pontos`,
  },
];

/** Bandas sem Infinity, para JSON. */
const bands = () => {
  let lo = 0;
  return EAR_BANDS.map((b) => {
    const out = { key: b.key, label: b.label, min: lo, max: Number.isFinite(b.max) ? b.max : null };
    lo = b.max;
    return out;
  });
};

export function methodology(env: Record<string, string | undefined> = process.env) {
  const sha = env.VERCEL_GIT_COMMIT_SHA ?? null;
  const repo = env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}` : "maricobello/sinos";
  const ids = Object.keys(SOURCES) as SourceId[];
  return {
    version: { commit: sha ? sha.slice(0, 7) : null, url: sha ? `https://github.com/${repo}/commit/${sha}` : `https://github.com/${repo}` },
    time: {
      storage: "instantes guardados em UTC (epoch ms) e exibidos no relógio de Brasília",
      zone: "America/Sao_Paulo, UTC−3 fixo (sem horário de verão desde 2019)",
      hour: "hora h = intervalo [h:00, h+1:00) de Brasília; dia fechado = até ontem",
      capture: "toda fonte leva fetchedAt (hora da coleta) e os cálculos levam computedAt",
    },
    sources: ids.map((id) => {
      const m = SOURCES[id];
      const r = VALID_RANGES[id];
      return {
        id,
        name: m.name,
        provider: m.provider,
        license: m.license,
        docs: m.docs,
        cadence: m.cadence,
        freshnessSlaHours: m.freshnessSlaHours,
        requiresKey: m.requiresKey ?? null,
        range: { min: r.range[0], max: r.range[1], unit: r.unit, why: r.why },
        trust: (TRUST_SOURCES as SourceId[]).includes(id),
        ...DATA_DICTIONARY[id],
      };
    }),
    audit: {
      weights: CHECK_WEIGHTS,
      rules: CHECK_RULES,
      thresholds: AUDIT_THRESHOLDS,
      okScore: T.okScore,
      score: "100 × Σ(peso × nota) / Σ(peso); passa = 1, checagem pulada = 1",
      status: `ok com score ≥ ${T.okScore} e nenhuma reprovação; degradada caso contrário; fora se a coleta falha; desabilitada se falta a chave`,
      cross: [
        {
          id: "pld_vs_cmo",
          label: "PLD (CCEE) × CMO limitado (ONS)",
          rule: `últimos ${T.pldVsCmo.days} dias, mínimo ${T.pldVsCmo.minPairs} pares hora × submercado: passa com MAE < R$ ${T.pldVsCmo.passMae} e mais de ${pct(T.pldVsCmo.passWithin1)} das horas com |Δ| ≤ R$ 1; alerta com MAE < R$ ${T.pldVsCmo.warnMae}; reprova acima`,
        },
        { id: "fx_triangle", label: "Triangulação cambial", rule: `EUR/USD implícito entre ${br(T.fx.eurusd[0])} e ${br(T.fx.eurusd[1])} e GBP/USD entre ${br(T.fx.gbpusd[0])} e ${br(T.fx.gbpusd[1])}; fora disso reprova` },
      ],
    },
    trust: {
      sources: TRUST_SOURCES,
      rules: TRUST_RULES,
      digest: `valores do dia arredondados a ${TRUST_RULES.decimals} casas, na ordem SE, S, NE, N × hora, resumidos por SHA-1; últimos ${TRUST_RULES.windowDays} dias fechados`,
      revision: "o mesmo dia com hash diferente e não menos completo; registra pontos alterados, maior diferença absoluta e relativa, deslocamento da média, hashes e hora da detecção",
      seal: `alta: sem revisão e completo · média: revisões pequenas ou dias incompletos · baixa: alguma revisão ≥ ${pct(TRUST_RULES.bigRevision)}, ${TRUST_RULES.manyRevisions} ou mais revisões em 30 dias, ou metade ou mais dos dias incompletos; PLD estimado pelo CMO fica no máximo em média`,
    },
    renewables: {
      checks: RENEWABLE_CHECKS,
      rules: [
        `apurada do ONS reproduzida por max(0, referência − geração) com erro médio < ${br(RENEWABLE_CHECKS.methodMaeMax)} MW`,
        `referência acima de ${br(RENEWABLE_CHECKS.refAboveAvail)} × disponibilidade é sinalizada; o corte limitado à disponibilidade vira o piso da faixa`,
        `convenção de hora validada pela correlação entre a geração dos conjuntos e o balanço: sem defasagem tem que ser a melhor e passar de ${br(RENEWABLE_CHECKS.hourCorrMin)}`,
        `balanço fecha quando |hidro + térmica + eólica + solar − intercâmbio − carga| ≤ ${pct(RENEWABLE_CHECKS.identityTol)} da carga`,
      ],
    },
    alerts: {
      defaults: DEFAULT_THRESHOLDS,
      rules: [
        `PLD horário ≥ R$ ${DEFAULT_THRESHOLDS.pldMax} em algum submercado`,
        `diferença entre submercados na mesma hora ≥ R$ ${DEFAULT_THRESHOLDS.spread}`,
        `diferença entre a hora mais cara e a mais barata do dia ≥ R$ ${DEFAULT_THRESHOLDS.intraday} no mesmo submercado`,
        `corte do dia ≥ ${br(DEFAULT_THRESHOLDS.curtailFactor)}× a mediana dos 7 dias anteriores e ≥ ${DEFAULT_THRESHOLDS.curtailMinGWh} GWh`,
      ],
      target: "regras de preço olham amanhã quando o PLD de amanhã já saiu, senão hoje; a mensagem diz se é oficial ou estimado",
      dedupe: "cada alerta tem id regra + data e é enviado uma vez só; limites ajustáveis por variável de ambiente",
    },
    forecast: {
      leadWeight: LEAR_WEIGHT,
      published: `previsão publicada = ${Math.round(LEAR_WEIGHT * 100)}% LEAR + ${Math.round((1 - LEAR_WEIGHT) * 100)}% ingênuo; D+1 vem da programação do DESSEM (CMO limitado), o modelo começa em D+2`,
      naive: "ingênuo de Lago et al. (2021): segunda, sábado e domingo repetem o mesmo dia da semana anterior; os demais repetem ontem",
      walkForward: "cada dia é previsto só com o histórico anterior; LEAR re-estimado todo dia na janela de 90 dias; previsão limitada ao piso e ao teto horário e média diária ao teto estrutural",
      metric: "rMAE = MAE do modelo / MAE do ingênuo, hora a hora; abaixo de 1 o modelo ganha. Dias ausentes na fonte ficam de fora; menos de 48 horas no grupo = amostra pequena",
      regimes: {
        estacao: SEASONS.map((s) => ({ key: s.key, label: s.label })),
        reservatorio: bands(),
        faixa_pld: PLD_BANDS.map((b) => ({ key: b.key, label: b.label })),
      },
      regimeNotes: [
        "estação pela data do dia previsto",
        "reservatório pela EAR do próprio submercado no dia",
        `faixa pelo PLD realizado na hora; piso = até 1% acima de R$ ${br(PLD_LIMITS.min)}`,
      ],
    },
    bess: [
      "arbitragem: despacho ótimo dia a dia por programação linear exata (HiGHS) sobre o PLD horário real. O PLD sai na véspera, então o ótimo do dia é implementável; a política de 1 ciclo por dia fica como referência conservadora",
      "eficiência de ida e volta η aplicada como √η na carga e √η na descarga; estado de carga entre 0 e 100%, começando e terminando o dia vazio; limite de ciclos por dia",
      "degradação: perda de capacidade de d% ao ano, e a receita do ano t é a do ano 1 × (1 − d)^(t−1); o despacho não cobra desgaste por MWh",
      "custos: o LCOS informado define o CAPEX implícito; OPEX fixo em % do CAPEX; VPL, TIR, payback e LCOS de equilíbrio saem do fluxo de caixa",
      "receita de capacidade (ex.: LRCAP) só entra se for informada (padrão 0), em R$/kW·ano, e aparece em linha separada da arbitragem: é premissa regulatória, não receita firme",
    ],
    limits: PLD_LIMITS,
  };
}

export type Methodology = ReturnType<typeof methodology>;
