/**
 * PDF do Prontuário Econômico-Financeiro da plataforma (estilo prontuário: ficha de identificação,
 * sinais vitais, parecer, exames com valores de referência, conduta e evolução).
 * Usa o mesmo motor de layout, fontes e paleta do relatório de auditoria das usinas.
 */
import { AFRelationship, PDFDocument, type RGB } from "pdf-lib";
import { embedReportFonts } from "@/lib/report";
import { canonicalJson } from "@/lib/report/canonical";
import { barChart, niceScale } from "@/lib/report/charts";
import { fmtBRL, fmtBRLCompact, fmtDateTime, fmtNum, fmtPct, fmtYears, groupHex, shortHash } from "@/lib/report/format";
import { Layout, type Cell, type Run } from "@/lib/report/layout";
import { C, PAGE } from "@/lib/report/theme";
import type { ExamRow, ProntuarioData, Situacao } from "./dados";

export const PRONTUARIO_TITLE = "Prontuário Econômico-Financeiro";
export const PRONTUARIO_ATTACHMENT = "dados-prontuario.json";

const SIT: Record<Situacao, { label: string; fg: RGB; bg: RGB }> = {
  normal: { label: "NORMAL", fg: C.green, bg: C.greenSoft },
  atencao: { label: "ATENÇÃO", fg: C.amberDark, bg: C.amberSoft },
  alterado: { label: "ALTERADO", fg: C.redStrong, bg: C.redSoft },
  na: { label: "N/A", fg: C.muted, bg: C.panel },
};
const RANK: Record<Situacao, number> = { na: 0, normal: 1, atencao: 2, alterado: 3 };
const worst = (list: Situacao[]): Situacao => list.reduce<Situacao>((w, s) => (RANK[s] > RANK[w] ? s : w), "normal");
const chipCell = (s: Situacao): Cell => ({ text: SIT[s].label, chip: { fg: SIT[s].fg, bg: SIT[s].bg }, align: "center" });
const tintCell = (text: string, s: Situacao): Cell => ({ text, bg: SIT[s].bg, color: SIT[s].fg, font: "semibold", align: "right" });
const mi = (v: number) => fmtBRLCompact(v, 1);
const STATUS_LABEL: Record<string, string> = { operacao: "Em operação", implantacao: "Em implantação", encerrada: "Captação encerrada" };
const ONCHAIN_LABEL: Record<string, string> = { pending: "Agendada", active: "Aberta", succeeded: "Meta atingida", failed: "Não atingiu", finalized: "Encerrada", cancelled: "Cancelada" };

export async function renderProntuario(d: ProntuarioData): Promise<Uint8Array> {
  const now = new Date(d.issuedAt);
  const pdf = await PDFDocument.create();
  const fonts = await embedReportFonts(pdf);
  pdf.setTitle(`${PRONTUARIO_TITLE} — Aferi Capital (${d.id})`, { showInWindowTitleBar: true });
  pdf.setSubject("Modelo econômico da plataforma, levantamento das usinas, remuneração, DRE projetada, auditoria e revisão técnica. Documento confidencial.");
  pdf.setAuthor("Aferi Capital");
  pdf.setCreator("Aferi Capital — gerador do prontuário econômico-financeiro");
  pdf.setProducer("Aferi Capital (pdf-lib)");
  pdf.setLanguage("pt-BR");
  pdf.setKeywords(["Aferi Capital", "prontuário", "modelo econômico", "tokenização", "energia solar", d.id, `modelo:${d.modelVersion}`, `sha256:${d.dataHash}`]);
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);
  await pdf.attach(new TextEncoder().encode(canonicalJson(d)), PRONTUARIO_ATTACHMENT, {
    mimeType: "application/json",
    description: "Dados do prontuário (JSON canônico)",
    creationDate: now,
    modificationDate: now,
    afRelationship: AFRelationship.Data,
  });

  const l = new Layout(pdf, fonts);
  l.addPage();
  cover(l, d);
  l.addPage();
  anamnese(l, d);
  levantamento(l, d);
  exameInvestidor(l, d);
  remuneracao(l, d);
  dre(l, d);
  estresse(l, d);
  matematica(l, d);
  auditoriaPerdas(l, d);
  revisao(l, d);
  conduta(l, d);
  evolucao(l, d);
  anexos(l, d);
  chrome(l, d);
  return pdf.save();
}

// ─── folha de rosto ──────────────────────────────────────────────────────────────────────────

