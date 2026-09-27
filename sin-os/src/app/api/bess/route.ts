import { z } from "zod";
import { cached } from "@/lib/cache";
import { getPld, publicMeta } from "@/lib/data";
import { bessStudy } from "@/lib/market/bess-study";
import { errorResponse, jsonResponse, SUB_PARAM } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Estudo do BESS no PLD real: despacho ótimo diário (HiGHS) nos últimos `days` dias do
 * submercado, receita, SOC, margem e modelo econômico (LCOS → CAPEX implícito → VPL, TIR,
 * payback, ROI) com cenários. Parâmetros validados; percentuais chegam em %.
 */
const Q = z.object({
  pow: z.coerce.number().min(1).max(2000).default(100),
  cap: z.coerce.number().min(1).max(8000).default(400),
  rte: z.coerce.number().min(50).max(99).default(88),
  deg: z.coerce.number().min(0).max(10).default(0.5),
  lcos: z.coerce.number().min(0).max(5000).default(312.45),
  wacc: z.coerce.number().min(0).max(30).default(10),
  life: z.coerce.number().min(5).max(40).default(20),
  opex: z.coerce.number().min(0).max(10).default(2),
  ref: z.coerce.number().min(0.25).max(3).default(1),
  maxc: z.coerce.number().min(0.25).max(3).default(1),
  days: z.coerce.number().int().min(30).max(365).default(365),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sub = SUB_PARAM(url.searchParams.get("sub"));
    const q = Q.parse(Object.fromEntries([...url.searchParams].filter(([k]) => k !== "sub")));
    const pld = await getPld(q.days + 30);
    if (!pld.data) throw new Error(pld.error ?? "PLD indisponível");
    const params = {
      sub,
      powerMW: q.pow,
      capacityMWh: q.cap,
      rte: q.rte / 100,
      degPctYear: q.deg,
      lcos: q.lcos,
      waccPct: q.wacc,
      lifeYears: q.life,
      opexPctCapex: q.opex,
      refCyclesPerDay: q.ref,
      maxCyclesPerDay: q.maxc,
      days: q.days,
    };
    const last = pld.data.ts[pld.data.ts.length - 1];
    const { value } = await cached(`bess:${last}:${JSON.stringify(params)}`, 15 * 60_000, () => bessStudy(pld.data!, params));
    return jsonResponse({ ...value, meta: publicMeta(pld), simulated: pld.simulated, generatedAt: Date.now() }, 300);
  } catch (e) {
    return errorResponse(e, e instanceof z.ZodError ? 400 : 502);
  }
}
