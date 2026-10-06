/**
 * Fixture realista e internamente consistente de `PlantAnalysis` (padrão: UFV Janaúba I).
 *
 * Os números são derivados de um modelo compacto e determinístico (sem rede, sem aleatoriedade
 * não semeada): clima mensal → POA → geração com perdas → fluxo de caixa de 25 anos → TIR/VPL,
 * Monte Carlo semeado, sensibilidade e benchmarks. Serve para testes do relatório PDF e para o
 * desenvolvimento da interface. `dataHash = sha256(canonicalAnalysisJson(analysis))`.
 */
import { createHash } from "node:crypto";
import { plants, getPlant } from "@/data/plants";
import { computeBenchmarks } from "@/lib/finance/benchmarks";
import { canonicalAnalysisJson } from "@/lib/report/canonical";
import type {
  Benchmark,
  CashFlowYear,
  LiveConditions,
  LocationInfo,
  LossWaterfallItem,
  MarketRates,
  MonthlyGeneration,
  OnChainState,
  Plant,
  PlantAnalysis,
  Provenance,
  SensitivityRow,
} from "@/lib/types";

export const FIXTURE_GENERATED_AT = "2026-10-04T13:15:00.000Z";
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// ─── utilidades determinísticas ─────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r0 = (v: number) => Math.round(v);

function npv(rate: number, flows: number[]): number {
  return flows.reduce((s, f, t) => s + f / Math.pow(1 + rate, t), 0);
}

