import type { ReportContext } from "../context";
import { allProvenance } from "../context";
import { displayUrl, fmtDateTime, fmtNum, fmtPct } from "../format";
import { statusSummary } from "../insights";
import type { Cell, Run } from "../layout";
import { C, statusColors } from "../theme";
import { ILLUSTRATIVE_TEXT } from "./cover";

/** Referências normativas e bibliográficas (as APIs consultadas constam da tabela de procedência). */
export const REFERENCES: string[] = [
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
    minSpace: 120,
    lead: `Cada número tem origem rastreável. Nesta emissão: ${statusSummary(prov)}.`,
  });

  // ── procedência ──
  if (prov.length) {
    l.subTitle("Procedência dos dados", { minSpace: 60 });
    const rows: Cell[][] = prov.map((p) => {
      const st = statusColors(p.status);
      const isUrl = /^https?:\/\//i.test(p.url);
      return [
        { text: p.name + (p.note ? `\n${p.note}` : ""), font: "regular" },
        { text: st.label, chip: { fg: st.fg, bg: st.bg }, align: "center" },
        { text: fmtDateTime(p.fetchedAt) },
        { text: isUrl ? displayUrl(p.url) : p.url, color: isUrl ? C.sky : C.muted, link: isUrl ? p.url : undefined, size: 6.5, truncate: true },
      ];
    });
    l.table({
      columns: [
        { header: "Fonte", width: 3.45 },
        { header: "Status", width: 0.8, align: "center" },
        { header: "Consulta", width: 1.08 },
        { header: "Endereço consultado", width: 2.27 },
      ],
      rows,
      size: 7,
      padY: 2.2,
      after: 4,
    });
    l.caption(
      "AO VIVO: API respondeu nesta emissão · CACHE: resposta recente armazenada · FALLBACK: referência embarcada · ERRO: sem dado (valor do catálogo). Horário de Brasília.",
      { after: 8 },
    );
  }

  // ── metodologia econômica ──
  l.subTitle("Metodologia econômico-financeira", { minSpace: 80 });
  const f = a.finance;
  l.bullets(
    [
      "Fluxo anual nominal da SPE: energia P50 com degradação × tarifa compensada, deduzidos Fio B (Lei 14.300), desconto ao assinante, perdas de faturamento, tributos, opex e reposições.",
      `TIR pela raiz do VPL; TIR real deflacionada pelo IPCA de longo prazo; VPL a ${fmtPct(f.discountRatePct)} a.a.; payback por interpolação do saldo acumulado; LCOE = VP dos custos ÷ VP da energia.`,
      `Monte Carlo com ${fmtNum(f.monteCarlo.runs, 0)} cenários e semente fixa (${f.monteCarlo.seed}), reprodutível; sensibilidade com uma premissa por vez; benchmarks como taxas compostas no mesmo horizonte. Integridade: dataHash = SHA-256 do JSON canônico anexo (${ctx.attachmentName}).`,
    ],
    { size: 7.6, gap: 1.2, after: 4 },
  );

  // ── referências ──
  l.subTitle("Referências normativas e bibliográficas", { minSpace: 70 });
  REFERENCES.forEach((r, i) => {
    l.rich([{ text: `[${i + 1}] `, font: "semibold", color: C.navy }, { text: r, color: C.muted }], { size: 7.2, lineHeight: 1.3, after: 0.6 });
  });
  l.gap(3);

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
      { text: "O tratamento tributário dos rendimentos e de ganhos na alienação das cotas deve ser confirmado com contador; valores por cota são brutos de tributos do investidor." },
    ],
    [
      { text: "Riscos digitais. ", font: "semibold" },
      { text: "Tokens dependem de contratos inteligentes, da rede BNB Smart Chain, de stablecoins e da custódia de chaves privadas pelo investidor; perda de chaves ou falhas técnicas podem impedir o acesso às cotas e à receita." },
    ],
    [
      { text: "Dados de terceiros. ", font: "semibold" },
      { text: "Dados públicos coletados automaticamente podem conter erros ou atrasos; versão atual na página da usina." },
    ],
  );
  l.callout(items, { title: "AVISOS LEGAIS", accent: C.navy, bg: C.panel, size: 7.1, after: 6 });
}
