import { NextResponse, type NextRequest } from "next/server";
import { getPlantAnalysis } from "@/lib/analysis";
import { readOnChainState } from "@/lib/web3/server";
import { rateLimit } from "@/lib/rateLimit";
import { defaultReportId, parseReportVariant, renderAuditReport } from "@/lib/report";
import { siteUrl } from "@/lib/web3/chains";

export const maxDuration = 60;

/**
 * Cache do PDF por usina e versão (mesma análise = mesmo relatório): a geração custa ~1 s de CPU,
 * então requisições repetidas reaproveitam o arquivo enquanto o hash dos dados não mudar (máx. 15 min).
 */
const pdfCache = new Map<string, { at: number; dataHash: string; reportId: string; bytes: Uint8Array }>();
const PDF_TTL_MS = 15 * 60_000;

/**
 * Relatório de auditoria técnica e econômica em PDF (com o JSON canônico anexado).
 * Padrão: resumo para o investidor (até 4 páginas); `?versao=completa` devolve o relatório integral.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/usinas/[slug]/relatorio">) {
  const limited = rateLimit(req, "report", 10, 60_000);
  if (limited) return limited;
  const { slug } = await ctx.params;
  const analysis = await getPlantAnalysis(slug);
  if (!analysis) return NextResponse.json({ error: "usina não encontrada" }, { status: 404 });

  const variant = parseReportVariant(req.nextUrl.searchParams.get("versao"));
  const cacheKey = `${slug}:${variant}`;
  let entry = pdfCache.get(cacheKey);
  if (!entry || entry.dataHash !== analysis.dataHash || Date.now() - entry.at > PDF_TTL_MS) {
    const onChain = await readOnChainState(slug).catch(() => null);
    const reportId = defaultReportId(analysis, new Date());
    const bytes = await renderAuditReport(analysis, { siteUrl, onChain, reportId, variant });
    entry = { at: Date.now(), dataHash: analysis.dataHash, reportId, bytes };
    pdfCache.set(cacheKey, entry);
  }
  const { reportId, bytes: pdf } = entry;
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${reportId}-${variant}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Data-Hash": analysis.dataHash,
      "X-Report-Variant": variant,
    },
  });
}
