import type { GridSnapshot } from "./snapshot";

/**
 * Força da rede para conectar inversores: nível de curto-circuito trifásico por barra (IEC 60909,
 * calculado no worker da rede) e a relação de curto-circuito SCR = S''k ÷ potência do parque.
 * Faixas usuais (IEEE 1204, CIGRE): SCR ≥ 3 rede forte; 2–3 fraca (o controle do inversor precisa de
 * estudo); abaixo de 2 muito fraca (exige reforço, compensador síncrono ou inversor formador de rede).
 *
 * O SCR composto soma ao parque novo a eólica e a solar já ligadas perto, vistas da barra pelos fatores
 * de interação da CIGRE (o worker publica esse equivalente por barra: a própria subestação e as vizinhas
 * com fator ≥ 0,7): um parque pequeno numa barra forte pode estar numa região já cheia de inversores.
 */

export type ShortCircuit = NonNullable<GridSnapshot["curto"]>;

export interface BusStrength {
  anarede: number;
  nome: string;
  kv: number;
  uf: string | null;
  /** Subsistema (N, NE, SE, S) ou, nas barras de fronteira, o país (UY, VE…). */
  sub: string | null;
  lat: number | null;
  lon: number | null;
  /** S''k mínimo do dia (MVA, c = 1,0, sem o maior compensador da subestação) e a hora. */
  skMin: number;
  hMin: number;
  /** S''k máximo do despacho do dia (c = 1,1 limitado a Um/Un) e a hora. */
  skMax: number;
  hMax: number;
  /** Eólica e solar já ligadas vistas desta barra (MW equivalentes, pelos fatores de interação): as da
   *  própria subestação e as das vizinhas com fator ≥ 0,7. */
  ibrMw: number;
  /** A parte disso que está na própria subestação. */
  ibrStationMw: number;
  /** S''k mínimo com todos os compensadores síncronos ligados (MVA). */
  skMinAll: number;
}

export const SCR_STRONG = 3;
export const SCR_WEAK = 2;
export type ScrClass = "forte" | "fraca" | "muito fraca";
export const SUBSYSTEMS = new Set(["N", "NE", "SE", "S"]);
/** Quando a busca não acha nada: o cadastro do ONS abrevia os nomes. */
export const NO_MATCH_HINT = "O cadastro do ONS abrevia nomes (P. AFONSO, S.DA MESA): tente uma palavra só.";
/** Diferença a partir da qual vale mostrar o curto com todos os compensadores ligados. */
export const COMPENSATOR_GAP = 1.1;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function busRows(sc: ShortCircuit): BusStrength[] {
  return sc.barras.map((r) => {
    const [anarede, nome, kv, uf, sub, lat, lon, skMin, hMin, skMax, hMax] = r;
    const ibr = r[11];
    const all = r[12];
    const st = r[13];
    return {
      anarede,
      nome,
      kv,
      uf,
      sub,
      lat,
      lon,
      skMin,
      hMin,
      skMax,
      hMax,
      ibrMw: finite(ibr) && ibr > 0 ? ibr : 0,
      ibrStationMw: finite(st) && st > 0 ? st : finite(ibr) && ibr > 0 && !finite(st) ? ibr : 0,
      skMinAll: finite(all) && all >= skMin ? all : skMin,
    };
  });
}

/** Corrente de curto (kA) para S''k em MVA numa barra de kV nominal. */
export const ikA = (skMva: number, kv: number) => skMva / (Math.sqrt(3) * kv);

export const scr = (skMva: number, mw: number) => (mw > 0 ? skMva / mw : Infinity);

/** SCR composto: o curto dividido pelo parque novo somado aos inversores já ligados perto (equivalente). */
export const scrComposite = (skMva: number, mw: number, ibrMw: number) => (mw + ibrMw > 0 ? skMva / (mw + Math.max(0, ibrMw)) : Infinity);

export const classify = (s: number): ScrClass => (s >= SCR_STRONG ? "forte" : s >= SCR_WEAK ? "fraca" : "muito fraca");

/** Maior parque (MW) que mantém SCR ≥ alvo na barra, pelo curto mínimo do dia, descontados os inversores
 *  que já estão perto (equivalente). */
export const maxPlantMw = (skMin: number, ibrMw = 0, target = SCR_STRONG) => Math.max(0, skMin / target - Math.max(0, ibrMw));

/** Barra de fronteira internacional: o campo do subsistema traz o país. */
export const isBorder = (b: BusStrength) => !!b.sub && !SUBSYSTEMS.has(b.sub);

