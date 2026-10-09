import type { Locale } from "./config";
import { pt, type Dict } from "./dict/pt";
import { en } from "./dict/en";
import { es } from "./dict/es";
import { fr } from "./dict/fr";
import { de } from "./dict/de";
import { zh } from "./dict/zh";
import { ja } from "./dict/ja";

export type { Dict };
const ALL: Record<Locale, Dict> = { pt, en, es, fr, de, zh, ja };

export function getDict(locale: Locale): Dict {
  return ALL[locale] ?? pt;
}
