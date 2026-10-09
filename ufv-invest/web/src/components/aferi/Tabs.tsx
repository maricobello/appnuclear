"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

export type TabDef = { id: string; label: string; content: ReactNode };

/** Abas acessíveis (setas do teclado) sincronizadas com o #hash da URL */
export function Tabs({ tabs, initial }: { tabs: TabDef[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);

  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      if (tabs.some((t) => t.id === h)) setActive(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tabs]);

  const select = (id: string, focus = false) => {
    setActive(id);
    history.replaceState(null, "", `#${id}`);
    if (focus) document.getElementById(`tab-${id}`)?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label="Seções da usina" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            role="tab"
            aria-selected={active === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            onClick={() => select(t.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") select(tabs[(i + 1) % tabs.length].id, true);
              if (e.key === "ArrowLeft") select(tabs[(i - 1 + tabs.length) % tabs.length].id, true);
            }}
            className={cx(
              "relative shrink-0 whitespace-nowrap px-3 py-3 text-[14px] font-medium transition",
              active === t.id ? "text-good after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-leaf" : "text-ink-2 hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} id={`panel-${t.id}`} role="tabpanel" aria-labelledby={`tab-${t.id}`} hidden={active !== t.id} className="pt-6">
          {t.content}
        </div>
      ))}
    </div>
  );
}