function cover(l: Layout, d: ProntuarioData): void {
  const x = l.x0;
  const w = l.width;
  l.y += 6;
  l.text("PRONTUÁRIO ECONÔMICO-FINANCEIRO", x, l.y + 8, { font: "semibold", size: 8, color: C.amberDark });
  l.y += 14;
  l.text("Plataforma Aferi Capital", x, l.y + 22, { font: "bold", size: 22, color: C.navy });
  l.y += 30;
  l.text("Cotas tokenizadas de usinas solares fotovoltaicas · liquidação na BNB Chain", x, l.y + 9, { size: 9.5, color: C.muted });
  l.y += 20;

  // ficha de identificação
  const top = l.y;
  l.rect(x, top, w, 16, { fill: C.navy });
  l.text("FICHA DE IDENTIFICAÇÃO", x + 9, top + 10.8, { font: "semibold", size: 7.4, color: C.white });
  l.y = top + 20;
  const open = d.plants.filter((p) => p.open).length;
  l.definitionGrid(
    [
      { label: "Nº do prontuário", value: d.id, mono: true },
      { label: "Emissão", value: fmtDateTime(d.issuedAt, true) },
      { label: "Versão do modelo", value: `Modelo Aferi v${d.modelVersion}` },
      { label: "Rede de liquidação", value: `${d.network.name} (${d.network.chainId})` },
      { label: "Contratos", value: d.network.deployed ? "Implantados e lidos na emissão" : "Ainda não implantados nesta rede" },
      { label: "Classificação", value: "Confidencial — uso interno da administração" },
      { label: "Usinas avaliadas", value: `${d.plants.length} (${open} ofertas abertas)` },
      { label: "Fontes de dados", value: `${d.provenance.live} de ${d.provenance.total} ao vivo; demais com referência embarcada` },
      { label: "Integridade (SHA-256)", value: shortHash(d.dataHash), mono: true },
    ],
    { cols: 3, x: x + 9, width: w - 18, after: 4, valueSize: 8.4 },
  );
  l.rect(x, top, w, l.y - top, { stroke: C.border, strokeWidth: 0.8 });
  l.y += 12;

  // sinais vitais
  l.subTitle("Sinais vitais", { right: "Tabela recomendada, cenário P50" });
  const rec = d.optimization.bestEval;
  const curEval = d.optimization.currentEval;
  const y1 = d.pnl.find((p) => p.year === 1);
  l.tiles(
    [
      { label: "Captação da carteira", value: mi(d.totals.raiseAllBRL), sub: `${open} abertas: ${mi(d.totals.raiseOpenBRL)}`, accent: C.navy },
      { label: "Potência instalada", value: `${fmtNum(d.totals.mwp, 1)} MWp`, sub: `${d.plants.length} usinas no catálogo`, accent: C.navy },
      { label: "TIR média do investidor", value: fmtPct(d.totals.avgIrrRecPct, 1), sub: "Ponderada pela captação (P50)", accent: C.green },
      { label: "TIR mínima × referência", value: `${fmtPct(rec.worstIrrP50Pct, 1)}`, sub: `Referência ≥ ${fmtPct(d.limits.minIrrP50Pct, 1)}`, accent: C.green },
      { label: "VPL da plataforma", value: mi(rec.platformNpv), sub: `Antes dos fixos · atual ${mi(curEval.platformNpv)}`, accent: C.amber, valueColor: C.green },
      { label: "Participação da plataforma", value: fmtPct(rec.worstSharePct, 1), sub: `Teto ${fmtPct(d.limits.maxSharePct, 0)} do caixa das usinas`, accent: C.amber },
      { label: "Resultado líquido no ano 1", value: mi(y1?.result ?? NaN), sub: `Margem ${fmtPct(y1?.marginPct ?? NaN, 1)}`, accent: C.amber },
      { label: "Carteira de equilíbrio", value: mi(d.scale.breakEvenAumBRL), sub: "Recorrente cobre os custos fixos", accent: C.amber },
    ],
    { cols: 4, height: 50, after: 10, valueSize: 13 },
  );

  // parecer
  l.callout(
    d.diagnosis.map((t, i) => [{ text: `${i + 1}. `, font: "bold", color: C.navy }, { text: t }] as Run[]),
    { title: "PARECER TÉCNICO (SÍNTESE)", accent: C.amber, size: 8.4, after: 10 },
  );

  // classificação geral
  const inv = worst(d.investorPanel.flatMap((p) => p.rows.map((r) => r.situacao)));
  const plat = worst(d.platformPanel.map((r) => r.situacao));
  const op = worst(d.review.map((r) => r.situacao));
  l.ensure(30);
  l.text("CLASSIFICAÇÃO GERAL", x, l.y + 8, { font: "semibold", size: 7, color: C.muted });
  let cx = x;
  const cy = l.y + 13;
  for (const [label, s] of [
    ["Investidor", inv],
    ["Plataforma", plat],
    ["Operação", op],
  ] as const) {
    const lw = l.text(`${label}:`, cx, cy + 8.4, { font: "semibold", size: 8, color: C.navy });
    cx += lw + 4;
    cx += l.chip(SIT[s].label, cx, cy + 1, SIT[s].fg, SIT[s].bg, 6.8) + 16;
  }
  l.y = cy + 22;
  l.caption(
    "Leitura: NORMAL = dentro da referência com folga; ATENÇÃO = dentro da referência, perto do limite; ALTERADO = fora da referência ou pendência que impede a operação na rede principal. " +
      "Usinas do catálogo são projetos ilustrativos com premissas de mercado.",
  );
}

// ─── 01 anamnese ─────────────────────────────────────────────────────────────────────────────

function anamnese(l: Layout, d: ProntuarioData): void {
  const m = d.market;
  l.sectionTitle(1, "Anamnese: premissas e metodologia", {
    lead: "Condições de mercado na data da emissão e método de cálculo. Todos os números deste prontuário são recalculados a cada emissão a partir do catálogo de usinas, das fontes públicas e, quando houver, do estado dos contratos na blockchain.",
  });
  l.definitionGrid(
    [
      { label: "Selic (meta)", value: `${fmtPct(m.selicPct, 2)} a.a.` },
      { label: "CDI atual", value: `${fmtPct(m.cdiPct, 2)} a.a.` },
      { label: "CDI médio projetado (horizonte)", value: `${fmtPct(m.cdiRefPct, 2)} a.a.` },
      { label: "IPCA de longo prazo", value: `${fmtPct(m.ipcaLPPct, 2)} a.a.` },
      { label: "Juro real (NTN-B)", value: `${fmtPct(m.realPct, 2)} a.a.` },
      { label: "Taxa de desconto nominal", value: `${fmtPct(m.discountRatePct, 2)} a.a.` },
      { label: "USDT/BRL", value: fmtNum(m.usdtBrl, 2) },
      { label: "Fontes ao vivo", value: `${d.provenance.live} de ${d.provenance.total}` },
      { label: "Tabelas avaliadas", value: `${d.optimization.evaluated} (${d.optimization.feasible} viáveis)` },
    ],
    { cols: 3, after: 8 },
  );
  l.subTitle("Método");
  l.bullets(
    [
      "Fluxo de caixa de cada usina (25 anos): geração P50/P90 com dados NASA POWER e PVGIS, receita de geração compartilhada pela Lei 14.300/2022 (tarifa, Fio B, desconto ao assinante, perdas), O&M, seguro, arrendamento, reposição de inversores e tributos (lucro presumido). É o mesmo modelo exibido no site.",
      "Decomposição do caixa entre investidor e plataforma pela cascata da seção 07: estruturação sobre a captação, gestão sobre a receita e performance sobre o excedente a um retorno preferencial (IPCA + h).",
      `Otimização: ${d.optimization.evaluated} tabelas de remuneração dentro das faixas de mercado; escolhe-se a de maior VPL para a plataforma que respeita todas as travas do investidor em todas as ofertas abertas (TIR P50, TIR real P90, payback e participação máxima).`,
      "Auditoria: estresse de geração, regulação, custos e tarifa; reprodução exata da aritmética de distribuição do contrato; revisão técnica do ambiente na data da emissão.",
    ],
    { size: 8.4, after: 6 },
  );
}

// ─── 02 levantamento ─────────────────────────────────────────────────────────────────────────

