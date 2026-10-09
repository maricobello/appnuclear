"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronDown } from "lucide-react";
import { LOCALE_COOKIE, LOCALE_INFO, LOCALES, type Locale } from "@/i18n/config";
import { useT } from "@/i18n/client";
import { cx } from "@/components/ui";
import { Flag } from "./Flag";

/** Guarda a escolha por um ano; o servidor lê o cookie em cada página. */
function saveLocale(l: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
}

/** Seletor discreto de idioma: só a bandeira; abre a lista com os nomes nativos. */
export function LangSwitcher({ tone = "default" }: { tone?: "default" | "overlay" }) {
  const { locale, d } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const choose = (l: Locale) => {
    setOpen(false);
    if (l === locale) return;
    saveLocale(l);
    start(() => router.refresh());
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${d.common.language}: ${LOCALE_INFO[locale].name}`}
        className={cx(
          "flex items-center gap-1 rounded-full px-2 py-2 transition",
          tone === "overlay" ? "text-white/80 hover:bg-white/10" : "text-muted hover:bg-surface-2 hover:text-ink",
          pending && "opacity-60",
        )}
      >
        <Flag code={LOCALE_INFO[locale].flag} />
        <ChevronDown className="size-3" aria-hidden />
      </button>
      {open && (
        <ul role="listbox" aria-label={d.common.language} className="absolute right-0 z-50 mt-2 w-44 rounded-xl border border-line-strong bg-surface p-1.5 shadow-2xl">
          {LOCALES.map((l) => (
            <li key={l} role="option" aria-selected={l === locale}>
              <button
                type="button"
                lang={l}
                onClick={() => choose(l)}
                className={cx("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] transition hover:bg-surface-2", l === locale ? "text-ink" : "text-ink-2")}
              >
                <Flag code={LOCALE_INFO[l].flag} />
                <span className="flex-1 text-left">{LOCALE_INFO[l].name}</span>
                {l === locale && <Check className="size-4 text-brand" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
