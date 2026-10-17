import type { SourceMetaView } from "@/components/ui";
import type { Slo } from "./audit/slo";
import type { AgentReport, AuditRun } from "./audit/types";
import type { BorderSpread, EuZoneArb, GlobalLens, SpreadStat, StorageResult } from "./market/arbitrage";
import type { BessStudy } from "./market/bess-study";
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

/** /api/auditoria?lite=1 — o resumo que o menu lateral e a home usam. */
export interface AuditoriaLite {
  latest: { id: string; startedAt: number; overallScore: number; counts: AuditRun["counts"]; attention: string[] } | null;
  dataMode: string;
  storage: "firestore" | "memory";
  /** Erro do Firestore (ex.: cota diária esgotada); nulo quando saudável ou não configurado. */
  storageError: string | null;
}

export type BessResp = BessStudy & { meta: SourceMetaView; simulated: boolean; generatedAt: number };

export interface ConfiancaResp {
  generatedAt: number;
  windowDays: number;
  totalRevisions30d: number;
  seals: {
    source: string;
    name: string;
    provider: string;
    monitored: boolean;
    level: "alta" | "média" | "baixa" | "sem dado";
    revisions30d: number;
    reasons: string[];
    completeness: { days: number; completeDays: number; incomplete: string[] } | null;
    biggestRevision: { date: string; maxAbsDiff: number; maxRelDiff: number; changedPoints: number } | null;
  }[];
  recentRevisions: { source: string; date: string; detectedAt: number; changedPoints: number; maxAbsDiff: number; maxRelDiff: number; meanShift: number }[];
}

export type { RenewablesReport as RenovaveisResp } from "./market/renewables-report";
export type { GridReport as RedeResp } from "./grid/report";
export type { ThermalReportResp as TermicasResp } from "./market/thermal-report";
export type { PlanView as PlanejamentoResp } from "./planning/view";

export interface AlertasResp {
  generatedAt: number;
  day: string | null;
  pldOfficial: boolean;
  thresholds: { pldMax: number; spread: number; intraday: number; curtailFactor: number; curtailMinGWh: number };
  alerts: { id: string; rule: "pld_max" | "spread" | "intraday" | "curtailment"; title: string; text: string }[];
}

export interface RenovaveisHistoricoResp {
  generatedAt: number;
  months: {
    month: string;
    eolicaMWh: number;
    solarMWh: number;
    cappedMWh: number;
    bySub: Record<Sub, number>;
    byReason: Record<"REL" | "CNF" | "ENE", number>;
    days: number;
    computedAt: number;
    revision: { fromVersion: string; prevTotalMWh: number; detectedAt: number } | null;
  }[];
  /** Meses que não couberam no prazo desta resposta (calculados nas próximas). */
  missing?: number;
}

export type { RegimeBucket } from "./market/regime-backtest";
export interface RegimesResp {
  sub: Sub;
  from: string;
  to: string;
  days: number;
  overall: import("./market/regime-backtest").RegimeBucket;
  dm?: { statistic: number; pValue: number };
  buckets: import("./market/regime-backtest").RegimeBucket[];
  method: string;
  pldSource: string;
  computedAt: number;
}