function levantamento(l: Layout, d: ProntuarioData): void {
  l.sectionTitle(2, "Levantamento das usinas cadastradas", {
    lead: "Identificação e indicadores-base de cada usina do catálogo, na tabela de remuneração praticada hoje.",
    minSpace: 260,
  });
  l.table({
    columns: [
      { header: "Usina", width: 2.4, font: "semibold" },
      { header: "Local", width: 1.8 },
      { header: "Status", width: 1.5 },
      { header: "kWp", width: 0.9, align: "right" },
      { header: "Fio B", width: 1.8 },
      { header: "Na blockchain", width: 1.5 },
    ],
    rows: d.plants.map((p) => [
      `${p.name} (${p.symbol})`,
      `${p.municipio}/${p.uf}`,
      STATUS_LABEL[p.status] ?? p.status,
      fmtNum(p.dcKWp, 0),
      p.fioBRule,
      p.onChain ? `${ONCHAIN_LABEL[p.onChain.state] ?? p.onChain.state} · ${fmtNum(p.onChain.cotasSold, 0)} cotas` : d.network.deployed ? "Sem oferta" : "Não implantada",
    ]),
    footerRows: [["Total", "", "", fmtNum(d.totals.mwp * 1000, 0), "", ""]],
    size: 7.4,
  });
  l.table({
    columns: [
      { header: "Usina", width: 2.0, font: "semibold" },
      { header: "Captação", width: 1.1, align: "right" },
      { header: "Cota", width: 0.9, align: "right" },
      { header: "P50 (MWh/ano)", width: 1.1, align: "right" },
      { header: "Yield kWh/kWp", width: 1.05, align: "right" },
      { header: "CAPEX R$/Wp", width: 0.95, align: "right" },
      { header: "LCOE R$/MWh", width: 0.95, align: "right" },
      { header: "TIR (atual)", width: 0.9, align: "right" },
      { header: "Payback", width: 0.95, align: "right" },
      { header: "Prob. TIR < CDI", width: 1.0, align: "right" },
    ],
    rows: d.plants.map((p) => [
      p.name.replace(/^Usina /, ""),
      mi(p.raiseBRL),
      fmtBRL(p.cotaPriceBRL, 0),
      fmtNum(p.p50MWh, 0),
      fmtNum(p.specificYield, 0),
      fmtNum(p.capexPerWp, 2),
      fmtNum(p.lcoe, 0),
      fmtPct(p.irrBasePct, 1),
      fmtYears(p.paybackBase, 1),
      fmtPct(p.probIrrBelowCdiPct, 1),
    ]),
    footerRows: [["Carteira", mi(d.totals.raiseAllBRL), "", fmtNum(d.plants.reduce((s, p) => s + p.p50MWh, 0), 0), "", "", "", "", "", ""]],
    size: 7.2,
  });
  l.caption("P50: energia anual mediana; LCOE: custo nivelado da energia; Prob. TIR < CDI: probabilidade, no Monte Carlo de 2.000 rodadas, de a TIR ficar abaixo do CDI médio projetado.");
}

// ─── 03 exame do investidor ──────────────────────────────────────────────────────────────────

function exameInvestidor(l: Layout, d: ProntuarioData): void {
  l.sectionTitle(3, "Exame do investidor (tabela recomendada)", {
    lead: "Retorno de quem compra a cota depois de todas as taxas da plataforma. Cada célula é comparada ao valor de referência do cabeçalho; a cor indica a situação.",
    minSpace: 220,
  });
  const ref = d.investorPanel[0]?.rows.map((r) => r.referencia) ?? [];
  const rows: Cell[][] = d.investorPanel.map((p) => [p.name.replace(/^Usina /, ""), ...p.rows.map((r) => tintCell(r.resultado, r.situacao))]);
  l.table({
    columns: [
      { header: "Usina", width: 1.7, font: "semibold" },
      { header: `TIR P50\n${ref[0] ?? ""}`, width: 1.1, align: "right" },
      { header: `TIR real P90\n${ref[1] ?? ""}`, width: 1.1, align: "right" },
      { header: `Payback\n${ref[2] ?? ""}`, width: 1.1, align: "right" },
      { header: `Rendimento 1º ano\n${ref[3] ?? ""}`, width: 1.3, align: "right" },
      { header: `Participação\n${ref[4] ?? ""}`, width: 1.1, align: "right" },
    ],
    rows,
    size: 7.6,
  });
  l.caption(
    `Referências: TIR P50 ≥ CDI médio projetado (${fmtPct(d.market.cdiRefPct, 2)}) + ${fmtNum(d.guardrails.minIrrSpreadOverCdiPp, 0)} p.p. de prêmio pela iliquidez e pelo risco do ativo; TIR real no P90 ≥ juro real da NTN-B; rendimento do 1º ano comparado ao CDI líquido de IR de 15 %; participação = taxas da plataforma ÷ (taxas + distribuições) no horizonte.`,
  );
}

// ─── 04 remuneração ──────────────────────────────────────────────────────────────────────────

