/**
 * Relatório de Auditoria Técnica e Econômica (PDF) de uma usina — uso no servidor.
 *
 * Fontes Geist (OFL) lidas de `src/lib/report/fonts` via `process.cwd()`; incluir esse diretório
 * no `outputFileTracingIncludes` do Next.js para o deploy na Vercel.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { AFRelationship, PDFDocument } from "pdf-lib";
import QRCode from "qrcode";
import type { OnChainState, PlantAnalysis } from "@/lib/types";
import { canonicalAnalysisJson } from "./canonical";
import type { ReportContext, ReportVariant } from "./context";
import { compactDate, fmtDateTime, shortHash } from "./format";
import { Layout, type Fonts } from "./layout";
import { renderCover } from "./sections/cover";
import { renderLocation } from "./sections/location";
import { renderResource } from "./sections/resource";
import { renderGeneration } from "./sections/generation";
import { renderEconomics } from "./sections/economics";
import { renderRisk } from "./sections/risk";
import { renderTokenization } from "./sections/tokenization";
import { renderSources } from "./sections/sources";
import { renderResumoCover, renderResumoInvestment, renderResumoPlant, renderResumoToken } from "./sections/resumo";
import { C, PAGE } from "./theme";

export { canonicalAnalysisJson, canonicalJson } from "./canonical";
export type { ReportVariant } from "./context";

export const REPORT_TITLE = "Relatório de Auditoria Técnica e Econômica";
export const ATTACHMENT_NAME = "dados-analise.json";

export interface RenderAuditReportOptions {
  /** URL pública do site (sem barra final), ex.: https://ufv-invest.vercel.app */
  siteUrl: string;
  onChain?: OnChainState | null;
  /** identificador do relatório; padrão RA-<SÍMBOLO>-<aaaammdd>-<hash6> */
  reportId?: string;
  /** instante de emissão (padrão: agora) — útil para saídas determinísticas em testes */
  now?: Date;
  /** "resumo" (padrão, até 4 páginas para o investidor) ou "completo" (relatório técnico integral) */
  variant?: ReportVariant;
}

export const VARIANT_LABEL: Record<ReportVariant, string> = {
  resumo: "Resumo para o investidor",
  completo: "Versão completa",
};

/** Normaliza o parâmetro de URL `?versao=` (completa/completo → "completo"; qualquer outro → "resumo"). */
export function parseReportVariant(v: string | null | undefined): ReportVariant {
  return /^complet[ao]$/i.test((v ?? "").trim()) ? "completo" : "resumo";
}

// caminhos literais (escopo estático) para o rastreamento de arquivos do Next/Turbopack incluir
// só a pasta de fontes no deploy — ver outputFileTracingIncludes em next.config.ts
const FONT_FILES = {
  regular: "Geist-Regular.ttf",
  semibold: "Geist-SemiBold.ttf",
  bold: "Geist-Bold.ttf",
  mono: "GeistMono-Regular.ttf",
} as const;

type FontBytes = Record<keyof typeof FONT_FILES, Uint8Array>;
let fontBytesPromise: Promise<FontBytes> | null = null;

function loadFontBytes(): Promise<FontBytes> {
  if (!fontBytesPromise) {
    const dir = path.join(process.cwd(), "src/lib/report/fonts");
    fontBytesPromise = Promise.all(
      (Object.keys(FONT_FILES) as (keyof typeof FONT_FILES)[]).map(async (k) => [k, new Uint8Array(await readFile(path.join(/*turbopackIgnore: true*/ dir, FONT_FILES[k])))] as const),
    )
      .then((entries) => Object.fromEntries(entries) as FontBytes)
      .catch((err) => {
        fontBytesPromise = null;
        throw err;
      });
  }
  return fontBytesPromise;
}

export function defaultReportId(analysis: PlantAnalysis, now: Date): string {
  const sym = (analysis.plant.token?.symbol || analysis.plant.slug).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const h = (analysis.dataHash || "").replace(/^0x/, "").slice(0, 6).toUpperCase() || "000000";
  return `RA-${sym}-${compactDate(now)}-${h}`;
}

