import { cached } from "../cache";
import { errMsg, fetchJson, probesOf } from "./http";
import { isoDay } from "./time";
import { emptyQuality, type Probe, type SourceResult, type TimeSeries } from "./types";

/**
 * Energy-Charts API (Fraunhofer ISE) — preços day-ahead das zonas de licitação
 * europeias (resolução de 15 min desde o MTU de 15 min do SDAC, out/2025). Sem chave.
 * Licença CC BY 4.0. https://api.energy-charts.info
 */
export const EC_BASE = "https://api.energy-charts.info";

export const EU_ZONES = [
  { bzn: "DE-LU", name: "Alemanha-Lux." },
  { bzn: "FR", name: "França" },
  { bzn: "NL", name: "Holanda" },
  { bzn: "BE", name: "Bélgica" },
  { bzn: "AT", name: "Áustria" },
  { bzn: "CH", name: "Suíça" },
  { bzn: "PL", name: "Polônia" },
  { bzn: "DK1", name: "Dinamarca O." },
  { bzn: "NO2", name: "Noruega S." },
  { bzn: "SE4", name: "Suécia S." },
  { bzn: "ES", name: "Espanha" },
  { bzn: "IT-North", name: "Itália N." },
] as const;

export interface EcPrice {
  unix_seconds: number[];
  price?: (number | null)[];
  data?: (number | null)[];
  unit?: string;
  license_info?: string;
}

export type ZonePrices = Record<string, TimeSeries & { name: string }>;

export async function fetchEuPrices(daysBack = 7): Promise<SourceResult<ZonePrices>> {
  const probes: Probe[] = [];
  const quality = emptyQuality();
  const start = isoDay(Date.now() - daysBack * 86400_000);
  const end = isoDay(Date.now() + 2 * 86400_000);
  const out: ZonePrices = {};
  const errors: string[] = [];
  await Promise.all(
    EU_ZONES.map(async (z) => {
      try {
        const { value } = await cached(`ec:${z.bzn}:${start}`, 5 * 60_000, () =>
          fetchJson<EcPrice>(`${EC_BASE}/price?bzn=${encodeURIComponent(z.bzn)}&start=${start}&end=${end}`),
        );
        probes.push(...value.probes);
        const j = value.json;
        const arr = j.price ?? j.data;
        if (!Array.isArray(j.unix_seconds) || !Array.isArray(arr) || arr.length !== j.unix_seconds.length) {
          quality.schemaIssues.push(`${z.bzn}: arrays unix_seconds/price ausentes ou desalinhados`);
          return;
        }
        const ts: number[] = [];
        const values: number[] = [];
        const seen = new Set<number>();
        j.unix_seconds.forEach((s, i) => {
          const v = arr[i];
          if (v === null || !Number.isFinite(v)) { quality.invalid++; return; }
          if (seen.has(s)) { quality.duplicates++; return; }
          seen.add(s);
          ts.push(s * 1000);
          values.push(v);
        });
        out[z.bzn] = { ts, values, unit: j.unit ?? "EUR/MWh", name: z.name };
      } catch (e) {
        probes.push(...probesOf(e));
        errors.push(`${z.bzn}: ${errMsg(e)}`);
      }
    }),
  );
  const zones = Object.values(out);
  if (!zones.length) {
    return { id: "energy_charts", ok: false, data: null, error: errors.join(" | ") || "sem dados", probes, quality, simulated: false, fetchedAt: Date.now() };
  }
  quality.points = zones.reduce((s, z) => s + z.values.length, 0);
  quality.latestTs = Math.max(...zones.map((z) => z.ts[z.ts.length - 1] ?? 0));
  quality.values = zones.flatMap((z) => z.values.slice(-96));
  quality.range = [-500, 4000]; // harmonised min/max clearing price SDAC
  if (errors.length) quality.schemaIssues.push(...errors.map((e) => `zona indisponível — ${e}`));
  return { id: "energy_charts", ok: true, data: out, probes, quality, simulated: false, fetchedAt: Date.now() };
}
