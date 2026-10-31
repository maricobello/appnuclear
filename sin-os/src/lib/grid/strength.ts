import type { GridSnapshot } from "./snapshot";

/**
 * Força da rede para conectar inversores: nível de curto-circuito trifásico por barra (IEC 60909,
 * calculado no worker da rede) e a relação de curto-circuito SCR = S''k ÷ potência do parque.
 * Faixas usuais (IEEE 1204, CIGRE): SCR ≥ 3 rede forte; 2–3 fraca (o controle do inversor precisa de
 * estudo); abaixo de 2 muito fraca (exige reforço, compensador síncrono ou inversor formador de rede).
 *
 * O SCR composto soma ao parque novo a eólica e a solar já ligadas na mesma subestação, vistas da
 * barra pelos fatores de interação da CIGRE (o worker publica esse equivalente por barra): um parque
 * pequeno numa barra forte pode estar numa subestação já cheia de inversores.
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
  /** Eólica e solar já ligadas na subestação, vistas desta barra (MW equivalentes). */
  ibrMw: number;
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
      skMinAll: finite(all) && all >= skMin ? all : skMin,
    };
  });
}

/** Corrente de curto (kA) para S''k em MVA numa barra de kV nominal. */
export const ikA = (skMva: number, kv: number) => skMva / (Math.sqrt(3) * kv);

export const scr = (skMva: number, mw: number) => (mw > 0 ? skMva / mw : Infinity);

/** SCR composto: o curto dividido pelo parque novo somado aos inversores já ligados na subestação. */
export const scrComposite = (skMva: number, mw: number, ibrMw: number) => (mw + ibrMw > 0 ? skMva / (mw + Math.max(0, ibrMw)) : Infinity);

export const classify = (s: number): ScrClass => (s >= SCR_STRONG ? "forte" : s >= SCR_WEAK ? "fraca" : "muito fraca");

/** Maior parque (MW) que mantém SCR ≥ alvo na barra, pelo curto mínimo do dia, descontados os inversores
 *  que já estão na subestação. */
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

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

const ROMAN: Record<string, string> = { I: "1", II: "2", III: "3", IV: "4", V: "5", VI: "6", VII: "7", VIII: "8", IX: "9", X: "10" };

/** Palavras para a busca: romano vira número (menos na primeira palavra, que pode ser inicial, como em
 *  "V.AIRES") e número colado se separa ("ALEGRETE2" → ALEGRETE 2). */
const words = (s: string) =>
  fold(s)
    .split(" ")
    .filter(Boolean)
    .flatMap((w, i) => {
      const r = i > 0 ? ROMAN[w] : undefined;
      if (r) return [r];
      const m = /^([A-Z]{3,})(\d+)$/.exec(w);
      return m ? [m[1], m[2]] : [w];
    });

/** Palavras que não ajudam a achar a barra ("SE Ibiúna", "UHE Xingó", "barra de Tucuruí"). */
const STOP = new Set(["SE", "UHE", "UTE", "UFV", "UEE", "PCH", "SUBESTACAO", "USINA", "BARRA", "DE", "DA", "DO", "DOS", "DAS", "E", "KV"]);
/** Classes de tensão: número na busca filtra a tensão (525 kV do Sul tem a base de 500 kV no modelo). */
const VOLTAGES = new Map([69, 88, 138, 230, 345, 440, 500, 525, 765].map((v) => [String(v), v === 525 ? 500 : v]));

export interface BusSearch {
  items: BusStrength[];
  total: number;
}

/**
 * Busca por subestação. Cada palavra tem de casar com uma palavra do nome do cadastro do ONS: igual,
 * começo dela ("IBIU" → IBIUNA), contida num nome colado ("PRETO" → RIBEIRAOPRETO) ou abreviada pela
 * inicial ("Paulo Afonso" → P. AFONSO, "Serra da Mesa" → S.DA MESA) — a inicial sozinha não basta.
 * Número de tensão filtra ("Ibiúna 500 kV"); número de barra acha a barra ("barra 5695").
 * Mais parecidas primeiro, depois as de maior tensão.
 */
export function searchBuses(rows: BusStrength[], query: string, limit = 12): BusSearch {
  const all = words(query).filter((w) => !STOP.has(w));
  const kvs = new Set(all.filter((w) => VOLTAGES.has(w)).map((w) => VOLTAGES.get(w)!));
  const nums = all.filter((w) => /^\d+$/.test(w) && !VOLTAGES.has(w));
  const names = all.filter((w) => !/^\d+$/.test(w));
  if (!names.length && !nums.length) return { items: [], total: 0 };
  const scored: { b: BusStrength; score: number }[] = [];
  for (const b of rows) {
    if (kvs.size && !kvs.has(b.kv)) continue;
    if (!names.length) {
      if (nums.includes(String(b.anarede))) scored.push({ b, score: 10 });
      continue;
    }
    const toks = words(b.nome);
    const used = new Set<number>();
    let score = 0;
    let full = false;
    let ok = true;
    for (const w of names) {
      let best = -1;
      let kind = 0;
      toks.forEach((t, i) => {
        if (used.has(i)) return;
        const k = t === w ? 4 : t.startsWith(w) && w.length >= 2 ? 3 : w.length >= 4 && t.includes(w) ? 2 : t.length === 1 && w[0] === t ? 1 : 0;
        if (k > kind) {
          kind = k;
          best = i;
        }
      });
      if (!kind) {
        ok = false;
        break;
      }
      // palavra inteira ou inicial ocupa a palavra do nome; começo ou pedaço não ("RIBEIRAO PRETO" → RIBEIRAOPRETO)
      if (kind === 4 || kind === 1) used.add(best);
      score += kind;
      full ||= kind > 1;
    }
    // número na busca, além das palavras: tem de ser o número que o nome traz ("Mossoró 2") ou a barra
    if (ok && full && nums.every((x) => toks.includes(x) || String(b.anarede) === x)) scored.push({ b, score });
  }
  scored.sort((a, b) => b.score - a.score || b.b.kv - a.b.kv || a.b.nome.localeCompare(b.b.nome));
  return { items: scored.slice(0, limit).map((s) => s.b), total: scored.length };
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
