/**
 * PVGIS 5.3 (JRC/Comissão Europeia) — simulação de referência para validação cruzada do modelo.
 * https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/getting-started-pvgis/api-non-interactive-service_en
 *
 * Consulta PVcalc para 1 kWp com as perdas da usina (compostas, incluindo inversor), inclinação e
 * azimute convertidos (bússola → aspect 0 = Sul). Usina com seguidor de um eixo ⇒ opção
 * `inclined_axis=1&inclinedaxisangle=0` (eixo horizontal N-S). Base SARAH3; se a localização não
 * for coberta (4xx) ou a resposta vier fora do formato, repete com ERA5.
 *
 * Limitações do PVGIS a considerar na comparação: sem ganho bifacial, seguidor sem limite de
 * ângulo nem backtracking; perdas de temperatura, reflexão angular e espectro são do próprio PVGIS.
 * Falha ⇒ `null` (é só validação cruzada).
 */
import { z } from "zod";
import type { Plant, PvgisCrossCheck } from "@/lib/types";
import { DAY_SEC, SourceError, describeError, fetchJson, provenanceFromResult, warnSource, type SourceOptions } from "./http";
import { compassToPvgisAspect, compoundLossPct, fmtCoord, parseDecimal, round } from "./units";

const PVGIS_URL = "https://re.jrc.ec.europa.eu/api/v5_3/PVcalc";
export const PVGIS_REVALIDATE_SEC = 30 * DAY_SEC;
const PVGIS_TIMEOUT_MS = 10_000;

export type PvgisRadDatabase = "PVGIS-SARAH3" | "PVGIS-ERA5";
export type PvgisMode = "fixed" | "inclined_axis";

/** Perda do sistema (%) enviada ao PVGIS: perdas da usina + inversor (100 − eficiência europeia), compostas */
export function pvgisSystemLossPct(plant: Plant): number {
  const l = plant.tech.losses;
  const inverterLossPct = 100 - plant.tech.inverter.euroEfficiencyPct;
  return round(
    compoundLossPct([
      l.soilingPct,
      l.shadingPct,
      l.mismatchPct,
      l.dcWiringPct,
      l.acWiringPct,
      l.transformerPct,
      l.unavailabilityPct,
      inverterLossPct,
    ]),
    2,
  );
}

export function pvgisMode(plant: Plant): PvgisMode {
  return plant.tech.mounting === "single-axis" ? "inclined_axis" : "fixed";
}

export function pvgisUrl(plant: Plant, raddatabase: PvgisRadDatabase): string {
  const p = new URLSearchParams();
  p.set("lat", fmtCoord(plant.location.lat));
  p.set("lon", fmtCoord(plant.location.lon));
  p.set("peakpower", "1");
  p.set("loss", String(pvgisSystemLossPct(plant)));
  if (pvgisMode(plant) === "inclined_axis") {
    // eixo único horizontal (inclinação do eixo 0°) orientado N-S
    p.set("inclined_axis", "1");
    p.set("inclinedaxisangle", "0");
  } else {
    p.set("angle", String(plant.tech.tiltDeg));
    p.set("aspect", String(compassToPvgisAspect(plant.tech.azimuthDeg)));
  }
  p.set("mountingplace", "free");
  p.set("outputformat", "json");
  p.set("raddatabase", raddatabase);
  return `${PVGIS_URL}?${p.toString()}`;
}

// ─── Esquemas ───────────────────────────────────────────────────────────────────────────────

const looseNumber = z
  .union([z.number(), z.string()])
  .transform((v) => parseDecimal(v))
  .pipe(z.number());

const optionalMeta = z.union([z.number(), z.string()]).optional().catch(undefined);