/** O que a fronteira faz com o curto da barra (conversora de frequência ou ligação em CA), do relatório. */
export function borderNote(sc: ShortCircuit, b: BusStrength): string | null {
  if (!isBorder(b) || !b.sub) return null;
  const f = sc.fronteira?.[b.sub];
  return f ? `Fronteira com ${f.pais}: ${f.nota}.` : "Barra de fronteira: a rede do país vizinho não está no modelo.";
}

/** Potência do parque digitada: "100", "1.000", "2.500,5", "1,5", "300 MW". Fora de (0, 100 000) MW: null. */
export function parseMw(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 && raw < 1e5 ? raw : null;
  if (typeof raw !== "string") return null;
  let t = raw.trim().toLowerCase().replace(/\s*mw$/, "").replace(/\s+/g, "");
  if (!t) return null;
  t = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = Number(t);
  return v > 0 && v < 1e5 ? v : null;
}

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();

const ROMAN: Record<string, string> = { I: "1", II: "2", III: "3", IV: "4", V: "5", VI: "6", VII: "7", VIII: "8", IX: "9", X: "10" };

interface Tok {
  w: string;
  /** Abreviada no cadastro (terminava em ponto: "SANT.", "C."). */
  abbr: boolean;
}

/** Palavras de um nome: "SANT. ARAGUAIA" → SANT (abreviada) e ARAGUAIA. Romano vira número, menos na
 *  primeira palavra e nas abreviadas (o "I." de "C.I.CURITIBA" é inicial); número colado se separa
 *  ("ALEGRETE2" → ALEGRETE 2). */
function tokens(s: string): Tok[] {
  const out: Tok[] = [];
  (plain(s).match(/[A-Z0-9]+\.?/g) ?? []).forEach((r, i) => {
    const abbr = r.endsWith(".");
    const w = abbr ? r.slice(0, -1) : r;
    const roman = !abbr && i > 0 ? ROMAN[w] : undefined;
    if (roman) {
      out.push({ w: roman, abbr: false });
      return;
    }
    const m = /^([A-Z]{3,})(\d+)$/.exec(w);
    if (m) out.push({ w: m[1], abbr: false }, { w: m[2], abbr: false });
    else out.push({ w, abbr });
  });
  return out;
}

const cache = new WeakMap<BusStrength, Tok[]>();
const busTokens = (b: BusStrength) => {
  let t = cache.get(b);
  if (!t) cache.set(b, (t = tokens(b.nome)));
  return t;
};

/** Palavras que não ajudam a achar a barra ("SE Ibiúna", "UHE Xingó"); "barra" só sai antes de um
 *  número ("barra 5695"), porque também é nome ("Barra Grande"). */
const STOP = new Set(["SE", "UHE", "UTE", "UFV", "UEE", "PCH", "SUBESTACAO", "USINA", "DE", "DA", "DO", "DOS", "DAS", "E", "KV"]);
const VOLTAGE_CLASSES = new Set([69, 88, 138, 161, 230, 289, 345, 440, 500, 525, 765]);

/** Quanto a palavra da busca casa com a palavra do nome: 4 igual; 3 começo dela ("IBIU" → IBIUNA);
 *  2 abreviada no cadastro ("SANTANA" → SANT.), nome cortado ("NORTE" → NORT) ou colado ("PRETO" →
 *  RIBEIRAOPRETO); 1 só a inicial ("PAULO" → P.). */
function kindOf(w: string, t: Tok, last: boolean): number {
  if (t.w === w) return 4;
  if (/^\d+$/.test(w) || /^\d+$/.test(t.w)) return 0;
  if (w.length >= 2 && t.w.startsWith(w)) return 3;
  if (t.abbr && t.w.length >= 2 && w.startsWith(t.w)) return 2;
  if (!t.abbr && t.w.length >= 4 && w.startsWith(t.w)) return 2;
  if (w.length >= 4 && t.w.includes(w)) return 2;
  if (t.w.length === 1 && w[0] === t.w && (t.abbr || !last)) return 1;
  return 0;
}

/** Melhor pontuação das palavras da busca contra as do nome (cada palavra numa palavra do nome; na
 *  ordem, se `ordered`); −1 se não casa ou se só casou por inicial. */
function score(words: string[], toks: Tok[], ordered: boolean): number {
  let best = -1;
  const used = new Set<number>();
  const go = (i: number, from: number, acc: number, full: boolean) => {
    if (i === words.length) {
      if (full && acc > best) best = acc;
      return;
    }
    for (let j = ordered ? from : 0; j < toks.length; j++) {
      if (used.has(j)) continue;
      const k = kindOf(words[i], toks[j], j === toks.length - 1);
      if (!k) continue;
      // palavra colada pode receber mais de uma da busca ("RIBEIRAO PRETO" → RIBEIRAOPRETO)
      const glued = k >= 2 && toks[j].w.length > words[i].length && toks[j].w.includes(words[i]);
      if (!glued) used.add(j);
      go(i + 1, glued ? j : j + 1, acc + k, full || k > 1);
      used.delete(j);
    }
  };
  go(0, 0, 0, false);
  return best;
}

