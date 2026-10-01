import { getGlobalBundle, publicMeta } from "@/lib/data";
import { mean } from "@/lib/quant/stats";
import { errorResponse, jsonResponse } from "@/lib/services";
import type { ZonePrices } from "@/lib/sources/europe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Agrega a resolução nativa (15 min) em horas para os gráficos. */
function hourly(zones: ZonePrices, from: number) {
  const out: Record<string, { name: string; ts: number[]; values: number[] }> = {};
  for (const [bzn, z] of Object.entries(zones)) {
    const acc = new Map<number, number[]>();
    z.ts.forEach((t, i) => {
      if (t < from) return;
      const h = Math.floor(t / 3600_000) * 3600_000;
      (acc.get(h) ?? acc.set(h, []).get(h)!).push(z.values[i]);
    });
    const ts = [...acc.keys()].sort((a, b) => a - b);
    out[bzn] = { name: z.name, ts, values: ts.map((t) => Math.round(mean(acc.get(t)!) * 100) / 100) };
  }
  return out;
}

export async function GET() {
  try {
    const g = await getGlobalBundle();
    const now = Date.now();
    const from = now - 3 * 86400_000;
    const cut = (s: { ts: number[]; values: number[] } | null, since: number) => {
      if (!s) return null;
      const idx = s.ts.map((t, i) => [t, i] as const).filter(([t]) => t >= since).map(([, i]) => i);
      return { ts: idx.map((i) => s.ts[i]), values: idx.map((i) => s.values[i]) };
    };
    return jsonResponse({
      generatedAt: now,
      meta: {
        eu: publicMeta(g.eu),
        ukMid: publicMeta(g.ukMid),
        ukSys: publicMeta(g.ukSys),
        carbon: publicMeta(g.carbon),
        fx: publicMeta(g.fx),
        eia: publicMeta(g.eia),
      },
      eu: g.eu.data ? hourly(g.eu.data, from) : null,
      euResolutionMin: g.eu.data ? Math.round(((Object.values(g.eu.data)[0]?.ts[1] ?? 0) - (Object.values(g.eu.data)[0]?.ts[0] ?? 0)) / 60_000) : null,
      ukMid: cut(g.ukMid.data, now - 2 * 86400_000),
      ukSys: g.ukSys.data
        ? { ts: g.ukSys.data.ts.slice(-96), sbp: g.ukSys.data.sbp.slice(-96), ssp: g.ukSys.data.ssp.slice(-96), niv: g.ukSys.data.niv.slice(-96) }
        : null,
      carbon: g.carbon.data,
      fx: g.fx.data,
      eia: g.eia.data
        ? { henryHub: cut(g.eia.data.henryHub, now - 90 * 86400_000), brent: cut(g.eia.data.brent, now - 90 * 86400_000) }
        : null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
