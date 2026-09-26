import { runSelfEval } from "@/lib/audit/selfeval";

export const dynamic = "force-dynamic";

/**
 * Auto-avaliação da camada determinística do auditor: injeta falhas conhecidas e mede se a
 * classificação (ok/degraded/down) bate com o esperado. Retorna 200 se precisão/recall macro
 * ≥ 0,9, senão 500 — assim o smoke pega uma regressão na lógica de auditoria.
 */
export async function GET() {
  const r = runSelfEval();
  const good = r.precisionMacro >= 0.9 && r.recallMacro >= 0.9;
  return Response.json(r, { status: good ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}
