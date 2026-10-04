import { NextResponse, type NextRequest } from "next/server";
import { getPlant } from "@/data/plants";
import { buildLive } from "@/lib/analysis";
import { rateLimit } from "@/lib/rateLimit";
import { getLiveWeather } from "@/lib/sources";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/usinas/[slug]/ao-vivo">) {
  const limited = rateLimit(req, "live", 60, 60_000);
  if (limited) return limited;
  const { slug } = await ctx.params;
  const plant = getPlant(slug);
  if (!plant) return NextResponse.json({ error: "usina não encontrada" }, { status: 404 });
  const weather = await getLiveWeather(plant);
  return NextResponse.json(weather ? buildLive(plant, weather) : null, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=300" } });
}