function irr(flows: number[]): number {
  let lo = -0.9;
  let hi = 1.5;
  if (npv(lo, flows) * npv(hi, flows) > 0) return NaN;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (npv(mid, flows) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function payback(cumulative: number[]): number | null {
  for (let t = 1; t < cumulative.length; t++) {
    if (cumulative[t] >= 0 && cumulative[t - 1] < 0) {
      return t - 1 + -cumulative[t - 1] / (cumulative[t] - cumulative[t - 1]);
    }
  }
  return null;
}

// ─── dados por usina que não estão no catálogo ──────────────────────────────────────────────

const LOCATION_META: Record<string, Omit<LocationInfo, "municipio" | "uf" | "ibgeCode" | "provenance">> = {
  "ufv-janauba-1": {
    ufNome: "Minas Gerais",
    regiaoImediata: "Janaúba",
    regiaoIntermediaria: "Montes Claros",
    regiao: "Sudeste",
    populacao: 70699,
    populacaoAno: 2022,
    pibPerCapitaBRL: 21847.62,
    pibAno: 2021,
    elevationM: 533,
  },
  "ufv-petrolina-1": {
    ufNome: "Pernambuco",
    regiaoImediata: "Petrolina",
    regiaoIntermediaria: "Petrolina",
    regiao: "Nordeste",
    populacao: 386791,
    populacaoAno: 2022,
    pibPerCapitaBRL: 26402.1,
    pibAno: 2021,
    elevationM: 376,
  },
  "ufv-bom-jesus-da-lapa-1": {
    ufNome: "Bahia",
    regiaoImediata: "Bom Jesus da Lapa",
    regiaoIntermediaria: "Guanambi",
    regiao: "Nordeste",
    populacao: 65550,
    populacaoAno: 2022,
    pibPerCapitaBRL: 15912.4,
    pibAno: 2021,
    elevationM: 436,
  },
};

/** Fator de emissão médio do SIN (tCO₂/MWh), ordem de grandeza MCTI */
const SIN_EMISSION_FACTOR = 0.0385;
/** Demanda contratada de geração (TUSDg), R$/kW·mês — hipótese da fixture */
const TUSDG_BRL_PER_KW_MONTH = 9.5;

// ─── modelo financeiro compacto ─────────────────────────────────────────────────────────────

interface ModelParams {
  energyFactor: number;
  tariffFactor: number;
  capexFactor: number;
  omFactor: number;
  revenueLossPct: number;
  ipcaPct: number;
  tariffRealGrowthPct: number;
  clientDiscountPct: number;
}

function fioBChargedPct(plant: Plant, calendarYear: number): number {
  const f = plant.finance;
  if (f.revenueModel === "ppa") return 0;
  if (f.accessRequestYear < 2023) return calendarYear >= 2046 ? 100 : 0;
  const schedule: Record<number, number> = { 2023: 15, 2024: 30, 2025: 45, 2026: 60, 2027: 75, 2028: 90 };
  if (calendarYear < 2023) return 0;
  return schedule[calendarYear] ?? 100;
}

function runModel(plant: Plant, yearlyMWh: number[], p: ModelParams) {
  const f = plant.finance;
  const t = plant.token;
  const investment = t.totalCotas * t.cotaPriceBRL * p.capexFactor;
  const capex = investment * (1 - t.structuringFeePct / 100);
  const ipca = p.ipcaPct / 100;
  const g = p.tariffRealGrowthPct / 100;
  const flows: CashFlowYear[] = [
    {
      year: 0,
      calendarYear: f.startYear - 1,
      energyMWh: 0,
      priceBRLPerKWh: 0,
      fioBChargedPct: 0,
      revenueBRL: 0,
      taxesBRL: 0,
      opexBRL: 0,
      capexBRL: investment,
      netCashFlowBRL: -investment,
      cumulativeBRL: -investment,
      discountedCashFlowBRL: -investment,
    },
  ];
  let opexPv = 0;
  for (let y = 1; y <= f.horizonYears; y++) {
    const cal = f.startYear + y - 1;
    const infl = Math.pow(1 + ipca, y - 1);
    const tariffIdx = infl * Math.pow(1 + g, y - 1);
    const fioB = fioBChargedPct(plant, cal);
    const credit = f.tariffBRLPerKWh * p.tariffFactor * tariffIdx - f.fioBBRLPerKWh * tariffIdx * (fioB / 100);
    const price = credit * (1 - p.clientDiscountPct / 100) * (1 - p.revenueLossPct / 100);
    const energy = yearlyMWh[y - 1] * p.energyFactor;
    const revenue = energy * 1000 * price;
    const taxes = revenue * (f.taxPctRevenue / 100);
    const fixed =
      (f.omBRLPerKWpYear * plant.tech.dcKWp * p.omFactor +
        (f.insurancePctCapex / 100) * capex +
        f.landLeaseBRLYear +
        TUSDG_BRL_PER_KW_MONTH * 12 * plant.tech.acKW) *
      infl;
    const opex = fixed + (f.adminFeePctRevenue / 100) * revenue;
    const capexY = y === f.inverterReplacementYear ? f.inverterReplacementBRLPerKW * plant.tech.acKW * infl : 0;
    const net = revenue - taxes - opex - capexY;
    const prev = flows[y - 1];
    flows.push({
      year: y,
      calendarYear: cal,
      energyMWh: r1(energy),
      priceBRLPerKWh: r3(price),
      fioBChargedPct: fioB,
      revenueBRL: r0(revenue),
      taxesBRL: r0(taxes),
      opexBRL: r0(opex),
      capexBRL: r0(capexY),
      netCashFlowBRL: r0(net),
      cumulativeBRL: r0(prev.cumulativeBRL + net),
      discountedCashFlowBRL: 0,
    });
    opexPv += opex + capexY;
  }
  return { flows, investment, capex, opexPvUndiscounted: opexPv };
}

// ─── construtor ─────────────────────────────────────────────────────────────────────────────

export function buildAnalysisFixture(slugOrPlant: string | Plant = "ufv-janauba-1"): PlantAnalysis {
  const plant = typeof slugOrPlant === "string" ? getPlant(slugOrPlant) : slugOrPlant;
  if (!plant) throw new Error(`usina desconhecida: ${String(slugOrPlant)}`);
  const { tech, finance: fin, location: loc } = plant;
  const fc = plant.fallbackClimate;
  const at = FIXTURE_GENERATED_AT;
  const lat = loc.lat.toFixed(4);
  const lon = loc.lon.toFixed(4);

  // ── procedência ──
  const prov = (id: string, name: string, url: string, status: Provenance["status"], minutesAgo: number, note?: string): Provenance => ({
    id,
    name,
    url,
    status,
    fetchedAt: new Date(Date.parse(at) - minutesAgo * 60_000).toISOString(),
    ...(note ? { note } : {}),
  });
  const pNasa = prov(
    "nasa-power-climatology",
    "NASA POWER — climatologia mensal 2001–2020",
    `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DIFF,T2M,T2M_MAX,T2M_MIN,WS2M&community=RE&longitude=${lon}&latitude=${lat}&format=JSON`,
    "live",
    1,
  );
  const pNasaAnnual = prov(
    "nasa-power-annual",
    "NASA POWER — série anual de irradiação 2001–2024",
    `https://power.larc.nasa.gov/api/temporal/annual/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=${lon}&latitude=${lat}&start=2001&end=2024&format=JSON`,
    "cache",
    180,
    "Resposta em cache (TTL 24 h)",
  );
  const pPvgis = prov(
    "pvgis-pvcalc",
    "PVGIS 5.3 (JRC/Comissão Europeia) — PVcalc",
    `https://re.jrc.ec.europa.eu/api/v5_3/PVcalc?lat=${lat}&lon=${lon}&peakpower=1&loss=14&angle=${tech.tiltDeg}&aspect=180&outputformat=json`,
    "live",
    1,
  );
  const pIbge = prov(
    "ibge-localidades",
    "IBGE — API de Localidades",
    `https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${loc.ibgeCode}`,
    "live",
    1,
  );
  const pIbgePop = prov(
    "ibge-sidra-populacao",
    "IBGE SIDRA — Censo 2022, população residente (tabela 4709)",
    `https://apisidra.ibge.gov.br/values/t/4709/n6/${loc.ibgeCode}/v/93/p/last`,
    "cache",
    720,
  );
  const pIbgePib = prov(
    "ibge-sidra-pib",
    "IBGE SIDRA — PIB dos municípios (tabela 5938)",
    `https://apisidra.ibge.gov.br/values/t/5938/n6/${loc.ibgeCode}/v/37/p/last`,
    "fallback",
    1,
    "API indisponível; valor de referência embarcado (IBGE, PIB dos Municípios 2021)",
  );
  const pElev = prov("open-meteo-elevation", "Open-Meteo — Elevation API (Copernicus DEM 90 m)", `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`, "live", 1);
  const pSelic = prov("bcb-sgs-432", "Banco Central do Brasil — SGS 432 (meta Selic)", "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json", "live", 2);
  const pCdi = prov("bcb-sgs-4389", "Banco Central do Brasil — SGS 4389 (CDI anualizado)", "https://api.bcb.gov.br/dados/serie/bcdata.sgs.4389/dados/ultimos/1?formato=json", "live", 2);
  const pIpca = prov("bcb-sgs-13522", "Banco Central do Brasil — SGS 13522 (IPCA 12 meses)", "https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/dados/ultimos/1?formato=json", "live", 2);
  const pFocus = prov(
    "bcb-focus-ipca",
    "Banco Central do Brasil — Focus, expectativa de IPCA de longo prazo",
    "https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais?$top=20&$filter=Indicador%20eq%20'IPCA'&$format=json",
    "fallback",
    2,
    "Focus sem resposta; usado valor de referência de 3,5 % a.a.",
  );
  const pNtnb = prov(
    "tesouro-direto-ntnb",
    "Tesouro Direto — taxa do Tesouro IPCA+ 2045",
    "https://www.tesourotransparente.gov.br/ckan/dataset/taxas-dos-titulos-ofertados-pelo-tesouro-direto",
    "cache",
    240,
  );
  const pFx = prov("awesomeapi-usd-brl", "AwesomeAPI — cotação USD/BRL", "https://economia.awesomeapi.com.br/json/last/USD-BRL", "live", 2);
  const pCrypto = prov("coingecko-usdt-bnb", "CoinGecko — USDT/BRL e BNB/BRL", "https://api.coingecko.com/api/v3/simple/price?ids=tether,binancecoin&vs_currencies=brl", "live", 2);
  const pAneel = prov(
    "aneel-tarifas",
    "ANEEL Dados Abertos — tarifas homologadas das distribuidoras",
    "https://dadosabertos.aneel.gov.br/dataset/tarifas-distribuidoras-energia-eletrica",
    "error",
    2,
    "Tempo esgotado (8 s); usada a tarifa do catálogo da usina",
  );
  const pForecast = prov(
    "open-meteo-forecast",
    "Open-Meteo — previsão horária (GHI, GTI, nebulosidade)",
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=shortwave_radiation,global_tilted_irradiance,temperature_2m,cloud_cover&tilt=${tech.tiltDeg}&azimuth=180&timezone=America%2FSao_Paulo&forecast_days=7`,
    "live",
    0,
  );

  // ── recurso solar (NASA POWER "ao vivo": pequena perturbação determinística do fallback) ──
  const ghi = fc.ghiKWhM2Day.map((v, m) => r2(v * (1 + 0.018 * Math.sin(m * 1.7 + 0.4))));
  const temp = fc.tempC.map((v, m) => r1(v + 0.3 * Math.cos(m * 0.9)));
  const tempMax = (fc.tempMaxC ?? fc.tempC.map((v) => v + 6)).map((v, m) => r1(v + 0.2 * Math.cos(m)));
  const tempMin = (fc.tempMinC ?? fc.tempC.map((v) => v - 6)).map((v, m) => r1(v - 0.2 * Math.sin(m)));
  const wind = (fc.windMs ?? fc.tempC.map(() => 2.5)).map((v) => r1(v));
  const summer = (m: number) => 0.5 + 0.5 * Math.cos((2 * Math.PI * m) / 12); // 1 em jan, 0 em jul
  const dhi = ghi.map((v, m) => r2(v * (0.27 + 0.13 * summer(m))));
  const annualGhi = r1(ghi.reduce((s, v, m) => s + v * DAYS[m], 0));
  const cv = fc.interannualCvPct;
  const rand = mulberry32(plant.location.ibgeCode);
  const rawSeries = Array.from({ length: 24 }, () => normal(rand));
  const mean = rawSeries.reduce((s, v) => s + v, 0) / rawSeries.length;
  const sd = Math.sqrt(rawSeries.reduce((s, v) => s + (v - mean) ** 2, 0) / (rawSeries.length - 1));
  const annualSeries = rawSeries.map((z, i) => ({ year: 2001 + i, ghiKWhM2: r1(annualGhi * (1 + ((cv / 100) * (z - mean)) / sd)) }));

  // ── geração ──
  const tracker = tech.mounting === "single-axis";
  const poaFactor = (m: number) =>
    tracker ? 1.2 + 0.03 * Math.cos((2 * Math.PI * (m - 5.5)) / 12) : 1.035 + 0.085 * Math.cos((2 * Math.PI * (m - 5.5)) / 12);
  const poa = ghi.map((v, m) => v * DAYS[m] * poaFactor(m));
  const annualPoa = poa.reduce((s, v) => s + v, 0);
  const cellTemp = temp.map((t, m) => t + 4.6 * ghi[m] * (tech.module.noctC / 45));
  const tempFactor = cellTemp.map((tc) => 1 + (tech.module.gammaPmaxPctPerC / 100) * (tc - 25));
  const L = tech.losses;
  const bifacialGainPct = tech.module.bifacial ? (tracker ? 4 : 3) : 0;
  const steps: { label: string; pct: number }[] = [
    { label: "Ganho bifacial (face posterior)", pct: -bifacialGainPct },
    { label: "Temperatura de célula", pct: 0 }, // calculado abaixo
    { label: "Ângulo de incidência (IAM)", pct: 3.0 },
    { label: "Espectro e baixa irradiância", pct: 1.5 },
    { label: "Qualidade dos módulos e auxiliares", pct: 1.5 },
    { label: "Sujeira (soiling)", pct: L.soilingPct },
    { label: "Sombreamento", pct: L.shadingPct },
    { label: "Mismatch e tolerância de potência", pct: L.mismatchPct },
    { label: "Degradação inicial (LID/LeTID)", pct: tech.degradation.firstYearPct },
    { label: "Cabeamento CC", pct: L.dcWiringPct },
    { label: "Eficiência do inversor", pct: r1(100 - tech.inverter.euroEfficiencyPct) },
    { label: "Limitação CA (clipping)", pct: r1(Math.max(0, (tech.dcKWp / tech.acKW - 1.2) * 1.5)) },
    { label: "Cabeamento CA", pct: L.acWiringPct },
    { label: "Transformador", pct: L.transformerPct },
    { label: "Indisponibilidade", pct: L.unavailabilityPct },
  ];
  const tempLossPct = r1((1 - poa.reduce((s, v, m) => s + v * tempFactor[m], 0) / annualPoa) * 100);
  steps[1].pct = tempLossPct;
  const otherFactor = steps.filter((_, i) => i !== 1).reduce((s, st) => s * (1 - st.pct / 100), 1);
  const monthlyEnergy = poa.map((v, m) => (v * tech.dcKWp * tempFactor[m] * otherFactor) / 1000);
  const annualP50 = r1(monthlyEnergy.reduce((s, v) => s + v, 0));
  const nominal = (annualPoa * tech.dcKWp) / 1000;
  let running = nominal;
  const lossWaterfall: LossWaterfallItem[] = [{ label: "Energia nominal no plano (POA × Pstc)", pct: 0, energyMWhAfter: r1(nominal) }];
  steps.forEach((st, i) => {
    running = i === steps.length - 1 ? annualP50 : running * (1 - st.pct / 100);
    lossWaterfall.push({ label: st.label, pct: st.pct, energyMWhAfter: r1(running) });
  });
  const monthly: MonthlyGeneration[] = monthlyEnergy.map((e, m) => ({
    month: m,
    poaKWhM2: r1(poa[m]),
    energyMWh: r1(e),
    prPct: r1((e / ((poa[m] * tech.dcKWp) / 1000)) * 100),
    cellTempC: r1(cellTemp[m]),
  }));
  const unc = { interannualPct: cv, resourceDataPct: 4.0, modelPct: 3.0, degradationPct: 1.0, totalPct: 0 };
  unc.totalPct = r2(Math.sqrt(unc.interannualPct ** 2 + unc.resourceDataPct ** 2 + unc.modelPct ** 2 + unc.degradationPct ** 2));
  const tenYearPct = Math.sqrt((unc.interannualPct / Math.sqrt(10)) ** 2 + unc.resourceDataPct ** 2 + unc.modelPct ** 2 + unc.degradationPct ** 2);
  const pAt = (z: number, s: number) => r1(annualP50 * (1 - (z * s) / 100));
  const yearly = Array.from({ length: fin.horizonYears }, (_, i) => ({
    year: i + 1,
    energyMWh: r1(annualP50 * Math.pow(1 - tech.degradation.annualPct / 100, i)),
  }));
  const specificYield = r1((annualP50 * 1000) / tech.dcKWp);
  const pvgisMonthly = monthly.map((mg, m) => r1(((mg.energyMWh * 1000) / tech.dcKWp) * (0.982 + 0.01 * Math.sin(m * 2.1))));
  const pvgisAnnual = r1(pvgisMonthly.reduce((s, v) => s + v, 0));
  const pvgisMWh = r1((pvgisAnnual * tech.dcKWp) / 1000);

  const generation = {
    monthly,
    annualP50MWh: annualP50,
    p75MWh: pAt(0.6745, unc.totalPct),
    p90MWh: pAt(1.2816, unc.totalPct),
    p99MWh: pAt(2.3263, unc.totalPct),
    p90TenYearMWh: pAt(1.2816, tenYearPct),
    specificYieldKWhPerKWp: specificYield,
    performanceRatioPct: r1((annualP50 / nominal) * 100),
    capacityFactorPct: r1((annualP50 / ((tech.acKW * 8760) / 1000)) * 100),
    annualPoaKWhM2: r1(annualPoa),
    annualGhiKWhM2: annualGhi,
    uncertainty: unc,
    lossWaterfall,
    yearly,
    crossCheck: { source: "PVGIS 5.3 (PVGIS-SARAH3)", annualMWh: pvgisMWh, deviationPct: r1(((annualP50 - pvgisMWh) / pvgisMWh) * 100) },
    co2AvoidedTonsYear: r1(annualP50 * SIN_EMISSION_FACTOR),
    method: [
      "Irradiação global e difusa mensais da NASA POWER (climatologia 2001–2020), com validação cruzada contra o PVGIS 5.3 (JRC).",
      tracker
        ? `Transposição para o plano dos módulos com seguidor de um eixo N-S (rotação máx. ±${tech.trackerMaxAngleDeg ?? 55}°, backtracking), modelo isotrópico de Liu-Jordan e decomposição de Erbs; albedo ${String(tech.albedo).replace(".", ",")}.`
        : `Transposição para o plano inclinado (${tech.tiltDeg}°, azimute ${tech.azimuthDeg}° = Norte) pelo modelo isotrópico de Liu-Jordan com decomposição de Erbs; albedo ${String(tech.albedo).replace(".", ",")}.`,
      `Temperatura de célula pelo modelo NOCT (${tech.module.noctC} °C) ponderada pela irradiância; coeficiente de potência ${String(tech.module.gammaPmaxPctPerC).replace(".", ",")} %/°C.`,
      tech.module.bifacial ? `Ganho bifacial estimado em ${bifacialGainPct} % para albedo de solo natural.` : "Módulos monofaciais (sem ganho de face posterior).",
      `Perdas de sistema aplicadas multiplicativamente; eficiência europeia do inversor ${String(tech.inverter.euroEfficiencyPct).replace(".", ",")} %; relação CC/CA ${(tech.dcKWp / tech.acKW).toFixed(2).replace(".", ",")}.`,
      `P75/P90/P99 assumindo distribuição normal da energia anual com incerteza combinada (RSS) de ${unc.totalPct.toFixed(1).replace(".", ",")} %; no P90 de 10 anos a variabilidade interanual é dividida por √10.`,
      `Degradação de ${String(tech.degradation.firstYearPct).replace(".", ",")} % no primeiro ano e ${String(tech.degradation.annualPct).replace(".", ",")} % a.a. (linear) nos anos seguintes.`,
    ],
  };

  // ── mercado ──
  const market: MarketRates = {
    selicPct: 13.75,
    cdiPct: 13.65,
    ipca12mPct: 4.32,
    ipcaLongTermPct: 3.5,
    realRatePct: 7.1,
    usdBrl: 5.47,
    usdtBrl: 5.49,
    bnbBrl: 3412.5,
    provenance: [pSelic, pCdi, pIpca, pFocus, pNtnb, pFx, pCrypto],
  };

  // ── finanças ──
  const base: ModelParams = {
    energyFactor: 1,
    tariffFactor: 1,
    capexFactor: 1,
    omFactor: 1,
    revenueLossPct: fin.revenueLossPct,
    ipcaPct: market.ipcaLongTermPct,
    tariffRealGrowthPct: fin.tariffRealGrowthPct,
    clientDiscountPct: fin.clientDiscountPct,
  };
  const yearlyMWh = yearly.map((y) => y.energyMWh);
  const discountRatePct = 12.0;
  const dr = discountRatePct / 100;
  const baseRun = runModel(plant, yearlyMWh, base);
  const flows = baseRun.flows;
  let disc = 0;
  for (const cf of flows) {
    cf.discountedCashFlowBRL = r0(cf.netCashFlowBRL / Math.pow(1 + dr, cf.year));
    disc += cf.discountedCashFlowBRL;
  }
  const nets = flows.map((f) => f.netCashFlowBRL);
  const irrNom = irr(nets) * 100;
  const discCum: number[] = [];
  flows.reduce((acc, f) => {
    discCum.push(acc + f.discountedCashFlowBRL);
    return acc + f.discountedCashFlowBRL;
  }, 0);
  const investment = baseRun.investment;
  const sumNet = nets.slice(1).reduce((s, v) => s + v, 0);
  const pvCosts =
    investment + flows.slice(1).reduce((s, f) => s + (f.opexBRL + f.capexBRL) / Math.pow(1 + dr, f.year), 0);
  const pvEnergy = flows.slice(1).reduce((s, f) => s + f.energyMWh / Math.pow(1 + dr, f.year), 0);
  const totalCotas = plant.token.totalCotas;

  const evalParams = (p: Partial<ModelParams>, energyFactor = 1) => {
    const run = runModel(plant, yearlyMWh, { ...base, ...p, energyFactor });
    const n = run.flows.map((f) => f.netCashFlowBRL);
    return { irr: irr(n) * 100, npv: npv(dr, n) };
  };

  const p90Factor = generation.p90MWh / annualP50;
  const sensDefs: { variable: string; lowLabel: string; highLabel: string; low: Partial<ModelParams>; high: Partial<ModelParams>; eLow?: number; eHigh?: number }[] = [
    { variable: "Geração anual", lowLabel: "P90", highLabel: "P10", low: {}, high: {}, eLow: p90Factor, eHigh: 2 - p90Factor },
    { variable: "Tarifa de energia (B1)", lowLabel: "-10 %", highLabel: "+10 %", low: { tariffFactor: 0.9 }, high: { tariffFactor: 1.1 } },
    { variable: "CAPEX / captação", lowLabel: "-10 %", highLabel: "+10 %", low: { capexFactor: 0.9 }, high: { capexFactor: 1.1 } },
    { variable: "Desconto ao assinante", lowLabel: "12 %", highLabel: "25 %", low: { clientDiscountPct: 12 }, high: { clientDiscountPct: 25 } },
    { variable: "Inadimplência e energia não compensada", lowLabel: "2 %", highLabel: "8 %", low: { revenueLossPct: 2 }, high: { revenueLossPct: 8 } },
    { variable: "Custos de O&M", lowLabel: "-20 %", highLabel: "+20 %", low: { omFactor: 0.8 }, high: { omFactor: 1.2 } },
    { variable: "Reajuste real da tarifa", lowLabel: "-0,5 % a.a.", highLabel: "+1,5 % a.a.", low: { tariffRealGrowthPct: -0.5 }, high: { tariffRealGrowthPct: 1.5 } },
    { variable: "IPCA de longo prazo", lowLabel: "2,5 %", highLabel: "5,0 %", low: { ipcaPct: 2.5 }, high: { ipcaPct: 5.0 } },
  ];
  const sensitivity: SensitivityRow[] = sensDefs.map((d) => {
    const lo = evalParams(d.low, d.eLow ?? 1);
    const hi = evalParams(d.high, d.eHigh ?? 1);
    return {
      variable: d.variable,
      lowLabel: d.lowLabel,
      highLabel: d.highLabel,
      irrLowPct: r2(lo.irr),
      irrHighPct: r2(hi.irr),
      npvLowBRL: r0(lo.npv),
      npvHighBRL: r0(hi.npv),
    };
  });

  // Monte Carlo semeado
  const runs = 2000;
  const seed = 20261004;
  const mc = mulberry32(seed);
  const irrs: number[] = [];
  const npvs: number[] = [];
  for (let i = 0; i < runs; i++) {
    const res = evalParams(
      {
        tariffRealGrowthPct: base.tariffRealGrowthPct + 0.6 * normal(mc),
        capexFactor: 1 + 0.05 * normal(mc),
        omFactor: 1 + 0.1 * normal(mc),
        revenueLossPct: 2 + 6 * Math.sqrt(mc()) * 0.75,
        ipcaPct: base.ipcaPct + 0.8 * normal(mc),
      },
      1 + (unc.totalPct / 100) * normal(mc),
    );
    irrs.push(res.irr);
    npvs.push(res.npv);
  }
  const sortedIrr = [...irrs].sort((a, b) => a - b);
  const sortedNpv = [...npvs].sort((a, b) => a - b);
  const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))))];
  const binW = 0.5;
  const hMin = Math.floor(sortedIrr[0] / binW) * binW;
  const hMax = Math.ceil(sortedIrr[sortedIrr.length - 1] / binW) * binW;
  const histogram: { fromPct: number; toPct: number; count: number }[] = [];
  for (let b = hMin; b < hMax - 1e-9; b += binW) {
    histogram.push({ fromPct: r2(b), toPct: r2(b + binW), count: irrs.filter((v) => v >= b && v < b + binW).length });
  }

  const N = fin.horizonYears;
  // comparativos calculados pelo módulo financeiro real (mesma trajetória de CDI e regras de IR)
  const benchmarks: Benchmark[] = computeBenchmarks(market, N, nets, irrNom).map((b) => ({
    ...b,
    annualPct: r2(b.annualPct),
    finalValueOf1000BRL: r2(b.finalValueOf1000BRL),
  }));

  const firstNet = flows[1].netCashFlowBRL;
  const fmtBR = (v: number, d = 2) => v.toFixed(d).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fioRule =
    fin.accessRequestYear < 2023
      ? "Direito adquirido: sem cobrança até 2045"
      : `${fioBChargedPct(plant, fin.startYear)} % em ${fin.startYear}, 100 % a partir de 2029`;
  const finance = {
    investmentBRL: investment,
    capexBRL: baseRun.capex,
    discountRatePct,
    cashFlows: flows,
    npvBRL: r0(disc),
    irrNominalPct: r2(irrNom),
    irrRealPct: r2(((1 + irrNom / 100) / (1 + market.ipcaLongTermPct / 100) - 1) * 100),
    paybackYears: (() => {
      const p = payback(flows.map((f) => f.cumulativeBRL));
      return p === null ? null : r1(p);
    })(),
    discountedPaybackYears: (() => {
      const p = payback(discCum);
      return p === null ? null : r1(p);
    })(),
    lcoeBRLPerMWh: r1(pvCosts / pvEnergy),
    roiTotalPct: r1(((sumNet - investment) / investment) * 100),
    moic: r2(sumNet / investment),
    firstYearYieldPct: r2((firstNet / investment) * 100),
    avgYieldPct: r2((sumNet / N / investment) * 100),
    perCota: {
      priceBRL: plant.token.cotaPriceBRL,
      firstYearIncomeBRL: r2(firstNet / totalCotas),
      avgMonthlyIncomeBRL: r2(sumNet / N / 12 / totalCotas),
      totalIncomeBRL: r2(sumNet / totalCotas),
    },
    benchmarks,
    monteCarlo: {
      runs,
      seed,
      irrP10Pct: r2(q(sortedIrr, 0.1)),
      irrP50Pct: r2(q(sortedIrr, 0.5)),
      irrP90Pct: r2(q(sortedIrr, 0.9)),
      npvP10BRL: r0(q(sortedNpv, 0.1)),
      npvP50BRL: r0(q(sortedNpv, 0.5)),
      npvP90BRL: r0(q(sortedNpv, 0.9)),
      probIrrBelowCdiPct: r1((irrs.filter((v) => v < market.cdiPct).length / runs) * 100),
      probNpvNegativePct: r1((npvs.filter((v) => v < 0).length / runs) * 100),
      histogram,
      variables: [
        `Geração anual (normal, σ = ${unc.totalPct.toFixed(1).replace(".", ",")} %)`,
        "Reajuste real da tarifa (normal, σ = 0,6 p.p.)",
        "CAPEX (normal, σ = 5 %)",
        "Custos de O&M (normal, σ = 10 %)",
        "Inadimplência e energia não compensada (2 % a 6,5 %)",
        "IPCA de longo prazo (normal, σ = 0,8 p.p.)",
      ],
    },
    sensitivity,
    assumptions: [
      { label: `Captação (${fmtBR(totalCotas, 0)} cotas × R$ ${fmtBR(plant.token.cotaPriceBRL)})`, value: `R$ ${fmtBR(investment, 0)}` },
      { label: "CAPEX da usina (EPC, conexão e terreno)", value: `R$ ${fmtBR(baseRun.capex, 0)} (R$ ${fmtBR(baseRun.capex / (tech.dcKWp * 1000))}/Wp)` },
      { label: "Custo de estruturação", value: `${fmtBR(plant.token.structuringFeePct, 1)} % da captação` },
      { label: `Tarifa B1 ${loc.distribuidora} (com impostos)`, value: `R$ ${fmtBR(fin.tariffBRLPerKWh, 3)}/kWh` },
      { label: "TUSD Fio B", value: `R$ ${fmtBR(fin.fioBBRLPerKWh, 3)}/kWh` },
      { label: "Fio B cobrado (Lei 14.300/2022)", value: fioRule },
      { label: "Desconto ao assinante", value: `${fmtBR(fin.clientDiscountPct, 1)} %` },
      { label: "Energia não compensada + inadimplência", value: `${fmtBR(fin.revenueLossPct, 1)} %` },
      { label: "Reajuste tarifário", value: `IPCA + ${fmtBR(fin.tariffRealGrowthPct, 1)} % a.a.` },
      { label: "IPCA de longo prazo", value: `${fmtBR(market.ipcaLongTermPct, 1)} % a.a.` },
      { label: "O&M", value: `R$ ${fmtBR(fin.omBRLPerKWpYear, 0)}/kWp·ano` },
      { label: "Seguro", value: `${fmtBR(fin.insurancePctCapex)} % do CAPEX a.a.` },
      { label: "Arrendamento do terreno", value: `R$ ${fmtBR(fin.landLeaseBRLYear, 0)}/ano` },
      { label: "Demanda contratada de geração (TUSDg)", value: `R$ ${fmtBR(TUSDG_BRL_PER_KW_MONTH)}/kW·mês × ${fmtBR(tech.acKW, 0)} kW` },
      { label: "Taxa de gestão (SPE e plataforma)", value: `${fmtBR(fin.adminFeePctRevenue, 1)} % da receita` },
      { label: "Tributos (lucro presumido)", value: `${fmtBR(fin.taxPctRevenue)} % da receita` },
      { label: "Troca de inversores", value: `Ano ${fin.inverterReplacementYear}, R$ ${fmtBR(fin.inverterReplacementBRLPerKW, 0)}/kW` },
      { label: "Taxa de desconto (VPL)", value: `${fmtBR(discountRatePct, 1)} % a.a. nominal` },
      { label: "Horizonte", value: `${N} anos (${fin.startYear}–${fin.startYear + N - 1})` },
    ],
  };

  // ── local ──
  const meta = LOCATION_META[plant.slug] ?? {};
  const location: LocationInfo = {
    municipio: loc.municipio,
    uf: loc.uf,
    ibgeCode: loc.ibgeCode,
    ...meta,
    provenance: [pIbge, pIbgePop, pIbgePib, pElev],
  };

  // ── condições ao vivo ──
  const live: LiveConditions = {
    time: at,
    ghiWm2: 642,
    poaWm2: 668,
    tempC: 29.8,
    cloudCoverPct: 22,
    isDay: true,
    estimatedPowerKW: r0(Math.min(tech.acKW, tech.dcKWp * 0.668 * 0.81)),
    forecast: Array.from({ length: 7 }, (_, i) => {
      const g = r2(ghi[9] * (0.86 + 0.18 * Math.abs(Math.sin(i * 1.3 + 0.5))));
      const p = r2(g * poaFactor(9));
      return {
        date: `2026-10-${String(4 + i).padStart(2, "0")}`,
        ghiKWhM2: g,
        poaKWhM2: p,
        energyMWh: r1((p * tech.dcKWp * (generation.performanceRatioPct / 100)) / 1000),
        tempMaxC: r1(tempMax[9] + 1.2 * Math.sin(i)),
        cloudCoverPct: r0(18 + 30 * Math.abs(Math.cos(i * 1.3 + 0.5))),
      };
    }),
    provenance: pForecast,
  };

  const analysis: PlantAnalysis = {
    plant,
    generatedAt: at,
    location,
    resource: {
      monthly: { ghiKWhM2Day: ghi, dhiKWhM2Day: dhi, tempC: temp, tempMaxC: tempMax, tempMinC: tempMin, windMs: wind },
      annualGhiKWhM2: annualGhi,
      interannualCvPct: cv,
      annualSeries,
      provenance: [pNasa, pNasaAnnual],
    },
    pvgis: {
      annualKWhPerKWp: pvgisAnnual,
      monthlyKWhPerKWp: pvgisMonthly,
      interannualSdKWhPerKWp: r1(pvgisAnnual * 0.031),
      provenance: pPvgis,
    },
    generation,
    market,
    finance,
    live,
    provenance: [pNasa, pNasaAnnual, pPvgis, pIbge, pIbgePop, pIbgePib, pElev, pSelic, pCdi, pIpca, pFocus, pNtnb, pFx, pCrypto, pAneel, pForecast],
    dataHash: "",
  };
  analysis.dataHash = sha256Hex(canonicalAnalysisJson(analysis));
  return analysis;
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Análise completa da UFV Janaúba I */
export const analysisFixture: PlantAnalysis = buildAnalysisFixture("ufv-janauba-1");

/** Análises das três usinas do catálogo */
export const analysisFixturesBySlug: Record<string, PlantAnalysis> = Object.fromEntries(
  plants.map((p) => [p.slug, p.slug === "ufv-janauba-1" ? analysisFixture : buildAnalysisFixture(p.slug)]),
);

const WEI = BigInt(10) ** BigInt(18);

/** Estado on-chain de exemplo (BSC Testnet), oferta ativa com 48.250 cotas vendidas */
export const onChainFixture: OnChainState = {
  chainId: 97,
  tokenAddress: "0x7a3b9c1d2e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b",
  offeringAddress: "0x1f2e3d4c5b6a79880f1e2d3c4b5a6978e0d1c2b3",
  totalSupply: BigInt(48250),
  maxSupply: BigInt(130000),
  cotasSold: BigInt(48250),
  raisedUSDT: BigInt(878150) * WEI,
  offeringState: "active",
  documents: [
    {
      name: "Relatório de Auditoria Técnica e Econômica (dados da análise)",
      uri: "https://ufv-invest.example/usinas/ufv-janauba-1/relatorio.pdf",
      hash: `0x${analysisFixture.dataHash}`,
      timestamp: Math.floor(Date.parse("2026-10-04T13:20:00Z") / 1000),
    },
    {
      name: "Contrato social da SPE e acordo de cotistas",
      uri: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      hash: "0x5d41402abc4b2a76b9719d911017c592ae2d1f0e4c3b2a19087f6e5d4c3b2a19",
      timestamp: Math.floor(Date.parse("2026-09-28T18:00:00Z") / 1000),
    },
  ],
};
