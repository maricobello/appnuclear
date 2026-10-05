import type { ReportContext } from "../context";
import { allProvenance } from "../context";
import { displayUrl, fmtDateTime, fmtNum, fmtPct, truncateEnd } from "../format";
import { statusSummary } from "../insights";
import type { Cell, Run } from "../layout";
import { C, statusColors } from "../theme";
import { ILLUSTRATIVE_TEXT } from "./cover";

export const REFERENCES: string[] = [
  "NASA Prediction Of Worldwide Energy Resources (POWER) — Langley Research Center, climatologia e séries de irradiação e temperatura.",
  "PVGIS 5.3 — Joint Research Centre, Comissão Europeia: estimativa independente de geração fotovoltaica.",
  "Open-Meteo — APIs de previsão, arquivo histórico e elevação (modelos numéricos e Copernicus DEM).",
  "IBGE — API de Localidades e SIDRA (Censo Demográfico 2022, PIB dos Municípios).",
  "Banco Central do Brasil — SGS (Selic, CDI, IPCA) e Sistema de Expectativas de Mercado (Focus).",
  "Pereira, E. B. et al. Atlas Brasileiro de Energia Solar, 2ª ed. INPE, 2017.",
  "Lei nº 14.300/2022 — Marco legal da micro e minigeração distribuída; Resolução Normativa ANEEL nº 1.059/2023.",
  "Resolução CVM nº 88/2022 — ofertas públicas de distribuição por meio de plataforma de investimento participativo.",
  "IEC 61724-1:2021 — monitoramento de desempenho de sistemas fotovoltaicos (definição de PR).",
  "EIPs 1643 (gestão de documentos) e 2222 (funds distribution token); contratos OpenZeppelin.",
];

