import { enquadrar, parcelaNaoCompensada, type Modalidade } from "./rules";

/**
 * Viabilidade de um sistema de GD (economia, VPL, TIR, payback, LCOE) e análise de
 * contrato de assinatura com desconto ao longo da transição do Fio B. Premissas omitidas
 * recebem valores de referência explícitos na saída — nunca escondidos.
 */

const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;

export interface ViabilidadeEntrada {
  potenciaKwp: number;
  /** R$/kWh com tributos pagos hoje na fatura. */
  tarifaRsKwh: number;
  geracaoKwhKwpMes?: number;
  capexRsKwp?: number;
  omPctAno?: number;
  degradacaoPctAno?: number;
  /** Fio B sem tributos (R$/kWh); sem valor ⇒ 30% da tarifa sem tributos. */
  fioBRsKwh?: number;
  tributosPct?: number;
  /** Parte da geração consumida no instante (não passa pela rede, não paga Fio B). */
  simultaneidadePct?: number;
  reajustePctAno?: number;
  waccPctAno?: number;
  anos?: number;
  anoInicio?: number;
  dataProtocolo?: string;
  modalidade?: Modalidade;
  fonte?: string;
  trocaInversorAno?: number;
  trocaInversorPctCapex?: number;
}

export function npv(rate: number, flows: number[]): number {
  return flows.reduce((s, f, t) => s + f / (1 + rate) ** t, 0);
}

