import { byYearDesc, ckanPackage, datastoreSearch, pickKey, subOf } from "./ckan";
import { num } from "./csv";
import { errMsg, probesOf } from "./http";
import { brtToUtc } from "./time";
import { PLD_LIMITS } from "../market/brazil";
import { emptyQuality, SUBS, type Probe, type SourceResult, type Sub, type SubPanel } from "./types";

/**
 * CCEE — Portal de Dados Abertos (CKAN): conjunto PLD_HORARIO.
 * PLD horário por submercado (R$/MWh), publicado em D−1 a partir do CMO do DESSEM
 * limitado pelo piso/teto regulatórios (ANEEL).
 * https://dadosabertos.ccee.org.br/dataset/pld_horario
 */
export const CCEE_BASE = "https://dadosabertos.ccee.org.br/api/3/action";

export async function fetchPldHourly(daysBack = 120): Promise<SourceResult<SubPanel>> {
  const probes: Probe[] = [];
  const quality = emptyQuality();
  try {
    const pkg = await ckanPackage(CCEE_BASE, "pld_horario");
    probes.push(...pkg.probes);
    const resources = byYearDesc(pkg.resources, (r) => r.datastore_active !== false);
    if (!resources.length) throw new Error("nenhum recurso anual com datastore ativo em pld_horario");

    const need = daysBack * 24 * 4;
    const records: Record<string, unknown>[] = [];
    for (const { r } of resources.slice(0, 2)) {
      const res = await datastoreSearch(CCEE_BASE, r.id, Math.min(32000, need - records.length));
      probes.push(...res.probes);
      records.push(...res.records);
      if (records.length >= need) break;
    }
    if (!records.length) throw new Error("datastore_search retornou 0 registros");

    const sample = records[0];
    const kMes = pickKey(sample, /^mes_referencia$/i, /^mes/i);
    const kSub = pickKey(sample, /^submercado$/i, /submerc/i);
    const kDia = pickKey(sample, /^dia$/i);
    const kHora = pickKey(sample, /^hora$/i, /^hr$/i);
    const kVal = pickKey(sample, /^pld_hora$/i, /^pld_horario$/i, /^pld$/i, /valor/i);
    const kData = pickKey(sample, /^data$/i, /^din_/i);
    for (const [name, k] of Object.entries({ SUBMERCADO: kSub, HORA: kHora, PLD_HORA: kVal })) {
      if (!k) quality.schemaIssues.push(`campo ausente: ${name}`);
    }
    if (!kData && !(kMes && kDia)) quality.schemaIssues.push("campos de data ausentes (MES_REFERENCIA/DIA ou DATA)");
    if (quality.schemaIssues.length) throw new Error(`schema inesperado: ${quality.schemaIssues.join("; ")}`);

    const map = new Map<number, Partial<Record<Sub, number>>>();
    for (const rec of records) {
      const sub = subOf(rec[kSub!]);
      const hora = num(rec[kHora!]);
      const val = num(rec[kVal!]);
      let ts = NaN;
      if (kMes && kDia) {
        const mes = String(rec[kMes]).replace(/\D/g, "");
        ts = brtToUtc(+mes.slice(0, 4), +mes.slice(4, 6), num(rec[kDia]), hora);
      } else if (kData) {
        const d = String(rec[kData]).slice(0, 10);
        ts = brtToUtc(+d.slice(0, 4), +d.slice(5, 7), +d.slice(8, 10), hora);
      }
      if (!sub || !Number.isFinite(ts) || !Number.isFinite(val)) {
        quality.invalid++;
        continue;
      }
      const row = map.get(ts) ?? {};
      if (row[sub] !== undefined) quality.duplicates++;
      row[sub] = val;
      map.set(ts, row);
    }
    const ts = [...map.keys()].sort((a, b) => a - b);
    const cutoff = ts[ts.length - 1] - daysBack * 86400_000;
    const keep = ts.filter((t) => t > cutoff);
    const panel: SubPanel = {
      ts: keep,
      values: Object.fromEntries(SUBS.map((s) => [s, keep.map((t) => map.get(t)?.[s] ?? null)])) as SubPanel["values"],
      unit: "R$/MWh",
    };
    quality.points = keep.length * 4;
    quality.expectedPoints = (Math.round((keep[keep.length - 1] - keep[0]) / 3600_000) + 1) * 4;
    quality.latestTs = keep[keep.length - 1];
    quality.values = SUBS.flatMap((s) => panel.values[s].slice(-168)).filter((v): v is number => v !== null);
    quality.range = [PLD_LIMITS.min - 0.5, PLD_LIMITS.maxHourly + 0.5];
    return { id: "ccee_pld", ok: true, data: panel, probes, quality, simulated: false, fetchedAt: Date.now() };
  } catch (e) {
    probes.push(...probesOf(e));
    return { id: "ccee_pld", ok: false, data: null, error: errMsg(e), probes, quality, simulated: false, fetchedAt: Date.now() };
  }
}
