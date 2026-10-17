import { AUDIT_THRESHOLDS, CHECK_WEIGHTS } from "./audit/checks";
import { GRID_CHECKS, PLAN_CHECKS } from "./audit/models";
import { HISTORY_DAYS } from "./grid/snapshot";
import { DEFAULT_THRESHOLDS } from "./audit/market-alerts";
import { TRUST_RULES, TRUST_SOURCES } from "./audit/trust";
import { MAX_GAP_DAYS, MAX_GAP_HOURS, PLD_LIMITS } from "./market/brazil";
import { FLOOR_SNAP, LEAR_WEIGHT } from "./market/forecast";
import { EAR_BANDS, FLOOR_RECENT, PLD_BANDS, SEASONS } from "./market/regime-backtest";
import { DECOUPLE_BRL, IDENTITY_TOL_MW } from "./market/interchange";
import { CCEE_VALIDATION, THERMAL_CHECKS } from "./market/thermal";
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

const br = (x: number) => x.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const pct = (x: number) => `${br(Math.round(x * 1000) / 10)}%`;
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
      `se a CCEE não responde: Plataforma de Integração (se configurada) → dias oficiais já gravados pelo coletor → CMO do DESSEM limitado ao piso de R$ ${br(PLD_LIMITS.min)} e ao teto horário de R$ ${br(PLD_LIMITS.maxHourly)} → último dado bom persistido`,
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
  ons_intercambio: {
    files: [`${S3}/intercambio_nacional_ho/INTERCAMBIO_NACIONAL_AAAA.parquet`],
    grain: "hora × interligação (N–NE, N–SE, NE–SE, S–SE)",
    time: "din_instante no relógio de Brasília gravado como UTC (mesma correção do balanço)",
    fields: [
      { col: "id_subsistema_origem · id_subsistema_destino", as: "par", unit: "N · NE · SE · S", note: "o sentido do arquivo é o sentido em que a energia passou na hora" },
      { col: "val_intercambiomwmed", as: "real", unit: "MWmed", note: "sempre ≥ 0 no arquivo; o app dá o sinal pelo sentido" },
      { col: "val_intercambioprogmwmed", as: "prog", unit: "MWmed", note: "no mesmo sentido do medido; negativo quando o programa era o contrário" },
    ],
    steps: [
      "cada par tem um sentido de referência fixo (N→NE, N→SE, NE→SE, S→SE): positivo = energia nesse sentido",
      `conferência com o balanço: a exportação de N, NE e SE somando as interligações é o intercâmbio do balanço (diferença até ${IDENTITY_TOL_MW} MW); no Sul a diferença é o intercâmbio com Argentina e Uruguai`,
      `par descolado = PLD do destino − PLD da origem acima de R$ ${DECOUPLE_BRL} na mesma hora`,
    ],
    version: "arquivo anual relido a cada 3 h",
  },
  ons_termica: {
    files: [`${S3}/geracao_termica_despacho_2_ho/GERACAO_TERMICA_DESPACHO-2_AAAA_MM.parquet`, `${S3}/cvu_usitermica_se/CVU_USINA_TERMICA_AAAA.parquet`],
    grain: "hora × usina térmica; CVU por semana operativa (sábado a sexta) e revisão do PMO",
    time: "din_instante no relógio de Brasília gravado como UTC; semana operativa pelas datas de início e fim",
    fields: [
      { col: "val_verifgeracao", as: "gen", unit: "MWmed", note: "geração verificada total da usina" },
      { col: "val_verifordemmerito · val_verifinflexpura", as: "mérito · inflexibilidade", unit: "MWmed", note: "a inflexibilidade embutida no mérito fica no mérito" },
      { col: "val_verifunitcommitment · val_verifrazaoeletrica · val_verifgarantiaenergetica", as: "uc · elétrica · segurança", unit: "MWmed", note: "fora da ordem de mérito com direito a ESS" },
      { col: "val_verifgfom · val_verifgsub · val_verifexportacao · val_verifreposicaoperdas · val_verifreservapotencia", as: "demais motivos", unit: "MWmed" },
      { col: "val_verifconstrainedoff", as: "off", unit: "MWmed", note: "corte de usina despachada por mérito" },
      { col: "val_progdisponibilidade", as: "avail", unit: "MWmed", note: "disponibilidade declarada na programação" },
      { col: "cod_usinaplanejamento · val_cvu", as: "código · CVU", unit: "R$/MWh", note: "liga a usina ao CVU da semana" },
    ],
    steps: [
      `os motivos somados têm de dar a geração da usina: dia com diferença acima de ${THERMAL_CHECKS.identityTol * 100}% é sinalizado`,
      "CVU da semana operativa que contém o dia (revisão mais recente do PMO)",
      "ESS = max(0, CVU − PLD) × geração fora da ordem de mérito (unit commitment, restrição elétrica, segurança energética) + max(0, PLD − CVU) × constrained-off, hora a hora, só para CVU > 0",
    ],
    version: "arquivo mensal relido a cada 3 h; o CVU muda a cada revisão semanal do PMO",
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

/**
 * Política de dados faltantes e de invalidação de séries: o que acontece com cada lacuna, valor
 * inválido, revisão e falha de fonte. Cada número sai da constante que o código aplica.
 */
export function dataPolicy() {
  const c = T.completeness;
  return {
    missing: [
      `Hora faltando no PLD ou no CMO: o dia entra na série com até ${MAX_GAP_HOURS} horas faltando, completadas pela média da hora anterior e da seguinte; com ${MAX_GAP_HOURS + 1} ou mais, o dia conta como ausente (regra abaixo).`,
      `Dia inteiro faltando: até ${MAX_GAP_DAYS} dias seguidos são interpolados hora a hora entre os dias vizinhos e marcados como imputados. Dia imputado fica fora de toda métrica (backtest, erro contra o ingênuo, cobertura das bandas) e aparece como aviso na previsão.`,
      `Lacuna maior que ${MAX_GAP_DAYS} dias quebra a série: nada é inventado, o modelo usa o trecho contínuo mais recente.`,
      "Dia só fecha completo: PLD oficial é gravado só com as 24 horas dos 4 submercados; corte de eólica e solar só com as 48 meias horas; o modelo da rede só roda com a geração por usina e o balanço nas 24 horas.",
      `Completude por fonte (auditor): pontos recebidos ÷ esperados na janela ≥ ${pct(c.passRatio)} aprova, ≥ ${pct(c.warnRatio)} fica em atenção, abaixo reprova.`,
      `Selo de confiança: dia incompleto rebaixa para "média"; metade ou mais dos últimos ${TRUST_RULES.windowDays} dias incompletos, para "baixa".`,
    ],
    invalidation: [
      "Registro sem submercado, sem data válida ou sem valor numérico é descartado e contado como inválido; o mesmo submercado e hora repetido é contado como duplicado.",
      `Mais de ${pct(c.passInvalid)} de inválidos tira a fonte de "aprovada"; mais de ${pct(c.warnInvalid)}, reprova a completude.`,
      `Valor fora da faixa plausível da fonte (tabela de faixas acima) conta na Validade: até ${pct(T.validity.warnOutside)} fora fica em atenção, acima disso reprova.`,
      "Coluna essencial ausente derruba a coleta (fonte fora do ar); coluna secundária ausente fica em atenção no Schema.",
      `Observação mais recente acima do SLA da fonte fica "atrasada"; acima de ${T.freshness.warnSlaFactor}× o SLA, reprova o Frescor.`,
      "A flag de dado inválido do corte do ONS não é usada: ela não é atualizada depois que o agente contesta o corte.",
      `Hora em que o balanço do ONS não fecha (geração − intercâmbio ≠ carga em mais de ${pct(RENEWABLE_CHECKS.identityTol)}) é apontada; a apurada do corte que não reproduz referência − geração (erro médio ≥ ${br(RENEWABLE_CHECKS.methodMaeMax)} MW) sinaliza mudança de método.`,
      "Relatório do modelo da rede fora do esquema fechado é recusado na entrada (campo desconhecido é descartado, valor fora de faixa reprova); um retrato guardado em formato antigo é ignorado.",
    ],
    revisions: [
      `Cada dia fechado vira uma impressão digital (valores arredondados a ${TRUST_RULES.decimals} casas, SHA-1). O mesmo dia com impressão diferente e não menos completo é uma revisão: registra pontos alterados, maior diferença e o valor anterior.`,
      `Revisão de ${pct(TRUST_RULES.bigRevision)} ou mais em algum ponto, ou ${TRUST_RULES.manyRevisions} revisões em 30 dias, rebaixa o selo para "baixa".`,
      "Histórico mensal do corte: arquivo do ONS republicado (Last-Modified novo) é relido e o total anterior do mês fica guardado como revisão.",
      `O modelo da rede guarda o resumo dos últimos ${HISTORY_DAYS} dias; reprocessar o mesmo dia substitui o resumo dele.`,
    ],
    fallbacks: [
      "PLD: CCEE (dados abertos) → PLD oficial gravado pelo coletor ou pela Plataforma de Integração → CMO do ONS limitado ao piso e ao teto da ANEEL, sempre marcado como estimado. Os dois nunca se misturam sem aviso na tela.",
      "Coleta que falha reaproveita o último valor bom em memória por até 6 horas; a idade do dado continua visível em cada painel.",
      "Dado simulado só existe no modo de demonstração ou como último recurso sinalizado; o smoke test diário reprova se qualquer rota da produção responder com dado simulado.",
    ],
  };
}

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
      published: `previsão publicada = ${Math.round(LEAR_WEIGHT * 100)}% LEAR + ${Math.round((1 - LEAR_WEIGHT) * 100)}% ingênuo, com ajuste ao piso: se a hora ficou no piso em pelo menos ${FLOOR_SNAP.minDays} dos últimos ${FLOOR_SNAP.window} dias e a previsão está a menos de R$ ${FLOOR_SNAP.within} do piso, publica o piso. D+1 vem da programação do DESSEM (CMO limitado), o modelo começa em D+2`,
      naive: "ingênuo de Lago et al. (2021): segunda, sábado e domingo repetem o mesmo dia da semana anterior; os demais repetem ontem",
      walkForward: "cada dia é previsto só com o histórico anterior; LEAR re-estimado todo dia na janela de 90 dias; previsão limitada ao piso e ao teto horário e média diária ao teto estrutural",
      metric: "rMAE = MAE do modelo / MAE do ingênuo, hora a hora; abaixo de 1 o modelo ganha. Dias ausentes na fonte ficam de fora; menos de 48 horas no grupo = amostra pequena",
      regimes: {
        estacao: SEASONS.map((s) => ({ key: s.key, label: s.label })),
        reservatorio: bands(),
        piso_recente: FLOOR_RECENT.map((b) => ({ key: b.key, label: b.label })),
        faixa_pld: PLD_BANDS.map((b) => ({ key: b.key, label: b.label })),
      },
      regimeNotes: [
        "estação pela data do dia previsto",
        "reservatório pela EAR do próprio submercado no dia",
        `piso recente pelos 7 dias anteriores ao previsto (conhecido antes de prever)`,
        `faixa pelo PLD realizado na hora; piso = até 1% acima de R$ ${br(PLD_LIMITS.min)}. Por ser separada pelo resultado, a faixa mostra onde o erro mora mas não julga o modelo (dilema do previsor, Lerch et al., 2017)`,
      ],
    },
    bess: [
      "arbitragem: despacho ótimo dia a dia por programação linear exata (HiGHS) sobre o PLD horário real. O PLD sai na véspera, então o ótimo do dia é implementável; a política de 1 ciclo por dia fica como referência conservadora",
      "eficiência de ida e volta η aplicada como √η na carga e √η na descarga; estado de carga entre 0 e 100%, começando e terminando o dia vazio; limite de ciclos por dia",
      "degradação: perda de capacidade de d% ao ano, e a receita do ano t é a do ano 1 × (1 − d)^(t−1); o despacho não cobra desgaste por MWh",
      "custos: o LCOS informado define o CAPEX implícito; OPEX fixo em % do CAPEX; VPL, TIR, payback e LCOS de equilíbrio saem do fluxo de caixa",
      "receita de capacidade (ex.: LRCAP) só entra se for informada (padrão 0), em R$/kW·ano, e aparece em linha separada da arbitragem: é premissa regulatória, não receita firme",
    ],
    dataPolicy: dataPolicy(),
    thermal: {
      checks: THERMAL_CHECKS,
      rules: [
        "O ONS classifica cada hora de cada térmica por motivo: ordem de mérito (CVU abaixo do CMO), inflexibilidade declarada, unit commitment (rampa e tempo mínimo do DESSEM), razão elétrica, segurança energética (decisão do CMSE), GFOM, substituição, exportação, reposição de perdas e reserva de potência. Somados, dão a geração da usina.",
        "ESS de restrição de operação e de segurança energética: max(0, CVU − PLD) × geração por unit commitment, razão elétrica ou segurança energética, hora a hora no submercado da usina.",
        "ESS de constrained-off: max(0, PLD − CVU) × corte verificado da usina despachada por mérito.",
        "Só térmicas com CVU não nulo; CVU do PMO da semana operativa (revisão mais recente). Rateio entre consumidores na proporção do consumo: a tela mostra o ESS dividido pela carga do SIN nos mesmos dias.",
        "Fora da conta: geração por mérito com CVU acima do PLD (usinas com CCEAR por disponibilidade são cobertas pela receita do contrato), deslocamento hidráulico, serviços ancilares e importação — não aparecem nos arquivos do ONS usados.",
        "Pilha de mérito: usinas do submercado ordenadas por CVU com a disponibilidade declarada na programação, na hora de maior geração térmica do último dia, contra o CMO da hora; a térmica marginal é a mais cara gerando por mérito com CVU até o CMO da hora (o ONS classifica o mérito na programação, e ≈ 20% da geração que ele chama de mérito tem CVU acima do CMO horário publicado).",
      ],
      validation: CCEE_VALIDATION.map((v) => ({
        bulletin: v.bulletin,
        url: v.url,
        week: `${v.week.from.split("-").reverse().join("/")} a ${v.week.to.split("-").reverse().join("/")}`,
        uc: { model: v.model.uc, ccee: v.ccee.uc },
        off: { model: v.model.off, ccee: v.ccee.off },
        cceeTotal: v.ccee.total,
      })),
    },
    grid: {
      checks: GRID_CHECKS,
      steps: [
        "rede: cadastros do ONS de linhas (resistência, reatância e susceptância em % na base de 100 MVA; capacidade de longa e de curta duração), subestações (barra, tensão, coordenadas) e transformadores em operação no dia; fica a maior ilha conectada",
        "geração: cada usina da geração horária do ONS vai para a barra pelo código do equipamento, pelo conjunto, pelo ponto de conexão ou pelo nome; pequenas usinas e as sem barra abatem a carga do próprio estado",
        "carga: a de cada subsistema (balanço horário do ONS, que já inclui as perdas) rateada pela potência dos transformadores que descem para 34,5–138 kV; as perdas calculadas pelo modelo são descontadas em duas passadas",
        "elos de corrente contínua (Belo Monte, Madeira, Itaipu 50 Hz em Ibiúna, Garabi) pelos fluxos programados do ONS, como injeções nas barras de corrente alternada",
        "fluxo de potência AC das 24 horas em lote no p3s (C++/KLU, Fraunhofer IEE); a hora de maior carga é refeita no pandapower e cada linha tem que bater em menos de 1 MW",
        "N-1: saída de cada linha de 440 kV ou mais e de cada interligação entre subsistemas na hora de maior carga, conferida contra a capacidade de curta duração",
        "validação: intercâmbio calculado nas linhas da fronteira (mais o elo de Belo Monte no Norte–Sudeste) contra o intercâmbio medido pelo ONS; até 15% do fluxo médio é bom, até 30% atenção",
        "agenda: GitHub Actions às 16:47 e 23:47 UTC sobre o último dia com as 24 horas no balanço; o relatório entra por /api/rede/ingest só com o segredo do servidor e passa por um esquema fechado",
      ],
      audit: [
        `retrato com até ${GRID_CHECKS.ageDays.pass} dias do dia modelado; ${GRID_CHECKS.ageDays.warn} dias é atenção, mais que isso reprova`,
        "fluxo AC fecha nas 24 horas (22 ou 23 é atenção) e bate com o pandapower em menos de 1 MW",
        `injeção extra da barra de referência até ${pct(GRID_CHECKS.slackShare.pass)} da carga média (até ${pct(GRID_CHECKS.slackShare.warn)} atenção)`,
        `pelo menos ${pct(GRID_CHECKS.coverage.pass)} da geração das usinas despachadas com barra (${pct(GRID_CHECKS.coverage.warn)} atenção)`,
        `contingências N-1 resolvidas em ${pct(GRID_CHECKS.n1Converged.pass)} dos casos ou mais (${pct(GRID_CHECKS.n1Converged.warn)} atenção)`,
        `tensões entre 0,90 e 1,10 pu em ${pct(GRID_CHECKS.voltageInBand.pass)} das barras: só plausibilidade, o ONS não publica tensões medidas`,
        "intercâmbio de cada interligação: bom aprova, atenção fica em atenção, ruim reprova",
      ],
      limits: [
        "transformadores com reatância presumida (12% na própria base): o cadastro do ONS não publica a impedância",
        "compensação série das linhas não está no cadastro: o corredor Norte–Sudeste sai mais pesado que o real e é o menos confiável",
        "reatores e capacitores manobráveis fora do modelo; tensões servem só como plausibilidade",
      ],
    },
    planning: {
      checks: PLAN_CHECKS,
      steps: [
        "solver: NovoModelo, o SDDP aberto de ONS, CCEE e EPE (programação dinâmica dual estocástica), sem modificação; o caso é montado e rodado todo dia no GitHub Actions",
        "cada subsistema é um reservatório equivalente (como os REEs do NEWAVE): a ENA faz o papel da vazão com produtividade 1 MW/(m³/s), então 1 MWmês = 2,6298 hm³",
        "só a ENA armazenável é água utilizável: o ONS a define como a ENA bruta menos o vertimento não turbinável das usinas a fio d'água, e a diferença acompanha esse vertimento medido usina a usina (correlação mensal de 0,95 a 0,997). Dentro dela, os REEs com EAR máxima abaixo de um mês da afluência média (Belo Monte, Itaipu, Madeira e Teles Pires) viram uma usina fio d'água — turbinável, sem estoque — e o resto entra no reservatório; as duas dividem a disponibilidade hidráulica medida usina a usina (média de 28 dias). A soma das ENAs por REE é conferida contra a do subsistema a cada rodada",
        "aproveitamento: k = (geração + energia vertida turbinável + variação da EAR) ÷ ENA armazenável nos últimos 24 meses, usina a usina; multiplica a ENA e faz o papel das perdas, da evaporação e das retiradas que o deck oficial traz (perto de 0,95 no SE, 1,0 no N e no S, 0,79 no NE)",
        "afluências: histórico diário de ENA desde 2000 reconstruído na configuração de usinas de hoje — a ENA publicada usa as usinas de cada época (a MLT do N dobrou com Belo Monte, a do SE subiu 55% com Madeira e Teles Pires), então cada dia entra pela % da MLT do dia × a MLT atual do mesmo mês —, agregado em janelas mensais alinhadas ao dia de início; o NovoModelo estima o PAR(p)-A com a maior ordem que aceita como estacionária em todas as estações (até 6) e, se nenhuma passar, o PAR(p) clássico; a correlação espacial dos resíduos é estimada junto",
        "estágios: 60 mensais que começam no dia seguinte ao último dado (estações de um mês ancoradas nesse dia, sem estágio parcial), três patamares por posto da carga líquida do SIN (15% pesada, 50% média, 35% leve), CVaR nos estágios e desconto anual",
        "envelope operativo: teto de armazenamento por mês do ano = maior EAR já operada naquele mês desde 2000 (+1 p.p.), acima do qual o modelo verte; piso = menor EAR já operada naquele mês, flexível, com penalidade igual ao CVU mais caro da frota (o modelo despacha toda térmica antes de violar, como no despacho por segurança energética, sem chegar ao déficit)",
        "térmicas usina a usina dos últimos 28 dias do despacho do ONS: limite = disponibilidade programada média, mínimo = inflexibilidade média, custo = CVU da semana do PMO em vigor",
        "defluência mínima: nos subsistemas sem fio d'água (S e NE), o reservatório equivalente não turbina + verte menos que o quantil de 1% da geração hidráulica diária do último ano (no NE, ~2,5 GW: a defluência mínima de Sobradinho e Xingó); abaixo disso só com penalidade de R$ 500/MWh, como nas flexibilizações da ANA em seca",
        "carga e renováveis: média dos últimos 12 meses do balanço do ONS × índice sazonal médio de 3 anos × crescimento dos últimos 12 meses (renováveis com o ritmo caindo à metade a cada ano); o mês do ano anterior sozinho carregava o clima daquele ano. Pequenas usinas fora da ENA e térmicas fora do despacho abatem a carga; eólica e solar como fontes não controláveis com corte e incerteza pela dispersão ano a ano",
        "interligações: limite em cada sentido = quantil 99,5% do fluxo medido no último ano, mais limites conjuntos de recebimento e exportação de cada subsistema pelo intercâmbio líquido medido",
        "aversão a risco implícita: o caso aberto é mais folgado que o deck oficial (sem volumes mínimos operativos, restrições usina a usina nem a previsão de vazões do DECOMP) e, no λ padrão, dava CMO de R$ 18 em jun/2025 com o DESSEM a R$ 212; cada rodada roda o SDDP com o λ padrão e depois busca (secante protegida num índice em que a curva é quase reta, com passo limitado, até 8 rodadas, partindo do ponto da rodada anterior) a aversão a risco com que o CMO do 1º estágio — mediana dos cenários, SE — reproduz o CMO médio do DESSEM nos 14 dias anteriores: primeiro o λ do CVaR até 0,99; se ele satura sem chegar ao alvo (dez/2025: CMO ≈ 0 com λ 0,99), o piso operativo do SE sobe até 40 p.p., o análogo do volume mínimo operativo dos modelos oficiais; o caso publicado é o calibrado e o puro aparece ao lado",
        "PLD: CMO de cada patamar entre o piso e o teto horário da ANEEL do ano e média do estágio limitada ao teto estrutural, cenário a cenário; meses civis pela média dos estágios ponderada pelos dias. O PLD com ponta (a manchete) soma ao CMO de cada cenário os desvios horários do CMO do DESSEM dos 30 dias anteriores antes do piso e do teto",
        "faixa do SDDP: a mais larga entre a P10–P90 dos cenários e a mediana mais os quantis 10% e 90% do erro da retroanálise no mesmo horizonte (conformal, interpolado entre horizontes)",
        "PLD publicado: a combinação, horizonte a horizonte, do P50 do SDDP calibrado com o CMO do DESSEM das 2 semanas anteriores (com a ponta) congelado; o peso do SDDP é o que minimiza o erro da retroanálise nos 4 submercados juntos, sem crescer com o horizonte — em 2025–26 ele só ajuda no mês seguinte, e depois a âncora erra menos que a trajetória do SDDP —, e a faixa P10–P90 vem dos quantis do erro dessa combinação no mesmo horizonte; pesos, erro e cobertura são medidos deixando cada mês de fora da calibração",
        "sensibilidades (um SDDP completo cada, no λ implícito): sem aversão a risco, hidrologia 15% mais seca e carga 5% maior",
        "retroanálise: o caso montado no dia 1º de cada mês passado só com o que estava publicado na véspera, com a mesma calibração do λ; o PLD previsto para os 6 meses seguintes é comparado com o realizado, com o SDDP sem calibração, com a persistência, com o CMO do DESSEM de 14 dias e com o CMO semanal do DECOMP",
      ],
      params: [
        "custo de déficit de patamar único R$ 7.643,82/MWh (valor usado pela CPAMP)",
        "CVaR α = 15% (recomendação da CPAMP); λ = 40% no SDDP puro e o implícito no caso publicado",
        "taxa de desconto de 12% ao ano (a dos decks do PMO)",
        "limites do PLD por ano civil (ANEEL); anos sem tabela usam os do último ano publicado",
      ],
      audit: [
        `rodada com até ${PLAN_CHECKS.ageDays.pass} dias (até ${PLAN_CHECKS.ageDays.warn} atenção)`,
        `limite inferior do SDDP variando até ${pct(PLAN_CHECKS.lbStability.pass)} nas últimas 10 iterações (até ${pct(PLAN_CHECKS.lbStability.warn)} atenção): com CVaR o gap clássico não se aplica`,
        `fator de aproveitamento da ENA armazenável entre ${br(PLAN_CHECKS.kRange[0])} e ${br(PLAN_CHECKS.kRange[1])} em todos os subsistemas`,
        "calibração: CMO do 1º estágio a menos de max(R$ 8, 8%) do CMO do DESSEM de 14 dias; fora da tolerância ou num extremo do caminho (λ 0, ou λ 0,99 com o piso do SE +40 p.p.) é atenção",
        "retroanálise: erro do PLD mensal publicado (a combinação, com pesos calibrados sem o mês avaliado) menor ou igual ao da persistência (até 25% pior é atenção)",
        `PLD realizado dentro da faixa publicada entre ${pct(PLAN_CHECKS.coverage.lo)} e ${pct(PLAN_CHECKS.coverage.hi)} dos meses (nominal 80%), cada mês medido pela calibração dos demais`,
      ],
      data: [
        `${S3}/ena_subsistema_di/ENA_DIARIO_SUBSISTEMA_AAAA.csv|parquet (desde 2000)`,
        `${S3}/ena_ree_di/ENA_DIARIO_REE_AAAA.csv|parquet e ear_ree_di (desde 2018)`,
        `${S3}/ear_subsistema_di/EAR_DIARIO_SUBSISTEMA_AAAA.parquet (desde 2000)`,
        `${S3}/energia_vertida_turbinavel_ho/ENERGIA_VERTIDA_TURBINAVEL_AAAA_MM.parquet`,
        `${S3}/balanco_energia_subsistema_ho/BALANCO_ENERGIA_SUBSISTEMA_AAAA.parquet`,
        `${S3}/geracao_termica_despacho_2_ho/GERACAO_TERMICA_DESPACHO-2_AAAA_MM.parquet e cvu_usitermica_se`,
        `${S3}/intercambio_nacional_ho/INTERCAMBIO_NACIONAL_AAAA.parquet`,
        `${S3}/cmo_tm (CMO semi-horário do DESSEM: ponta, calibração do λ e PLD realizado) e cmo_se (CMO semanal do DECOMP, na retroanálise)`,
      ],
      limits: [
        "subsistemas agregados: sem cascatas usina a usina nem produtividade variável com a queda",
        "manutenção programada futura das térmicas e expansão contratada (leilões) não entram; a frota é a dos últimos 28 dias",
        "restrições elétricas internas aos submercados ficam de fora; as interligações usam o que já foi medido, não o limite operativo publicado",
      ],
    },
    limits: PLD_LIMITS,
  };
}

export type Methodology = ReturnType<typeof methodology>;
