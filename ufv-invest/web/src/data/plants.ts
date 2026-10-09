import type { Plant, PlantCommercial } from "@/lib/types";
import fotos from "./fotos.json";
import importadas from "./usinas.json";

/**
 * Catálogo de usinas.
 *
 * Todas as usinas abaixo são PROJETOS ILUSTRATIVOS (`illustrative: true`): localização,
 * distribuidora e regras regulatórias são reais, e o recurso solar vem das APIs públicas
 * (NASA POWER, PVGIS, Open-Meteo) em tempo de execução; os dados de engenharia, CAPEX e
 * tokenização são hipóteses de mercado para demonstrar a plataforma. Para listar uma usina
 * real, substitua estes campos pelos do projeto executivo, contrato de EPC e parecer de acesso.
 *
 * `fallbackClimate` é usado somente se as APIs não responderem: médias mensais aproximadas de
 * referência (ordem de grandeza do Atlas Brasileiro de Energia Solar, INPE 2017), sinalizadas
 * como "fallback" na tela e no PDF.
 */

const defaultLosses = {
  soilingPct: 2.0,
  shadingPct: 1.0,
  mismatchPct: 1.0,
  dcWiringPct: 1.5,
  acWiringPct: 0.8,
  transformerPct: 1.0,
  unavailabilityPct: 1.0,
};


const climate = (ghi: number[], t: number[], cv = 3.5) => ({
  ghiKWhM2Day: ghi,
  tempC: t,
  tempMaxC: t.map((x) => +(x + 6).toFixed(1)),
  tempMinC: t.map((x) => +(x - 6).toFixed(1)),
  windMs: [2.0, 1.9, 1.8, 1.9, 2.0, 2.2, 2.5, 2.7, 2.8, 2.5, 2.2, 2.0],
  interannualCvPct: cv,
  source: "Referência aproximada (Atlas Brasileiro de Energia Solar, INPE 2017) — fallback embarcado",
});

const cemigFinance = (o: { access: number; start: number; discount?: number; om?: number; lease: number }) => ({
  revenueModel: "gd-assinatura" as const,
  tariffBRLPerKWh: 0.95,
  fioBBRLPerKWh: 0.3,
  accessRequestYear: o.access,
  clientDiscountPct: o.discount ?? 20,
  revenueLossPct: 6,
  tariffRealGrowthPct: 0.5,
  omBRLPerKWpYear: o.om ?? 55,
  insurancePctCapex: 0.35,
  landLeaseBRLYear: o.lease,
  adminFeePctRevenue: 8,
  inverterReplacementYear: 13,
  inverterReplacementBRLPerKW: 350,
  taxPctRevenue: 11.33,
  horizonYears: 25,
  startYear: o.start,
});

const topcon585 = { model: "Módulo TOPCon bifacial 585 Wp (Tier 1)", wp: 585, gammaPmaxPctPerC: -0.3, noctC: 43, efficiencyPct: 22.6, bifacial: true };
const string250 = { model: "Inversor string 250 kW", kw: 250, euroEfficiencyPct: 98.4 };

