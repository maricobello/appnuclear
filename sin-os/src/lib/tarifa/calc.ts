/**
 * Tarifa de energia por dentro: componentes homologados pela ANEEL (TE e TUSD abertas),
 * tarifa efetiva com tributos e a simulação da reforma tributária (CBS e IBS, EC 132/2023
 * e LC 214/2025). Funções puras: rodam no servidor, no navegador e nos testes.
 */

/** "457,17000000000002" → 457.17; ",00" → 0. */
export const num = (s: unknown): number => {
  if (typeof s === "number") return s;
  if (typeof s !== "string" || !s.trim()) return 0;
  const v = Number(s.trim().replace(/\./g, (m, i, all: string) => (all.includes(",") ? "" : m)).replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};

export type Grupo = "Energia" | "Fio B (distribuição)" | "Transmissão (Fio A)" | "Perdas e inadimplência" | "Encargos setoriais" | "Itaipu, Angra e nucleares" | "Subsídios e descontos" | "Outros";
export const GRUPOS: Grupo[] = ["Energia", "Fio B (distribuição)", "Transmissão (Fio A)", "Perdas e inadimplência", "Encargos setoriais", "Itaipu, Angra e nucleares", "Subsídios e descontos", "Outros"];

/** Componentes da base de componentes tarifários da ANEEL: rótulo e grupo. */
export const COMPONENTES: Record<string, [string, Grupo]> = {
  TE_ENERGIA: ["Energia comprada", "Energia"],
  TUSD_FioB: ["Fio B — remuneração, depreciação e O&M da distribuidora", "Fio B (distribuição)"],
  TUSD_RB: ["Rede básica (transmissão)", "Transmissão (Fio A)"],
  TUSD_CCT: ["Conexão às instalações de transmissão", "Transmissão (Fio A)"],
  TUSD_CUSD: ["Uso do sistema de outras distribuidoras", "Transmissão (Fio A)"],
  TUSD_FR: ["Rede de fronteira", "Transmissão (Fio A)"],
  TUSD_ONS: ["Operador Nacional (ONS)", "Transmissão (Fio A)"],
  TUSDG_T: ["TUSD de geração — transmissão", "Transmissão (Fio A)"],
  TUSDG_ONS: ["TUSD de geração — ONS", "Transmissão (Fio A)"],
  TUSD_PT: ["Perdas técnicas", "Perdas e inadimplência"],
  TUSD_PNT: ["Perdas não técnicas (furto e fraude)", "Perdas e inadimplência"],
  TUSD_RI: ["Receitas irrecuperáveis (inadimplência)", "Perdas e inadimplência"],
  TUSD_Per_RB_D: ["Perdas da rede básica na distribuição", "Perdas e inadimplência"],
  TE_Per_RB: ["Perdas da rede básica", "Perdas e inadimplência"],
  TUSD_CDE: ["CDE — Conta de Desenvolvimento Energético", "Encargos setoriais"],
  TUSD_CDE_COVID: ["CDE Covid (empréstimo da pandemia)", "Encargos setoriais"],
  TE_CDE_COVID: ["CDE Covid (empréstimo da pandemia)", "Encargos setoriais"],
  TE_CDE_GD: ["CDE — subsídio da geração distribuída", "Encargos setoriais"],
  TE_CDE_ELET: ["CDE Eletrobras (capitalização)", "Encargos setoriais"],
  TUSD_PROINFA: ["PROINFA", "Encargos setoriais"],
  TUSD_TFSEE: ["TFSEE — taxa de fiscalização da ANEEL", "Encargos setoriais"],
  TUSD_PeD: ["P&D e eficiência energética", "Encargos setoriais"],
  TE_PeD: ["P&D e eficiência energética", "Encargos setoriais"],
  TUSD_CCC: ["CCC — Conta de Consumo de Combustíveis", "Encargos setoriais"],
  TUSD_CCD: ["CCD", "Encargos setoriais"],
  TUSD_RGR: ["RGR — Reserva Global de Reversão", "Encargos setoriais"],
  TE_ESSERR: ["ESS e EER — serviços do sistema e energia de reserva", "Encargos setoriais"],
  TE_CFURH: ["CFURH — compensação pelo uso de recursos hídricos", "Encargos setoriais"],
  "TUSD BENEFICIO_L14299": ["Benefício da Lei 14.299/2022", "Encargos setoriais"],
  TE_BENEFICIO_L14299: ["Benefício da Lei 14.299/2022", "Encargos setoriais"],
  TE_TRANSPORTE_ITAIPU: ["Transporte da energia de Itaipu", "Itaipu, Angra e nucleares"],
  TE_TUST_ITAIPU: ["Transmissão de Itaipu", "Itaipu, Angra e nucleares"],
  TE_TUST_CI: ["Transmissão de contratos de importação", "Itaipu, Angra e nucleares"],
  TE_ANGRA: ["Angra 1, 2 e 3 (nucleares)", "Itaipu, Angra e nucleares"],
  TUSD_SUBSIDIO: ["Subsídios cobertos pela CDE (TUSD)", "Subsídios e descontos"],
  TE_SUBSIDIO: ["Subsídios cobertos pela CDE (TE)", "Subsídios e descontos"],
  TUSD_Liminar: ["Efeito de liminares", "Outros"],
  TE_Liminar: ["Efeito de liminares", "Outros"],
  TUSD_OUTROS: ["Outros", "Outros"],
};

export interface ComponenteLinha {
  codigo: string;
  rotulo: string;
  grupo: Grupo;
  parcela: "TE" | "TUSD";
  valorMwh: number;
}

export interface Decomposicao {
  te: number | null;
  tusd: number | null;
  itens: ComponenteLinha[];
  grupos: { grupo: Grupo; te: number; tusd: number; total: number; pct: number }[];
  /** Diferença entre a soma dos componentes e a TE+TUSD homologada (deve ser ~0). */
  residuo: number | null;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Agrupa os componentes de uma combinação (subgrupo, modalidade, classe, posto) em R$/MWh. */
export function decompor(registros: { DscComponenteTarifario: string; VlrComponenteTarifario: unknown }[]): Decomposicao {
  let te: number | null = null;
  let tusd: number | null = null;
  const vistos = new Map<string, ComponenteLinha>();
  for (const r of registros) {
    const c = r.DscComponenteTarifario?.trim();
    const v = num(r.VlrComponenteTarifario);
    if (!c) continue;
    if (c === "TE") te = v;
    else if (c === "TUSD") tusd = v;
    else if (!vistos.has(c) && Math.abs(v) > 1e-9) {
      const [rotulo, grupo] = COMPONENTES[c] ?? [c.replace(/_/g, " "), "Outros" as Grupo];
      vistos.set(c, { codigo: c, rotulo, grupo, parcela: c.startsWith("TE") ? "TE" : "TUSD", valorMwh: r4(v) });
    }
  }
  const itens = [...vistos.values()].sort((a, b) => GRUPOS.indexOf(a.grupo) - GRUPOS.indexOf(b.grupo) || b.valorMwh - a.valorMwh);
  const total = (te ?? 0) + (tusd ?? 0) || itens.reduce((s, i) => s + i.valorMwh, 0);
  const grupos = GRUPOS.map((g) => {
    const its = itens.filter((i) => i.grupo === g);
    const gte = its.filter((i) => i.parcela === "TE").reduce((s, i) => s + i.valorMwh, 0);
    const gtu = its.filter((i) => i.parcela === "TUSD").reduce((s, i) => s + i.valorMwh, 0);
    return { grupo: g, te: r4(gte), tusd: r4(gtu), total: r4(gte + gtu), pct: total ? Math.round(((gte + gtu) / total) * 1000) / 10 : 0 };
  }).filter((g) => Math.abs(g.total) > 1e-6);
  const soma = itens.reduce((s, i) => s + i.valorMwh, 0);
  return { te, tusd, itens, grupos, residuo: te !== null && tusd !== null ? r4(soma - te - tusd) : null };
}

export interface Tributos {
  /** Frações: 0,18 = 18%. */
  icms: number;
  pis: number;
  cofins: number;
}

export interface Efetiva {
  semTributosKwh: number;
  icmsKwh: number;
  pisKwh: number;
  cofinsKwh: number;
  comTributosKwh: number;
  cargaPct: number;
}

/** Tarifa com tributos "por dentro" (como na fatura): base ÷ (1 − ICMS − PIS − Cofins). */
export function efetiva(teMwh: number, tusdMwh: number, bandeiraMwh: number, t: Tributos): Efetiva {
  const base = (teMwh + tusdMwh + bandeiraMwh) / 1000;
  const rate = t.icms + t.pis + t.cofins;
  const bruto = rate < 0.95 ? base / (1 - rate) : base;
  return {
    semTributosKwh: r4(base),
    icmsKwh: r4(bruto * t.icms),
    pisKwh: r4(bruto * t.pis),
    cofinsKwh: r4(bruto * t.cofins),
    comTributosKwh: r4(bruto),
    cargaPct: base ? Math.round(((bruto - base) / base) * 1000) / 10 : 0,
  };
}

/* ---------------------------------------------------- reforma tributária */

export interface PremissasReforma {
  /** Alíquotas de referência (frações). Estimativas: a definitiva sai por resolução do Senado. */
  cbsRef: number;
  ibsRef: number;
  icms: number;
  pis: number;
  cofins: number;
  /** ICMS entra na base do IBS/CBS? A LC 214/2025 exclui (conferir). */
  icmsNaBase: boolean;
}

export const PREMISSAS_PADRAO: PremissasReforma = { cbsRef: 0.088, ibsRef: 0.177, icms: 0.18, pis: 0.0105, cofins: 0.0484, icmsNaBase: false };

/** Calendário da transição (EC 132/2023, ADCT, e LC 214/2025). */
export const TRANSICAO: Record<number, { pisCofins: boolean; icmsFator: number; cbs: (ref: number) => number; ibs: (ref: number) => number; teste: boolean; nota: string }> = {
  2026: { pisCofins: true, icmsFator: 1, cbs: () => 0.009, ibs: () => 0.001, teste: true, nota: "ano de teste: CBS 0,9% e IBS 0,1% destacados e compensados com PIS/Cofins — sem custo novo" },
  2027: { pisCofins: false, icmsFator: 1, cbs: (r) => r - 0.001, ibs: () => 0.001, teste: false, nota: "PIS e Cofins extintos; CBS cheia (menos 0,1 p.p.) e IBS de 0,1%" },
  2028: { pisCofins: false, icmsFator: 1, cbs: (r) => r - 0.001, ibs: () => 0.001, teste: false, nota: "igual a 2027" },
  2029: { pisCofins: false, icmsFator: 0.9, cbs: (r) => r, ibs: (r) => r * 0.1, teste: false, nota: "ICMS a 90%; IBS a 10% da alíquota de referência" },
  2030: { pisCofins: false, icmsFator: 0.8, cbs: (r) => r, ibs: (r) => r * 0.2, teste: false, nota: "ICMS a 80%; IBS a 20%" },
  2031: { pisCofins: false, icmsFator: 0.7, cbs: (r) => r, ibs: (r) => r * 0.3, teste: false, nota: "ICMS a 70%; IBS a 30%" },
  2032: { pisCofins: false, icmsFator: 0.6, cbs: (r) => r, ibs: (r) => r * 0.4, teste: false, nota: "ICMS a 60%; IBS a 40%" },
  2033: { pisCofins: false, icmsFator: 0, cbs: (r) => r, ibs: (r) => r, teste: false, nota: "ICMS extinto; IBS cheio" },
};

export interface AnoReforma {
  ano: number;
  semTributosKwh: number;
  icmsKwh: number;
  pisCofinsKwh: number;
  cbsKwh: number;
  ibsKwh: number;
  /** O que o consumidor final paga por kWh. */
  totalKwh: number;
  cargaPct: number;
  /** Custo para empresa no regime regular: CBS/IBS viram crédito integral (e, hoje, PIS/Cofins não cumulativos). */
  liquidoEmpresaKwh: number;
  destaqueTesteKwh: number;
  nota: string;
}

/**
 * Tarifa por kWh em cada ano da transição. ICMS e PIS/Cofins "por dentro" (base ÷ (1 − soma));
 * CBS e IBS "por fora" sobre o valor sem esses tributos (não integram a própria base).
 */
export function simularReforma(baseMwh: number, p: PremissasReforma = PREMISSAS_PADRAO, anos = Object.keys(TRANSICAO).map(Number)): AnoReforma[] {
  const base = baseMwh / 1000;
  return anos.map((ano) => {
    const t = TRANSICAO[Math.min(2033, Math.max(2026, ano))];
    const icms = p.icms * t.icmsFator;
    const pc = t.pisCofins ? p.pis + p.cofins : 0;
    const bruto = base / (1 - icms - pc);
    const icmsKwh = bruto * icms;
    const pisCofinsKwh = bruto * pc;
    const baseIva = p.icmsNaBase ? base + icmsKwh : base;
    const cbs = t.cbs(p.cbsRef);
    const ibs = t.ibs(p.ibsRef);
    const cbsKwh = t.teste ? 0 : baseIva * cbs;
    const ibsKwh = t.teste ? 0 : baseIva * ibs;
    const total = bruto + cbsKwh + ibsKwh;
    return {
      ano,
      semTributosKwh: r4(base),
      icmsKwh: r4(icmsKwh),
      pisCofinsKwh: r4(pisCofinsKwh),
      cbsKwh: r4(cbsKwh),
      ibsKwh: r4(ibsKwh),
      totalKwh: r4(total),
      cargaPct: base ? Math.round(((total - base) / base) * 1000) / 10 : 0,
      liquidoEmpresaKwh: r4(total - cbsKwh - ibsKwh - pisCofinsKwh),
      destaqueTesteKwh: t.teste ? r4(baseIva * (cbs + ibs)) : 0,
      nota: t.nota,
    };
  });
}

/** ICMS modal sobre energia por UF (fração) — referência para começar; confira a lei do estado e a classe. */
export const ICMS_UF: Record<string, number> = {
  AC: 0.19, AL: 0.19, AM: 0.2, AP: 0.18, BA: 0.205, CE: 0.2, DF: 0.2, ES: 0.17, GO: 0.19, MA: 0.23, MG: 0.18, MS: 0.17, MT: 0.17, PA: 0.19, PB: 0.2, PE: 0.205, PI: 0.225, PR: 0.195, RJ: 0.2, RN: 0.2, RO: 0.195, RR: 0.2, RS: 0.17, SC: 0.17, SE: 0.19, SP: 0.18, TO: 0.2,
};
