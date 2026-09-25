import "server-only";
import { cached } from "./cache";
import { getBrazilBundle } from "./data";
import { buildForecast, type ForecastInternal } from "./market/forecast";
import type { Sub } from "./sources/types";

/** Previsão cacheada por submercado; recalcula quando chega PLD novo ou a cada 30 min. */
export async function getForecast(sub: Sub, horizonDays = 7): Promise<{ fc: ForecastInternal; simulated: boolean; fallback: string | null }> {
  const br = await getBrazilBundle();
  const pld = br.pld.data;
  if (!pld) throw new Error(br.pld.error ?? "PLD indisponível");
  const lastTs = pld.ts[pld.ts.length - 1];
  const { value } = await cached(`fc:${sub}:${horizonDays}:${lastTs}:${br.pld.simulated}`, 30 * 60_000, async () =>
    buildForecast(pld, sub, horizonDays, 1000),
  );
  return { fc: value, simulated: br.pld.simulated, fallback: br.pld.fallback ?? null };
}

export const SUB_PARAM = (v: string | null): Sub => (v === "S" || v === "NE" || v === "N" ? v : "SE");

export function jsonResponse(data: unknown, sMaxAge = 60, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": `public, s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge * 5}` },
  });
}

export function errorResponse(e: unknown, status = 502) {
  return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status, headers: { "Cache-Control": "no-store" } });
}
