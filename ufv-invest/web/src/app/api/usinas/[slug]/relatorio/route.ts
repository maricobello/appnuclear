import { NextResponse, type NextRequest } from "next/server";
import { getPlantAnalysis } from "@/lib/analysis";
import { readOnChainState } from "@/lib/web3/server";
import { rateLimit } from "@/lib/rateLimit";
import { renderAuditReport } from "@/lib/report";
import { siteUrl } from "@/lib/web3/chains";

export const maxDuration = 60;

/** Relatório de auditoria técnica e econômica em PDF (com o JSON canônico anexado). */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/usinas/[slug]/relatorio">) {
  const limited = rateLimit(req, "report", 10, 60_000);
  if (limited) return limited;
  const { slug } = await ctx.params;
  const analysis = await getPlantAnalysis(slug);
  if (!analysis) return NextResponse.json({ error: "usina não encontrada" }, { status: 404 });

  const onChain = await readOnChainState(slug).catch(() => null);
  const reportId = `UFV-${analysis.plant.token.symbol}-${analysis.generatedAt.slice(0, 10).replaceAll("-", "")}-${analysis.dataHash.slice(0, 8).toUpperCase()}`;
  const pdf = await renderAuditReport(analysis, { siteUrl, onChain, reportId });
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Data-Hash": analysis.dataHash,
    },
  });
}