export function irr(flows: number[]): number | null {
  if (!(flows.some((f) => f < 0) && flows.some((f) => f > 0))) return null;
  let lo = -0.99;
  let hi = 2;
  let flo = npv(lo, flows);
  if (flo * npv(hi, flows) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid, flows);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

function payback(flows: number[], rate = 0): number | null {
  let acc = flows[0];
  for (let t = 1; t < flows.length; t++) {
    const d = flows[t] / (1 + rate) ** t;
    if (acc + d >= 0) return t - 1 + (d > 0 ? -acc / d : 0);
    acc += d;
  }
  return null;
}

export function viabilidade(e: ViabilidadeEntrada) {
  const premissas: string[] = [];
  const def = <T,>(v: T | undefined, d: T, label: string) => {
    if (v === undefined || v === null) {
      premissas.push(label);
      return d;
    }
    return v;
  };
  const anoInicio = e.anoInicio ?? new Date().getFullYear();
  const g = def(e.geracaoKwhKwpMes, 125, "geração de 125 kWh/kWp·mês (média Brasil; Sul ~110, Nordeste ~140)");
  const capexKwp = def(e.capexRsKwp, 3200, "CAPEX de R$ 3.200/kWp (referência de mercado; cote o seu)");
  const om = def(e.omPctAno, 1, "O&M de 1% do CAPEX ao ano") / 100;
  const deg = def(e.degradacaoPctAno, 0.5, "degradação de 0,5% ao ano") / 100;
  const trib = def(e.tributosPct, 25, "tributos (ICMS+PIS/Cofins) de 25% na tarifa") / 100;
  const sim = def(e.simultaneidadePct, 30, "simultaneidade de 30% (residencial; comércio diurno 50–70%)") / 100;
  const reaj = def(e.reajustePctAno, 5, "reajuste tarifário de 5% ao ano") / 100;
  const wacc = def(e.waccPctAno, 10, "taxa de desconto de 10% ao ano") / 100;
  const anos = Math.min(40, Math.max(5, e.anos ?? 25));
  const fioB0 = e.fioBRsKwh ?? 0.3 * e.tarifaRsKwh * (1 - trib);
  if (e.fioBRsKwh === undefined) premissas.push("Fio B estimado em 30% da tarifa sem tributos");
  const enq = enquadrar({ dataProtocolo: e.dataProtocolo, potenciaKw: e.potenciaKwp, fonte: e.fonte ?? "solar", modalidade: e.modalidade ?? "local" }, `${anoInicio}-01-01`);
  const capex = e.potenciaKwp * capexKwp;
  const flows = [-capex];
  const anual: { ano: number; geracaoKwh: number; economiaRs: number; fioBPct: number }[] = [];
  let genPv = 0;
  let costPv = capex;
  for (let y = 1; y <= anos; y++) {
    const ano = anoInicio + y - 1;
    const gen = e.potenciaKwp * g * 12 * (1 - deg) ** (y - 1);
    const tarifa = e.tarifaRsKwh * (1 + reaj) ** (y - 1);
    const fioB = fioB0 * (1 + reaj) ** (y - 1);
    const p = parcelaNaoCompensada(enq.enquadramento, ano, enq.transicaoAte).fioB;
    const custoCompensadaKwh = (p * fioB) / (1 - trib);
    const economia = gen * sim * tarifa + gen * (1 - sim) * (tarifa - custoCompensadaKwh);
    const omY = capex * om * (1 + reaj) ** (y - 1);
    const inv = y === (e.trocaInversorAno ?? 12) ? capex * ((e.trocaInversorPctCapex ?? 10) / 100) : 0;
    flows.push(economia - omY - inv);
    genPv += gen / (1 + wacc) ** y;
    costPv += (omY + inv) / (1 + wacc) ** y;
    anual.push({ ano, geracaoKwh: Math.round(gen), economiaRs: Math.round(economia), fioBPct: Math.round(p * 100) });
  }
  const tir = irr(flows);
  const out = {
    enquadramento: enq.enquadramento,
    capexRs: Math.round(capex),
    geracaoAno1Kwh: anual[0]?.geracaoKwh ?? 0,
    economiaAno1Rs: anual[0]?.economiaRs ?? 0,
    vplRs: Math.round(npv(wacc, flows)),
    tirPct: tir === null ? null : r1(tir * 100),
    paybackAnos: (() => {
      const v = payback(flows);
      return v === null ? null : r1(v);
    })(),
    paybackDescontadoAnos: (() => {
      const v = payback(flows, wacc);
      return v === null ? null : r1(v);
    })(),
    lcoeRsKwh: genPv > 0 ? r2(costPv / genPv) : null,
    marcos: anual.filter((a, i) => i === 0 || [5, 10, 15, 20, 25].includes(i + 1) || a.ano === 2028 || a.ano === 2029),
    premissas,
    avisos: enq.avisos,
  };
  return out;
}

export interface AssinaturaEntrada {
  /** Tarifa com tributos (R$/kWh). */
  tarifaRsKwh: number;
  descontoPct: number;
  creditosKwhMes: number;
  fioBRsKwh?: number;
  tributosPct?: number;
  anoInicio?: number;
  anos?: number;
  /** Quem paga à distribuidora o Fio B da energia compensada. */
  fioBPorConta?: "assinante" | "gerador";
  /** Desconto sobre a tarifa cheia ou sobre a tarifa já líquida do Fio B. */
  baseDesconto?: "tarifa_cheia" | "tarifa_liquida";
  dataProtocolo?: string;
}

/** Desconto efetivo do assinante ano a ano conforme o Fio B sobe (GD II). */
export function analisarAssinatura(e: AssinaturaEntrada) {
  const trib = (e.tributosPct ?? 25) / 100;
  const anoInicio = e.anoInicio ?? new Date().getFullYear();
  const fioB = e.fioBRsKwh ?? 0.3 * e.tarifaRsKwh * (1 - trib);
  const enq = enquadrar({ dataProtocolo: e.dataProtocolo }, `${anoInicio}-01-01`);
  const quem = e.fioBPorConta ?? "assinante";
  const base = e.baseDesconto ?? "tarifa_cheia";
  const d = e.descontoPct / 100;
  const anos: { ano: number; fioBPct: number; pagaGeradorRs: number; pagaDistribuidoraRs: number; economiaRs: number; descontoEfetivoPct: number }[] = [];
  for (let y = 0; y < Math.min(15, Math.max(1, e.anos ?? 6)); y++) {
    const ano = anoInicio + y;
    const p = parcelaNaoCompensada(enq.enquadramento, ano, enq.transicaoAte).fioB;
    const fioBKwh = (p * fioB) / (1 - trib);
    const semGd = e.creditosKwhMes * e.tarifaRsKwh;
    const precoBase = base === "tarifa_cheia" ? e.tarifaRsKwh : e.tarifaRsKwh - fioBKwh;
    const gerador = e.creditosKwhMes * precoBase * (1 - d);
    const distrib = quem === "assinante" ? e.creditosKwhMes * fioBKwh : 0;
    const economia = semGd - gerador - distrib;
    anos.push({ ano, fioBPct: Math.round(p * 100), pagaGeradorRs: r2(gerador), pagaDistribuidoraRs: r2(distrib), economiaRs: r2(economia), descontoEfetivoPct: r1((economia / semGd) * 100) });
  }
  const pior = anos.reduce((m, a) => (a.descontoEfetivoPct < m.descontoEfetivoPct ? a : m), anos[0]);
  return {
    enquadramentoUsina: enq.enquadramento,
    premissas: [
      ...(e.fioBRsKwh === undefined ? ["Fio B estimado em 30% da tarifa sem tributos"] : []),
      `Fio B por conta do ${quem}; desconto sobre a ${base === "tarifa_cheia" ? "tarifa cheia" : "tarifa líquida do Fio B"}`,
    ],
    porMes: anos,
    alerta: pior && pior.descontoEfetivoPct < e.descontoPct - 3 ? `o desconto efetivo cai para ${pior.descontoEfetivoPct}% em ${pior.ano} (contratado ${e.descontoPct}%) porque o Fio B sobe — negocie quem absorve` : null,
  };
}
