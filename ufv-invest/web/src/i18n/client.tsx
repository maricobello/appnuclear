"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { makeFmt } from "@/lib/fmt";
import { DEFAULT_LOCALE, interpolate, type Locale } from "./config";
import type { Dict } from "./dicts";

const Ctx = createContext<{ locale: Locale; d: Dict } | null>(null);

export function I18nProvider({ locale, dict, children }: { locale: Locale; dict: Dict; children: ReactNode }) {
  const v = useMemo(() => ({ locale, d: dict }), [locale, dict]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

/** Dicionário, interpolação e formatadores do idioma atual (componentes de cliente). */
export function useT() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useT fora do I18nProvider");
  const f = useMemo(() => makeFmt(c.locale ?? DEFAULT_LOCALE), [c.locale]);
  return { locale: c.locale, d: c.d, f, t: interpolate };
}
