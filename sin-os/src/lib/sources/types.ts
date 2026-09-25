export type SourceId =
  | "ccee_pld"
  | "ons_cmo"
  | "ons_ear"
  | "ons_ena"
  | "ons_carga"
  | "energy_charts"
  | "elexon_mid"
  | "elexon_sysprice"
  | "uk_carbon"
  | "open_meteo"
  | "open_meteo_ens"
  | "bcb_fx"
  | "eia";

export type Region = "BR" | "EU" | "UK" | "US" | "GLOBAL";

export interface SourceMeta {
  id: SourceId;
  name: string;
  provider: string;
  region: Region;
  category: "preço" | "operação" | "hidrologia" | "clima" | "câmbio" | "carbono" | "combustíveis";
  endpoint: string;
  docs: string;
  license: string;
  cadence: string;
  /** Idade máxima aceitável da observação mais recente (horas). */
  freshnessSlaHours: number;
  requiresKey?: string;
  description: string;
}

export interface Probe {
  url: string;
  ok: boolean;
  status: number | null;
  latencyMs: number;
  bytes: number;
  at: number;
  error?: string;
}

export interface Quality {
  latestTs: number | null;
  points: number;
  expectedPoints?: number;
  duplicates: number;
  invalid: number;
  schemaIssues: string[];
  values?: number[];
  range?: [number, number];
}

export interface SourceResult<T> {
  id: SourceId;
  ok: boolean;
  data: T | null;
  error?: string;
  probes: Probe[];
  quality: Quality;
  simulated: boolean;
  /** Descrição do caminho de fallback usado, se houver. */
  fallback?: string;
  fetchedAt: number;
}

export const SUBS = ["SE", "S", "NE", "N"] as const;
export type Sub = (typeof SUBS)[number];

export const SUB_NAMES: Record<Sub, string> = {
  SE: "Sudeste/Centro-Oeste",
  S: "Sul",
  NE: "Nordeste",
  N: "Norte",
};

/** Série horária por submercado alinhada por timestamp (início da hora, UTC ms). */
export interface SubPanel {
  ts: number[];
  values: Record<Sub, (number | null)[]>;
  unit: string;
}

export interface DailySubPanel {
  dates: string[]; // YYYY-MM-DD (BRT)
  values: Record<Sub, (number | null)[]>;
  unit: string;
}

export interface TimeSeries {
  ts: number[];
  values: number[];
  unit: string;
}

export function emptyQuality(): Quality {
  return { latestTs: null, points: 0, duplicates: 0, invalid: 0, schemaIssues: [] };
}
