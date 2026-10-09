"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import type { PlantSummary } from "@/lib/analysis";
import { cx } from "@/components/ui";

type Status = "todas" | "operacao" | "implantacao" | "encerrada";
const TABS: { id: Status; label: string }[] = [
  { id: "todas", label: "Todas" },
  { id: "operacao", label: "Em operação" },
  { id: "implantacao", label: "Em implantação" },
  { id: "encerrada", label: "Oferta encerrada" },
];
const POT = [
  { id: "", label: "Potência (MWp)" },
  { id: "ate-1.5", label: "Até 1,5 MWp", test: (k: number) => k <= 1500 },
  { id: "1.5-3", label: "1,5 a 3 MWp", test: (k: number) => k > 1500 && k <= 3000 },
  { id: "acima-3", label: "Acima de 3 MWp", test: (k: number) => k > 3000 },
];
const PPA = [
  { id: "", label: "PPA" },
  { id: "ativo", label: "PPA ativo" },
  { id: "inativo", label: "Sem PPA ativo" },
];
const ROI = [
  { id: "", label: "ROI (retorno)" },
  { id: "ate-5", label: "Retorno em até 5 anos", test: (y: number | null) => y != null && y <= 5 },
  { id: "5-7", label: "Retorno de 5 a 7 anos", test: (y: number | null) => y != null && y > 5 && y <= 7 },
  { id: "acima-7", label: "Retorno acima de 7 anos", test: (y: number | null) => y == null || y > 7 },
];
const SORTS = [
  { id: "relevantes", label: "Mais relevantes" },
  { id: "roi", label: "Maior ROI" },
  { id: "rentabilidade", label: "Maior rentabilidade (TIR)" },
  { id: "cota", label: "Menor valor da cota" },
  { id: "payback", label: "Menor prazo de retorno" },
  { id: "potencia", label: "Maior potência" },
];
const UF_NAME: Record<string, string> = { MG: "Minas Gerais", BA: "Bahia", PE: "Pernambuco", SP: "São Paulo", GO: "Goiás" };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const selectCls =
  "h-10 rounded-lg border border-line-strong bg-surface-2 pl-3 pr-8 text-[13px] text-ink-2 outline-none transition focus:border-brand appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%235b6b7c%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:12px] bg-[right_10px_center] bg-no-repeat";

