import { z } from "zod";
import { cached } from "@/lib/cache";
import { csvResponse, toCsv } from "@/lib/csv";
import { getBrazilBundle, getGlobalBundle, publicMeta } from "@/lib/data";
import { bessArbitrage, DEFAULT_BESS, euBattery, euBorders, globalLens, submarketSpreads } from "@/lib/market/arbitrage";
import { errorResponse, getForecast, jsonResponse, SUB_PARAM } from "@/lib/services";
import type { FxData } from "@/lib/sources/fx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SpecQuery = z.object({
  cap: z.coerce.number().min(1).max(5000).optional(),
  pow: z.coerce.number().min(0.5).max(2000).optional(),
  rte: z.coerce.number().min(0.5).max(0.99).optional(),
  deg: z.coerce.number().min(0).max(500).optional(),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sub = SUB_PARAM(url.searchParams.get("sub"));
    const q = SpecQuery.parse(Object.fromEntries(url.searchParams));
    const eta = q.rte ? Math.sqrt(q.rte) : DEFAULT_BESS.etaCharge;
    const spec = {
      ...DEFAULT_BESS,
      capacityMWh: q.cap ?? DEFAULT_BESS.capacityMWh,
      powerMW: q.pow ?? DEFAULT_BESS.powerMW,
      etaCharge: eta,
      etaDischarge: eta,
      degradationCost: q.deg ?? DEFAULT_BESS.degradationCost,
    };
    const [br, gl, { fc, simulated }] = await Promise.all([getBrazilBundle(), getGlobalBundle(), getForecast(sub)]);
    const key = `arb:${sub}:${fc.generatedAt}:${JSON.stringify(spec)}`;
    const { value } = await cached(key, 15 * 60_000, async () => ({
      bess: await bessArbitrage(fc, spec),
      spreads: br.pld.data ? submarketSpreads(br.pld.data, 30) : [],
      eu: gl.eu.data ? await euBattery(gl.eu.data) : [],
      borders: gl.eu.data ? euBorders(gl.eu.data) : [],
      lens: br.pld.data ? globalLens(br.pld.data, gl.eu.data, gl.ukMid.data, gl.fx.data as FxData | null) : [],
    }));
    if (url.searchParams.get("format") === "csv") {
      // despacho ótimo (LP) sobre E[preço]: MW > 0 = descarga, < 0 = carga
      const b = value.bess;
      const rows = b.schedule.map((r) => [new Date(r.ts).toISOString(), r.price.toFixed(2), r.mw.toFixed(3), (100 * r.soc).toFixed(1)]);
      const comment = `SIN OS - despacho BESS ${sub} ${spec.capacityMWh}MWh/${spec.powerMW}MW; intrinseco R$ ${b.intrinsicRS.toFixed(0)}; opcionalidade R$ ${b.extrinsicRS.toFixed(0)}${simulated ? " (previsao SIMULADA)" : ""}; gerado ${new Date().toISOString()}`;
      return csvResponse(toCsv(["timestamp_utc", "preco_esperado_rs_mwh", "potencia_liquida_mw", "soc_pct"], rows, comment), `despacho-${sub}`, 300);
    }
    return jsonResponse(
      {
        sub,
        generatedAt: Date.now(),
        forecastSimulated: simulated,
        meta: { pld: publicMeta(br.pld), eu: publicMeta(gl.eu), ukMid: publicMeta(gl.ukMid), fx: publicMeta(gl.fx) },
        ...value,
      },
      300,
    );
  } catch (e) {
    return errorResponse(e);
  }
}