export const pvgisResponseSchema = z.looseObject({
  inputs: z
    .looseObject({
      meteo_data: z
        .looseObject({ radiation_db: optionalMeta, year_min: optionalMeta, year_max: optionalMeta })
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
  outputs: z.looseObject({
    monthly: z.record(z.string(), z.unknown()),
    totals: z.record(z.string(), z.unknown()),
  }),
});
export type PvgisResponse = z.infer<typeof pvgisResponseSchema>;

const monthlySchema = z.array(z.looseObject({ month: looseNumber, E_m: looseNumber })).min(12);
const totalsSchema = z.looseObject({ E_y: looseNumber, SD_y: looseNumber.optional().catch(undefined) });

export interface ParsedPvgis {
  annualKWhPerKWp: number;
  monthlyKWhPerKWp: number[];
  interannualSdKWhPerKWp?: number;
  radiationDb?: string;
  period?: string;
}

/** Extrai E_y, E_m (12, jan..dez) e SD_y do bloco `fixed` ou `inclined_axis` */
export function parsePvgis(json: PvgisResponse, mode: PvgisMode): ParsedPvgis {
  const monthly = monthlySchema.safeParse(json.outputs.monthly[mode]);
  const totals = totalsSchema.safeParse(json.outputs.totals[mode]);
  if (!monthly.success || !totals.success) {
    throw new SourceError("schema", `saída "${mode}" ausente ou incompleta na resposta do PVGIS`);
  }
  const byMonth = new Map<number, number>();
  for (const row of monthly.data) byMonth.set(row.month, row.E_m);
  const months: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const v = byMonth.get(m);
    if (v === undefined || v < 0) throw new SourceError("schema", `PVGIS sem E_m para o mês ${m}`);
    months.push(v);
  }
  const annual = totals.data.E_y;
  if (!(annual > 0)) throw new SourceError("schema", "PVGIS com E_y inválido");
  const meteo = json.inputs?.meteo_data;
  const ymin = meteo?.year_min !== undefined ? String(meteo.year_min) : undefined;
  const ymax = meteo?.year_max !== undefined ? String(meteo.year_max) : undefined;
  return {
    annualKWhPerKWp: annual,
    monthlyKWhPerKWp: months,
    ...(totals.data.SD_y !== undefined ? { interannualSdKWhPerKWp: totals.data.SD_y } : {}),
    ...(meteo?.radiation_db !== undefined ? { radiationDb: String(meteo.radiation_db) } : {}),
    ...(ymin && ymax ? { period: `${ymin}–${ymax}` } : {}),
  };
}

/** Vale tentar a outra base de radiação? (localização fora da cobertura = 4xx, ou saída inesperada) */
function shouldTryEra5(e: unknown): boolean {
  return e instanceof SourceError && ((e.isClientError && e.status !== 429) || e.kind === "schema");
}

export async function getPvgisCrossCheck(plant: Plant, opts: SourceOptions = {}): Promise<PvgisCrossCheck | null> {
  const mode = pvgisMode(plant);
  const loss = pvgisSystemLossPct(plant);
  let sarahFailure: string | undefined;
  for (const db of ["PVGIS-SARAH3", "PVGIS-ERA5"] as const) {
    const url = pvgisUrl(plant, db);
    try {
      const res = await fetchJson(url, pvgisResponseSchema, {
        timeoutMs: PVGIS_TIMEOUT_MS,
        revalidateSec: PVGIS_REVALIDATE_SEC,
        ...opts,
      });
      const parsed = parsePvgis(res.data, mode);
      const radDb = parsed.radiationDb ?? db;
      const mount =
        mode === "inclined_axis"
          ? "seguidor de 1 eixo horizontal N-S (sem limite de ângulo/backtracking no PVGIS)"
          : `fixo, inclinação ${plant.tech.tiltDeg}°, aspect ${compassToPvgisAspect(plant.tech.azimuthDeg)}° (0 = Sul)`;
      const notes = [
        `1 kWp, ${mount}`,
        `perdas do sistema ${loss} % (compostas, inclui inversor; sem ganho bifacial)`,
        sarahFailure ? `SARAH3 indisponível (${sarahFailure}); usado ERA5` : undefined,
      ];
      return {
        annualKWhPerKWp: parsed.annualKWhPerKWp,
        monthlyKWhPerKWp: parsed.monthlyKWhPerKWp,
        ...(parsed.interannualSdKWhPerKWp !== undefined ? { interannualSdKWhPerKWp: parsed.interannualSdKWhPerKWp } : {}),
        provenance: provenanceFromResult(
          "pvgis-5.3",
          `PVGIS 5.3 (JRC) — ${radDb}${parsed.period ? ` ${parsed.period}` : ""}`,
          res,
          notes.filter(Boolean).join("; "),
        ),
      };
    } catch (e) {
      if (db === "PVGIS-SARAH3" && shouldTryEra5(e)) {
        sarahFailure = describeError(e);
        continue;
      }
      warnSource(`PVGIS (${plant.slug}, ${db}): ${describeError(e)}`);
      return null;
    }
  }
  return null;
}