function remuneracao(l: Layout, d: ProntuarioData): void {
  const cur = d.current;
  const rec = d.recommended;
  const ce = d.optimization.currentEval;
  const be = d.optimization.bestEval;
  l.sectionTitle(4, "Modelo de remuneração da plataforma", {
    lead: "Comparação entre a tabela praticada hoje e a tabela recomendada pelo otimizador, que maximiza o valor para a plataforma dentro das travas do investidor.",
  });
  l.subTitle("4.1 Tabela atual × tabela recomendada");
  const basePrice = (s: number) => fmtBRL((1000 * (1 - cur.structuringPct / 100)) / (1 - s / 100), 0);
  l.table({
    columns: [
      { header: "Parâmetro", width: 3, font: "semibold" },
      { header: "Atual", width: 1.4, align: "right" },
      { header: "Recomendada", width: 1.4, align: "right", font: "semibold" },
    ],
    rows: [
      ["Estruturação (sucesso), % da captação", fmtPct(cur.structuringPct, 0), fmtPct(rec.structuringPct, 0)],
      ["Gestão, % da receita bruta da usina (anual)", fmtPct(cur.managementPct, 0), fmtPct(rec.managementPct, 0)],
      ["Performance, % do caixa acima do retorno preferencial", cur.performancePct ? fmtPct(cur.performancePct, 0) : "—", rec.performancePct ? fmtPct(rec.performancePct, 0) : "—"],
      ["Retorno preferencial (hurdle)", "—", rec.performancePct ? `IPCA + ${fmtNum(rec.hurdleRealPct, 0)} %` : "—"],
      ["Originação (paga pelo patrocinador)", "—", fmtBRL(d.costs.originationFeeBRL, 0)],
      ["Preço da cota de uma usina de base R$ 1.000", basePrice(cur.structuringPct), basePrice(rec.structuringPct)],
      ["TIR mínima do investidor (P50)", fmtPct(ce.worstIrrP50Pct, 2), fmtPct(be.worstIrrP50Pct, 2)],
      ["TIR real mínima do investidor (P90)", fmtPct(ce.worstRealIrrP90Pct, 2), fmtPct(be.worstRealIrrP90Pct, 2)],
      ["Participação máxima da plataforma", fmtPct(ce.worstSharePct, 1), fmtPct(be.worstSharePct, 1)],
      [{ text: "VPL da plataforma nas ofertas abertas", font: "bold" }, { text: mi(ce.platformNpv), font: "bold" }, { text: mi(be.platformNpv), font: "bold", color: C.green }],
    ],
    size: 7.8,
  });

  l.subTitle("4.2 Escada de agressividade", { right: "Melhor tabela para cada teto de participação" });
  l.table({
    columns: [
      { header: "Perfil", width: 1.3, font: "semibold" },
      { header: "Teto de participação", width: 1.2, align: "right" },
      { header: "Melhor tabela (estruturação + gestão + performance)", width: 3.6 },
      { header: "VPL plataforma", width: 1.2, align: "right" },
      { header: "TIR mínima do investidor", width: 1.3, align: "right" },
    ],
    rows: d.ladder.map((s) => {
      const isRec = s.maxSharePct === d.limits.maxSharePct;
      const f = isRec ? "bold" : "regular";
      return [
        { text: s.label, font: isRec ? "bold" : "semibold" },
        { text: fmtPct(s.maxSharePct, 0), font: f },
        { text: s.schedule ?? "nenhuma tabela viável", font: f },
        { text: s.schedule ? mi(s.platformNpv) : "—", font: f },
        { text: s.schedule ? fmtPct(s.worstIrrPct, 2) : "—", font: f },
      ];
    }),
    size: 7.6,
  });
  l.caption("Cada degrau acima transfere caixa do investidor para a plataforma. Os degraus mantêm as demais travas (TIR P50, TIR real P90 e payback); a referência mínima do investidor continua respeitada.");

  l.subTitle("4.3 Fronteira de remuneração", { minSpace: 230, right: "Cada ponto é uma tabela avaliada" });
  l.ensure(196);
  frontierChart(l, d, { x: l.x0, y: l.y, w: l.width, h: 186 });
  l.y += 192;
  l.caption(
    `Eixo horizontal: TIR P50 mínima do investidor entre as ofertas abertas; vertical: VPL da plataforma. Linha tracejada: referência mínima do investidor (${fmtPct(d.limits.minIrrP50Pct, 2)}). Pontos cinza violam alguma trava.`,
  );

  l.subTitle("4.4 Economia por oferta (tabela recomendada)", { minSpace: 150 });
  const open = d.economics.filter((e) => e.open);
  l.table({
    columns: [
      { header: "Usina", width: 1.8, font: "semibold" },
      { header: "Captação", width: 1, align: "right" },
      { header: "Estruturação", width: 1, align: "right" },
      { header: "Gestão (25 anos)", width: 1.1, align: "right" },
      { header: "Performance (25 anos)", width: 1.2, align: "right" },
      { header: "VPL líquido", width: 1, align: "right" },
      { header: "Take rate", width: 0.9, align: "right" },
      { header: "Investidores", width: 0.9, align: "right" },
    ],
    rows: open.map((e) => [
      e.name.replace(/^Usina /, ""),
      mi(e.recommended.raiseBRL),
      mi(e.recommended.structuringBRL),
      mi(e.recommended.managementTotalBRL),
      mi(e.recommended.performanceTotalBRL),
      mi(e.recommended.platformNpv),
      `${fmtPct(e.recommended.takeRatePct, 1)} a.a.`,
      fmtNum(e.recommended.investors, 0),
    ]),
    footerRows: [
      [
        "Ofertas abertas",
        mi(open.reduce((s, e) => s + e.recommended.raiseBRL, 0)),
        mi(open.reduce((s, e) => s + e.recommended.structuringBRL, 0)),
        mi(open.reduce((s, e) => s + e.recommended.managementTotalBRL, 0)),
        mi(open.reduce((s, e) => s + e.recommended.performanceTotalBRL, 0)),
        mi(open.reduce((s, e) => s + e.recommended.platformNpv, 0)),
        "",
        fmtNum(open.reduce((s, e) => s + e.recommended.investors, 0), 0),
      ],
    ],
    size: 7.2,
  });
  l.caption("VPL líquido: valor presente das taxas menos tributos sobre a receita de serviços, custos da oferta, KYC, aquisição de investidores e operação da SPE (antes dos custos fixos da plataforma). Gestão e performance em valores nominais somados.");
}

function frontierChart(l: Layout, d: ProntuarioData, r: { x: number; y: number; w: number; h: number }): void {
  const pts = d.frontier.filter((p) => Number.isFinite(p.irr) && Number.isFinite(p.npv));
  if (pts.length === 0) return;
  const padL = 40;
  const padB = 22;
  const px = r.x + padL;
  const pw = r.w - padL - 8;
  const ph = r.h - padB - 6;
  const py = r.y + 4;
  const xs = niceScale(Math.min(...pts.map((p) => p.irr), d.limits.minIrrP50Pct) - 0.3, Math.max(...pts.map((p) => p.irr)) + 0.3, 6);
  const ys = niceScale(0, Math.max(...pts.map((p) => p.npv / 1e6)), 5);
  const X = (v: number) => px + ((v - xs.min) / (xs.max - xs.min)) * pw;
  const Y = (v: number) => py + ph - ((v - ys.min) / (ys.max - ys.min)) * ph;
  for (const t of ys.ticks) {
    l.line(px, Y(t), px + pw, Y(t), { color: C.border, width: 0.4 });
    l.text(fmtNum(t, 0), px - 5, Y(t) + 2.2, { size: 6.4, color: C.muted, align: "right", width: 0 });
  }
  for (const t of xs.ticks) {
    l.text(`${fmtNum(t, 0)} %`, X(t), py + ph + 10, { size: 6.4, color: C.muted, align: "center", width: 0 });
  }
  l.text("R$ mi", r.x, py + 6, { size: 6.4, color: C.muted });
  l.text("TIR P50 mínima do investidor", px + pw / 2, py + ph + 19, { size: 6.6, color: C.muted, align: "center", width: 0 });
  l.line(X(d.limits.minIrrP50Pct), py, X(d.limits.minIrrP50Pct), py + ph, { color: C.redStrong, width: 0.8, dash: [3, 2] });
  for (const p of pts) l.circle(X(p.irr), Y(p.npv / 1e6), 1.7, { fill: p.feasible ? C.sky : C.subtle });
  const mark = (irr: number, npv: number, color: RGB, label: string) => {
    l.circle(X(irr), Y(npv / 1e6), 4.2, { fill: color, stroke: C.white, strokeWidth: 1 });
    l.text(label, X(irr) + 7, Y(npv / 1e6) + 2.5, { font: "semibold", size: 7, color });
  };
  mark(d.optimization.currentEval.worstIrrP50Pct, d.optimization.currentEval.platformNpv, C.amberDark, "Atual");
  mark(d.optimization.bestEval.worstIrrP50Pct, d.optimization.bestEval.platformNpv, C.green, "Recomendada");
  l.line(px, py + ph, px + pw, py + ph, { color: C.subtle, width: 0.6 });
}

