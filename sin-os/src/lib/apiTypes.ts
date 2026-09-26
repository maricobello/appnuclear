import type { SourceMetaView } from "@/components/ui";
import type { Slo } from "./audit/slo";
import type { AgentReport, AuditRun } from "./audit/types";
import type { BorderSpread, EuZoneArb, GlobalLens, SpreadStat, StorageResult } from "./market/arbitrage";
import type { ForecastResult } from "./market/forecast";
import type { FxData } from "./sources/fx";
import type { SourceMeta, Sub } from "./sources/types";
import type { CarbonNow } from "./sources/uk";
import type { BasinEnsemble } from "./sources/weather";

type SubVals = Record<Sub, (number | null)[]>;
export interface HourlyView { ts: number[]; values: SubVals; unit: string }

export interface BrasilResp {
  generatedAt: number;
  limits: { year: number; min: number; maxStructural: number; maxHourly: number; source: string };
  meta: Record<"pld" | "cmo" | "ear" | "ena" | "load", SourceMetaView>;
  kpis: { sub: Sub; now: number | null; at: number | null; dayAgo: number | null; todayAvg: number | null; tomorrowAvg: number | null; spark: (number | null)[] }[] | null;
  pld: HourlyView | null;
  aggregates: { dates: string[]; daily: SubVals; heatDates: string[]; heat: Record<Sub, (number | null)[][]> } | null;
  cmo: HourlyView | null;
  ear: { dates: string[]; values: SubVals; unit: string } | null;
  ena: { dates: string[]; values: SubVals; unit: string } | null;
  load: HourlyView | null;
}

export type PrevisaoResp = ForecastResult & { simulated: boolean; fallback: string | null };

export interface ArbitragemResp {
  sub: Sub;
  generatedAt: number;
  forecastSimulated: boolean;
  meta: Record<"pld" | "eu" | "ukMid" | "fx", SourceMetaView>;
  bess: StorageResult;
  spreads: SpreadStat[];
  eu: EuZoneArb[];
  borders: BorderSpread[];
  lens: GlobalLens[];
}

export interface GlobalResp {
  generatedAt: number;
  meta: Record<"eu" | "ukMid" | "ukSys" | "carbon" | "fx" | "eia", SourceMetaView>;
  eu: Record<string, { name: string; ts: number[]; values: number[] }> | null;
  euResolutionMin: number | null;
  ukMid: { ts: number[]; values: number[] } | null;
  ukSys: { ts: number[]; sbp: number[]; ssp: number[]; niv: number[] } | null;
  carbon: CarbonNow | null;
  fx: FxData | null;
  eia: { henryHub: { ts: number[]; values: number[] } | null; brent: { ts: number[]; values: number[] } | null } | null;
}

export interface ClimaResp {
  generatedAt: number;
  meta: Record<"weather" | "ensemble", SourceMetaView>;
  hubs: {
    id: string;
    name: string;
    role: string;
    sub: Sub;
    next24: { tempAvg: number; tempMax: number; windAvg: number; windCf: number; solarCf: number; precip: number; cdh: number };
    series: { ts: number[]; temp: number[]; windCf: number[]; solarCf: number[] };
    daily16: { dates: string[]; mm: number[] };
  }[];
  basins: BasinEnsemble[];
}

export interface AuditoriaResp {
  latest: AuditRun | null;
  history: { id: string; startedAt: number; overallScore: number; counts: AuditRun["counts"]; trigger: string }[];
  slo: Slo;
  reports: AgentReport[];
  registry: SourceMeta[];
  telemetry: { host: string; count: number; errors: number; p50: number; p95: number }[];
  storage: "firestore" | "memory";
  firebase: { configured: boolean; projectId: string | null; error: string | null };
  agent: { configured: boolean; model: string };
  alerts: { configured: boolean; destination: "ntfy" | "json" | null };
  auth: { required: boolean };
  dataMode: string;
}
