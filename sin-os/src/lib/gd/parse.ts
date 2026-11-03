import type { FaturaGD } from "./types";

/**
 * Leitura determinística de fatura de energia (texto do PDF, linha a linha): sem modelo de
 * linguagem, sem custo de token. Heurísticas para os layouts mais comuns das
 * distribuidoras (CPFL, Enel, Cemig, Light, Copel, Celesc, Equatorial, Energisa,
 * Neoenergia, RGE, EDP…): itens "descrição · kWh · preço · valor" validados pelo produto
 * quantidade × preço ≈ valor, quadro de GD/SCEE (injetada, saldo, créditos) e quadro de
 * tributos (base × alíquota ≈ valor). Não extrai nome, CPF nem endereço (LGPD).
 */

export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const NUM_RE = /-?\d{1,3}(?:\.\d{3})+(?:,\d+)?-?|-?\d+(?:,\d+)?-?/g;

/** "1.234,56" → 1234.56; "123,45-" → −123.45; "1.234" → 1234. */
export function parseBR(raw: string): number | null {
  let s = raw.trim().replace(/^R\$\s*/i, "");
  let neg = false;
  if (s.endsWith("-")) {
    neg = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  }
  if (/,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  else if (/\./.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}

interface Tok {
  v: number;
  dec: number;
  raw: string;
}

function numbers(line: string): Tok[] {
  // teto de tokens por linha: a busca de trios é cúbica e o texto vem de fora
  line = line.slice(0, 400);
  // datas e horários não são números da fatura
  const clean = line.replace(/\b\d{2}\/\d{2}\/\d{2,4}\b/g, " ").replace(/\b\d{2}\/\d{4}\b/g, " ").replace(/\b\d{1,2}:\d{2}\b/g, " ");
  const out: Tok[] = [];
  for (const m of clean.matchAll(NUM_RE)) {
    const v = parseBR(m[0]);
    if (v === null) continue;
    const dec = /,(\d+)-?$/.exec(m[0])?.[1].length ?? 0;
    out.push({ v, dec, raw: m[0] });
    if (out.length >= 16) break;
  }
  return out;
}

export interface LineItem {
  q: number | null;
  p: number | null;
  v: number | null;
  /** O trio fechou (q × p ≈ v): a linha é um item faturado de verdade. */
  ok: boolean;
}

/** Quantidade, preço e valor de um item: procura o trio com q × p ≈ v. */
export function lineItem(line: string): LineItem {
  const ns = numbers(line);
  for (let i = 0; i < ns.length; i++)
    for (let j = i + 1; j < ns.length; j++)
      for (let k = j + 1; k < ns.length; k++) {
        const [q, p, v] = [ns[i], ns[j], ns[k]];
        if (p.dec < 2 || v.dec !== 2 || Math.abs(p.v) >= 50) continue;
        const prod = Math.abs(q.v * p.v);
        if (q.v !== 0 && Math.abs(prod - Math.abs(v.v)) <= Math.max(0.06, Math.abs(v.v) * 0.012)) return { q: Math.abs(q.v), p: Math.abs(p.v), v: v.v, ok: true };
      }
  const money = ns.filter((n) => n.dec === 2);
  return { q: ns[0] && ns[0].dec !== 2 ? Math.abs(ns[0].v) : null, p: ns.find((n) => n.dec >= 4)?.v ?? null, v: money.at(-1)?.v ?? null, ok: false };
}

/** Base, alíquota e valor de uma linha de tributo (base × alíq/100 ≈ valor). */
export function taxLine(line: string): { base: number | null; pct: number | null; v: number | null } {
  const ns = numbers(line);
  for (let i = 0; i < ns.length; i++)
    for (let j = 0; j < ns.length; j++) {
      if (i === j || ns[j].v <= 0 || ns[j].v > 40) continue;
      for (let k = 0; k < ns.length; k++) {
        if (k === i || k === j || ns[k].dec !== 2) continue;
        const exp = (ns[i].v * ns[j].v) / 100;
        if (ns[i].v > ns[k].v && Math.abs(exp - ns[k].v) <= Math.max(0.03, ns[k].v * 0.01)) return { base: ns[i].v, pct: ns[j].v / 100, v: ns[k].v };
      }
    }
  const pct = /(\d{1,2}(?:,\d+)?)\s*%/.exec(line);
  const money = ns.filter((n) => n.dec === 2);
  return { base: null, pct: pct ? (parseBR(pct[1]) ?? 0) / 100 : null, v: money.at(-1)?.v ?? null };
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function refFrom(s: string): string | null {
  // "15/10/2026" é data (vencimento, leitura), não mês de referência
  const f = fold(s).replace(/\b\d{2}\/\d{2}\/\d{2,4}\b/g, " ");
  let m = /\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?\s*[/-]?\s*(20\d{2}|\d{2})\b/.exec(f);
  if (m) {
    const y = m[2].length === 2 ? `20${m[2]}` : m[2];
    return `${y}-${String(MESES.indexOf(m[1]) + 1).padStart(2, "0")}`;
  }
  m = /\b(0[1-9]|1[0-2])\/(20\d{2})\b/.exec(f);
  return m ? `${m[2]}-${m[1]}` : null;
}

/** Primeiro número logo depois do rótulo (no texto já sem acento). */
function after(l: string, re: RegExp): number | null {
  const m = re.exec(l);
  if (!m) return null;
  const rest = l.slice(m.index + m[0].length, m.index + m[0].length + 40).replace(/\b\d{2}\/\d{2}\/\d{2,4}\b/g, " ");
  const n = /-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?/.exec(rest.replace(/\b(60|90) dias\b/g, " "));
  return n ? parseBR(n[0]) : null;
}

const DISTRIBUIDORAS: [RegExp, string][] = [
  [/\bcpfl\b/, "CPFL"],
  [/\brge\b/, "RGE"],
  [/\benel\b/, "Enel"],
  [/\bcemig\b/, "Cemig"],
  [/\blight\b/, "Light"],
  [/\bcopel\b/, "Copel"],
  [/\bcelesc\b/, "Celesc"],
  [/\bequatorial\b/, "Equatorial"],
  [/\benergisa\b/, "Energisa"],
  [/\bcoelba\b/, "Coelba (Neoenergia)"],
  [/\bcelpe\b/, "Celpe (Neoenergia)"],
  [/\bcosern\b/, "Cosern (Neoenergia)"],
  [/\belektro\b/, "Elektro (Neoenergia)"],
  [/\bneoenergia\b/, "Neoenergia"],
  [/\bedp\b/, "EDP"],
  [/\bceee\b/, "CEEE Equatorial"],
  [/\bamazonas energia\b/, "Amazonas Energia"],
  [/\bceb\b|\bneoenergia brasilia\b/, "Neoenergia Brasília"],
  [/\bcocel\b|\bdmed\b|\bcercos\b/, "Permissionária"],
];

const firstMoney = (line: string) => numbers(line).filter((n) => n.dec === 2).at(-1)?.v ?? null;

/** fnv-1a de 32 bits: id estável da fatura (para não contar a mesma duas vezes). */
export function hashId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export interface ParseOut {
  fatura: FaturaGD;
  /** Linhas usadas em cada campo (para o usuário conferir a leitura). */
  trilha: Record<string, string>;
}

export function parseFatura(text: string, arquivo?: string): ParseOut {
  const lines = text
    .replace(/ /g, " ")
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  const all = fold(lines.join("\n"));
  const f: Partial<FaturaGD> = {};
  const trilha: Record<string, string> = {};
  const set = <K extends keyof FaturaGD>(k: K, v: FaturaGD[K] | null | undefined, line: string) => {
    if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) return;
    if (f[k] !== undefined) return;
    f[k] = v as never;
    trilha[k as string] = line.slice(0, 160);
  };
  const next = (i: number) => lines[i + 1] ?? "";

  const consumos: { q: number; ok: boolean }[] = [];
  let energiaRs = 0;
  let energiaHit = false;
  let compQ = 0;
  let compRs = 0;
  let compHit = false;
  let fioB = 0;
  let band = 0;
  let pontaQ = 0;
  let fpQ = 0;
  let tusdInjP = 0;
  let totalFallback: { v: number; line: string } | undefined;

  lines.forEach((line, i) => {
    const l = fold(line);
    // identificação
    if (f.uc === undefined) {
      const m = /(unidade consumidora|n[o.º°]*\s*(da\s+)?(uc|instalacao)|codigo (da instalacao|do cliente|unico)|instalacao|conta contrato|seu codigo|numero do cliente)\D{0,25}(\d[\d.\-/]{4,20}\d)/.exec(l);
      if (m) set("uc", m[5].replace(/\D/g, ""), line);
      else if (/(unidade consumidora|instalacao|seu codigo|conta contrato)\s*:?\s*$/.test(l)) {
        const n = /(\d[\d.\-/]{4,20}\d)/.exec(next(i));
        if (n) set("uc", n[1].replace(/\D/g, ""), `${line} ${next(i)}`);
      }
    }
    if (f.ref === undefined && /(referencia|referente a|mes\/ano|conta (do )?mes|mes de faturamento|competencia|mes ref)/.test(l)) set("ref", refFrom(line) ?? refFrom(next(i)), line);
    if (f.vencimento === undefined && /vencimento/.test(l)) {
      const m = /(\d{2}\/\d{2}\/\d{4})/.exec(line) ?? /(\d{2}\/\d{2}\/\d{4})/.exec(next(i));
      if (m) set("vencimento", m[1], line);
    }
    if (f.totalRs === undefined && /(total a pagar|valor a pagar|total da (fatura|conta)|valor total|total geral|valor do documento|total consolidado|valor cobrado)/.test(l)) {
      const v = firstMoney(line) ?? firstMoney(next(i));
      if (v !== null && v >= 0) set("totalRs", v, line);
    }
    if (/^total\b/.test(l) && !/(tributo|imposto|kwh|consumo|itens|geral de)/.test(l)) {
      const v = firstMoney(line);
      if (v !== null && v >= 0) totalFallback ??= { v, line };
    }
    if (f.dias === undefined) {
      const m = /(?:n[o.º°]*\s*de\s*)?dias\D{0,6}(\d{2})\b|\b(\d{2})\s*dias\b/.exec(l);
      if (m && /(leitura|periodo|dias de|consumo|faturad|n[o.º°]* de dias)/.test(l)) set("dias", Number(m[1] ?? m[2]), line);
    }

    // quadro de GD / SCEE
    const abs = (v: number | null) => (v === null ? null : Math.abs(v));
    if (/saldo/.test(l) && !/(saldo devedor|r\$|debito)/.test(l)) {
      set("saldoExpirarKwh", abs(after(l, /saldo a expirar[^0-9]*?(?:nos proximos \d+ dias|no proximo mes|em \d{2}\/\d{4})?\s*:?/)), line);
      set("saldoAnteriorKwh", abs(after(l, /saldo anterior( de (geracao|creditos?))?\s*(\(kwh\))?\s*:?/)), line);
      set("saldoKwh", abs(after(l, /(saldo (atual|final|acumulado|em kwh|de creditos?|disponivel|total|remanescente|para o proximo mes)( de (geracao|creditos?))?|saldo kwh|creditos? (acumulados?|disponiveis))\s*(\(kwh\))?\s*:?/)), line);
    }
    if (/(credito(s)? recebido|recebid[oa]s?|transferid|ouc\b|outras uc)/.test(l) && /(kwh|credito|energia)/.test(l) && !/r\$/.test(l))
      set("creditosRecebidosKwh", abs(after(l, /(creditos? recebidos?|recebid[oa]s?|transferid[oa]s?|ouc|outras ucs?)\s*(de outras ucs?)?\s*(\(kwh\))?\s*:?/)), line);
    if (/(energia (ativa )?injetada|injecao|injetad[ao] no mes|energia gerada|geracao do mes)/.test(l) && !/(tusd|\bte\b|r\$|preco|tarifa)/.test(l) && !lineItem(line).ok)
      set("injetadaKwh", abs(after(l, /(energia (ativa )?injetada( no mes)?|injecao( no mes)?|injetad[ao] no mes|energia gerada( no mes)?|geracao do mes)\s*(\(kwh\))?\s*:?/)), line);

    // itens faturados
    const item = () => lineItem(line);
    // "Energia SCEE isenta" é a parte do consumo sem ICMS (Cemig), não crédito
    const isenta = /isent/.test(l) && !/(compens|injet|credito)/.test(l);
    const isComp = !isenta && /(injet|compens|scee|credito|gd ?i|geracao|energia gerada|inj\.)/.test(l);
    if (/(fio b|parcela nao compensada|nao compensad|componente fio)/.test(l) || (/tusd ?gd/.test(l) && !/(injet|compens|credito)/.test(l))) {
      const v = item().v ?? firstMoney(line);
      if (v && v > 0) {
        fioB += v;
        trilha.fioBRs ??= line.slice(0, 160);
      }
      return;
    }
    if (/(custo de disponibilidade|consumo minimo|valor minimo|taxa minima|disponibilidade do sistema)/.test(l)) {
      const v = item().v ?? firstMoney(line);
      if (v) set("disponibilidadeRs", Math.abs(v), line);
      return;
    }
    if (/bandeira|band\.|adicional (de )?bandeira|adic\.? band/.test(l)) {
      const nome = /(verde|amarela|vermelha(?: ?(?:patamar)? ?[12i]{1,2})?|escassez)/.exec(l)?.[1];
      if (nome) set("bandeira", nome.replace(/\s+/g, " "), line);
      const v = item().v;
      if (v && Math.abs(v) < 5000 && numbers(line).length >= 2) band += v;
      if (v) trilha.bandeiraRs ??= line.slice(0, 160);
      return;
    }
    if (/(ilum(inacao)?\.? (publica|pub)|\bcip\b|\bcosip\b|\bccip\b|contrib.*ilum)/.test(l)) {
      set("cipRs", firstMoney(line), line);
      return;
    }
    if (/(multa|juros|mora|atualizacao monet|correcao monet)/.test(l) && !/(sem multa|isento)/.test(l)) {
      const v = firstMoney(line);
      if (v && v > 0) f.multasRs = (f.multasRs ?? 0) + v;
      return;
    }
    if (/^(icms)\b/.test(l) || /\bicms\b.*(aliq|%|base)/.test(l)) {
      const t = taxLine(line);
      set("icmsRs", t.v, line);
      set("icmsPct", t.pct, line);
      return;
    }
    if (/^(pis|pis\/pasep|pasep)\b/.test(l)) {
      const t = taxLine(line);
      set("pisRs", t.v, line);
      set("pisPct", t.pct, line);
      return;
    }
    if (/^cofins\b/.test(l)) {
      const t = taxLine(line);
      set("cofinsRs", t.v, line);
      set("cofinsPct", t.pct, line);
      return;
    }
    if (/ultrapassagem/.test(l)) {
      const v = item().v ?? firstMoney(line);
      if (v) set("ultrapassagemRs", Math.abs(v), line);
      return;
    }
    if (/(ufer|reativ|excedente de reativ|dmcr)/.test(l)) {
      const v = item().v ?? firstMoney(line);
      if (v && /(r\$|\d,\d{2})/.test(line)) f.reativoRs = (f.reativoRs ?? 0) + Math.abs(v);
      return;
    }
    if (/demanda/.test(l)) {
      const it = item();
      const q = it.q ?? numbers(line)[0]?.v ?? null;
      if (/contratad/.test(l)) set("demandaContratadaKw", q, line);
      else if (/ponta/.test(l) && !/fora/.test(l)) set("demandaPontaKw", q, line);
      else if (q !== null && /(kw\b|medida|registrada|faturad|demanda)/.test(l)) set("demandaKw", q, line);
      return;
    }
    if (/kwh/.test(l) || /(consumo|energia (eletrica|ativa))/.test(l)) {
      const it = item();
      if (it.q === null && it.v === null) return;
      if (isComp) {
        if (!it.ok) return; // linha informativa do quadro de GD, não item faturado
        if (it.q) compQ = Math.max(compQ, it.q);
        if (it.v) compRs += -Math.abs(it.v);
        if (it.p && /\btusd\b|uso do sistema/.test(l)) tusdInjP = it.p;
        compHit = true;
        trilha.compensadaKwh ??= line.slice(0, 160);
        return;
      }
      if ((isenta || /(consumo|energia (eletrica|ativa)( fornecida)?|uso do sistema|energia consumida|\btusd\b|\bte\b)/.test(l)) && !/(reativ|demanda|leitura anterior|leitura atual|media|historico)/.test(l)) {
        if (/\bponta\b/.test(l) && !/fora/.test(l)) pontaQ = Math.max(pontaQ, it.q ?? 0);
        else if (/fora (de )?ponta|\bfp\b/.test(l)) fpQ = Math.max(fpQ, it.q ?? 0);
        else if (it.q) consumos.push({ q: it.q, ok: it.ok });
        if (it.v && it.v > 0) energiaRs += it.v;
        if (it.p !== null && it.p > 0 && it.p < 5) {
          if (/\btusd\b|uso do sistema/.test(l)) set("tusdRsKwh", it.p, line);
          else if (/\bte\b|energia/.test(l)) set("teRsKwh", it.p, line);
        }
        energiaHit = true;
        trilha.consumoKwh ??= line.slice(0, 160);
      }
    }
  });

  // TE e TUSD repetem a mesma quantidade (soma as distintas): "Energia elétrica 130" +
  // "Energia SCEE isenta 480" = 610; "Consumo TUSD 420" + "Consumo TE 420" = 420
  const validos = consumos.some((c) => c.ok) ? consumos.filter((c) => c.ok) : consumos;
  let consumoQ = 0;
  const vistos: number[] = [];
  for (const c of validos)
    if (!vistos.some((v) => Math.abs(v - c.q) <= 0.5)) {
      vistos.push(c.q);
      consumoQ += c.q;
    }
  if (pontaQ || fpQ) {
    if (pontaQ) f.consumoPontaKwh = pontaQ;
    if (fpQ) f.consumoForaPontaKwh = fpQ;
    if (!consumoQ) consumoQ = pontaQ + fpQ;
  }
  if (energiaHit && consumoQ) f.consumoKwh = consumoQ;
  if (energiaRs) f.energiaRs = Math.round(energiaRs * 100) / 100;
  if (compHit) {
    if (compQ) f.compensadaKwh = compQ;
    if (compRs) f.compensacaoRs = Math.round(compRs * 100) / 100;
  }
  // quadro de GD sem itens de compensação: créditos usados = (saldo anterior + injetada + recebidos) − saldo
  if (f.compensadaKwh === undefined) {
    const m = /(credito(s)? (utilizado|consumido|compensado)s?|energia compensada|compensacao)\D{0,30}(\d[\d.]*(?:,\d+)?)/.exec(all);
    if (m) {
      const v = parseBR(m[4]);
      if (v !== null) f.compensadaKwh = v;
    }
  }
  // layout em que o crédito da TUSD sai com preço menor que o da TUSD consumida: a diferença é o Fio B
  if (!fioB && tusdInjP && f.tusdRsKwh && compQ && f.tusdRsKwh - tusdInjP > 0.005) {
    fioB = (f.tusdRsKwh - tusdInjP) * compQ;
    trilha.fioBRs = "(implícito: preço da TUSD consumida − preço da TUSD injetada) × kWh compensados";
  }
  if (fioB) f.fioBRs = Math.round(fioB * 100) / 100;
  if (f.totalRs === undefined && totalFallback) {
    f.totalRs = totalFallback.v;
    trilha.totalRs = totalFallback.line.slice(0, 160);
  }
  if (band) f.bandeiraRs = Math.round(band * 100) / 100;
  if (/(com tributos|c\/ tributos|com impostos|c\/ impostos|preco unit\.? \(?r\$\)? com)/.test(all)) f.tarifasComTributos = true;
  else if (/(sem tributos|s\/ tributos|sem impostos|tarifa homologada)/.test(all)) f.tarifasComTributos = false;
  if (/(leitura (estimada|pela media|por media)|faturamento (pela|por) media|media de consumo faturad|consumo estimado)/.test(all)) f.leituraEstimada = true;
  const lig = /(monofasic|bifasic|trifasic)/.exec(all)?.[1];
  if (lig) f.ligacao = lig.startsWith("mono") ? "mono" : lig.startsWith("bi") ? "bi" : "tri";
  const sub = /\b(b1|b2|b3|b4a|b4b|b4|a4|a3a|a3|a2|a1|as)\b/.exec(all)?.[1];
  if (sub) {
    f.subgrupo = sub.toUpperCase();
    f.grupo = sub.startsWith("a") ? "A" : "B";
  } else if (/grupo a\b|media tensao|alta tensao/.test(all)) f.grupo = "A";
  else if (/grupo b\b|baixa tensao/.test(all)) f.grupo = "B";
  if (f.grupo === undefined && (f.demandaKw !== undefined || f.demandaContratadaKw !== undefined)) f.grupo = "A";
  // "verde" sozinho é bandeira: a modalidade só conta com contexto
  const mod = /(modalidade( tarifaria)?|tarifa|horo ?sazonal|horaria)\s*:?\s*(convencional|branca|verde|azul)\b/.exec(all)?.[3];
  if (mod) f.modalidadeTarifaria = mod;
  const classe = /\b(residencial|comercial|industrial|rural|poder publico|servico publico|iluminacao publica)\b/.exec(all)?.[1];
  if (classe) f.classe = classe;
  for (const [re, name] of DISTRIBUIDORAS)
    if (re.test(all)) {
      f.distribuidora = name;
      break;
    }
  if (/\bgd ?(iii|3)\b/.test(all)) f.enquadramento = "GD III";
  else if (/\bgd ?(ii|2)\b/.test(all)) f.enquadramento = "GD II";
  else if (/\bgd ?(i|1)\b/.test(all)) f.enquadramento = "GD I";
  if (f.ref === undefined) {
    const r = refFrom(lines.slice(0, 40).join(" "));
    if (r) {
      f.ref = r;
      trilha.ref = "(primeiro mês/ano do cabeçalho)";
    }
  }

  const temGd = f.injetadaKwh !== undefined || f.compensadaKwh !== undefined || f.saldoKwh !== undefined || /(scee|gera(cao)? distribuida|micro ?gera|mini ?gera|energia injetada)/.test(all);
  const chaves: (keyof FaturaGD)[] = ["uc", "ref", "consumoKwh", "totalRs", "vencimento", ...(temGd ? (["compensadaKwh", "saldoKwh"] as (keyof FaturaGD)[]) : [])];
  const faltando = chaves.filter((k) => f[k] === undefined) as string[];
  const confianca = Math.round(((chaves.length - faltando.length) / chaves.length) * 100) / 100;
  const id = hashId(`${f.uc ?? ""}|${f.ref ?? ""}|${f.totalRs ?? ""}|${f.consumoKwh ?? ""}|${f.uc ? "" : text.slice(0, 2000)}`);
  const fatura = { ...f, id, ...(arquivo ? { arquivo: arquivo.slice(0, 120) } : {}), confianca, faltando } as FaturaGD;
  return { fatura, trilha };
}