const newPlants: Plant[] = [
  {
    slug: "ufv-horizonte-azul",
    name: "Usina Horizonte Azul",
    tagline: "Geração compartilhada no Alto Paranaíba, em operação desde 2025",
    description:
      "Usina de minigeração distribuída (geração compartilhada) conectada à CEMIG-D. A energia vira créditos cedidos a " +
      "assinantes com desconto na conta de luz; a receita líquida da SPE é distribuída mensalmente aos detentores das cotas.",
    about:
      "A Usina Horizonte Azul é um projeto de geração de energia solar fotovoltaica localizado em Patos de Minas (MG). " +
      "O empreendimento opera desde 2025 e vende a energia por assinatura a consumidores da CEMIG, no modelo de geração compartilhada.",
    status: "operacao",
    illustrative: true,
    sponsor: { name: "SPE Horizonte Azul Energia Ltda. (exemplo)" },
    location: { municipio: "Patos de Minas", uf: "MG", ibgeCode: 3148004, lat: -18.578, lon: -46.518, distribuidora: "CEMIG Distribuição", submercado: "SE/CO" },
    tech: {
      dcKWp: 1228.5,
      acKW: 1000,
      module: { ...topcon585, count: 2100 },
      inverter: { ...string250, count: 4 },
      mounting: "fixed",
      tiltDeg: 18,
      azimuthDeg: 0,
      albedo: 0.2,
      losses: defaultLosses,
      degradation: { firstYearPct: 1.0, annualPct: 0.4 },
      landAreaHa: 2.6,
      modalidade: "geracao-compartilhada",
      commissioning: "2025-04-10",
    },
    finance: cemigFinance({ access: 2023, start: 2025, lease: 16000 }),
    token: {
      symbol: "AFHAZ1",
      name: "Cota Usina Horizonte Azul",
      totalCotas: 5000,
      cotaPriceBRL: 1000,
      cotaPriceUSDT: 182,
      minCotas: 1,
      softCapCotas: 3500,
      structuringFeePct: 4,
      chainId: 97,
      offeringStart: "2026-09-01T12:00:00Z",
      offeringEnd: "2026-12-15T23:59:59Z",
      demoSoldCotas: 2800,
    },
    fallbackClimate: climate([5.9, 6.1, 5.4, 5.2, 4.8, 4.6, 4.9, 5.6, 5.7, 5.8, 5.6, 5.7], [22.9, 23.1, 22.6, 21.6, 19.6, 18.4, 18.4, 20.3, 22.3, 23.1, 22.6, 22.6]),
  },
  {
    slug: "ufv-vale-verde",
    name: "Usina Vale Verde",
    tagline: "Seguidor solar no Triângulo Mineiro, com direito adquirido ao Fio B",
    description:
      "Minigeração com seguidor solar de um eixo, conectada à CEMIG-D. Solicitação de acesso feita em 2022: pela Lei 14.300/2022 " +
      "mantém a compensação integral (sem cobrança do Fio B) até 2045.",
    about:
      "A Usina Vale Verde fica em Uberlândia (MG) e usa seguidores solares de um eixo, que acompanham o sol ao longo do dia e " +
      "aumentam a geração nas horas de maior consumo. Está em operação desde 2024.",
    status: "operacao",
    illustrative: true,
    sponsor: { name: "SPE Vale Verde Energia Ltda. (exemplo)" },
    location: { municipio: "Uberlândia", uf: "MG", ibgeCode: 3170206, lat: -18.918, lon: -48.277, distribuidora: "CEMIG Distribuição", submercado: "SE/CO" },
    tech: {
      dcKWp: 2395.4,
      acKW: 2000,
      module: { model: "Módulo TOPCon monofacial 580 Wp (Tier 1)", wp: 580, count: 4130, gammaPmaxPctPerC: -0.3, noctC: 43, efficiencyPct: 22.4, bifacial: false },
      inverter: { ...string250, count: 8 },
      mounting: "single-axis",
      tiltDeg: 0,
      azimuthDeg: 0,
      trackerMaxAngleDeg: 55,
      albedo: 0.22,
      losses: { ...defaultLosses, shadingPct: 1.5, soilingPct: 2.5 },
      degradation: { firstYearPct: 1.0, annualPct: 0.4 },
      landAreaHa: 5.6,
      modalidade: "geracao-compartilhada",
      commissioning: "2024-08-20",
    },
    finance: cemigFinance({ access: 2022, start: 2024, discount: 22, om: 66, lease: 30000 }),
    token: {
      symbol: "AFVVD1",
      name: "Cota Usina Vale Verde",
      totalCotas: 8800,
      cotaPriceBRL: 1200,
      cotaPriceUSDT: 218.4,
      minCotas: 1,
      softCapCotas: 6160,
      structuringFeePct: 4,
      chainId: 97,
      offeringStart: "2026-08-15T12:00:00Z",
      offeringEnd: "2026-11-30T23:59:59Z",
      demoSoldCotas: 6336,
    },
    fallbackClimate: climate([5.7, 6.0, 5.3, 5.2, 4.7, 4.5, 4.8, 5.5, 5.4, 5.6, 5.6, 5.5], [23.6, 23.8, 23.4, 22.4, 20.4, 19.2, 19.3, 21.4, 23.2, 23.9, 23.5, 23.3]),
  },
  {
    slug: "ufv-serra-dourada",
    name: "Usina Serra Dourada",
    tagline: "Maior projeto da carteira, no norte de Minas; captação financia a obra",
    description:
      "Minigeração em implantação conectada à CEMIG-D, com comissionamento previsto para 2027. Os recursos da captação ficam em " +
      "custódia no contrato até a meta mínima e financiam a construção (EPC).",
    about:
      "A Usina Serra Dourada será construída em Montes Claros (MG), região com um dos maiores índices de irradiação do Sudeste. " +
      "O projeto está em implantação e a geração começa após o comissionamento, previsto para 2027.",
    status: "implantacao",
    illustrative: true,
    sponsor: { name: "SPE Serra Dourada Energia Ltda. (exemplo)" },
    location: { municipio: "Montes Claros", uf: "MG", ibgeCode: 3143302, lat: -16.735, lon: -43.862, distribuidora: "CEMIG Distribuição", submercado: "SE/CO" },
    tech: {
      dcKWp: 4001.4,
      acKW: 3000,
      module: { ...topcon585, count: 6840 },
      inverter: { ...string250, count: 12 },
      mounting: "fixed",
      tiltDeg: 16,
      azimuthDeg: 0,
      albedo: 0.2,
      losses: defaultLosses,
      degradation: { firstYearPct: 1.0, annualPct: 0.4 },
      landAreaHa: 8.4,
      modalidade: "geracao-compartilhada",
      commissioning: "2027-08-01",
    },
    finance: cemigFinance({ access: 2025, start: 2027, om: 50, lease: 60000 }),
    token: {
      symbol: "AFSDR1",
      name: "Cota Usina Serra Dourada",
      totalCotas: 15800,
      cotaPriceBRL: 950,
      cotaPriceUSDT: 172.9,
      minCotas: 1,
      softCapCotas: 11060,
      structuringFeePct: 4,
      chainId: 97,
      offeringStart: "2026-09-20T12:00:00Z",
      offeringEnd: "2027-02-28T23:59:59Z",
      demoSoldCotas: 5372,
    },
    fallbackClimate: climate([6.0, 6.2, 5.6, 5.5, 5.0, 4.8, 5.1, 5.8, 6.1, 6.1, 5.6, 5.8], [24.4, 24.7, 24.3, 23.3, 21.4, 20.0, 19.9, 21.4, 23.6, 24.6, 24.0, 24.0]),
  },
  {
    slug: "ufv-sol-do-cerrado",
    name: "Usina Sol do Cerrado",
    tagline: "Noroeste de Minas, área agrícola com alta irradiação e operação estável",
    description:
      "Usina de minigeração em operação, conectada à CEMIG-D, com energia vendida por assinatura a produtores rurais e " +
      "comércio da região. A receita líquida é distribuída mensalmente aos cotistas.",
    about:
      "A Usina Sol do Cerrado fica em Unaí (MG), polo agrícola do noroeste mineiro. Opera desde 2025 com estrutura fixa e " +
      "módulos bifaciais, atendendo assinantes da CEMIG no modelo de geração compartilhada.",
    status: "operacao",
    illustrative: true,
    sponsor: { name: "SPE Sol do Cerrado Energia Ltda. (exemplo)" },
    location: { municipio: "Unaí", uf: "MG", ibgeCode: 3170404, lat: -16.357, lon: -46.906, distribuidora: "CEMIG Distribuição", submercado: "SE/CO" },
    tech: {
      dcKWp: 1801.8,
      acKW: 1500,
      module: { ...topcon585, count: 3080 },
      inverter: { ...string250, count: 6 },
      mounting: "fixed",
      tiltDeg: 16,
      azimuthDeg: 0,
      albedo: 0.2,
      losses: defaultLosses,
      degradation: { firstYearPct: 1.0, annualPct: 0.4 },
      landAreaHa: 3.8,
      modalidade: "geracao-compartilhada",
      commissioning: "2025-01-20",
    },
    finance: cemigFinance({ access: 2023, start: 2025, om: 56, lease: 22000 }),
    token: {
      symbol: "AFSCE1",
      name: "Cota Usina Sol do Cerrado",
      totalCotas: 6550,
      cotaPriceBRL: 1100,
      cotaPriceUSDT: 200.2,
      minCotas: 1,
      softCapCotas: 4585,
      structuringFeePct: 4,
      chainId: 97,
      offeringStart: "2026-09-10T12:00:00Z",
      offeringEnd: "2026-12-20T23:59:59Z",
      demoSoldCotas: 2227,
    },
    fallbackClimate: climate([5.8, 6.1, 5.5, 5.4, 5.0, 4.8, 5.1, 5.8, 5.8, 5.8, 5.5, 5.6], [24.0, 24.3, 24.0, 23.3, 21.6, 20.2, 20.2, 22.0, 24.2, 24.6, 23.9, 23.7]),
  },
];

