/** Idiomas da interface. O português é a referência; os demais seguem as mesmas chaves. */
export const LOCALES = ["pt", "en", "es", "fr", "de", "zh", "ja"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "pt";
export const LOCALE_COOKIE = "aferi-lang";

/** Tag BCP 47 usada na formatação de números, moeda e datas */
export const INTL: Record<Locale, string> = { pt: "pt-BR", en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE", zh: "zh-CN", ja: "ja-JP" };

/** Nome nativo e bandeira de cada idioma (seletor do menu) */
export const LOCALE_INFO: Record<Locale, { name: string; flag: "br" | "us" | "es" | "fr" | "de" | "cn" | "jp" }> = {
  pt: { name: "Português", flag: "br" },
  en: { name: "English", flag: "us" },
  es: { name: "Español", flag: "es" },
  fr: { name: "Français", flag: "fr" },
  de: { name: "Deutsch", flag: "de" },
  zh: { name: "中文", flag: "cn" },
  ja: { name: "日本語", flag: "jp" },
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/** Escolhe o idioma pelo cabeçalho Accept-Language (ordem de preferência do navegador). */
export function matchLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const prefs = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag.toLowerCase(), q: q ? Number(q.trim().slice(2)) || 0 : 1 };
    })
    .filter((p) => p.tag)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of prefs) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** Substitui {chave} pelos valores informados. */
export function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
