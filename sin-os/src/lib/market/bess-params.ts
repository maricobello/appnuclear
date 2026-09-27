import { z } from "zod";
import type { Sub } from "../sources/types";
import type { BessParams } from "./bess-study";

/**
 * Parâmetros do estudo BESS (query de /api/bess e ferramenta do assistente): mesmos
 * limites nos dois caminhos. Percentuais chegam em % (rte, deg, wacc, opex).
 */
export const BESS_QUERY = z.object({
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
export type BessQuery = z.infer<typeof BESS_QUERY>;

export const toBessParams = (sub: Sub, q: BessQuery): BessParams => ({
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
});