const basePlants: Plant[] = [
...newPlants,
  {
    slug: "ufv-janauba-1",
    name: "Usina Janaúba I",
    tagline: "Minigeração no norte de Minas, um dos melhores recursos solares do Sudeste",
    description:
      "Usina fotovoltaica de minigeração distribuída (geração compartilhada) conectada à CEMIG-D. A energia gera créditos " +
      "que são cedidos a assinantes com desconto na conta de luz; a receita líquida da SPE é distribuída aos detentores das cotas.",
    status: "implantacao",
    illustrative: true,
    sponsor: { name: "SPE UFV Janaúba I Ltda. (exemplo)" },
    location: {
      municipio: "Janaúba",
      uf: "MG",
      ibgeCode: 3135100,
      lat: -15.835,
      lon: -43.278,
      distribuidora: "CEMIG Distribuição",
      submercado: "SE/CO",
    },
    tech: {
      dcKWp: 3276,
      acKW: 2500,
      module: { model: "Módulo TOPCon bifacial 585 Wp (Tier 1)", wp: 585, count: 5600, gammaPmaxPctPerC: -0.3, noctC: 43, efficiencyPct: 22.6, bifacial: true },
      inverter: { model: "Inversor string 250 kW", kw: 250, count: 10, euroEfficiencyPct: 98.4 },
      mounting: "fixed",
      tiltDeg: 15,
      azimuthDeg: 0,
      albedo: 0.2,
      losses: defaultLosses,
      degradation: { firstYearPct: 1.0, annualPct: 0.4 },
      landAreaHa: 6.5,
      modalidade: "geracao-compartilhada",
      commissioning: "2027-03-01",
    },
    finance: {
      revenueModel: "gd-assinatura",
      tariffBRLPerKWh: 0.95,
      fioBBRLPerKWh: 0.3,
      accessRequestYear: 2025,
      clientDiscountPct: 20,
      revenueLossPct: 6,
      tariffRealGrowthPct: 0.5,
      omBRLPerKWpYear: 55,
      insurancePctCapex: 0.35,
      landLeaseBRLYear: 39000,
      adminFeePctRevenue: 8,
      inverterReplacementYear: 13,
      inverterReplacementBRLPerKW: 350,
      taxPctRevenue: 11.33,
      horizonYears: 25,
      startYear: 2027,
    },
    token: {
      symbol: "UFVJAN1",
      name: "Cota UFV Janaúba I",
      totalCotas: 13000,
      cotaPriceBRL: 1000,
      cotaPriceUSDT: 182,
      minCotas: 1,
      softCapCotas: 9100,
      demoSoldCotas: 4810,
      structuringFeePct: 4,
      chainId: 97,
      offeringStart: "2026-10-01T12:00:00Z",
      offeringEnd: "2026-12-20T23:59:59Z",
    },
    fallbackClimate: {
      ghiKWhM2Day: [6.2, 6.3, 5.8, 5.6, 5.1, 4.9, 5.2, 5.9, 6.3, 6.3, 5.7, 5.9],
      tempC: [26.0, 26.3, 26.0, 25.0, 23.2, 21.8, 21.7, 23.2, 25.4, 26.6, 25.8, 25.6],
      tempMaxC: [31.5, 32.0, 31.6, 31.0, 29.8, 29.0, 29.2, 30.9, 32.6, 33.0, 31.4, 31.0],
      tempMinC: [20.8, 20.9, 20.7, 19.4, 17.0, 15.0, 14.6, 15.8, 18.6, 20.6, 20.8, 20.8],
      windMs: [2.2, 2.1, 2.0, 2.1, 2.2, 2.4, 2.6, 2.8, 2.9, 2.7, 2.4, 2.2],
      interannualCvPct: 3.5,
      source: "Referência aproximada (Atlas Brasileiro de Energia Solar, INPE 2017) — fallback embarcado",
    },
  },
  {
    slug: "ufv-petrolina-1",
    name: "Usina Petrolina I",
    tagline: "Sertão do São Francisco: sol forte o ano inteiro e direito adquirido ao Fio B",
    description:
      "Minigeração com solicitação de acesso anterior a 07/01/2023: pela Lei 14.300/2022 mantém a compensação integral " +
      "(sem cobrança do Fio B) até 2045. Conectada à Neoenergia Pernambuco.",
    status: "encerrada",
    illustrative: true,
    sponsor: { name: "SPE UFV Petrolina I Ltda. (exemplo)" },
    location: {
      municipio: "Petrolina",
      uf: "PE",
      ibgeCode: 2611101,
      lat: -9.338,
      lon: -40.565,
      distribuidora: "Neoenergia Pernambuco",
      submercado: "NE",
    },
    tech: {
      dcKWp: 1980,
      acKW: 1600,
      module: { model: "Módulo PERC monofacial 550 Wp (Tier 1)", wp: 550, count: 3600, gammaPmaxPctPerC: -0.35, noctC: 45, efficiencyPct: 21.3, bifacial: false },
      inverter: { model: "Inversor string 200 kW", kw: 200, count: 8, euroEfficiencyPct: 98.2 },
      mounting: "fixed",
      tiltDeg: 10,
      azimuthDeg: 0,
      albedo: 0.22,
      losses: { ...defaultLosses, soilingPct: 2.5 },
      degradation: { firstYearPct: 2.0, annualPct: 0.55 },
      landAreaHa: 4.2,
      modalidade: "geracao-compartilhada",
      ceg: "UFV.RS.PE.000000-0.01 (exemplo)",
      commissioning: "2024-06-15",
    },
    finance: {
      revenueModel: "gd-assinatura",
      tariffBRLPerKWh: 0.98,
      fioBBRLPerKWh: 0.27,
      accessRequestYear: 2022,
      clientDiscountPct: 22,
      revenueLossPct: 6,
      tariffRealGrowthPct: 0.5,
      omBRLPerKWpYear: 58,
      insurancePctCapex: 0.35,
      landLeaseBRLYear: 25200,
      adminFeePctRevenue: 8,
      inverterReplacementYear: 12,
      inverterReplacementBRLPerKW: 350,
      taxPctRevenue: 11.33,
      horizonYears: 25,
      startYear: 2024,
    },
    token: {
      symbol: "UFVPET1",
      name: "Cota UFV Petrolina I",
      totalCotas: 8460,
      cotaPriceBRL: 1000,
      cotaPriceUSDT: 182,
      minCotas: 1,
      softCapCotas: 5922,
      demoSoldCotas: 8460,
      offeringStart: "2024-02-01T12:00:00Z",
      offeringEnd: "2024-04-30T23:59:59Z",
      structuringFeePct: 4,
      chainId: 97,
    },
    fallbackClimate: {
      ghiKWhM2Day: [6.0, 6.0, 5.9, 5.5, 5.1, 4.8, 5.1, 5.8, 6.4, 6.5, 6.4, 6.1],
      tempC: [27.5, 27.2, 27.0, 26.5, 25.7, 24.6, 24.2, 25.0, 26.8, 28.2, 28.5, 28.0],
      tempMaxC: [33.0, 32.6, 32.2, 31.5, 30.8, 29.8, 29.6, 30.9, 33.0, 34.6, 34.8, 34.0],
      tempMinC: [22.6, 22.5, 22.4, 22.0, 21.0, 19.6, 18.9, 19.3, 20.8, 22.2, 22.8, 22.8],
      windMs: [3.2, 3.0, 2.7, 2.6, 3.0, 3.6, 4.0, 4.3, 4.4, 4.0, 3.6, 3.3],
      interannualCvPct: 3.0,
      source: "Referência aproximada (Atlas Brasileiro de Energia Solar, INPE 2017) — fallback embarcado",
    },
  },
  {
    slug: "ufv-bom-jesus-da-lapa-1",
    name: "Usina Bom Jesus da Lapa I",
    tagline: "Rastreador de um eixo no oeste baiano: mais energia nas horas de pico",
    description:
      "Minigeração com seguidor solar de um eixo (Norte-Sul), conectada à Neoenergia Coelba. Em construção, " +
      "com comissionamento previsto para 2027.",
    status: "implantacao",
    illustrative: true,
    sponsor: { name: "SPE UFV Bom Jesus da Lapa I Ltda. (exemplo)" },
    location: {
      municipio: "Bom Jesus da Lapa",
      uf: "BA",
      ibgeCode: 2903904,
      lat: -13.29,
      lon: -43.45,
      distribuidora: "Neoenergia Coelba",
      submercado: "NE",
    },
    tech: {
      dcKWp: 2600,
      acKW: 2000,
      module: { model: "Módulo TOPCon bifacial 580 Wp (Tier 1)", wp: 580, count: 4483, gammaPmaxPctPerC: -0.3, noctC: 43, efficiencyPct: 22.4, bifacial: true },
      inverter: { model: "Inversor string 250 kW", kw: 250, count: 8, euroEfficiencyPct: 98.4 },
      mounting: "single-axis",
      tiltDeg: 0,
      azimuthDeg: 0,
      trackerMaxAngleDeg: 55,
      albedo: 0.22,
      losses: { ...defaultLosses, shadingPct: 1.5 },
      degradation: { firstYearPct: 1.0, annualPct: 0.4 },
      landAreaHa: 6.0,
      modalidade: "geracao-compartilhada",
      commissioning: "2027-05-01",
    },
    finance: {
      revenueModel: "gd-assinatura",
      tariffBRLPerKWh: 0.93,
      fioBBRLPerKWh: 0.29,
      accessRequestYear: 2024,
      clientDiscountPct: 20,
      revenueLossPct: 6,
      tariffRealGrowthPct: 0.5,
      omBRLPerKWpYear: 68,
      insurancePctCapex: 0.4,
      landLeaseBRLYear: 36000,
      adminFeePctRevenue: 8,
      inverterReplacementYear: 13,
      inverterReplacementBRLPerKW: 350,
      taxPctRevenue: 11.33,
      horizonYears: 25,
      startYear: 2027,
    },
    token: {
      symbol: "UFVBJL1",
      name: "Cota UFV Bom Jesus da Lapa I",
      totalCotas: 11500,
      cotaPriceBRL: 1000,
      cotaPriceUSDT: 182,
      minCotas: 1,
      softCapCotas: 8050,
      demoSoldCotas: 1610,
      offeringStart: "2026-09-15T12:00:00Z",
      offeringEnd: "2027-01-31T23:59:59Z",
      structuringFeePct: 4,
      chainId: 97,
    },
    fallbackClimate: {
      ghiKWhM2Day: [6.1, 6.2, 5.9, 5.8, 5.4, 5.2, 5.5, 6.1, 6.4, 6.3, 5.8, 5.9],
      tempC: [27.0, 27.2, 26.9, 26.5, 25.4, 24.1, 24.0, 25.4, 27.6, 28.5, 27.5, 27.0],
      tempMaxC: [32.6, 33.0, 32.6, 32.4, 31.8, 31.0, 31.2, 32.8, 34.6, 35.0, 33.2, 32.4],
      tempMinC: [21.8, 21.8, 21.6, 21.0, 19.2, 17.2, 16.8, 18.2, 20.8, 22.2, 22.0, 21.8],
      windMs: [2.0, 1.9, 1.8, 1.9, 2.1, 2.4, 2.6, 2.9, 3.0, 2.7, 2.2, 2.0],
      interannualCvPct: 3.5,
      source: "Referência aproximada (Atlas Brasileiro de Energia Solar, INPE 2017) — fallback embarcado",
    },
  },
];

