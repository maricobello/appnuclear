/**
 * Texto → fala (Web Speech API do navegador, voz pt-BR do sistema). Funções puras para
 * testar: limpeza de markdown, unidades e siglas faladas por extenso, e divisão em frases
 * curtas (o Chrome corta enunciados longos).
 */
export function speakable(text: string): string {
  const lines = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\*\*|__|`|~~/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  const joined = lines.reduce((acc, l) => (acc ? `${acc}${/[.!?:;]$/.test(acc) ? " " : ". "}${l}` : l), "");
  return joined
    .replace(/\s*\/\s*MWh\b/g, " por megawatt-hora")
    .replace(/\s+\/\s+/g, " por ")
    .replace(/\bkWh\b/g, "quilowatts-hora")
    .replace(/\bMWh\b/g, "megawatts-hora")
    .replace(/\bMWmed\b/g, "megawatts médios")
    .replace(/\bMW\b/g, "megawatts")
    .replace(/\bGW\b/g, "gigawatts")
    .replace(/\bp\.p\./g, "pontos percentuais")
    .replace(/\b(\d{1,2})h\b/g, "$1 horas")
    .replace(/\bSE\/CO\b/g, "Sudeste")
    .replace(/\bSE\b/g, "Sudeste")
    .replace(/\bNE\b/g, "Nordeste")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function splitSentences(text: string, max = 220): string[] {
  const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  return parts.flatMap((s) => {
    if (s.length <= max) return [s];
    const out: string[] = [];
    let cur = "";
    for (const piece of s.split(/(?<=,)\s+/)) {
      if (cur && (cur + " " + piece).length > max) {
        out.push(cur);
        cur = piece;
      } else cur = cur ? `${cur} ${piece}` : piece;
    }
    if (cur) out.push(cur);
    return out;
  });
}

/** Nota da voz do sistema: neurais "Natural/Online" (Edge) > Google (Chrome) > aprimoradas da Apple > o resto. */
export function voiceScore(v: { name: string; localService?: boolean }): number {
  const n = v.name;
  let s = 0;
  if (/natural|online|neural/i.test(n)) s += 100;
  if (/google/i.test(n)) s += 60;
  if (/premium|enhanced|aprimorad|siri/i.test(n)) s += 50;
  if (/Francisca|Thalita|Antonio|Luciana|Felipe|Daniel|Maria/i.test(n)) s += 10;
  if (/compact|espeak|eloquence|novelty/i.test(n)) s -= 80;
  return s;
}

/** Melhor voz pt-BR disponível (a escolhida pelo usuário, se ainda existir). */
export function pickVoice<V extends { lang: string; name: string; voiceURI: string; localService?: boolean }>(voices: V[], preferredURI?: string | null): V | null {
  const pt = voices.filter((v) => /^pt[-_]BR$/i.test(v.lang));
  if (preferredURI) {
    const chosen = pt.find((v) => v.voiceURI === preferredURI);
    if (chosen) return chosen;
  }
  const best = [...pt].sort((a, b) => voiceScore(b) - voiceScore(a))[0];
  return best ?? voices.find((v) => /^pt/i.test(v.lang)) ?? null;
}
