import "server-only";
import { curtRowFrom, monthAggregate, type CurtRow, type MonthAggregate, type Tech } from "../market/renewables";
import { loadDoc, saveDoc } from "../store";
import { curtailmentUrl, readParquet } from "./ons-renewables";
import { brtDate } from "./time";


export interface MonthDoc extends MonthAggregate {
  /** Last-Modified dos arquivos de eólica e solar no S3 quando o total foi calculado. */
  version: string;
  computedAt: number;
  /** Total anterior quando o ONS republicou o mês com números diferentes. */
  revision: { fromVersion: string; prevTotalMWh: number; detectedAt: number } | null;
}

const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

async function lastModified(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": "SIN-OS/1.0 (+https://github.com/maricobello/sinos)" }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
    return res.ok ? (res.headers.get("last-modified") ?? "sem-data") : null;
  } catch {
    return null;
  }
}

/**
 * Total de corte de um mês. Lê o cache persistente e só baixa os parquets de novo quando o ONS
 * republicou o arquivo (Last-Modified diferente) — e, nesse caso, registra quanto o total mudou.
 */
export async function curtailmentMonth(y: number, m: number): Promise<MonthDoc | null> {
  const id = ym(y, m);
  const [vE, vS] = await Promise.all([lastModified(curtailmentUrl("eolica", y, m)), lastModified(curtailmentUrl("solar", y, m))]);
  const prev = await loadDoc<MonthDoc>("curtail_months", id).catch(() => null);
  if (!vE && !vS) return prev; // ONS fora: o último total conhecido continua valendo
  const version = `${vE ?? "-"}|${vS ?? "-"}`;
  if (prev && prev.version === version) return prev;
  const rows: CurtRow[] = [];
  for (const tech of ["eolica", "solar"] as Tech[]) {
    if (!(tech === "eolica" ? vE : vS)) continue;
    const { rows: raw } = await readParquet(curtailmentUrl(tech, y, m));
    for (const o of raw) {
      const r = curtRowFrom(o, tech);
      if (r) rows.push(r);
    }
  }
  const agg = monthAggregate(id, rows);
  const total = agg.eolicaMWh + agg.solarMWh;
  const prevTotal = prev ? prev.eolicaMWh + prev.solarMWh : null;
  const doc: MonthDoc = {
    ...agg,
    version,
    computedAt: Date.now(),
    revision: prev && prevTotal !== null && Math.abs(total - prevTotal) > 1 ? { fromVersion: prev.version, prevTotalMWh: prevTotal, detectedAt: Date.now() } : (prev?.revision ?? null),
  };
  await saveDoc("curtail_months", id, doc).catch(() => undefined);
  return doc;
}

/** Últimos `months` meses (inclui o corrente, parcial), em ordem cronológica; 3 meses por vez. */
export async function curtailmentHistory(months = 12, now = Date.now()): Promise<MonthDoc[]> {
  const [y0, m0] = brtDate(now).split("-").map(Number);
  const list = Array.from({ length: months }, (_, k) => {
    const t = y0 * 12 + (m0 - 1) - (months - 1 - k);
    return { y: Math.floor(t / 12), m: (t % 12) + 1 };
  });
  const out: (MonthDoc | null)[] = [];
  for (let i = 0; i < list.length; i += 3) out.push(...(await Promise.all(list.slice(i, i + 3).map(({ y, m }) => curtailmentMonth(y, m).catch(() => null)))));
  return out.filter((x): x is MonthDoc => !!x);
}
