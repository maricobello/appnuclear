import "server-only";
import { getPld, publicMeta } from "../data";
import { fetchCmoHourly } from "../sources/ons";
import { fetchBalance } from "../sources/ons-renewables";
import { fetchThermal } from "../sources/ons-thermal";
import { brtDate } from "../sources/time";
import { CCEE_VALIDATION, ESS_LABEL, REASONS, thermalReport } from "./thermal";

/**
 * Tela Térmicas & encargos: despacho térmico por motivo, pilha de mérito com o CMO e o ESS estimado
 * pela regra da CCEE, em R$ e em R$ por MWh consumido (carga do balanço do ONS nos mesmos dias).
 */
export async function buildThermalReport(days = 7, now = Date.now()) {
  const [th, pld, cmo, bal] = await Promise.all([fetchThermal(days + 2, now), getPld(days + 4), fetchCmoHourly(days + 4), fetchBalance(days + 2, now)]);
  const pldPanel = pld.ok && pld.data && !pld.simulated ? pld.data : null;
  const pldOfficial = !!pldPanel && !pld.fallback;
  const report = th.data ? thermalReport(th.data.rows, th.data.cvus, pldPanel, cmo.ok ? cmo.data : null, days) : null;

  // consumo dos mesmos dias (carga do balanço, MWh) para o ESS por MWh
  let loadMwh: number | null = null;
  if (report?.from && bal.data) {
    const set = new Set(report.days.map((d) => d.date));
    const hours = new Set<number>();
    let sum = 0;
    for (const r of bal.data) {
      if (!set.has(brtDate(r.ts)) || r.carga === null) continue;
      sum += r.carga;
      hours.add(r.ts);
    }
    loadMwh = hours.size === report.days.length * 24 ? sum : null;
  }

  const notes: string[] = [];
  if (pldPanel && !pldOfficial) notes.push("PLD estimado pelo CMO/DESSEM em parte da janela (a CCEE não responde ao servidor): o ESS usa esse PLD, como os boletins usados na validação.");
  if (!pldPanel) notes.push("PLD indisponível agora: o ESS não é estimado (os volumes por motivo continuam).");
  if (report?.checks.identityMaxGap !== null && report?.checks.identityMaxGap !== undefined && report.checks.identityMaxGap > 0.01)
    notes.push(`Em algum dia a soma dos motivos ficou ${(100 * report.checks.identityMaxGap).toFixed(1)}% diferente da geração total: o ONS pode ter reclassificado o despacho.`);
  notes.push("Usinas com CCEAR por disponibilidade na situação CMO > CVU > PLD são cobertas pela receita do contrato, não pelo ESS; por isso a geração por mérito acima do PLD não entra na conta.");

  return {
    generatedAt: now,
    days,
    meta: { termica: publicMeta(th), pld: publicMeta(pld), cmo: publicMeta(cmo), balanco: publicMeta(bal) },
    pldOfficial,
    reasons: REASONS.map((r) => ({ key: r.key, label: r.label, oom: r.oom, ess: r.ess })),
    essLabel: ESS_LABEL,
    report,
    loadMwh,
    essPerMwh: report && loadMwh ? report.totals.ess.total / loadMwh : null,
    validation: CCEE_VALIDATION,
    notes,
  };
}

export type ThermalReportResp = Awaited<ReturnType<typeof buildThermalReport>>;