// ─── 05 DRE ──────────────────────────────────────────────────────────────────────────────────

function dre(l: Layout, d: ProntuarioData): void {
  l.sectionTitle(5, "DRE projetada da plataforma", {
    lead: "Resultado anual da plataforma com a carteira atual: ano 0 = encerramento das ofertas abertas (estruturação e originação); anos seguintes = gestão e performance. Ofertas já encerradas seguem a tabela atual.",
  });
  l.subTitle("Resultado líquido por ano", { minSpace: 190, right: "R$ milhões (nominal)" });
  l.ensure(150);
  barChart(l, { x: l.x0, y: l.y, w: l.width, h: 140 }, {
    categories: d.pnl.map((p) => String(p.calendarYear)),
    series: [
      { name: "Tabela recomendada", values: d.pnl.map((p) => p.result / 1e6), color: C.green },
      { name: "Tabela atual", values: d.pnlCurrent.map((p) => p.result / 1e6), color: C.amberDark },
    ],
    yFormat: (v) => fmtNum(v, Math.abs(v) < 10 && v % 1 !== 0 ? 1 : 0),
    legend: true,
    barRatio: 0.7,
    maxTicks: 6,
  });
  l.y += 146;
  l.table({
    columns: [
      { header: "Ano", width: 0.6, font: "semibold" },
      { header: "Receita bruta", width: 1.1, align: "right" },
      { header: "Tributos", width: 1, align: "right" },
      { header: "Custos variáveis", width: 1.1, align: "right" },
      { header: "Custos fixos", width: 1, align: "right" },
      { header: "Resultado", width: 1, align: "right", font: "semibold" },
      { header: "Margem", width: 0.8, align: "right" },
      { header: "Acumulado", width: 1, align: "right" },
    ],
    rows: d.pnl.map((p) => [
      String(p.calendarYear),
      mi(p.gross),
      mi(-p.taxes),
      mi(-p.variableCosts),
      mi(-p.fixedCosts),
      { text: mi(p.result), color: p.result < 0 ? C.redStrong : C.text, font: "semibold" },
      fmtPct(p.marginPct, 1),
      mi(p.cumulative),
    ]),
    size: 7.2,
  });
  l.caption(
    `Tributos: ${fmtPct(d.costs.taxOnFeesPct, 2)} da receita de serviços (lucro presumido com ISS e adicional de IRPJ). Custos variáveis: operação da SPE (${fmtPct(d.costs.speOperationPctRevenue, 0)} da receita da usina + ${fmtBRL(d.costs.speFixedAnnualBRL, 0)}/ano por SPE), ofertas, KYC e aquisição. Custos fixos de ${fmtBRL(d.costs.fixedAnnualBRL, 0)}/ano corrigidos pelo IPCA.`,
  );

  l.subTitle("Escala e painel da plataforma", { minSpace: 200 });
  l.tiles(
    [
      { label: "Por R$ 1 mi: fechamento", value: mi(d.scale.upfrontPerMillion), sub: "Resultado líquido da oferta", accent: C.green },
      { label: "Por R$ 1 mi: recorrente", value: `${mi(d.scale.recurringPerMillion)}/ano`, sub: "Gestão + performance, ano 3", accent: C.green },
      { label: "Carteira de equilíbrio", value: mi(d.scale.breakEvenAumBRL), sub: "Recorrente = custos fixos", accent: C.amber },
      ...d.scale.targets.slice(0, 1).map((t) => ({ label: `Lucro de ${mi(t.annualProfitBRL)}/ano`, value: mi(t.aumBRL), sub: "Carteira necessária", accent: C.navy })),
    ],
    { cols: 4, height: 48, after: 6, valueSize: 12.5 },
  );
  l.paragraph(`Metas de lucro recorrente: ${d.scale.targets.map((t) => `${mi(t.annualProfitBRL)}/ano exige ${mi(t.aumBRL)} em usinas`).join("; ")}.`, { size: 8.2, color: C.muted, after: 6 });
  examTable(l, d.platformPanel);
}

function examTable(l: Layout, rows: ExamRow[]): void {
  l.table({
    columns: [
      { header: "Parâmetro", width: 3.2, font: "semibold" },
      { header: "Resultado", width: 1.3, align: "right" },
      { header: "Valor de referência", width: 1.8, align: "right" },
      { header: "Situação", width: 1, align: "center" },
    ],
    rows: rows.map((r) => [r.parametro, { text: r.resultado, font: "semibold", align: "right" }, r.referencia, chipCell(r.situacao)]),
    size: 7.6,
  });
}

// ─── 06 estresse ─────────────────────────────────────────────────────────────────────────────

function estresse(l: Layout, d: ProntuarioData): void {
  l.sectionTitle(6, "Exames complementares: estresse", {
    lead: "A mesma carteira sob choques de geração, regulação, custo e tarifa. A plataforma ganha sobre a receita (gestão) e sobre o excedente (performance): nos choques a receita dela cai, mas não vira obrigação de aporte.",
    minSpace: 200,
  });
  l.table({
    columns: [
      { header: "Cenário", width: 1.3, font: "semibold" },
      { header: "Descrição", width: 2.4 },
      { header: "TIR mín. (atual)", width: 1, align: "right" },
      { header: "TIR mín. (recom.)", width: 1, align: "right" },
      { header: "TIR média (recom.)", width: 1, align: "right" },
      { header: "TIR real mín. (recom.)", width: 1.1, align: "right" },
      { header: "VPL plataforma", width: 1.1, align: "right" },
    ],
    rows: d.scenarios.recommended.map((s, i) => {
      const c = d.scenarios.current[i];
      const below = s.worstIrrPct < d.limits.minIrrP50Pct;
      return [
        s.name,
        s.description,
        fmtPct(c?.worstIrrPct ?? NaN, 1),
        { text: fmtPct(s.worstIrrPct, 1), color: below ? C.amberDark : C.text, font: "semibold" },
        fmtPct(s.avgIrrPct, 1),
        { text: fmtPct(s.worstRealIrrPct, 1), color: s.worstRealIrrPct < d.limits.minRealIrrP90Pct ? C.redStrong : C.text },
        mi(s.platformNpv),
      ];
    }),
    size: 7.4,
  });
  l.caption("Em âmbar: cenários em que a TIR mínima fica abaixo da referência do caso-base — esperado num choque; o importante é a TIR real seguir positiva e o VPL da plataforma seguir positivo.");
}

