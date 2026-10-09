/**
 * Conversão de uma linha da planilha de usinas em um objeto `Plant` (src/lib/types.ts).
 * Sem dependências do app: roda no Node (importador) e nos testes (vitest).
 */
import { COLUNAS } from "./colunas.mjs";

export const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

/** nomes alternativos aceitos no cabeçalho */
const ALIAS = {
  preco_venda: "preco_venda_rs",
  preco_venda_r: "preco_venda_rs",
  preco_de_venda: "preco_venda_rs",
  preco_de_venda_r: "preco_venda_rs",
  valor_cota: "valor_cota_rs",
  valor_cota_r: "valor_cota_rs",
  ppa: "ppa_ativo",
  ppa_ativo_sim_nao: "ppa_ativo",
  ibge: "codigo_ibge",
  cidade: "municipio",
  lat: "latitude",
  lon: "longitude",
  kwp: "potencia_kwp",
  potencia_cc_kwp: "potencia_kwp",
  potencia_ca_kw: "potencia_kw_ca",
};
/** cabeçalho → id da coluna ("Potência kWp" → "potencia_kwp") */
export const headerId = (h) => {
  const id = norm(h).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return ALIAS[id] ?? id;
};

export const slugify = (s) =>
  norm(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

const SUBMERCADO = {
  N: ["AC", "AM", "AP", "PA", "RO", "RR", "TO"],
  NE: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
  S: ["PR", "RS", "SC"],
};
export function submercado(uf) {
  for (const [k, list] of Object.entries(SUBMERCADO)) if (list.includes(uf)) return k;
  return "SE/CO";
}

function num(v) {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  // aceita "1.234,56", "1234.56", "R$ 5.000.000", "20%"
  let s = String(v).replace(/[R$\s%]/g, "");
  if (/,\d{1,3}$/.test(s) || (s.includes(",") && s.includes("."))) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function bool(v) {
  const s = norm(v);
  if (!s) return undefined;
  if (["sim", "s", "yes", "y", "true", "1", "ativo", "x"].includes(s)) return true;
  if (["nao", "n", "no", "false", "0", "inativo"].includes(s)) return false;
  return null;
}
function date(v) {
  if (v === null || v === undefined || v === "") return undefined;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** Lê e valida os campos da linha; devolve { valores, erros } */
export function parseRow(raw, linha) {
  const byId = {};
  for (const [k, v] of Object.entries(raw)) byId[headerId(k)] = v;
  const out = {};
  const erros = [];
  for (const c of COLUNAS) {
    const v = byId[c.id];
    let val;
    if (c.tipo === "numero") val = num(v);
    else if (c.tipo === "simnao") val = bool(v);
    else if (c.tipo === "data") val = date(v);
    else val = v === null || v === undefined ? undefined : String(v).trim() || undefined;
    if (val === null || (typeof val === "number" && Number.isNaN(val))) erros.push(`linha ${linha}: "${c.id}" com valor inválido (${v})`);
    else if (c.tipo === "lista" && val !== undefined && !c.valores.includes(norm(val))) erros.push(`linha ${linha}: "${c.id}" deve ser ${c.valores.join(" ou ")}`);
    else if (c.obrig && (val === undefined || val === "")) erros.push(`linha ${linha}: coluna obrigatória "${c.id}" vazia`);
    out[c.id] = c.tipo === "lista" && val !== undefined ? norm(val) : val;
  }
  if (out.uf) out.uf = String(out.uf).toUpperCase();
  if (out.latitude !== undefined && (out.latitude < -34 || out.latitude > 6)) erros.push(`linha ${linha}: latitude fora do Brasil`);
  if (out.longitude !== undefined && (out.longitude < -74 || out.longitude > -34)) erros.push(`linha ${linha}: longitude fora do Brasil`);
  if (out.potencia_kwp !== undefined && out.potencia_kw_ca !== undefined && out.potencia_kwp / out.potencia_kw_ca > 1.6)
    erros.push(`linha ${linha}: razão CC/CA ${(out.potencia_kwp / out.potencia_kw_ca).toFixed(2)} acima de 1,6 — confira as potências`);
  return { valores: out, erros };
}

/** Climatologia genérica (só é usada se a NASA POWER não responder) */
function genericClimate(lat) {
  const base = [5.8, 6.0, 5.5, 5.2, 4.8, 4.6, 4.9, 5.6, 5.8, 5.9, 5.6, 5.7];
  const k = lat > -12 ? 1.03 : lat < -24 ? 0.9 : 1;
  const t = lat > -12 ? 27 : lat < -24 ? 19 : 23.5;
  const temps = [1, 1.2, 0.9, 0.2, -1.2, -2.4, -2.5, -1.2, 0.6, 1.2, 1, 0.9].map((d) => +(t + d).toFixed(1));
  return {
    ghiKWhM2Day: base.map((g) => +(g * k).toFixed(2)),
    tempC: temps,
    tempMaxC: temps.map((x) => +(x + 6).toFixed(1)),
    tempMinC: temps.map((x) => +(x - 6).toFixed(1)),
    windMs: [2.0, 1.9, 1.8, 1.9, 2.0, 2.2, 2.5, 2.7, 2.8, 2.5, 2.2, 2.0],
    interannualCvPct: 4,
    source: "Climatologia genérica por latitude — fallback do importador (a NASA POWER substitui em tempo real)",
  };
}

/** Monta o objeto Plant a partir dos valores validados */
export function buildPlant(v, { ibgeCode, fotos = [] }) {
  const slug = v.slug ? slugify(v.slug) : slugify(v.nome);
  const kwp = v.potencia_kwp;
  const wp = v.modulo_wp ?? 585;
  const preco = v.valor_cota_rs ?? 1000;
  const total = v.total_cotas ?? (v.preco_venda_rs ? Math.round(v.preco_venda_rs / preco) : Math.round((kwp * 1000 * 4.0) / preco));
  const startYear = Number((v.comissionamento ?? new Date().toISOString()).slice(0, 4));
  const tracker = v.estrutura === "seguidor";
  const ppaRevenue = v.modelo_receita === "ppa";
  if (ppaRevenue && !v.ppa_preco_mwh) throw new Error(`${v.nome}: modelo_receita "ppa" exige ppa_preco_mwh`);
  const invKw = v.inversor_kw ?? 250;
  return {
    slug,
    name: v.nome,
    tagline: v.descricao ?? `${v.municipio}/${v.uf} · ${(kwp / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MWp`,
    description: v.descricao ?? `Usina fotovoltaica em ${v.municipio}/${v.uf}, conectada à ${v.distribuidora}.`,
    about: v.sobre,
    status: v.status,
    illustrative: false,
    sponsor: { name: `SPE ${v.nome}` },
    location: { municipio: v.municipio, uf: v.uf, ibgeCode, lat: v.latitude, lon: v.longitude, distribuidora: v.distribuidora, submercado: submercado(v.uf) },
    tech: {
      dcKWp: kwp,
      acKW: v.potencia_kw_ca,
      module: {
        model: v.modulo_modelo ?? `Módulo ${wp} Wp`,
        wp,
        count: v.modulo_qtd ?? Math.round((kwp * 1000) / wp),
        gammaPmaxPctPerC: -0.32,
        noctC: 43,
        efficiencyPct: 22,
        bifacial: v.modulo_bifacial ?? false,
      },
      inverter: { model: v.inversor_modelo ?? `Inversor ${invKw} kW`, kw: invKw, count: v.inversor_qtd ?? Math.ceil(v.potencia_kw_ca / invKw), euroEfficiencyPct: 98.2 },
      mounting: tracker ? "single-axis" : "fixed",
      tiltDeg: tracker ? 0 : (v.inclinacao_graus ?? Math.round(Math.min(25, Math.max(10, Math.abs(v.latitude))))),
      azimuthDeg: 0,
      ...(tracker ? { trackerMaxAngleDeg: 55 } : {}),
      albedo: 0.2,
      losses: { soilingPct: 2.0, shadingPct: tracker ? 1.5 : 1.0, mismatchPct: 1.0, dcWiringPct: 1.5, acWiringPct: 0.8, transformerPct: 1.0, unavailabilityPct: 1.0 },
      degradation: { firstYearPct: 1.0, annualPct: 0.4 },
      landAreaHa: v.area_ha ?? +((kwp / 1000) * 2.1).toFixed(1),
      modalidade: "geracao-compartilhada",
      commissioning: v.comissionamento ?? `${startYear}-01-01`,
    },
    finance: {
      revenueModel: ppaRevenue ? "ppa" : "gd-assinatura",
      tariffBRLPerKWh: v.tarifa_kwh ?? 0.95,
      fioBBRLPerKWh: v.fio_b_kwh ?? 0.3,
      accessRequestYear: v.ano_solicitacao_acesso ?? startYear - 1,
      clientDiscountPct: v.desconto_cliente_pct ?? 20,
      revenueLossPct: 6,
      ...(ppaRevenue ? { ppaPriceBRLPerMWh: v.ppa_preco_mwh } : {}),
      tariffRealGrowthPct: 0.5,
      omBRLPerKWpYear: v.om_rs_kwp_ano ?? 55,
      insurancePctCapex: 0.35,
      landLeaseBRLYear: v.arrendamento_rs_ano ?? Math.round((v.area_ha ?? (kwp / 1000) * 2.1) * 6000),
      adminFeePctRevenue: 8,
      inverterReplacementYear: 13,
      inverterReplacementBRLPerKW: 350,
      taxPctRevenue: 11.33,
      horizonYears: 25,
      startYear,
    },
    token: {
      symbol: `AF${slug.replace(/[^a-z]/g, "").slice(0, 5).toUpperCase()}`,
      name: `Cota ${v.nome}`,
      totalCotas: total,
      cotaPriceBRL: preco,
      cotaPriceUSDT: +(preco / 5.5).toFixed(2),
      minCotas: v.cota_minima ?? 1,
      softCapCotas: Math.round(total * ((v.meta_minima_pct ?? 70) / 100)),
      structuringFeePct: 4,
      chainId: 97,
      ...(v.inicio_oferta ? { offeringStart: `${v.inicio_oferta}T12:00:00Z` } : {}),
      ...(v.fim_oferta ? { offeringEnd: `${v.fim_oferta}T23:59:59Z` } : {}),
      ...(v.cotas_vendidas !== undefined ? { demoSoldCotas: v.cotas_vendidas } : v.status === "encerrada" ? { demoSoldCotas: total } : {}),
    },
    commercial: {
      ppaActive: v.ppa_ativo === true,
      ...(v.ppa_contraparte ? { ppaCounterparty: v.ppa_contraparte } : {}),
      ...(v.ppa_fim ? { ppaEndDate: v.ppa_fim } : {}),
      askingPriceBRL: v.preco_venda_rs ?? total * preco,
      ...(v.escala ? { scale: v.escala } : {}),
      ...(v.equipamentos_obs ? { notes: v.equipamentos_obs } : {}),
    },
    fallbackClimate: genericClimate(v.latitude),
    ...(fotos.length ? { cover: fotos[0], gallery: fotos } : {}),
  };
}
