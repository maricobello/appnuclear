import { publicForecast } from "@/lib/market/forecast";
import { errorResponse, getForecast, jsonResponse, SUB_PARAM } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const sub = SUB_PARAM(new URL(req.url).searchParams.get("sub"));
    const { fc, simulated, fallback } = await getForecast(sub);
    return jsonResponse({ ...publicForecast(fc), simulated, fallback }, 600);
  } catch (e) {
    return errorResponse(e);
  }
}