// ─── 07 matemática ───────────────────────────────────────────────────────────────────────────

function formula(l: Layout, lines: string[], note?: string): void {
  const size = 7.8;
  const lh = size * 1.55;
  const h = lines.length * lh + 14 + (note ? 12 : 0);
  l.ensure(h + 4);
  const top = l.y;
  l.rect(l.x0, top, l.width, h, { fill: C.panel });
  l.rect(l.x0, top, 2.4, h, { fill: C.navy });
  lines.forEach((ln, i) => l.text(ln, l.x0 + 12, top + 9 + i * lh + size, { font: "mono", size, color: C.navy }));
  if (note) l.text(note, l.x0 + 12, top + h - 7, { size: 6.8, color: C.muted, width: l.width - 24, truncate: true });
  l.y = top + h + 7;
}

function matematica(l: Layout, d: ProntuarioData): void {
  l.sectionTitle(7, "Matemática da plataforma", {
    lead: "Fórmulas que o site, os contratos e este prontuário aplicam. Notação: t = ano de operação (1..N); π = IPCA de longo prazo; I = captação; CAPEX = custo da usina.",
  });
  l.subTitle("7.1 Oferta primária (contrato UFVOffering)");
  formula(l, [
    "Captação          I = n · p          (n cotas vendidas, p = preço por cota em USDT)",
    "Faixa de venda    meta mínima S ≤ n ≤ teto H;  por investidor  q ≤ q_max = H / 10",
    "Desistência       cada aporte pode ser devolvido em até 5 dias (100 % do valor)",
    "Sucesso           n ≥ S no fim do prazo  →  encerrar: I vai à tesouraria; cotas entregues",
    "Fracasso          n < S, cancelamento ou não encerrada em 60 dias  →  reembolso integral",
  ]);
  l.subTitle("7.2 Cascata de caixa e remuneração");
  formula(l, [
    "Receita_t      = E_t · (tarifa_t − %FioB_t · FioB_t) · (1 − desconto) · (1 − perdas)",
    "Caixa_op_t     = Receita_t − Tributos_t − OPEX_t − Reposição_t",
    "Gestão_t       = g · Receita_t                                   → plataforma",
    "Caixa_t        = Caixa_op_t − Gestão_t",
    "Hurdle_t       = I · [(1 + h)(1 + π) − 1] · (1 + π)^(t−1)",
    "Performance_t  = c · max(0, Caixa_t − Hurdle_t − Déficit_{t−1})   → plataforma",
    "Déficit_t      = max(0, Déficit_{t−1} + Hurdle_t − Caixa_t)",
    "Distribuição_t = Caixa_t − Performance_t                         → investidores",
    "Captação       I = CAPEX / (1 − s);   Estruturação = s · I       → plataforma",
  ], `Tabela recomendada: s = ${fmtPct(d.recommended.structuringPct, 0)}, g = ${fmtPct(d.recommended.managementPct, 0)}, c = ${fmtPct(d.recommended.performancePct, 0)}, h = ${fmtPct(d.recommended.hurdleRealPct, 0)}.`);
  l.subTitle("7.3 Distribuição de rendimentos na cadeia (contrato UFVPlantToken)");
  formula(l, [
    "M = 2^128 (precisão);  S = cotas em circulação",
    "Ao distribuir D:   A = D · M + resto;   RPC += piso(A / S);   resto = A mod S",
    "Ao transferir v de a para b:   corr_a += RPC · v;   corr_b −= RPC · v",
    "Acumulado_i = piso((RPC · saldo_i + corr_i) / M);   Disponível_i = Acumulado_i − Sacado_i",
    "Conservação:   0 ≤ ∑ D − ∑ Acumulado_i ≤ nº de detentores (em wei)",
  ]);
  const a = d.audit;
  l.callout(
    [
      [
        { text: "Exame laboratorial — conservação. ", font: "bold" },
        {
          text: `Reprodução exata (inteiros) de ${a.distributions} distribuições mensais e ${a.transfers} transferências entre ${a.holders} detentores de ${fmtNum(a.supply, 0)} cotas: distribuído ${fmtNum(Number(a.distributedWei) / 1e18, 6)} USDT, atribuído ${fmtNum(Number(a.attributedWei) / 1e18, 6)} USDT; resíduo retido no contrato = ${a.residualWei} wei (limite ${a.boundWei} wei); maior desvio em relação ao pró-rata exato = ${a.maxProRataErrorWei} wei.`,
        },
      ],
      [{ text: "Resultado: ", font: "bold" }, { text: a.ok ? "NORMAL — nenhum valor é criado ou perdido; o arredondamento é menor que 1 wei por detentor." : "ALTERADO — rever a aritmética do contrato.", color: a.ok ? C.green : C.redStrong, font: "semibold" }],
    ],
    { accent: a.ok ? C.green : C.redStrong, bg: a.ok ? C.greenSoft : C.redSoft, size: 8, after: 8 },
  );
  l.subTitle("7.4 Indicadores");
  formula(l, [
    "VPL(r)       = ∑_{t=0..N} F_t / (1 + r)^t          TIR: r tal que VPL(r) = 0",
    "TIR real     = (1 + TIR) / (1 + π) − 1                Payback: 1º t com ∑ F ≥ 0",
    "MOIC         = ∑ Distribuição_t / I                  Rendimento 1º ano = Distribuição_1 / I",
    "Participação = (Estruturação + ∑ Gestão + ∑ Performance) / (taxas + ∑ Distribuição)",
    "Take rate    = (Gestão_1 + Performance_1) / I",
  ]);
}

// ─── 08 auditoria de perdas ──────────────────────────────────────────────────────────────────