const ABOUT: Record<string, string> = {
  "ufv-janauba-1": "A Usina Janaúba I será construída no norte de Minas Gerais, uma das regiões com maior irradiação do Sudeste. A captação financia a obra; a geração começa após o comissionamento, previsto para 2027.",
  "ufv-petrolina-1": "A Usina Petrolina I opera desde 2024 no Vale do São Francisco (PE). A oferta foi concluída com todas as cotas vendidas, e a usina mantém o direito à compensação integral (sem Fio B) até 2045.",
  "ufv-bom-jesus-da-lapa-1": "A Usina Bom Jesus da Lapa I fica no oeste baiano e usará seguidores solares de um eixo. Está em implantação, com comissionamento previsto para 2027.",
};

/**
 * Fotos reais: ficam em /public/images/usinas/<slug>/ e são listadas em `fotos.json` pelo
 * importador (`npm run usinas:importar`). Sem foto, o site mostra um espaço reservado.
 */
const photos = fotos as Record<string, string[]>;

/** situação comercial ilustrativa (a planilha real substitui) */
const COMMERCIAL: Record<string, PlantCommercial> = {
  "ufv-horizonte-azul": { ppaActive: true, ppaCounterparty: "Assinantes de geração compartilhada (exemplo)", ppaEndDate: "2035-04-30" },
  "ufv-vale-verde": { ppaActive: true, ppaCounterparty: "Cooperativa agrícola regional (exemplo)", ppaEndDate: "2034-08-31" },
  "ufv-serra-dourada": { ppaActive: false, notes: "Contratos de assinatura em negociação" },
  "ufv-sol-do-cerrado": { ppaActive: false, notes: "Energia vendida no mercado de assinatura, sem contrato de longo prazo" },
  "ufv-janauba-1": { ppaActive: false, notes: "Contratos de assinatura em negociação" },
  "ufv-bom-jesus-da-lapa-1": { ppaActive: true, ppaCounterparty: "Rede de supermercados regional (exemplo)", ppaEndDate: "2037-05-31" },
  "ufv-petrolina-1": { ppaActive: true, ppaCounterparty: "Assinantes de geração compartilhada (exemplo)", ppaEndDate: "2034-06-30" },
};

/** Usinas reais importadas da planilha substituem o catálogo ilustrativo */
const imported = importadas as unknown as Plant[];
const source: Plant[] = imported.length > 0 ? imported : basePlants;

export const plants: Plant[] = source.map((p) => {
  const gallery = p.gallery?.length ? p.gallery : (photos[p.slug] ?? []);
  const commercial = p.commercial ?? COMMERCIAL[p.slug];
  return {
    ...p,
    cover: p.cover ?? gallery[0],
    gallery,
    about: p.about ?? ABOUT[p.slug] ?? p.description,
    commercial: commercial ? { askingPriceBRL: p.token.totalCotas * p.token.cotaPriceBRL, ...commercial } : undefined,
  };
});

export function getPlant(slug: string): Plant | undefined {
  return plants.find((p) => p.slug === slug);
}
