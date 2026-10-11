/**
 * Monta os dados do Prontuário Econômico-Financeiro a partir das análises das usinas (as mesmas do
 * site) e do modelo da plataforma. Função pura: a rota/CLI passam o estado on-chain e a revisão
 * técnica do ambiente; aqui só há cálculo. O resultado é serializável e vai anexado ao PDF (JSON
 * canônico, SHA-256 no rodapé), para qualquer número poder ser conferido depois.
 */
import { createHash } from "node:crypto";
import type { OnChainState, PlantAnalysis } from "@/lib/types";
import { canonicalJson } from "@/lib/report/canonical";
import {
  aggressivenessLadder,
  applySchedule,
  auditDistribution,
  buildCases,
  cdiReferencePct,
  optimize,
  originationOf,
  platformPnl,
  platformUnit,
  scaleEconomics,
  scenarioMatrix,
  type CandidateEval,
  type Limits,
  type PnlYear,
  type ScaleEconomics,
  type ScenarioRow,
} from "./modelo";
import { CURRENT_SCHEDULE, GUARDRAILS, MODEL_VERSION, PLATFORM_COSTS, PLATFORM_REFERENCES, type FeeSchedule } from "./premissas";

export type Situacao = "normal" | "atencao" | "alterado" | "na";

export interface ExamRow {
  parametro: string;
  resultado: string;
  referencia: string;
  situacao: Situacao;
}

export interface ReviewItem {
  area: string;
  item: string;
  situacao: Situacao;
  detalhe: string;
}

export interface PlantRow {
  slug: string;
  name: string;
  municipio: string;
  uf: string;
  distribuidora: string;
  status: string;
  open: boolean;
  illustrative: boolean;
  symbol: string;
  dcKWp: number;
  acKW: number;
  startYear: number;
  revenueModel: string;
  fioBRule: string;
  capexBRL: number;
  capexPerWp: number;
  p50MWh: number;
  p90MWh: number;
  specificYield: number;
  lcoe: number;
  tariff: number;
  /** captação e indicadores do catálogo (tabela atual) */
  raiseBRL: number;
  cotas: number;
  cotaPriceBRL: number;
  softCapCotas: number;
  irrBasePct: number;
  paybackBase: number | null;
  probIrrBelowCdiPct: number;
  onChain: { state: string; cotasSold: number; raisedUSDT: number } | null;
}

export interface PlantEconomics {
  slug: string;
  name: string;
  open: boolean;
  current: { irrPct: number; realIrrP90Pct: number; payback: number | null; sharePct: number; platformNpv: number };
  recommended: {
    raiseBRL: number;
    cotaPriceBRL: number;
    irrPct: number;
    irrRealPct: number;
    realIrrP90Pct: number;
    payback: number | null;
    moic: number;
    firstYearYieldPct: number;
    sharePct: number;
    structuringBRL: number;
    managementTotalBRL: number;
    performanceTotalBRL: number;
    platformNpv: number;
    takeRatePct: number;
    investors: number;
    failedOfferingLoss: number;
  };
}

