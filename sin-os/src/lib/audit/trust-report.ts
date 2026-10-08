import "server-only";
import { getBrazilBundle, publicMeta } from "../data";
import { fetchCurtailment } from "../sources/ons-renewables";
import { SOURCES } from "../sources/registry";
import type { SourceResult } from "../sources/types";
import { listRevisions } from "../store";
import { closedDates, completeness, digestSource, sealOf, TRUST_SOURCES, type Revision } from "./trust";

/** Selos de confiança por fonte (revisões dos últimos 30 dias + completude dos últimos 10 dias fechados). */
export async function buildTrustReport(now = Date.now()) {
  const [b, revisions, curt] = await Promise.all([getBrazilBundle(), listRevisions(now - 30 * 86400_000), fetchCurtailment(12, now)]);
  const dates = closedDates(now, 10);
  const sources: Record<(typeof TRUST_SOURCES)[number], SourceResult<unknown>> = { ccee_pld: b.pld, ons_cmo: b.cmo, ons_carga: b.load, ons_ear: b.ear, ons_ena: b.ena, ons_curtailment: curt };
  const seals = TRUST_SOURCES.map((id) => {
    const r = sources[id];
    const usable = r.ok && !!r.data && !r.simulated;
    const comp = usable ? completeness(digestSource(id, r.data, now, 10), dates, id) : null;
    const seal = sealOf(id, revisions, comp);
    const meta = publicMeta(r);
    // sem dado real nesta leitura não existe selo; PLD estimado pelo CMO não é o PLD oficial
    const reasons = usable && id === "ccee_pld" && meta.fallback ? [...seal.reasons, "PLD estimado pelo CMO do ONS nesta leitura (não é o oficial da CCEE)"] : seal.reasons;
    return { ...seal, reasons, level: (usable ? seal.level : "sem dado") as "alta" | "média" | "baixa" | "sem dado", name: SOURCES[id].name, provider: SOURCES[id].provider, meta, monitored: usable };
  });
  const recentRevisions: Revision[] = revisions.slice(0, 20);
  return { generatedAt: now, windowDays: 10, seals, recentRevisions, totalRevisions30d: revisions.length };
}
export type TrustReport = Awaited<ReturnType<typeof buildTrustReport>>;
