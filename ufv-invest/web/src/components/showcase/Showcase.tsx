"use client";

import { useMemo, useState } from "react";
import type { PlantSummary } from "@/lib/analysis";
import { cx } from "@/components/ui";

type Filter = "todas" | "captacao" | "construcao" | "operacao";
type Sort = "destaque" | "tir" | "renda" | "payback";

const filters: { id: Filter; label: string }[] = [
  { id: "todas", label: "Todas" },
  { id: "captacao", label: "Em captação" },
  { id: "construcao", label: "Em construção" },
  { id: "operacao", label: "Em operação" },
];

/** Vitrine com filtros por fase e ordenação; os cards são renderizados no servidor e passados prontos. */
export function Showcase({ items, cards }: { items: PlantSummary[]; cards: Record<string, React.ReactNode> }) {
  const [filter, setFilter] = useState<Filter>("todas");
  const [sort, setSort] = useState<Sort>("destaque");

  const shown = useMemo(() => {
    const list = items.filter((s) => filter === "todas" || s.status === filter);
    // destaque: ofertas abertas primeiro (é onde dá para investir agora), depois em construção e em operação
    const phase = { captacao: 0, construcao: 1, operacao: 2 } as const;
    return [...list].sort((a, b) =>
      sort === "destaque"
        ? phase[a.status] - phase[b.status] || b.irrNominalPct - a.irrNominalPct
        : sort === "tir"
          ? b.irrNominalPct - a.irrNominalPct
          : sort === "renda"
            ? b.monthlyPerCotaBRL - a.monthlyPerCotaBRL
            : (a.paybackYears ?? 99) - (b.paybackYears ?? 99),
    );
  }, [items, filter, sort]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrar usinas por fase">
          {filters.map((f) => {
            const count = f.id === "todas" ? items.length : items.filter((s) => s.status === f.id).length;
            return (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cx(
                  "rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition",
                  filter === f.id ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-ink-2 hover:text-ink",
                )}
              >
                {f.label} <span className="ml-1 tnum opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          Ordenar por
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-ink">
            <option value="destaque">Destaques</option>
            <option value="tir">Maior rentabilidade</option>
            <option value="renda">Maior renda por cota</option>
            <option value="payback">Menor payback</option>
          </select>
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="mt-10 text-center text-[14px] text-muted">Nenhuma usina nesta fase no momento.</p>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((s) => (
            <div key={s.slug}>{cards[s.slug]}</div>
          ))}
        </div>
      )}
    </div>
  );
}
