import { hbars, histogram, tornado } from "../charts";
import type { ReportContext } from "../context";
import { fmtBRL, fmtBRLCompact, fmtNum, fmtPct } from "../format";
import { cdiNetPct } from "../insights";
import type { Cell } from "../layout";
import { C } from "../theme";
import type { PlantAnalysis } from "@/lib/types";

type Level = "Baixa" | "Média" | "Alta" | "Baixo" | "Médio" | "Alto";

function levelChip(level: Level): Cell {
  const k = level.startsWith("Baix") ? 0 : level.startsWith("Méd") ? 1 : 2;
  const colors = [
    { fg: C.green, bg: C.greenSoft },
    { fg: C.amberDark, bg: C.amberSoft },
    { fg: C.redStrong, bg: C.redSoft },
  ][k];
  return { text: level, chip: colors, align: "center" };
}

export function riskMatrix(a: PlantAnalysis): { risk: string; desc: string; prob: Level; impact: Level; mitigation: string }[] {
  const f = a.plant.finance;
  const g = a.generation;
  const acquired = f.accessRequestYear < 2023;
  const fioRows = a.finance.cashFlows.filter((c) => c.year > 0);
  const firstFull = fioRows.find((c) => c.fioBChargedPct >= 100);
  return [
    {
      risk: "Regulatório — Lei 14.300/2022 (Fio B)",
      desc: acquired
        ? "Mudança legal ou regulatória que reduza o direito adquirido à compensação integral até 2045."
        : `Cobrança crescente do Fio B sobre a energia compensada${firstFull ? ` (100 % a partir de ${firstFull.calendarYear} no modelo)` : ""}; regra pós-2028 ainda a ser definida pela ANEEL.`,
      prob: acquired ? "Baixa" : "Média",
      impact: acquired ? "Médio" : "Alto",
      mitigation: acquired
        ? "Protocolo de acesso anterior a 07/01/2023 documentado; acompanhamento regulatório contínuo."
        : "Fio B integral já modelado após a transição; sensibilidade e Monte Carlo incluem tarifa e desconto.",
    },
    {
      risk: "Tarifário",
      desc: `Reajustes da ${a.plant.location.distribuidora} abaixo da premissa (IPCA + ${fmtNum(f.tariffRealGrowthPct, 1)} % a.a.) ou mudança na estrutura tarifária B1.`,
      prob: "Média",
      impact: "Médio",
      mitigation: "Desconto ao assinante como colchão comercial; cenários de reajuste real negativo na sensibilidade.",
    },
    {
      risk: "Recurso solar",
      desc: `Anos com irradiação abaixo da média (CV interanual ${fmtPct(a.resource.interannualCvPct)}); incerteza combinada de ${fmtPct(g.uncertainty.totalPct)} na energia anual.`,
      prob: "Média",
      impact: "Médio",
      mitigation: "P90 e P99 publicados; validação cruzada NASA POWER × PVGIS; monitoramento contínuo da geração.",
    },
    {
      risk: "Técnico / O&M",
      desc: `Falhas de equipamentos, degradação acima de ${fmtPct(a.plant.tech.degradation.annualPct, 2)} a.a., troca de inversores (ano ${f.inverterReplacementYear}).`,
      prob: "Baixa",
      impact: "Médio",
      mitigation: "Equipamentos Tier 1 com garantia; contrato de O&M com SLA de disponibilidade; seguro de riscos operacionais.",
    },
    {
      risk: "Inadimplência de assinantes",
      desc: `Atraso ou cancelamento de assinantes e créditos não compensados (premissa de ${fmtPct(f.revenueLossPct)} da receita).`,
      prob: "Média",
      impact: "Médio",
      mitigation: "Carteira pulverizada, análise de crédito, fila de reposição de assinantes e cobrança na fatura.",
    },
    {
      risk: "Contraparte / SPE",
      desc: "Gestão da SPE, conflitos de interesse, falhas de governança ou insolvência de fornecedores e da gestora.",
      prob: "Baixa",
      impact: "Alto",
      mitigation: "SPE com patrimônio segregado, auditoria independente anual e relatórios ancorados on-chain.",
    },
    {
      risk: "Smart contract",
      desc: "Vulnerabilidades no código, uso indevido de chaves administrativas ou falha da rede BNB Smart Chain.",
      prob: "Baixa",
      impact: "Alto",
      mitigation: "Contratos imutáveis com testes e auditoria; admin em multisig com timelock; pausa de emergência.",
    },
    {
      risk: "Câmbio USDT/BRL",
      desc: "A receita é em reais e as distribuições em USDT; variações do câmbio e risco de paridade (depeg) da stablecoin.",
      prob: "Média",
      impact: "Baixo",
      mitigation: "Conversão na data de cada distribuição; preço da cota em BRL como referência contábil.",
    },
    {
      risk: "Liquidez das cotas",
      desc: "Mercado secundário restrito: transferências apenas entre carteiras com KYC; venda antecipada pode exigir deságio.",
      prob: "Alta",
      impact: "Médio",
      mitigation: "Horizonte de longo prazo explícito; renda periódica reduz a dependência de saída; registro de transferências on-chain.",
    },
  ];
}

