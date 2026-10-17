import { cvuRowFrom, THERMAL_COLUMNS, thermalRowFrom, type CvuRow, type ThermalRow } from "../market/thermal";
import { HttpError } from "./http";
import { ONS_S3 } from "./ons";
import { loadFiles, monthsFor, qualityOf, wrap } from "./ons-renewables";
import { VALID_RANGES } from "./ranges";
import type { Probe } from "./types";

/**
 * ONS — geração térmica por motivo do despacho (um parquet por mês, hora × usina, 49 colunas: lemos
 * só as usadas) e CVU das usinas por semana operativa do PMO (um parquet por ano).
 */
export const thermalUrl = (y: number, m: number) => `${ONS_S3}/geracao_termica_despacho_2_ho/GERACAO_TERMICA_DESPACHO-2_${y}_${String(m).padStart(2, "0")}.parquet`;
export const cvuUrl = (y: number) => `${ONS_S3}/cvu_usitermica_se/CVU_USINA_TERMICA_${y}.parquet`;

export interface ThermalData {
  rows: ThermalRow[];
  cvus: CvuRow[];
}

/** Despacho térmico dos últimos `days` dias e os CVUs das semanas que eles cobrem. */
export const fetchThermal = (days = 14, now = Date.now()) =>
  wrap<ThermalData>("ons_termica", async () => {
    const months = monthsFor(now, days);
    const urls = months.map(({ y, m }) => thermalUrl(y, m));
    const from = now - (days + 1) * 86400_000;
    const g = await loadFiles(urls, thermalRowFrom, `parquet:${urls.join("|")}`, THERMAL_COLUMNS);
    const years = [...new Set(months.map((x) => x.y))];
    const cv = await loadFiles(years.map(cvuUrl), cvuRowFrom, `parquet:${years.map(cvuUrl).join("|")}`);
    const rows = g.rows.filter((x) => x.ts >= from);
    const probes: Probe[] = [...g.probes, ...cv.probes];
    if (!rows.length) throw new HttpError("despacho térmico do ONS sem linhas na janela", probes);
    if (!cv.rows.length) throw new HttpError("CVU das térmicas indisponível", probes);
    // faixa e outliers sobre a geração térmica total do SIN por hora (série contínua)
    const byHour = new Map<number, number>();
    for (const r of rows) byHour.set(r.ts, (byHour.get(r.ts) ?? 0) + r.gen);
    const series = [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    return { data: { rows, cvus: cv.rows }, probes, quality: qualityOf(rows, g.invalid + cv.invalid, series, [...VALID_RANGES.ons_termica.range]) };
  });
