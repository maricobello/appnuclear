import { cached } from "../cache";
import { fetchJson } from "./http";
import type { Probe, Sub } from "./types";

/**
 * CKAN (usado por CCEE e ONS). Os recursos mudam de ID a cada ano; por isso
 * resolvemos dinamicamente via package_show em vez de fixar IDs no código.
 */
export interface CkanResource {
  id: string;
  name: string;
  url: string;
  format?: string;
  datastore_active?: boolean;
  last_modified?: string | null;
  created?: string;
}

interface CkanEnvelope<T> {
  success: boolean;
  result: T;
  error?: unknown;
}

export async function ckanPackage(base: string, pkg: string): Promise<{ resources: CkanResource[]; probes: Probe[] }> {
  const { value } = await cached(`ckan:${base}:${pkg}`, 6 * 3600_000, async () => {
    const { json, probes } = await fetchJson<CkanEnvelope<{ resources: CkanResource[] }>>(
      `${base}/package_show?id=${encodeURIComponent(pkg)}`,
    );
    if (!json.success || !Array.isArray(json.result?.resources)) {
      throw new Error(`CKAN package_show(${pkg}) sem recursos`);
    }
    return { resources: json.result.resources, probes };
  });
  return value;
}

export const resourceYear = (r: CkanResource): number | null => {
  const m = `${r.name} ${r.url}`.match(/(20\d{2})/g);
  return m ? Math.max(...m.map(Number)) : null;
};

/** Recursos ordenados do ano mais recente para o mais antigo. */
export function byYearDesc(resources: CkanResource[], filter: (r: CkanResource) => boolean = () => true) {
  return resources
    .filter(filter)
    .map((r) => ({ r, y: resourceYear(r) }))
    .filter((x): x is { r: CkanResource; y: number } => x.y !== null)
    .sort((a, b) => b.y - a.y || (b.r.last_modified ?? "").localeCompare(a.r.last_modified ?? ""));
}

export interface DatastoreResult {
  records: Record<string, unknown>[];
  fields?: { id: string; type: string }[];
  total?: number;
}

export async function datastoreSearch(base: string, resourceId: string, limit: number, sort = "_id desc") {
  const url = `${base}/datastore_search?resource_id=${resourceId}&limit=${limit}&sort=${encodeURIComponent(sort)}`;
  const { json, probes } = await fetchJson<CkanEnvelope<DatastoreResult>>(url, { timeoutMs: 30_000 });
  if (!json.success) throw new Error(`datastore_search falhou para ${resourceId}`);
  return { ...json.result, probes };
}

export function subOf(v: unknown): Sub | null {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return null;
  if (s === "SE" || s.startsWith("SUDESTE") || s === "SE/CO" || s === "SECO") return "SE";
  if (s === "S" || s === "SUL") return "S";
  if (s === "NE" || s.startsWith("NORDESTE")) return "NE";
  if (s === "N" || s === "NORTE") return "N";
  return null;
}

/** Busca chave de registro por padrões (tolerante a variações de caixa/nome). */
export function pickKey(record: Record<string, unknown>, ...patterns: RegExp[]): string | undefined {
  const keys = Object.keys(record);
  for (const p of patterns) {
    const k = keys.find((key) => p.test(key));
    if (k) return k;
  }
  return undefined;
}