export interface BusSearch {
  items: BusStrength[];
  total: number;
  /** Aviso quando a tensão pedida não existe e a busca seguiu sem ela. */
  note?: string;
}

/**
 * Busca por subestação. Cada palavra casa com uma palavra do nome do cadastro do ONS, na mesma ordem:
 * igual, começo dela, abreviada no cadastro ("Santana do Araguaia" → SANT. ARAGUAIA, "Paulo Afonso" →
 * P. AFONSO), cortada ou colada; a inicial sozinha não basta, e "Curitiba Centro" não vira C.I.CURITIBA.
 * Sem resultado na ordem, tenta fora de ordem. Número de tensão filtra ("Ibiúna 345"; sem barra
 * nessa tensão, mostra as outras e avisa); número de barra acha a barra ("barra 5695", "5695").
 */
export function searchBuses(rows: BusStrength[], query: string, limit = 12): BusSearch {
  const raw = tokens(query).map((t) => t.w);
  const dropped = new Set<string>();
  const q = raw.filter((w, i) => {
    const stop = STOP.has(w) || (w === "BARRA" && /^\d+$/.test(raw[i + 1] ?? ""));
    if (stop) dropped.add(w);
    return !stop;
  });
  const kvsInData = new Set(rows.map((b) => b.kv));
  const isKv = (w: string) => /^\d+$/.test(w) && (VOLTAGE_CLASSES.has(Number(w)) || kvsInData.has(Number(w)));
  const names = q.filter((w) => !/^\d+$/.test(w));
  const kvs = names.length ? new Set(q.filter(isKv).map(Number)) : new Set<number>();
  const nums = q.filter((w) => /^\d+$/.test(w) && !(names.length && isKv(w)));
  if (!names.length && !nums.length) return { items: [], total: 0 };

  const run = (useKv: boolean, ordered: boolean) => {
    const out: { b: BusStrength; s: number }[] = [];
    for (const b of rows) {
      if (useKv && kvs.size && !kvs.has(b.kv)) continue;
      if (!names.length) {
        if (nums.includes(String(b.anarede))) out.push({ b, s: 10 });
        continue;
      }
      const toks = busTokens(b);
      let s = score(names, toks, ordered);
      // número junto do nome: tem de ser o que o nome traz ("Mossoró 2") ou o da barra
      if (s < 0 || !nums.every((x) => toks.some((t) => t.w === x) || String(b.anarede) === x)) continue;
      for (const d of dropped) if (toks.some((t) => t.w === d)) s += 1; // "UHE Pimental" → UHE PIMENTAL primeiro
      out.push({ b, s });
    }
    return out;
  };
  let found = run(true, true);
  if (!found.length) found = run(true, false);
  let note: string | undefined;
  if (!found.length && kvs.size) {
    found = run(false, true);
    if (!found.length) found = run(false, false);
    if (found.length) {
      const have = [...new Set(found.map((f) => f.b.kv))].sort((a, b) => b - a);
      note = `Sem barra de ${[...kvs].join(" ou ")} kV com esse nome; ela aparece em ${have.slice(0, 4).join(", ")} kV.`;
    }
  }
  found.sort((a, b) => b.s - a.s || b.b.kv - a.b.kv || a.b.nome.localeCompare(b.b.nome));
  return { items: found.slice(0, limit).map((f) => f.b), total: found.length, ...(note ? { note } : {}) };
}

/** Rótulo de chip que separa barras de mesmo nome e tensão pelo número ANAREDE. */
export function chipLabels(items: BusStrength[], label: (b: BusStrength) => string): string[] {
  const base = items.map(label);
  const count = new Map<string, number>();
  for (const l of base) count.set(l, (count.get(l) ?? 0) + 1);
  return base.map((l, i) => ((count.get(l) ?? 0) > 1 ? `${l} · barra ${items[i].anarede}` : l));
}

/** As barras mais fracas a partir de uma tensão (sem as de fronteira). */
export function weakest(rows: BusStrength[], minKv = 230, limit = 12): BusStrength[] {
  return rows
    .filter((b) => b.kv >= minKv && !isBorder(b))
    .sort((a, b) => a.skMin - b.skMin)
    .slice(0, limit);
}
