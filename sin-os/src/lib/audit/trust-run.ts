import "server-only";
import type { SourceId, SourceResult } from "../sources/types";
import { loadTrustDays, saveRevisions, saveTrustDays } from "../store";
import { closedDates, diffDigest, digestSource, TRUST_SOURCES, type DayDigest, type Revision } from "./trust";

/**
 * Roda a verificação de revisões: para cada fonte monitorada, compara cada dia fechado dos
 * últimos 10 dias com a impressão digital guardada. Dia novo → guarda; dia igual → nada; dia
 * diferente → registra a revisão e passa a guardar a nova versão (a próxima revisão compara
 * com ela). Só dias completos entram como baseline.
 */
export async function runTrustCheck(results: Partial<Record<SourceId, SourceResult<unknown>>>, now = Date.now(), windowDays = 10): Promise<{ checked: number; stored: number; revisions: Revision[] }> {
  const revisions: Revision[] = [];
  const toSave: DayDigest[] = [];
  let checked = 0;
  for (const source of TRUST_SOURCES) {
    const r = results[source];
    if (!r?.ok || !r.data || r.simulated) continue;
    const digests = digestSource(source, r.data, now, windowDays);
    if (!digests.length) continue;
    const stored = await loadTrustDays(source, closedDates(now, windowDays));
    for (const cur of digests) {
      checked++;
      const prev = stored.get(cur.date);
      if (!prev) {
        if (cur.present >= cur.expected) toSave.push(cur); // baseline só com dia completo
        continue;
      }
      const rev = diffDigest(prev, cur, now);
      if (rev) {
        revisions.push(rev);
        toSave.push(cur);
      } else if (cur.present > prev.present) {
        toSave.push(cur); // lacuna preenchida sem mudar valores: atualiza o baseline
      }
    }
  }
  await saveTrustDays(toSave);
  await saveRevisions(revisions);
  return { checked, stored: toSave.length, revisions };
}
