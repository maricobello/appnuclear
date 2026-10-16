import "server-only";
import { appendLog, snapshotForecast, type LoggedForecast } from "./audit/track-record";
import type { ForecastInternal } from "./market/forecast";
import type { Sub } from "./sources/types";
import { readDoc, saveDoc } from "./store";

/**
 * Um documento por submercado com os últimos dias (≈100 KB). Lê sempre fresco antes de acrescentar
 * (outra instância pode ter gravado outro dia): 1 leitura e 1 gravação por dia novo.
 */
const COLLECTION = "forecast_log";
type Log = { sub: Sub; items: LoggedForecast[] };
const done = new Set<string>();

/** Grava a previsão do primeiro dia previsto, se for a primeira daquele dia. Nunca lança. */
export async function logForecast(fc: ForecastInternal): Promise<void> {
  const key = `${fc.sub}:${fc.firstForecastDate}`;
  if (done.has(key)) return;
  done.add(key);
  try {
    const log = (await readDoc<Log>(COLLECTION, fc.sub)) ?? { sub: fc.sub, items: [] };
    const items = appendLog(log.items, snapshotForecast(fc));
    if (items) await saveDoc(COLLECTION, fc.sub, { sub: fc.sub, items });
  } catch {
    done.delete(key);
  }
}

export async function loadForecastLog(sub: Sub): Promise<LoggedForecast[]> {
  return ((await readDoc<Log>(COLLECTION, sub).catch(() => null)) ?? { items: [] }).items;
}