function auditoriaPerdas(l: Layout, d: ProntuarioData): void {
  l.sectionTitle(8, "Auditoria de perdas da plataforma", {
    lead: "Situações que poderiam gerar prejuízo para a Aferi Capital, como cada uma é contida e o resultado do teste nesta emissão.",
    minSpace: 220,
  });
  const open = d.economics.filter((e) => e.open);
  const worstFail = Math.max(...open.map((e) => e.recommended.failedOfferingLoss));
  const avgUpfront = d.scale.upfrontPerMillion * (d.totals.raiseOpenBRL / Math.max(1, open.length) / 1e6);
  const sc = (name: string) => d.scenarios.recommended.find((s) => s.name === name);
  const p90 = sc("Geração P90");
  const fio = sc("Fio B a 100 %");
  const npvOk = (v?: number) => (v ?? -1) > 0;
  const rows: { risco: string; mecanismo: string; teste: string; s: Situacao }[] = [
    {
      risco: "Oferta não atinge a meta",
      mecanismo: "Escrow devolve 100 % ao investidor; custos da plataforma ficam afundados. Originação paga pelo patrocinador; marketing só após investidores âncora.",
      teste: `Perda máxima ${mi(worstFail)}; uma oferta média bem-sucedida rende ${mi(avgUpfront)} no fechamento (cobre ${fmtNum(avgUpfront / Math.max(1, worstFail), 1)} fracassos).`,
      s: worstFail < avgUpfront ? "atencao" : "alterado",
    },
    {
      risco: "Geração abaixo do esperado (P90)",
      mecanismo: "Gestão é % da receita e performance só existe acima do retorno preferencial: a plataforma nunca garante rendimento nem aporta caixa.",
      teste: `VPL da plataforma no P90: ${mi(p90?.platformNpv ?? NaN)}.`,
      s: npvOk(p90?.platformNpv) ? "normal" : "alterado",
    },
    {
      risco: "Mudança regulatória (Fio B a 100 %)",
      mecanismo: "Mesma lógica: a receita da plataforma acompanha a da usina; sem obrigação de compensar o investidor.",
      teste: `VPL da plataforma no estresse: ${mi(fio?.platformNpv ?? NaN)}.`,
      s: npvOk(fio?.platformNpv) ? "normal" : "alterado",
    },
    {
      risco: "Escala insuficiente para os custos fixos",
      mecanismo: "Plano de originação contínua e custos fixos enxutos; revisão a cada emissão deste prontuário.",
      teste: `Equilíbrio com ${mi(d.scale.breakEvenAumBRL)} de carteira; carteira atual ${mi(d.totals.raiseAllBRL)}.`,
      s: d.scale.breakEvenAumBRL <= d.totals.raiseAllBRL ? "normal" : "alterado",
    },
    {
      risco: "Responsabilização por rentabilidade",
      mecanismo: "Contratos e termos não prometem retorno; distribuição é só o caixa líquido depositado pela SPE; avisos de risco em todas as telas e relatórios.",
      teste: "Nenhuma função dos contratos obriga a plataforma a aportar recursos.",
      s: "normal",
    },
    {
      risco: "Erro na distribuição de rendimentos",
      mecanismo: "Precisão 2^128 com resto carregado; reprodução exata nesta emissão (seção 07.3).",
      teste: `Resíduo de ${d.audit.residualWei} wei (limite ${d.audit.boundWei}).`,
      s: d.audit.ok ? "normal" : "alterado",
    },
    {
      risco: "Perda ou roubo da chave administradora",
      mecanismo: "Troca de admin em 2 etapas com espera de 2 dias; na rede principal o deploy exige Safe multisig; pausa de emergência separada.",
      teste: d.network.chainId === 56 ? "Rede principal: verificar Safe na revisão técnica." : "Testnet: admin em carteira comum (aceitável só em teste).",
      s: d.network.chainId === 56 ? "normal" : "atencao",
    },
  ];
  l.table({
    columns: [
      { header: "Risco", width: 1.5, font: "semibold" },
      { header: "Mecanismo de proteção", width: 3.1 },
      { header: "Resultado do teste", width: 2.4 },
      { header: "Situação", width: 0.9, align: "center" },
    ],
    rows: rows.map((r) => [r.risco, r.mecanismo, r.teste, chipCell(r.s)]),
    size: 7.2,
  });
}

// ─── 09 revisão técnica ──────────────────────────────────────────────────────────────────────

function revisao(l: Layout, d: ProntuarioData): void {
  l.sectionTitle(9, "Revisão técnica da plataforma", {
    lead: "Estado do ambiente na data da emissão (configuração, contratos, dados e conformidade). Itens ALTERADOS impedem a operação com dinheiro real.",
    minSpace: 200,
  });
  l.table({
    columns: [
      { header: "Área", width: 0.9, font: "semibold" },
      { header: "Item", width: 2 },
      { header: "Situação", width: 0.9, align: "center" },
      { header: "Detalhe", width: 4 },
    ],
    rows: d.review.map((r) => [r.area, r.item, chipCell(r.situacao), r.detalhe]),
    size: 7.2,
  });
}

// ─── 10 conduta ──────────────────────────────────────────────────────────────────────────────

function conduta(l: Layout, d: ProntuarioData): void {
  l.sectionTitle(10, "Conduta (prescrições)", { lead: "Ações em ordem de prioridade. P0: antes da próxima oferta; P1: antes da rede principal; P2: evolução.", minSpace: 200 });
  const color: Record<string, { fg: RGB; bg: RGB }> = { P0: { fg: C.redStrong, bg: C.redSoft }, P1: { fg: C.amberDark, bg: C.amberSoft }, P2: { fg: C.sky, bg: C.navySoft } };
  l.table({
    columns: [
      { header: "Prioridade", width: 0.8, align: "center" },
      { header: "Ação", width: 4 },
      { header: "Efeito esperado", width: 2.6 },
    ],
    rows: d.prescriptions.map((p) => [{ text: p.prioridade, chip: color[p.prioridade], align: "center" }, p.acao, p.efeito]),
    size: 7.4,
  });
}

// ─── 11 evolução e autenticação ──────────────────────────────────────────────────────────────

function evolucao(l: Layout, d: ProntuarioData): void {
  l.sectionTitle(11, "Evolução e autenticação", {
    lead: "Este prontuário é regenerado a cada emissão, com os dados do momento. Para acompanhar a evolução, compare emissões pelo número e pelo hash.",
    minSpace: 230,
  });
  l.bullets(
    [
      "Emitir: tela /admin do site (botão Gerar prontuário, carteira com papel administrativo) ou, no repositório, npm run prontuario.",
      "Premissas editáveis em web/src/lib/prontuario/premissas.ts (taxas candidatas, travas do investidor, custos da plataforma); cada mudança é refletida na próxima emissão.",
      `Os dados completos vão anexados a este PDF (${PRONTUARIO_ATTACHMENT}, JSON canônico); o SHA-256 abaixo é calculado sobre eles, excluídos o número, a data de emissão e o próprio hash.`,
    ],
    { size: 8.2, after: 8 },
  );
  l.subTitle("Impressão digital dos dados (SHA-256)");
  const groups = groupHex(d.dataHash, 8);
  l.ensure(30);
  l.rect(l.x0, l.y, l.width, 26, { fill: C.panel });
  l.text(groups.join(" "), l.x0 + 10, l.y + 16.5, { font: "mono", size: 8.6, color: C.navy });
  l.y += 36;
  l.subTitle("Responsáveis", { minSpace: 90 });
  l.ensure(70);
  const top = l.y + 40;
  const w = (l.width - 30) / 2;
  for (const [i, label] of ["Responsável técnico (modelo e dados)", "Diretoria da Aferi Capital"].entries()) {
    const x = l.x0 + i * (w + 30);
    l.line(x, top, x + w, top, { color: C.text, width: 0.6 });
    l.text(label, x, top + 11, { size: 7.4, color: C.muted });
    l.text("Data: ____/____/________", x, top + 22, { size: 7.4, color: C.muted });
  }
  l.y = top + 34;
  l.caption("Documento gerado automaticamente. Projeções não são promessa de rentabilidade; o modelo exige revisão humana e validação jurídica e contábil antes de qualquer uso externo.");
}

