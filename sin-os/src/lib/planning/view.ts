import "server-only";
import { getPld, publicMeta } from "../data";
import { brtDate } from "../sources/time";
import { SUBS, type Sub } from "../sources/types";
import { PLAN_STALE_DAYS, planAgeDays } from "./report";
import { loadPlanReport } from "./store";

/**
 * Tela Planejamento: o último relatório do NovoModelo (worker no GitHub Actions) e, para comparar,
 * o PLD realizado de cada mês civil coberto pela janela do PLD horário (média até agora no mês corrente).
 */
export async function buildPlanView(now = Date.now()) {
  const [plan, pld] = await Promise.all([loadPlanReport().catch(() => null), getPld(70)]);
  const report = plan?.report ?? null;
  const panel = pld.ok && pld.data && !pld.simulated ? pld.data : null;
  const realized: { mes: string; horas: number; pld: Record<Sub, number | null> }[] = [];
  if (panel) {
    const byMonth = new Map<string, { n: number; sum: Record<Sub, number>; cnt: Record<Sub, number> }>();
    panel.ts.forEach((t, i) => {
      const m = brtDate(t).slice(0, 7);
      const acc = byMonth.get(m) ?? { n: 0, sum: { SE: 0, S: 0, NE: 0, N: 0 }, cnt: { SE: 0, S: 0, NE: 0, N: 0 } };
      acc.n++;
      for (const s of SUBS) {
        const v = panel.values[s][i];
        if (v !== null && Number.isFinite(v)) {
          acc.sum[s] += v;
          acc.cnt[s]++;
        }
      }
      byMonth.set(m, acc);
    });
    for (const [mes, a] of [...byMonth.entries()].sort()) {
      realized.push({ mes, horas: a.n, pld: Object.fromEntries(SUBS.map((s) => [s, a.cnt[s] ? Math.round((a.sum[s] / a.cnt[s]) * 100) / 100 : null])) as Record<Sub, number | null> });
    }
  }
  const ageDays = report ? planAgeDays(report, now) : null;
  const notes: string[] = [];
  if (plan?.invalid) notes.push("O relatório guardado está num formato antigo e foi ignorado; o próximo envio do worker o substitui.");
  if (!report) notes.push("Ainda não há relatório do planejamento: o worker diário (GitHub Actions) envia o primeiro depois de rodar.");
  if (panel && pld.fallback) notes.push("PLD realizado estimado pelo CMO/DESSEM em parte da janela (a CCEE não responde ao servidor).");
  return {
    generatedAt: now,
    report,
    history: plan?.history ?? [],
    receivedAt: plan?.receivedAt ?? null,
    ageDays,
    stale: ageDays === null || ageDays > PLAN_STALE_DAYS,
    realized,
    pldOfficial: !!panel && !pld.fallback,
    meta: { pld: publicMeta(pld) },
    notes,
  };
}

export type PlanView = Awaited<ReturnType<typeof buildPlanView>>;
