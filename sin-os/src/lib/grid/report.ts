import "server-only";
import { getPld, publicMeta } from "../data";
import { identityChecks, interchangeView } from "../market/interchange";
import { fetchBalance, fetchInterchange } from "../sources/ons-renewables";
import { brtDate } from "../sources/time";
import { GRID_STALE_DAYS, snapshotAgeDays } from "./snapshot";
import { loadGridSnapshot } from "./store";

/**
 * Tela Rede: intercâmbio medido × programado nas interligações (ONS, D−1) cruzado com o PLD dos
 * dois lados, e o retrato diário do fluxo de potência AC (worker com p3s), com a validação.
 */
export async function buildGridReport(days = 7, now = Date.now()) {
  const [ic, bal, pld, grid] = await Promise.all([
    fetchInterchange(days, now),
    fetchBalance(days, now),
    getPld(days + 2),
    loadGridSnapshot().catch(() => null),
  ]);
  const pldPanel = pld.ok && pld.data && !pld.simulated ? pld.data : null;
  const pldOfficial = !!pldPanel && !pld.fallback;
  const view = ic.data ? interchangeView(ic.data, pldPanel) : null;
  const identity = ic.data && bal.data ? identityChecks(ic.data, bal.data) : null;
  const snap = grid?.snapshot ?? null;
  const ageDays = snap ? snapshotAgeDays(snap.date, brtDate(now)) : null;

  const notes: string[] = [];
  if (pldPanel && !pldOfficial) notes.push("PLD estimado pelo CMO/DESSEM em parte da janela (a CCEE não responde ao servidor): o descolamento usa o CMO limitado ao piso e ao teto.");
  if (!pldPanel) notes.push("PLD indisponível agora: o intercâmbio aparece sem o descolamento de preço.");
  if (grid?.invalid) notes.push("O retrato guardado da rede está num formato antigo e foi ignorado; o próximo envio do worker o substitui.");

  return {
    generatedAt: now,
    days,
    meta: { intercambio: publicMeta(ic), balanco: publicMeta(bal), pld: publicMeta(pld) },
    pldOfficial,
    interchange: view,
    identity,
    grid: snap,
    gridHistory: grid?.history ?? [],
    gridReceivedAt: grid?.receivedAt ?? null,
    gridAgeDays: ageDays,
    gridStale: ageDays === null || ageDays > GRID_STALE_DAYS,
    notes,
  };
}

export type GridReport = Awaited<ReturnType<typeof buildGridReport>>;