export function renderRisk(ctx: ReportContext): void {
  const { l, a } = ctx;
  const f = a.finance;
  const mc = f.monteCarlo;
  const cdi = a.market.cdiPct;
  const cdiNet = cdiNetPct(a);
  l.sectionTitle(6, "Risco", {
    minSpace: 220,
    lead: "Distribuição da TIR (Monte Carlo), sensibilidade a cada premissa, comparação com renda fixa e matriz qualitativa de riscos.",
  });

  // ── Monte Carlo ──
  if (mc && mc.histogram?.length) {
    l.subTitle("Monte Carlo — distribuição da TIR nominal", { minSpace: 220, right: `${fmtNum(mc.runs, 0)} cenários · semente ${mc.seed}` });
    l.ensure(146);
    histogram(l, { x: l.x0, y: l.y, w: l.width, h: 142 }, {
      bins: mc.histogram,
      xFormat: (v) => `${fmtNum(v, 0)} %`,
      colorFn: (b) => ((b.fromPct + b.toPct) / 2 < cdi ? C.redStrong : C.amber),
      yTitle: "Frequência",
      markers: [
        { value: mc.irrP10Pct, label: `P10 ${fmtPct(mc.irrP10Pct)}`, color: C.navy, dash: true },
        { value: mc.irrP50Pct, label: `P50 ${fmtPct(mc.irrP50Pct)}`, color: C.navy },
        { value: mc.irrP90Pct, label: `P90 ${fmtPct(mc.irrP90Pct)}`, color: C.navy, dash: true },
        { value: cdi, label: `CDI ${fmtPct(cdi)}`, color: C.redStrong, dash: true },
      ],
      legendItems: [
        { label: "TIR ≥ CDI", color: C.amber, kind: "box" },
        { label: "TIR < CDI", color: C.redStrong, kind: "box" },
      ],
    });
    l.y += 146;
    l.tiles(
      [
        { label: "TIR P10 / P50 / P90", value: `${fmtNum(mc.irrP10Pct, 1)} / ${fmtNum(mc.irrP50Pct, 1)} / ${fmtNum(mc.irrP90Pct, 1)} %`, sub: "Percentis da TIR nominal", accent: C.navy },
        { label: "VPL P10 / P50 / P90", value: `${fmtBRLCompact(mc.npvP10BRL)} · ${fmtBRLCompact(mc.npvP50BRL)}`, sub: `P90: ${fmtBRLCompact(mc.npvP90BRL)}`, accent: C.navy },
        { label: "P(TIR < CDI bruto)", value: fmtPct(mc.probIrrBelowCdiPct), sub: `CDI ${fmtPct(cdi)} a.a. (líquido ${fmtPct(cdiNet)})`, valueColor: mc.probIrrBelowCdiPct > 20 ? C.redStrong : C.navy, accent: C.redStrong },
        { label: "P(VPL < 0)", value: fmtPct(mc.probNpvNegativePct), sub: `Taxa de desconto ${fmtPct(f.discountRatePct)} a.a.`, valueColor: mc.probNpvNegativePct > 20 ? C.redStrong : C.navy, accent: C.redStrong },
      ],
      { cols: 4, height: 42, after: 4, valueSize: 11.5 },
    );
    if (mc.variables?.length) l.caption(`Variáveis sorteadas: ${mc.variables.join("; ")}.`, { after: 8 });
  }

  // ── tornado ──
  const sens = [...(f.sensitivity ?? [])].sort(
    (x, y) => Math.abs(y.irrHighPct - y.irrLowPct) - Math.abs(x.irrHighPct - x.irrLowPct),
  );
  if (sens.length) {
    const h = 28 + sens.length * 17.5;
    l.subTitle("Sensibilidade da TIR (tornado)", { minSpace: h + 30, right: "Variação de uma premissa por vez" });
    l.ensure(h);
    tornado(l, { x: l.x0, y: l.y, w: l.width, h }, {
      rows: sens.map((s) => ({
        label: s.variable,
        sub: `${s.lowLabel} / ${s.highLabel}`,
        low: s.irrLowPct,
        high: s.irrHighPct,
        lowLabel: s.lowLabel,
        highLabel: s.highLabel,
      })),
      base: f.irrNominalPct,
      format: (v) => fmtPct(v),
      baseLabel: "TIR base",
    });
    l.y += h + 2;
    const top = sens[0];
    l.caption(
      `Ordenado pela amplitude do efeito. Maior sensibilidade: ${top.variable} (TIR de ${fmtPct(top.irrLowPct)} a ${fmtPct(top.irrHighPct)}; VPL de ${fmtBRLCompact(top.npvLowBRL)} a ${fmtBRLCompact(top.npvHighBRL)}). Verde: cenário acima da base; vermelho: abaixo.`,
      { after: 8 },
    );
  }

  // ── benchmarks ──
  const bm = [...(f.benchmarks ?? [])].filter((b) => Number.isFinite(b.finalValueOf1000BRL)).sort((x, y) => y.finalValueOf1000BRL - x.finalValueOf1000BRL);
  if (bm.length) {
    const rowH = 20;
    const h = bm.length * rowH;
    l.subTitle(`Comparativo: valor final de R$ 1.000 em ${a.plant.finance.horizonYears} anos`, { minSpace: h + 36, right: "Taxa anual equivalente" });
    l.ensure(h + 6);
    const isPlant = (name: string) => name.toLowerCase().includes(a.plant.name.toLowerCase()) || name.toLowerCase().includes("usina") || name.toLowerCase().includes("ufv");
    hbars(
      l,
      { x: l.x0, y: l.y, w: l.width, h },
      bm.map((b) => ({
        label: b.name,
        sub: `${fmtPct(b.annualPct, 2)} a.a.`,
        value: b.finalValueOf1000BRL,
        color: isPlant(b.name) ? C.amber : C.navy2,
        valueLabel: fmtBRL(b.finalValueOf1000BRL, 0),
        bold: isPlant(b.name),
      })),
    );
    l.y += h + 6;
    const notes = bm.filter((b) => b.note).map((b) => `${b.name}: ${b.note.replace(/\.$/, "")}`);
    l.caption(
      (notes.length ? `Notas — ${notes.join("; ")}. ` : "") +
        "Taxas compostas no mesmo horizonte; produtos com riscos, liquidez e tributação distintos. Rentabilidade projetada não é garantia de resultado.",
      { after: 8 },
    );
  }

  // ── matriz qualitativa ──
  l.subTitle("Matriz qualitativa de riscos", { minSpace: 140 });
  const rows: Cell[][] = riskMatrix(a).map((r) => [
    { text: r.risk, font: "semibold" },
    { text: r.desc },
    levelChip(r.prob),
    levelChip(r.impact),
    { text: r.mitigation, color: C.muted },
  ]);
  l.table({
    columns: [
      { header: "Risco", width: 1.35 },
      { header: "Descrição", width: 2.6 },
      { header: "Probab.", width: 0.62, align: "center" },
      { header: "Impacto", width: 0.62, align: "center" },
      { header: "Mitigação", width: 2.45 },
    ],
    rows,
    size: 7.1,
    padY: 2.8,
    after: 4,
  });
}