export interface ProntuarioData {
  id: string;
  issuedAt: string;
  modelVersion: string;
  siteUrl: string;
  network: { chainId: number; name: string; deployed: boolean };
  market: { selicPct: number; cdiPct: number; cdiRefPct: number; ipcaLPPct: number; realPct: number; usdtBrl: number; discountRatePct: number };
  provenance: { live: number; total: number };
  limits: Limits;
  current: FeeSchedule;
  recommended: FeeSchedule;
  optimization: { evaluated: number; feasible: number; currentEval: CandidateEval; bestEval: CandidateEval; ranking: CandidateEval[] };
  ladder: { label: string; maxSharePct: number; schedule: string | null; platformNpv: number; worstIrrPct: number; worstSharePct: number }[];
  /** nuvem de todas as tabelas avaliadas: TIR mínima do investidor × VPL da plataforma */
  frontier: { id: string; irr: number; npv: number; share: number; feasible: boolean }[];
  plants: PlantRow[];
  economics: PlantEconomics[];
  scenarios: { current: ScenarioRow[]; recommended: ScenarioRow[] };
  pnl: PnlYear[];
  pnlCurrent: PnlYear[];
  scale: ScaleEconomics;
  totals: { plants: number; open: number; mwp: number; raiseOpenBRL: number; raiseAllBRL: number; avgIrrRecPct: number; fixedCostsPv10: number };
  investorPanel: { slug: string; name: string; rows: ExamRow[] }[];
  platformPanel: ExamRow[];
  audit: { supply: number; holders: number; distributions: number; transfers: number; distributedWei: string; attributedWei: string; residualWei: string; boundWei: string; maxProRataErrorWei: string; ok: boolean };
  review: ReviewItem[];
  diagnosis: string[];
  prescriptions: { prioridade: "P0" | "P1" | "P2"; acao: string; efeito: string }[];
  costs: typeof PLATFORM_COSTS;
  guardrails: typeof GUARDRAILS;
  dataHash: string;
}

export interface BuildOptions {
  siteUrl: string;
  now?: Date;
  chainId: number;
  deployed: boolean;
  onChain?: Record<string, OnChainState | null>;
  review?: ReviewItem[];
}

// ─── utilidades ──────────────────────────────────────────────────────────────────────────────