// ─── anexos ──────────────────────────────────────────────────────────────────────────────────

function anexos(l: Layout, d: ProntuarioData): void {
  l.sectionTitle("A.", "Anexo: premissas da plataforma", { lead: "Estimativas de mercado para uma operação enxuta no Brasil; confirmar com o plano de negócios e o contador.", minSpace: 260 });
  const k = d.costs;
  l.table({
    columns: [
      { header: "Premissa", width: 3.4, font: "semibold" },
      { header: "Valor", width: 1.6, align: "right" },
    ],
    rows: [
      ...k.fixedBreakdown.map((f) => [f.item, `${fmtBRL(f.annualBRL, 0)}/ano`]),
      [{ text: "Custos fixos totais", font: "bold" }, { text: `${fmtBRL(k.fixedAnnualBRL, 0)}/ano`, font: "bold" }],
      ["Custo por oferta (SPE, due diligence, avaliação, lançamento)", fmtBRL(k.perOfferingBRL, 0)],
      ["KYC/AML e cadastro, por investidor", fmtBRL(k.perInvestorBRL, 0)],
      ["Custo de aquisição, por investidor", fmtBRL(k.cacPerInvestorBRL, 0)],
      ["Ticket médio", fmtBRL(k.avgTicketBRL, 0)],
      ["Operação da SPE (cobrança e compensação de créditos)", `${fmtPct(k.speOperationPctRevenue, 0)} da receita + ${fmtBRL(k.speFixedAnnualBRL, 0)}/ano`],
      ["Tributos sobre a receita de serviços", fmtPct(k.taxOnFeesPct, 2)],
      ["Taxa de originação (patrocinador)", fmtBRL(k.originationFeeBRL, 0)],
      ["Trava: prêmio mínimo da TIR P50 sobre o CDI médio", `${fmtNum(d.guardrails.minIrrSpreadOverCdiPp, 0)} p.p.`],
      ["Trava: TIR real no P90 acima da NTN-B", `${fmtNum(d.guardrails.minRealIrrP90OverNtnbPp, 0)} p.p.`],
      ["Trava: payback máximo do investidor", fmtYears(d.guardrails.maxPaybackYears, 0)],
      ["Trava: participação máxima da plataforma", fmtPct(d.guardrails.maxPlatformSharePct, 0)],
    ],
    size: 7.6,
  });
  l.sectionTitle("B.", "Anexo: glossário", { minSpace: 200 });
  l.definitionGrid(
    [
      { label: "TIR", value: "Taxa interna de retorno: a taxa anual que zera o VPL dos fluxos." },
      { label: "VPL", value: "Valor presente líquido dos fluxos, à taxa de desconto nominal." },
      { label: "P50 / P90", value: "Geração anual excedida em 50 % / 90 % dos anos." },
      { label: "Hurdle", value: "Retorno preferencial do investidor (IPCA + h) antes da performance." },
      { label: "Take rate", value: "Receita recorrente da plataforma ÷ capital captado, ao ano." },
      { label: "Participação", value: "Fatia do caixa da usina que fica com a plataforma no horizonte." },
      { label: "Escrow", value: "Custódia do dinheiro no contrato até o resultado da oferta." },
      { label: "SPE", value: "Sociedade de propósito específico, dona da usina." },
      { label: "Fio B", value: "Parcela da tarifa de distribuição cobrada da geração distribuída (Lei 14.300)." },
    ],
    { cols: 3, valueSize: 7.8 },
  );
}

// ─── cabeçalho e rodapé ──────────────────────────────────────────────────────────────────────

function chrome(l: Layout, d: ProntuarioData): void {
  const total = l.pages.length;
  l.pages.forEach((page, i) => {
    l.page = page;
    l.rect(0, 0, PAGE.width, PAGE.headerHeight, { fill: C.navy });
    l.rect(0, PAGE.headerHeight, PAGE.width, 1.6, { fill: C.amber });
    const cy = PAGE.headerHeight / 2;
    drawLogo(l, PAGE.marginX, cy);
    l.text(`${PRONTUARIO_TITLE} · Nº ${d.id}`, PAGE.marginX + 90, cy + 2.6, { size: 7.2, color: C.headerMuted, align: "right", width: PAGE.width - 2 * PAGE.marginX - 90, truncate: true });
    const fy = PAGE.height - 30;
    l.line(PAGE.marginX, fy, PAGE.width - PAGE.marginX, fy, { color: C.border, width: 0.6 });
    l.text(`Nº ${d.id}  ·  Emitido em ${fmtDateTime(d.issuedAt, true)}  ·  SHA-256 ${shortHash(d.dataHash)}`, PAGE.marginX, fy + 12, {
      size: 6.5,
      color: C.muted,
      width: PAGE.width - 2 * PAGE.marginX - 150,
      truncate: true,
    });
    const pageLabel = `${i + 1} / ${total}`;
    const pw = l.textWidth(pageLabel, "semibold", 7.2);
    l.text(pageLabel, PAGE.width - PAGE.marginX - pw, fy + 12, { font: "semibold", size: 7.2, color: C.navy });
    l.chip("CONFIDENCIAL", PAGE.width - PAGE.marginX - pw - 8, fy + 5.2, C.redStrong, C.redSoft, 5.8, "right", 0);
  });
}

function drawLogo(l: Layout, x: number, cy: number): void {
  const h = 10;
  l.line(x + 1, cy + h / 2, x + 5.5, cy - h / 2, { color: C.white, width: 2.2, round: true });
  l.line(x + 5.5, cy - h / 2, x + 10, cy + h / 2, { color: C.white, width: 2.2, round: true });
  l.circle(x + 9.5, cy + 1.2, 2.6, { fill: C.green });
  l.text("Aferi", x + 15, cy + 3.4, { font: "bold", size: 9.6, color: C.white });
  const w = l.textWidth("Aferi", "bold", 9.6);
  l.text(" Capital", x + 15 + w, cy + 3.4, { font: "semibold", size: 9.6, color: C.green });
}