export async function renderAuditReport(
  analysis: PlantAnalysis,
  opts: RenderAuditReportOptions,
): Promise<Uint8Array> {
  const now = opts.now ?? new Date();
  const siteUrl = (opts.siteUrl || "").replace(/\/+$/, "");
  const plant = analysis.plant;
  const reportId = opts.reportId ?? defaultReportId(analysis, now);
  const variant: ReportVariant = opts.variant === "completo" ? "completo" : "resumo";
  const plantUrl = `${siteUrl}/usinas/${plant.slug}`;

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const bytes = await loadFontBytes();
  const fonts: Fonts = {
    regular: await pdf.embedFont(bytes.regular, { subset: true, features: { tnum: true } }),
    semibold: await pdf.embedFont(bytes.semibold, { subset: true, features: { tnum: true } }),
    bold: await pdf.embedFont(bytes.bold, { subset: true, features: { tnum: true } }),
    mono: await pdf.embedFont(bytes.mono, { subset: true }),
  };

  // ── metadados ──
  const title = `Relatório de Auditoria — ${plant.name}`;
  pdf.setTitle(title, { showInWindowTitleBar: true });
  pdf.setSubject(
    (variant === "resumo"
      ? `${REPORT_TITLE} da ${plant.name} (${plant.location.municipio}/${plant.location.uf}) — ${VARIANT_LABEL.resumo.toLowerCase()}: rentabilidade × Selic, simulação de investimento, usina, tokenização e avisos.`
      : `${REPORT_TITLE} da ${plant.name} (${plant.location.municipio}/${plant.location.uf}): recurso solar, geração P50/P90, análise econômica, riscos e tokenização.`) +
      (plant.illustrative ? " Projeto ilustrativo." : ""),
  );
  pdf.setAuthor("Aferi Capital");
  pdf.setCreator("Aferi Capital — gerador de relatórios de auditoria");
  pdf.setProducer("Aferi Capital (pdf-lib)");
  pdf.setLanguage("pt-BR");
  pdf.setKeywords([
    "Aferi Capital",
    "auditoria",
    "energia solar",
    "tokenização",
    "BNB Chain",
    plant.slug,
    plant.token.symbol,
    reportId,
    `versao:${variant}`,
    `sha256:${analysis.dataHash}`,
    analysis.dataHash,
  ]);
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);

  // ── anexo com os dados canônicos (permite recomputar o hash) ──
  const json = canonicalAnalysisJson(analysis);
  await pdf.attach(new TextEncoder().encode(json), ATTACHMENT_NAME, {
    mimeType: "application/json",
    description: "Dados canônicos da análise — SHA-256 = dataHash",
    creationDate: now,
    modificationDate: now,
    afRelationship: AFRelationship.Data,
  });

  // ── QR code para a página da usina ──
  let qr: ReportContext["qr"] = null;
  try {
    const png = await QRCode.toBuffer(plantUrl, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 0,
      width: 360,
      color: { dark: "#0B1F2AFF", light: "#FFFFFFFF" },
    });
    qr = await pdf.embedPng(new Uint8Array(png));
  } catch {
    qr = null;
  }

  const l = new Layout(pdf, fonts);
  const ctx: ReportContext = {
    a: analysis,
    l,
    siteUrl,
    plantUrl,
    onChain: opts.onChain ?? null,
    reportId,
    now,
    qr,
    attachmentName: ATTACHMENT_NAME,
    variant,
  };

  if (variant === "resumo") {
    renderResumoCover(ctx);
    renderResumoInvestment(ctx);
    renderResumoPlant(ctx);
    renderResumoToken(ctx);
  } else {
    renderCover(ctx);
    l.addPage();
    renderLocation(ctx);
    renderResource(ctx);
    renderGeneration(ctx);
    renderEconomics(ctx);
    renderRisk(ctx);
    renderTokenization(ctx);
    renderSources(ctx);
  }

  drawChrome(ctx);
  return pdf.save();
}

/** Cabeçalho e rodapé em todas as páginas (desenhados ao final para conhecer N). */
function drawChrome(ctx: ReportContext): void {
  const { l, a } = ctx;
  const total = l.pages.length;
  const hashShort = shortHash(a.dataHash || "");
  l.pages.forEach((page, i) => {
    l.page = page;
    const isCover = i === 0;
    // faixa superior
    l.rect(0, 0, PAGE.width, PAGE.headerHeight, { fill: C.navy });
    if (!isCover) l.rect(0, PAGE.headerHeight, PAGE.width, 1.6, { fill: C.amber });
    const cy = PAGE.headerHeight / 2;
    drawLogo(l, PAGE.marginX, cy);
    const headerTitle = ctx.variant === "resumo" ? `Relatório de Auditoria · ${VARIANT_LABEL.resumo}` : REPORT_TITLE;
    l.text(`${headerTitle} · ${a.plant.name}`, PAGE.marginX + 90, cy + 2.6, {
      size: 7.2,
      color: C.headerMuted,
      align: "right",
      width: PAGE.width - 2 * PAGE.marginX - 90,
      truncate: true,
    });

    // rodapé
    const fy = PAGE.height - 30;
    l.line(PAGE.marginX, fy, PAGE.width - PAGE.marginX, fy, { color: C.border, width: 0.6 });
    const left = `ID ${ctx.reportId}  ·  Emitido em ${fmtDateTime(ctx.now, true)}  ·  SHA-256 ${hashShort}`;
    l.text(left, PAGE.marginX, fy + 12, { size: 6.5, color: C.muted, width: PAGE.width - 2 * PAGE.marginX - 120, truncate: true });
    const pageLabel = `${i + 1} / ${total}`;
    const pw = l.textWidth(pageLabel, "semibold", 7.2);
    l.text(pageLabel, PAGE.width - PAGE.marginX - pw, fy + 12, { font: "semibold", size: 7.2, color: C.navy });
    if (a.plant.illustrative) {
      l.chip("PROJETO ILUSTRATIVO", PAGE.width - PAGE.marginX - pw - 8, fy + 5.2, C.amberDark, C.amberSoft, 5.8, "right", 0);
    }
  });
}

/** Marca "Aferi Capital" com um sol estilizado */
function drawLogo(l: Layout, x: number, cy: number): void {
  // marca Aferi Capital: "A" geométrico (traços) com folha verde
  const h = 10;
  l.line(x + 1, cy + h / 2, x + 5.5, cy - h / 2, { color: C.white, width: 2.2, round: true });
  l.line(x + 5.5, cy - h / 2, x + 10, cy + h / 2, { color: C.white, width: 2.2, round: true });
  l.circle(x + 9.5, cy + 1.2, 2.6, { fill: C.green });
  l.text("Aferi", x + 15, cy + 3.4, { font: "bold", size: 9.6, color: C.white });
  const w = l.textWidth("Aferi", "bold", 9.6);
  l.text(" Capital", x + 15 + w, cy + 3.4, { font: "semibold", size: 9.6, color: C.green });
}
