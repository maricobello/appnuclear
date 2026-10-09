import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { makeFmt } from "@/lib/fmt";
import { DEFAULT_LOCALE, interpolate, isLocale, LOCALE_COOKIE, matchLocale, type Locale } from "./config";
import { getDict } from "./dicts";

/** Idioma da requisição: escolha salva no cookie; senão, o idioma do navegador. */
export const getLocale = cache(async (): Promise<Locale> => {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(c)) return c;
  try {
    return matchLocale((await headers()).get("accept-language"));
  } catch {
    return DEFAULT_LOCALE;
  }
});

/** Dicionário, interpolação e formatadores do idioma da requisição (componentes de servidor). */
export async function getT() {
  const locale = await getLocale();
  const d = getDict(locale);
  return { locale, d, f: makeFmt(locale), t: interpolate };
}