const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${v.toFixed(d).replace(".", ",")} %` : "—");
const brlM = (v: number) => (Number.isFinite(v) ? `R$ ${(v / 1e6).toFixed(2).replace(".", ",")} mi` : "—");
const yrs = (v: number | null) => (v === null || !Number.isFinite(v) ? "não se paga" : `${v.toFixed(1).replace(".", ",")} anos`);

/** "≥ ref": normal com folga, atenção dentro da folga, alterado abaixo */
function atLeast(v: number, ref: number, tol: number): Situacao {
  if (!Number.isFinite(v)) return "alterado";
  if (v < ref) return "alterado";
  return v < ref + tol ? "atencao" : "normal";
}
function atMost(v: number, ref: number, tol: number): Situacao {
  if (!Number.isFinite(v)) return "alterado";
  if (v > ref) return "alterado";
  return v > ref - tol ? "atencao" : "normal";
}

function fioBRule(a: PlantAnalysis): string {
  const f = a.plant.finance;
  if (f.revenueModel === "ppa") return "PPA";
  return f.accessRequestYear <= 2022 ? "Isento até 2045 (art. 26)" : "Transição (art. 27)";
}

// ─── montagem ────────────────────────────────────────────────────────────────────────────────

export function buildProntuarioData(analyses: PlantAnalysis[], opts: BuildOptions): ProntuarioData {
  const now = opts.now ?? new Date();
  const market = analyses[0].market;
  const horizon = Math.max(...analyses.map((a) => a.plant.finance.horizonYears));
  const cases = buildCases(analyses);
  const opt = optimize(cases, market, horizon);
  const rec = opt.best.schedule;
  const cur = CURRENT_SCHEDULE;
  const cycleYear = now.getUTCFullYear();

  const plants: PlantRow[] = analyses.map((a) => {
    const t = a.plant.token;
    const chain = opts.onChain?.[a.plant.slug] ?? null;
    return {
      slug: a.plant.slug,
      name: a.plant.name,
      municipio: a.plant.location.municipio,
      uf: a.plant.location.uf,
      distribuidora: a.plant.location.distribuidora,
      status: a.plant.status,
      open: a.plant.status !== "encerrada",
      illustrative: Boolean(a.plant.illustrative),
      symbol: t.symbol,
      dcKWp: a.plant.tech.dcKWp,
      acKW: a.plant.tech.acKW,
      startYear: a.plant.finance.startYear,
      revenueModel: a.plant.finance.revenueModel,
      fioBRule: fioBRule(a),
      capexBRL: a.finance.capexBRL,
      capexPerWp: a.finance.capexBRL / (a.plant.tech.dcKWp * 1000),
      p50MWh: a.generation.annualP50MWh,
      p90MWh: a.generation.p90MWh,
      specificYield: a.generation.specificYieldKWhPerKWp,
      lcoe: a.finance.lcoeBRLPerMWh,
      tariff: a.plant.finance.tariffBRLPerKWh,
      raiseBRL: a.finance.investmentBRL,
      cotas: t.totalCotas,
      cotaPriceBRL: t.cotaPriceBRL,
      softCapCotas: t.softCapCotas,
      irrBasePct: a.finance.irrNominalPct,
      paybackBase: a.finance.paybackYears,
      probIrrBelowCdiPct: a.finance.monteCarlo.probIrrBelowCdiPct,
      onChain: chain ? { state: chain.offeringState, cotasSold: Number(chain.cotasSold), raisedUSDT: Number(chain.raisedUSDT) / 1e18 } : null,
    };
  });

  const economics: PlantEconomics[] = cases.map((c) => {
    const n = c.a.plant.token.totalCotas;
    const softShare = c.a.plant.token.totalCotas > 0 ? c.a.plant.token.softCapCotas / c.a.plant.token.totalCotas : 0.7;
    const oc = applySchedule(c.p50, n, cur);
    const oc90 = applySchedule(c.p90, n, cur);
    const uc = platformUnit(oc, c.p50, { originationBRL: 0, softCapShare: softShare });
    const or = applySchedule(c.p50, n, rec);
    const or90 = applySchedule(c.p90, n, rec);
    const ur = platformUnit(or, c.p50, { originationBRL: originationOf(rec), softCapShare: softShare });
    return {
      slug: c.a.plant.slug,
      name: c.a.plant.name,
      open: c.open,
      current: { irrPct: oc.irrNominalPct, realIrrP90Pct: oc90.irrRealPct, payback: oc.paybackYears, sharePct: oc.platformSharePct, platformNpv: uc.npvNet },
      recommended: {
        raiseBRL: or.investment,
        cotaPriceBRL: or.cotaPrice,
        irrPct: or.irrNominalPct,
        irrRealPct: or.irrRealPct,
        realIrrP90Pct: or90.irrRealPct,
        payback: or.paybackYears,
        moic: or.moic,
        firstYearYieldPct: or.firstYearYieldPct,
        sharePct: or.platformSharePct,
        structuringBRL: or.structuringFee,
        managementTotalBRL: or.managementTotal,
        performanceTotalBRL: or.performanceTotal,
        platformNpv: ur.npvNet,
        takeRatePct: ur.takeRatePct,
        investors: ur.investors,
        failedOfferingLoss: ur.failedOfferingLoss,
      },
    };
  });

  const pnl = platformPnl(cases, rec, cycleYear);
  const pnlCurrent = platformPnl(cases, cur, cycleYear);
  const scale = scaleEconomics(cases, rec);
  const ladder = aggressivenessLadder(cases, market, horizon).map((s) => ({
    label: s.label,
    maxSharePct: s.maxSharePct,
    schedule: s.best?.schedule.label ?? null,
    platformNpv: s.best?.platformNpv ?? 0,
    worstIrrPct: s.best?.worstIrrP50Pct ?? NaN,
    worstSharePct: s.best?.worstSharePct ?? NaN,
  }));

  const openEcon = economics.filter((e) => e.open);
  const raiseOpen = openEcon.reduce((s, e) => s + e.recommended.raiseBRL, 0);
  const raiseAll = plants.reduce((s, p) => s + p.raiseBRL, 0);
  const avgIrrRec = raiseOpen > 0 ? openEcon.reduce((s, e) => s + e.recommended.irrPct * e.recommended.raiseBRL, 0) / raiseOpen : NaN;
  const disc = cases[0].p50.discountRatePct / 100;
  const ipca = market.ipcaLongTermPct / 100;
  let fixedPv10 = 0;
  for (let t = 0; t < 10; t++) fixedPv10 += (PLATFORM_COSTS.fixedAnnualBRL * (1 + ipca) ** t) / (1 + disc) ** t;
  const totals = {
    plants: plants.length,
    open: plants.filter((p) => p.open).length,
    mwp: plants.reduce((s, p) => s + p.dcKWp, 0) / 1000,
    raiseOpenBRL: raiseOpen,
    raiseAllBRL: raiseAll,
    avgIrrRecPct: avgIrrRec,
    fixedCostsPv10: fixedPv10,
  };

  // ── painel do investidor (tabela recomendada) ──
  const lim = opt.limits;
  const cdiNet = market.cdiPct * 0.85;
  const investorPanel = openEcon.map((e) => ({
    slug: e.slug,
    name: e.name,
    rows: [
      { parametro: "TIR nominal (P50)", resultado: pct(e.recommended.irrPct, 2), referencia: `≥ ${pct(lim.minIrrP50Pct, 2)}`, situacao: atLeast(e.recommended.irrPct, lim.minIrrP50Pct, 1) },
      { parametro: "TIR real (P90)", resultado: pct(e.recommended.realIrrP90Pct, 2), referencia: `≥ ${pct(lim.minRealIrrP90Pct, 2)}`, situacao: atLeast(e.recommended.realIrrP90Pct, lim.minRealIrrP90Pct, 1) },
      { parametro: "Payback simples", resultado: yrs(e.recommended.payback), referencia: `≤ ${lim.maxPaybackYears} anos`, situacao: atMost(e.recommended.payback ?? Infinity, lim.maxPaybackYears, 0.5) },
      { parametro: "Rendimento do 1º ano", resultado: pct(e.recommended.firstYearYieldPct), referencia: `≥ CDI líquido (${pct(cdiNet)})`, situacao: atLeast(e.recommended.firstYearYieldPct, cdiNet, 1) },
      { parametro: "Participação da plataforma", resultado: pct(e.recommended.sharePct), referencia: `≤ ${pct(lim.maxSharePct, 0)}`, situacao: atMost(e.recommended.sharePct, lim.maxSharePct, 1) },
    ] satisfies ExamRow[],
  }));

  // ── painel da plataforma ──
  const year1 = pnl.find((p) => p.year === 1);
  const year3 = pnl.find((p) => p.year === 3);
  const recurring1 = (year1?.management ?? 0) + (year1?.performance ?? 0);
  const takeRate = raiseAll > 0 ? (recurring1 / raiseAll) * 100 : NaN;
  const maxShare = Math.max(...openEcon.map((e) => e.recommended.sharePct));
  const concentration = raiseOpen > 0 ? (Math.max(...openEcon.map((e) => e.recommended.raiseBRL)) / raiseOpen) * 100 : NaN;
  const worstFail = Math.max(...openEcon.map((e) => e.recommended.failedOfferingLoss));
  const avgStructuring = openEcon.length ? openEcon.reduce((s, e) => s + e.recommended.structuringBRL, 0) / openEcon.length : 0;
  const npvOpen = opt.best.platformNpv;
  const platformPanel: ExamRow[] = [
    {
      parametro: "Take rate (receita recorrente ÷ carteira, ano 1)",
      resultado: `${pct(takeRate, 2)} a.a.`,
      referencia: `${pct(PLATFORM_REFERENCES.takeRateMinPct, 0)} a ${pct(PLATFORM_REFERENCES.takeRateMaxPct, 0)} a.a.`,
      situacao: takeRate < PLATFORM_REFERENCES.takeRateMinPct ? "alterado" : takeRate > PLATFORM_REFERENCES.takeRateMaxPct ? "atencao" : "normal",
    },
    { parametro: "Participação máxima no caixa das usinas", resultado: pct(maxShare), referencia: `≤ ${pct(GUARDRAILS.maxPlatformSharePct, 0)}`, situacao: atMost(maxShare, GUARDRAILS.maxPlatformSharePct, 1) },
    { parametro: "Margem líquida no ano 3", resultado: pct(year3?.marginPct ?? NaN), referencia: `≥ ${pct(PLATFORM_REFERENCES.netMarginYear3MinPct, 0)}`, situacao: atLeast(year3?.marginPct ?? NaN, PLATFORM_REFERENCES.netMarginYear3MinPct, 5) },
    {
      parametro: "Carteira de equilíbrio (custos fixos)",
      resultado: brlM(scale.breakEvenAumBRL),
      referencia: `≤ carteira atual (${brlM(raiseAll)})`,
      situacao: scale.breakEvenAumBRL <= raiseAll * 0.8 ? "normal" : scale.breakEvenAumBRL <= raiseAll ? "atencao" : "alterado",
    },
    {
      parametro: "VPL das ofertas abertas − VP dos custos fixos (10 anos)",
      resultado: brlM(npvOpen - fixedPv10),
      referencia: "> 0",
      situacao: npvOpen - fixedPv10 > 0.2 * fixedPv10 ? "normal" : npvOpen - fixedPv10 > 0 ? "atencao" : "alterado",
    },
    { parametro: "Concentração (maior oferta ÷ ofertas abertas)", resultado: pct(concentration), referencia: `≤ ${pct(PLATFORM_REFERENCES.maxConcentrationPct, 0)}`, situacao: atMost(concentration, PLATFORM_REFERENCES.maxConcentrationPct, 3) },
    {
      parametro: "Perda máxima de uma oferta fracassada",
      resultado: brlM(worstFail),
      referencia: `< estruturação média (${brlM(avgStructuring)})`,
      situacao: worstFail < avgStructuring * 0.5 ? "normal" : worstFail < avgStructuring ? "atencao" : "alterado",
    },
  ];

  // ── auditoria da distribuição: 24 meses do caixa médio da maior usina aberta, em USDT (18 casas) ──
  const biggest = openEcon.slice().sort((a, b) => b.recommended.raiseBRL - a.recommended.raiseBRL)[0];
  const bigCase = cases.find((c) => c.a.plant.slug === biggest?.slug) ?? cases[0];
  const bigOutcome = applySchedule(bigCase.p50, bigCase.a.plant.token.totalCotas, rec);
  const monthly = (bigOutcome.years[0]?.distribution ?? 1_000_000) / 12 / (market.usdtBrl || 5);
  const monthlyWei = Array.from({ length: 24 }, (_, i) => BigInt(Math.round(monthly * (1 + 0.003 * i) * 1e6)) * 10n ** 12n + BigInt(i * 7919));
  const audit = auditDistribution({ supply: bigCase.a.plant.token.totalCotas, monthlyWei });

  // ── revisão técnica (estáticos + o que a rota/CLI detectou) ──
  const review: ReviewItem[] = [
    ...(opts.review ?? []),
    {
      area: "Dados",
      item: "Banco de dados para KYC e contatos",
      situacao: "alterado",
      detalhe: "Pedidos de KYC e contatos ficam só na memória do servidor (demonstração). Antes da rede principal: Postgres gerenciado com criptografia e acesso restrito (LGPD).",
    },
    {
      area: "Contratos",
      item: "Auditoria externa dos contratos",
      situacao: "atencao",
      detalhe: "137 testes automatizados e auditoria interna; auditoria independente pendente antes de dinheiro real.",
    },
    {
      area: "Regulatório",
      item: "Enquadramento da oferta pública (CVM)",
      situacao: "alterado",
      detalhe: "Captação pública de cotas é oferta de investimento regulada; parecer de mercado de capitais pendente.",
    },
    {
      area: "Economia",
      item: "Taxas da plataforma na cadeia",
      situacao: "atencao",
      detalhe: "Estruturação, gestão e performance são retidas pela SPE fora da cadeia; o contrato distribui o líquido. Divulgar a tabela no termo de adesão.",
    },
    {
      area: "Contratos",
      item: "Conservação da distribuição de rendimentos",
      situacao: audit.ok ? "normal" : "alterado",
      detalhe: `Reprodução exata da aritmética do contrato: resíduo de ${audit.residualWei} wei em ${audit.distributions} distribuições e ${audit.transfers} transferências (limite ${audit.boundWei} wei).`,
    },
  ];

  // ── parecer e conduta ──
  const best = opt.best;
  const multiple = opt.current.platformNpv > 0 ? best.platformNpv / opt.current.platformNpv : NaN;
  const pending = review.filter((r) => r.situacao === "alterado").length;
  const diagnosis = [
    `Carteira com ${totals.plants} usinas (${totals.open} ofertas abertas), ${totals.mwp.toFixed(1).replace(".", ",")} MWp e captação total de ${brlM(raiseAll)}.`,
    `Tabela atual (${cur.structuringPct} % + ${cur.managementPct} % da receita): VPL de ${brlM(opt.current.platformNpv)} para a plataforma nas ofertas abertas, contra ${brlM(fixedPv10)} de custos fixos em 10 anos (valor presente): a operação não se sustenta sem revisão de preço ou escala.`,
    `Tabela recomendada (${rec.label.replace(/^Tabela recomendada \(|\)$/g, "")}): VPL de ${brlM(best.platformNpv)} (${Number.isFinite(multiple) ? `${multiple.toFixed(1).replace(".", ",")}×` : "—"} a atual), mantendo o investidor com TIR mínima de ${pct(best.worstIrrP50Pct, 2)} no P50 (referência ${pct(lim.minIrrP50Pct, 2)}) e ${pct(best.worstRealIrrP90Pct, 2)} real no P90.`,
    `A trava que limita a remuneração é a participação máxima de ${pct(GUARDRAILS.maxPlatformSharePct, 0)} da plataforma no caixa das usinas; o retorno do investidor segue acima das referências em todas as ofertas abertas.`,
    `O resultado recorrente cobre os custos fixos a partir de ${brlM(scale.breakEvenAumBRL)} de carteira; lucro recorrente de R$ 5 mi/ano exige ${brlM(scale.targets.find((t) => t.annualProfitBRL === 5_000_000)?.aumBRL ?? NaN)} em usinas.`,
    `Conservação da distribuição verificada (resíduo ≤ ${audit.boundWei} wei). Pendências técnicas críticas: ${pending}.`,
  ];
  const aumFor5 = scale.targets.find((t) => t.annualProfitBRL === 5_000_000)?.aumBRL ?? NaN;
  const prescriptions: ProntuarioData["prescriptions"] = [
    {
      prioridade: "P0",
      acao: `Adotar a tabela recomendada nas próximas ofertas e publicá-la no termo de adesão (estruturação de ${rec.structuringPct} % eleva a cota de R$ 1.000 para ${`R$ ${Math.round(1000 * (1 - cur.structuringPct / 100) / (1 - rec.structuringPct / 100)).toLocaleString("pt-BR")}`} na mesma usina).`,
      efeito: `VPL da plataforma de ${brlM(opt.current.platformNpv)} para ${brlM(best.platformNpv)} nas ofertas abertas.`,
    },
    {
      prioridade: "P0",
      acao: `Cobrar taxa de originação de R$ ${(PLATFORM_COSTS.originationFeeBRL / 1000).toFixed(0)} mil do patrocinador na listagem e só investir em marketing depois de 30 % da meta com investidores âncora.`,
      efeito: `Reduz a perda de uma oferta fracassada (hoje até ${brlM(worstFail)}).`,
    },
    { prioridade: "P0", acao: "Parecer jurídico de enquadramento CVM antes de qualquer captação na rede principal.", efeito: "Elimina o risco regulatório de suspensão das ofertas e de responsabilização dos administradores." },
    { prioridade: "P0", acao: "Banco de dados gerenciado (Postgres, região São Paulo) para KYC e contatos, com criptografia e trilha de acesso.", efeito: "Conformidade com a LGPD e com a prevenção à lavagem de dinheiro." },
    { prioridade: "P1", acao: "Safe multisig (3 de 5, carteiras físicas) como administradora e tesouraria na rede principal; auditoria externa dos contratos.", efeito: "Remove ponto único de falha na custódia e dá lastro de segurança para o investidor." },
    { prioridade: "P1", acao: `Plano de escala: carteira de ${brlM(aumFor5)} para lucro recorrente de R$ 5 mi/ano (≈ ${Math.ceil(aumFor5 / 10_000_000)} ofertas de R$ 10 mi).`, efeito: `Cada R$ 1 mi captado rende ${brlM(scale.upfrontPerMillion)} no fechamento e ${brlM(scale.recurringPerMillion)}/ano recorrentes.` },
    { prioridade: "P2", acao: "Levar a cascata de taxas para a cadeia (divisão automática na distribuição entre gestora e cotistas).", efeito: "Transparência total para o investidor e auditoria em tempo real da remuneração." },
  ];

  const data: Omit<ProntuarioData, "dataHash" | "id"> & { id?: string; dataHash?: string } = {
    issuedAt: now.toISOString(),
    modelVersion: MODEL_VERSION,
    siteUrl: opts.siteUrl,
    network: { chainId: opts.chainId, name: opts.chainId === 56 ? "BNB Smart Chain" : "BNB Smart Chain Testnet", deployed: opts.deployed },
    market: {
      selicPct: market.selicPct,
      cdiPct: market.cdiPct,
      cdiRefPct: cdiReferencePct(market, horizon),
      ipcaLPPct: market.ipcaLongTermPct,
      realPct: market.realRatePct,
      usdtBrl: market.usdtBrl,
      discountRatePct: cases[0].p50.discountRatePct,
    },
    provenance: (() => {
      const all = analyses.flatMap((a) => a.provenance);
      return { live: all.filter((p) => p.status === "live" || p.status === "cache").length, total: all.length };
    })(),
    limits: lim,
    current: cur,
    recommended: rec,
    optimization: { evaluated: opt.evaluated, feasible: opt.feasibleCount, currentEval: opt.current, bestEval: opt.best, ranking: opt.ranking },
    ladder,
    frontier: opt.all.map((e) => ({ id: e.schedule.id, irr: e.worstIrrP50Pct, npv: e.platformNpv, share: e.worstSharePct, feasible: e.feasible })),
    plants,
    economics,
    scenarios: { current: scenarioMatrix(cases, cur), recommended: scenarioMatrix(cases, rec) },
    pnl,
    pnlCurrent,
    scale,
    totals,
    investorPanel,
    platformPanel,
    audit: {
      supply: audit.supply,
      holders: audit.holders,
      distributions: audit.distributions,
      transfers: audit.transfers,
      distributedWei: audit.distributedWei.toString(),
      attributedWei: audit.attributedWei.toString(),
      residualWei: audit.residualWei.toString(),
      boundWei: audit.boundWei.toString(),
      maxProRataErrorWei: audit.maxProRataErrorWei.toString(),
      ok: audit.ok,
    },
    review,
    diagnosis,
    prescriptions,
    costs: PLATFORM_COSTS,
    guardrails: GUARDRAILS,
  };
  const dataHash = createHash("sha256").update(canonicalJson({ ...data, issuedAt: undefined }), "utf8").digest("hex");
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  return { ...data, id: `PE-${stamp}-${dataHash.slice(0, 6).toUpperCase()}`, dataHash } as ProntuarioData;
}
