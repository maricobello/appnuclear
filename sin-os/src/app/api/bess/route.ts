import { z } from "zod";
import { publicMeta } from "@/lib/data";
import { BESS_QUERY, toBessParams } from "@/lib/market/bess-params";
import { errorResponse, getBessStudy, jsonResponse, SUB_PARAM } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Estudo do BESS no PLD real: despacho ótimo diário (HiGHS) nos últimos `days` dias do
 * submercado, receita, SOC, margem e modelo econômico (LCOS → CAPEX implícito → VPL, TIR,
 * payback, ROI) com cenários. Parâmetros validados; percentuais chegam em %.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sub = SUB_PARAM(url.searchParams.get("sub"));
    const q = BESS_QUERY.parse(Object.fromEntries([...url.searchParams].filter(([k]) => k !== "sub")));
    const { study, pld } = await getBessStudy(toBessParams(sub, q));
    return jsonResponse({ ...study, meta: publicMeta(pld), simulated: pld.simulated, generatedAt: Date.now() }, 300);
  } catch (e) {
    return errorResponse(e, e instanceof z.ZodError ? 400 : 502);
  }
}
