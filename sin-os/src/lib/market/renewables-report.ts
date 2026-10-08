import "server-only";
import { getPld, publicMeta } from "../data";
import { fetchBalance, fetchCurtailment } from "../sources/ons-renewables";
import { SUBS } from "../sources/types";
import { PLD_LIMITS } from "./brazil";
import { curtailmentSummary, curtailmentVsFloor, hourConventionCheck, netLoadSummary, pldHourlyProfile, REASON_LABEL } from "./renewables";

/** Relatório de renováveis: corte (curtailment), carga líquida e PLD na mesma janela de dias fechados. */
export async function buildRenewablesReport(days = 14, now = Date.now()) {
  const [curt, bal, pld] = await Promise.all([fetchCurtailment(days, now), fetchBalance(days, now), getPld(days + 2)]);
  const rows = curt.data ?? [];
  const summary = curt.data ? curtailmentSummary(rows, now, days) : null;
  const netLoad = bal.data ? netLoadSummary(bal.data, now, days) : null;
  const hourCheck = curt.data && bal.data ? hourConventionCheck(rows, bal.data, "NE") : null;
  const pldPanel = pld.ok ? pld.data : null;
  const pldOfficial = !!pldPanel && !pld.simulated && !pld.fallback;
  const vsPld = summary && pldPanel && !pld.simulated ? SUBS.map((s) => curtailmentVsFloor(rows, pldPanel, PLD_LIMITS.min, s)!) : null;
  const pldProfile = summary?.from && summary.to && pldPanel && !pld.simulated ? pldHourlyProfile(pldPanel, summary.from, summary.to) : null;

  const f = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const notes: string[] = [];
  if (summary && summary.quality.inflatedMWh > 0)
    notes.push(
      `${f(summary.quality.inflatedSharePct)}% do corte oficial (${f(summary.quality.inflatedMWh, 0)} MWh) é geração de referência acima da disponibilidade declarada do conjunto, em ${f(summary.quality.refAboveAvailIntervals, 0)} meias horas. Mostramos o oficial e o piso limitado à disponibilidade.`,
    );
  if (summary?.quality.methodMAE !== null && summary?.quality.methodMAE !== undefined)
    notes.push(
      summary.quality.methodMAE < 1
        ? "A geração não realizada apurada do ONS bate com referência − geração em todas as meias horas restritas: o método está reproduzido."
        : `A apurada do ONS difere de referência − geração em ${f(summary.quality.methodMAE, 2)} MW em média: o método pode ter mudado.`,
    );
  if (hourCheck)
    notes.push(
      hourCheck.ok
        ? `Convenção de hora validada: a meia hora H:MM pertence à hora H (correlação ${f(hourCheck.corrByLag["0"], 4)} com o balanço; ${f(hourCheck.corrByLag["1"], 3)} deslocando 1 h).`
        : `Alerta: a convenção de hora do ONS pode ter mudado (melhor alinhamento ${hourCheck.bestLag} h).`,
    );
  if (netLoad && netLoad.quality.identityBreaks > 0)
    notes.push(`${netLoad.quality.identityBreaks} hora(s) em que o balanço não fecha (geração − intercâmbio ≠ carga em mais de 1%).`);
  if (pldPanel && !pldOfficial) notes.push("PLD estimado pelo CMO/DESSEM em parte da janela (a CCEE não responde ao servidor): valores a PLD são aproximados.");
  notes.push("O corte por confiabilidade (REL) e por rede (CNF) pode ser contestado e ressarcido; a flag de dado inválido do ONS não é atualizada depois da contestação, então não a usamos.");

  return {
    generatedAt: now,
    days,
    meta: { curtailment: publicMeta(curt), balanco: publicMeta(bal), pld: publicMeta(pld) },
    pldOfficial,
    pldFloor: PLD_LIMITS.min,
    reasonLabel: REASON_LABEL,
    curtailment: summary,
    netLoad,
    hourCheck,
    vsPld,
    pldProfile,
    notes,
  };
}

export type RenewablesReport = Awaited<ReturnType<typeof buildRenewablesReport>>;