export function renderSources(ctx: ReportContext): void {
  const { l, a } = ctx;
  const prov = allProvenance(a);
  l.sectionTitle(8, "Fontes de dados, metodologia e avisos legais", {
    minSpace: 260,
    lead: `Cada número deste relatório tem origem rastreável. Nesta emissão: ${statusSummary(prov)}. Fontes em fallback usam valores de referência embarcados e estão sinalizadas.`,
  });

  // ── procedência ──
  if (prov.length) {
    l.subTitle("Procedência dos dados", { minSpace: 90 });
    const rows: Cell[][] = prov.map((p) => {
      const st = statusColors(p.status);
      const isUrl = /^https?:\/\//i.test(p.url);
      return [
        { text: p.name + (p.note ? `\n${p.note}` : ""), font: "regular" },
        { text: st.label, chip: { fg: st.fg, bg: st.bg }, align: "center" },
        { text: fmtDateTime(p.fetchedAt) },
        { text: truncateEnd(isUrl ? displayUrl(p.url) : p.url, 64), color: isUrl ? C.sky : C.muted, link: isUrl ? p.url : undefined, size: 6.5 },
      ];
    });
    l.table({
      columns: [
        { header: "Fonte", width: 2.7 },
        { header: "Status", width: 0.85, align: "center" },
        { header: "Consulta", width: 0.95 },
        { header: "Endereço consultado", width: 2.7 },
      ],
      rows,
      size: 7,
      padY: 3,
      after: 4,
    });
    l.caption(
      "AO VIVO: resposta da API nesta emissão; CACHE: resposta recente armazenada; FALLBACK: valor de referência embarcado (API indisponível); ERRO: sem dado da fonte (valor do catálogo usado e sinalizado). Horários de Brasília.",
      { after: 8 },
    );
  }

  // ── metodologia econômica ──
  l.subTitle("Metodologia econômico-financeira", { minSpace: 80 });
  const f = a.finance;
  l.bullets(
    [
      "Fluxo de caixa anual nominal da SPE: receita = energia P50 (com degradação) × tarifa compensada, deduzidos Fio B (Lei 14.300), desconto ao assinante e perdas de faturamento; menos tributos, opex e reposições.",
      `TIR pela raiz do VPL (bisseção); TIR real deflacionada pelo IPCA de longo prazo; VPL à taxa de ${fmtPct(f.discountRatePct)} a.a.; payback por interpolação linear do saldo acumulado.`,
      "LCOE = valor presente dos custos (investimento, opex e reposições) ÷ valor presente da energia gerada, à mesma taxa de desconto.",
      `Monte Carlo com ${fmtNum(f.monteCarlo.runs, 0)} cenários e semente fixa (${f.monteCarlo.seed}), reprodutível; sensibilidade variando uma premissa por vez em torno do caso base.`,
      "Benchmarks: taxas anuais compostas no mesmo horizonte, líquidas de IR quando aplicável; o investimento na usina assume reinvestimento à própria TIR.",
      `Integridade: dataHash = SHA-256 do JSON canônico (chaves ordenadas, sem espaços) da análise, excluindo condições ao vivo e horário de geração; o JSON acompanha este PDF como anexo (${ctx.attachmentName}).`,
    ],
    { size: 7.6, gap: 1.2, after: 4 },
  );

  // ── referências ──
  l.subTitle("Referências", { minSpace: 70 });
  REFERENCES.forEach((r, i) => {
    l.rich([{ text: `[${i + 1}] `, font: "semibold", color: C.navy }, { text: r, color: C.muted }], { size: 7.2, lineHeight: 1.35, after: 1 });
  });
  l.gap(6);

  // ── avisos legais ──
  const items: Run[][] = [];
  if (a.plant.illustrative) items.push([{ text: ILLUSTRATIVE_TEXT, font: "semibold", color: C.amberDark }]);
  items.push(
    [
      { text: "Não é recomendação de investimento. ", font: "semibold" },
      { text: "Este relatório tem caráter exclusivamente informativo e técnico; não constitui oferta, solicitação de oferta, recomendação ou consultoria de investimento." },
    ],
    [
      { text: "Resultados não garantidos. ", font: "semibold" },
      { text: "Rentabilidade passada ou projetada não garante resultados futuros. As projeções dependem de premissas sujeitas a incerteza (recurso solar, tarifas, regulação, custos, inadimplência) e podem não se realizar; há risco de perda parcial ou total do capital." },
    ],
    [
      { text: "Regulação CVM. ", font: "semibold" },
      { text: "Ofertas públicas de valores mobiliários no Brasil exigem registro ou dispensa de registro na Comissão de Valores Mobiliários (CVM). Ofertas de crowdfunding de investimento seguem a Resolução CVM 88/2022 e devem ser conduzidas por plataforma eletrônica de investimento participativo registrada na CVM; a plataforma deve operar por meio de intermediário autorizado pela CVM, com limites de captação e de investimento por investidor." },
    ],
    [
      { text: "Tributação. ", font: "semibold" },
      { text: "O tratamento tributário dos rendimentos e de eventuais ganhos na alienação das cotas (inclusive como criptoativos) deve ser confirmado com contador ou assessor tributário; os valores por cota apresentados são brutos de tributos do investidor." },
    ],
    [
      { text: "Riscos digitais. ", font: "semibold" },
      { text: "Tokens dependem de contratos inteligentes, da rede BNB Smart Chain, de stablecoins e da custódia de chaves privadas pelo investidor; perda de chaves ou falhas técnicas podem impedir o acesso às cotas e à receita." },
    ],
    [
      { text: "Dados de terceiros. ", font: "semibold" },
      { text: "Dados públicos são obtidos automaticamente e podem conter erros, revisões ou atrasos; o status de cada fonte está indicado acima. A UFV Invest não se responsabiliza por decisões tomadas exclusivamente com base neste documento." },
    ],
  );
  l.callout(items, { title: "AVISOS LEGAIS", accent: C.navy, bg: C.panel, size: 7.4, after: 6 });
  l.caption(
    `Relatório ${ctx.reportId} emitido em ${fmtDateTime(ctx.now, true)} a partir da análise de ${fmtDateTime(a.generatedAt, true)}. Versão mais recente: ${displayUrl(ctx.plantUrl)}.`,
    { after: 0 },
  );
}
