import { NextResponse, type NextRequest } from "next/server";
import { getPlantAnalysis } from "@/lib/analysis";
import { rateLimit } from "@/lib/rateLimit";

/** Análise completa em JSON (dados abertos: qualquer pessoa pode auditar os números). */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/usinas/[slug]/analise">) {
  const limited = rateLimit(req, "analysis", 30, 60_000);
  if (limited) return limited;
  const { slug } = await ctx.params;
  const analysis = await getPlantAnalysis(slug);
  if (!analysis) return NextResponse.json({ error: "usina não encontrada" }, { status: 404 });
  return NextResponse.json(analysis, { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=600" } });
}