export function UsinasExplorer({ items, cards }: { items: PlantSummary[]; cards: Record<string, ReactNode> }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [uf, setUf] = useState(sp.get("uf") ?? "");
  const [tab, setTab] = useState<Status>((TABS.find((t) => t.id === sp.get("status"))?.id as Status) ?? "todas");
  const [pot, setPot] = useState(sp.get("pot") ?? "");
  const [sort, setSort] = useState(sp.get("ordem") ?? "relevantes");
  const [ppa, setPpa] = useState(sp.get("ppa") ?? "");
  const [roi, setRoi] = useState(sp.get("roi") ?? "");
  const [adv, setAdv] = useState(false);
  const [minIrr, setMinIrr] = useState(sp.get("rent") ?? "");
  const [maxCota, setMaxCota] = useState(sp.get("cotamax") ?? "");
  const [fioB, setFioB] = useState(sp.get("fiob") === "1");
  const [tracker, setTracker] = useState(sp.get("seguidor") === "1");

  const sync = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const ufs = useMemo(() => [...new Set(items.map((i) => i.uf))].sort(), [items]);

  const shown = useMemo(() => {
    const potTest = POT.find((p) => p.id === pot)?.test;
    const roiTest = ROI.find((r) => r.id === roi)?.test;
    const nq = norm(q.trim());
    const list = items.filter(
      (i) =>
        (tab === "todas" || i.status === tab) &&
        (!uf || i.uf === uf) &&
        (!potTest || potTest(i.dcKWp)) &&
        (!ppa || (ppa === "ativo" ? i.ppaActive : !i.ppaActive)) &&
        (!roiTest || roiTest(i.paybackYears)) &&
        (!nq || norm(`${i.name} ${i.municipio} ${i.uf} ${i.distribuidora}`).includes(nq)) &&
        (!minIrr || i.irrNominalPct >= Number(minIrr)) &&
        (!maxCota || i.cotaPriceBRL <= Number(maxCota)) &&
        (!fioB || i.tags.includes("Fio B isento até 2045")) &&
        (!tracker || i.mounting === "single-axis"),
    );
    const phase = { operacao: 0, implantacao: 1, encerrada: 2 } as const;
    const by: Record<string, (a: PlantSummary, b: PlantSummary) => number> = {
      relevantes: (a, b) => phase[a.status] - phase[b.status] || b.irrNominalPct - a.irrNominalPct,
      roi: (a, b) => b.roiTotalPct - a.roiTotalPct,
      rentabilidade: (a, b) => b.irrNominalPct - a.irrNominalPct,
      cota: (a, b) => a.cotaPriceBRL - b.cotaPriceBRL,
      payback: (a, b) => (a.paybackYears ?? 99) - (b.paybackYears ?? 99),
      potencia: (a, b) => b.dcKWp - a.dcKWp,
    };
    return [...list].sort(by[sort] ?? by.relevantes);
  }, [items, tab, uf, pot, ppa, roi, q, minIrr, maxCota, fioB, tracker, sort]);

  const activeAdv = [ppa, roi, uf, pot, minIrr, maxCota, fioB, tracker].filter(Boolean).length;
  const clearAll = () => {
    setQ("");
    setUf("");
    setTab("todas");
    setPot("");
    setPpa("");
    setRoi("");
    setMinIrr("");
    setMaxCota("");
    setFioB(false);
    setTracker(false);
    router.replace(pathname, { scroll: false });
  };

  return (
    <div>
      {/* busca, filtros e ordenação */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <label htmlFor="busca-usinas" className="sr-only">
            Buscar usina ou cidade
          </label>
          <input
            id="busca-usinas"
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              sync({ q: e.target.value || null });
            }}
            placeholder="Buscar usina ou cidade"
            className="h-11 w-full rounded-xl border border-line-strong bg-surface-2 pl-10 pr-3 text-[14px] text-ink placeholder:text-muted outline-none transition focus:border-brand"
          />
        </div>
        <button
          type="button"
          onClick={() => setAdv((a) => !a)}
          aria-expanded={adv}
          className={cx("inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-[14px] font-medium transition", adv || activeAdv ? "border-brand bg-brand-soft text-good" : "border-line-strong bg-surface-2 text-ink-2 hover:bg-surface-3")}
        >
          <SlidersHorizontal className="size-4" /> Filtros{activeAdv ? ` (${activeAdv})` : ""}
        </button>
        <label className="sr-only" htmlFor="f-ordem">
          Ordenar por
        </label>
        <select
          id="f-ordem"
          className={cx(selectCls, "h-11 rounded-xl text-[14px]")}
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            sync({ ordem: e.target.value === "relevantes" ? null : e.target.value });
          }}
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {adv && (
        <div className="mt-3 glass rounded-xl p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-[12px] font-medium text-ink-2">
              Contrato de energia (PPA)
              <select
                className={cx(selectCls, "mt-1 w-full")}
                value={ppa}
                onChange={(e) => {
                  setPpa(e.target.value);
                  sync({ ppa: e.target.value || null });
                }}
              >
                {PPA.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id ? p.label : "Todos"}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] font-medium text-ink-2">
              Retorno do investimento (ROI)
              <select
                className={cx(selectCls, "mt-1 w-full")}
                value={roi}
                onChange={(e) => {
                  setRoi(e.target.value);
                  sync({ roi: e.target.value || null });
                }}
              >
                {ROI.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id ? r.label : "Qualquer prazo"}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] font-medium text-ink-2">
              Estado
              <select
                className={cx(selectCls, "mt-1 w-full")}
                value={uf}
                onChange={(e) => {
                  setUf(e.target.value);
                  sync({ uf: e.target.value || null });
                }}
              >
                <option value="">Todos</option>
                {ufs.map((u) => (
                  <option key={u} value={u}>
                    {UF_NAME[u] ?? u}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] font-medium text-ink-2">
              Tamanho
              <select
                className={cx(selectCls, "mt-1 w-full")}
                value={pot}
                onChange={(e) => {
                  setPot(e.target.value);
                  sync({ pot: e.target.value || null });
                }}
              >
                {POT.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id ? p.label : "Qualquer"}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] font-medium text-ink-2">
              Rentabilidade mínima (% ao ano)
              <input
                type="number"
                min={0}
                step={0.5}
                inputMode="decimal"
                value={minIrr}
                onChange={(e) => {
                  setMinIrr(e.target.value);
                  sync({ rent: e.target.value || null });
                }}
                placeholder="ex.: 15"
                className="mt-1 h-10 w-full rounded-lg border border-line-strong px-3 text-[13px] outline-none focus:border-brand"
              />
            </label>
            <label className="text-[12px] font-medium text-ink-2">
              Cota de até (R$)
              <input
                type="number"
                min={0}
                step={50}
                inputMode="numeric"
                value={maxCota}
                onChange={(e) => {
                  setMaxCota(e.target.value);
                  sync({ cotamax: e.target.value || null });
                }}
                placeholder="ex.: 1000"
                className="mt-1 h-10 w-full rounded-lg border border-line-strong px-3 text-[13px] outline-none focus:border-brand"
              />
            </label>
            <label className="flex items-center gap-2 self-end rounded-lg border border-line-strong px-3 py-2.5 text-[13px] text-ink-2">
              <input
                type="checkbox"
                checked={fioB}
                onChange={(e) => {
                  setFioB(e.target.checked);
                  sync({ fiob: e.target.checked ? "1" : null });
                }}
                className="size-4 accent-[var(--brand)]"
              />
              Isenta do Fio B
            </label>
            <label className="flex items-center gap-2 self-end rounded-lg border border-line-strong px-3 py-2.5 text-[13px] text-ink-2">
              <input
                type="checkbox"
                checked={tracker}
                onChange={(e) => {
                  setTracker(e.target.checked);
                  sync({ seguidor: e.target.checked ? "1" : null });
                }}
                className="size-4 accent-[var(--brand)]"
              />
              Com seguidor solar
            </label>
          </div>
          {activeAdv > 0 && (
            <button onClick={clearAll} className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-good hover:underline">
              <X className="size-4" /> Limpar filtros
            </button>
          )}
        </div>
      )}

      {/* abas de status */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Status da usina">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              sync({ status: t.id === "todas" ? null : t.id });
            }}
            className={cx("rounded-full px-4 py-1.5 text-[13px] font-medium transition", tab === t.id ? "bg-white text-[#06090e]" : "text-ink-2 hover:bg-surface-2")}
          >
            {t.label}
          </button>
        ))}
      </div>
        <span className="text-[13px] text-muted" aria-live="polite">
          {shown.length} {shown.length === 1 ? "usina" : "usinas"}
        </span>
      </div>

      <h2 className="sr-only">Resultados</h2>
      {shown.length > 0 ? (
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{shown.map((s) => cards[s.slug])}</div>
      ) : (
        <div className="mt-6 rounded-xl border border-dashed border-line-strong p-10 text-center">
          <p className="text-[15px] font-semibold text-ink">Nenhuma usina com esses filtros.</p>
          <button onClick={clearAll} className="mt-3 inline-flex items-center gap-1 text-[14px] font-semibold text-good hover:underline">
            <X className="size-4" /> Limpar filtros
          </button>
        </div>
      )}
    </div>
  );
}
