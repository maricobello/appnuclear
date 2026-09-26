"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { ErrorBox, Loading, PageHeader, Panel, Stat, Table } from "@/components/ui";
import { bookSummary, isMonth, type Contract, type MonthlyPld, type Side } from "@/lib/market/book";
import { brl, num } from "@/lib/fmt";
import { SUBS, type Sub } from "@/lib/sources/types";
import { useApi } from "@/lib/useApi";

type PldMensalResp = MonthlyPld & { meta: { latestTs: number | null }; simulated: boolean; fallback: string | null };

const STORE_KEY = "sinos.carteira.v1";

// store externo (localStorage) — evita setState em efeito e mantém hidratação consistente
let listeners: (() => void)[] = [];
function readRaw(): string {
  try {
    return localStorage.getItem(STORE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}
function writeContracts(cs: Contract[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(cs));
  } catch {
    /* modo privado / storage cheio — segue sem persistir */
  }
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.push(cb);
  const onStorage = (e: StorageEvent) => e.key === STORE_KEY && cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
    window.removeEventListener("storage", onStorage);
  };
}
function useContracts(): [Contract[], (u: Contract[] | ((c: Contract[]) => Contract[])) => void] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "[]");
  const contracts = useMemo(() => {
    try {
      const a = JSON.parse(raw);
      return Array.isArray(a) ? (a as Contract[]) : [];
    } catch {
      return [];
    }
  }, [raw]);
  const set = (u: Contract[] | ((c: Contract[]) => Contract[])) => writeContracts(typeof u === "function" ? u(contracts) : u);
  return [contracts, set];
}

const uid = () => Math.random().toString(36).slice(2, 10);

const EXEMPLOS: Contract[] = [
  { id: uid(), label: "PPA anual SE", submarket: "SE", side: "compra", volumeMWm: 10, priceRS: 180, start: "2026-01", end: "2026-12" },
  { id: uid(), label: "Venda NE", submarket: "NE", side: "venda", volumeMWm: 5, priceRS: 160, start: "2026-06", end: "2026-12" },
];

export default function CarteiraPage() {
  const { data: pld, error } = useApi<PldMensalResp>("/api/pld-mensal", 600_000);
  const [contracts, setContracts] = useContracts();

  const summary = useMemo(() => (pld ? bookSummary(contracts, pld) : null), [contracts, pld]);
  const months = pld?.months ?? [];

  // formulário
  const [f, setF] = useState<{ label: string; submarket: Sub; side: Side; volumeMWm: string; priceRS: string; start: string; end: string }>({
    label: "",
    submarket: "SE",
    side: "compra",
    volumeMWm: "10",
    priceRS: "180",
    start: months[0] ?? "2026-01",
    end: months[months.length - 1] ?? "2026-12",
  });
  const valid = isMonth(f.start) && isMonth(f.end) && f.start <= f.end && Number(f.volumeMWm) > 0 && Number(f.priceRS) > 0;

  const add = () => {
    if (!valid) return;
    setContracts((cs) => [...cs, { id: uid(), label: f.label || undefined, submarket: f.submarket, side: f.side, volumeMWm: Number(f.volumeMWm), priceRS: Number(f.priceRS), start: f.start, end: f.end }]);
  };
  const remove = (id: string) => setContracts((cs) => cs.filter((c) => c.id !== id));

  const inputCls = "rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Carteira"
        subtitle="Contratos como swap financeiro sobre o PLD médio mensal por submercado: liquidação de curto prazo, exposição líquida e resultado. Os contratos ficam salvos só neste navegador."
      />

      <div role="note" className="flex items-start gap-2 rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-[11px] text-muted">
        <span aria-hidden>ℹ️</span>
        <span>
          Modelo simplificado da <strong className="text-ink-2">liquidação de curto prazo</strong> (a &ldquo;metade PLD&rdquo; do resultado): não inclui sazonalização/flexibilidade,
          encargos, TUST/TUSD, tributos, MRE/GSF nem garantia física. Só liquida meses com <strong className="text-ink-2">PLD realizado</strong> disponível no app
          {pld?.simulated ? " (atenção: PLD atual SIMULADO)" : pld?.fallback ? " (PLD estimado pelo CMO do ONS)" : ""}; meses futuros dependem da <strong className="text-ink-2">curva a termo (BBCE)</strong>, que o app ainda não tem.
        </span>
      </div>

      {error && !pld ? <ErrorBox error={error} /> : null}
      {!pld ? <Loading label="Carregando PLD mensal…" height={120} /> : null}

      {pld && summary ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Resultado liquidado" value={brl(summary.settledRS, 0)} deltaGood={summary.settledRS >= 0} delta={summary.settledRS >= 0 ? "a favor da carteira" : "contra a carteira"} hint="meses com PLD realizado" />
            <Stat label="Contratos" value={String(contracts.length)} hint={`${summary.coveredMonths} meses liquidados`} />
            <Stat label="Meses em aberto" value={String(summary.openMonths)} hint="dependem da curva a termo" />
            <Stat label="Cobertura do PLD" value={months.length ? `${months[0]} … ${months[months.length - 1]}` : "—"} hint={`${months.length} meses no app`} />
          </div>

          <Panel title="Adicionar contrato" subtitle="Swap sobre o PLD do submercado. Volume em MW médio; preço fixo em R$/MWh; período em meses (AAAA-MM).">
            <div className="flex flex-wrap items-end gap-2 text-xs">
              <label className="flex flex-col gap-1">Rótulo<input className={inputCls} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="opcional" /></label>
              <label className="flex flex-col gap-1">Submercado
                <select className={inputCls} value={f.submarket} onChange={(e) => setF({ ...f, submarket: e.target.value as Sub })}>{SUBS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
              </label>
              <label className="flex flex-col gap-1">Lado
                <select className={inputCls} value={f.side} onChange={(e) => setF({ ...f, side: e.target.value as Side })}><option value="compra">compra</option><option value="venda">venda</option></select>
              </label>
              <label className="flex flex-col gap-1">MW médio<input className={`${inputCls} w-24`} type="number" min="0" step="1" value={f.volumeMWm} onChange={(e) => setF({ ...f, volumeMWm: e.target.value })} /></label>
              <label className="flex flex-col gap-1">Preço R$/MWh<input className={`${inputCls} w-28`} type="number" min="0" step="1" value={f.priceRS} onChange={(e) => setF({ ...f, priceRS: e.target.value })} /></label>
              <label className="flex flex-col gap-1">Início<input className={`${inputCls} w-28`} type="month" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
              <label className="flex flex-col gap-1">Fim<input className={`${inputCls} w-28`} type="month" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label>
              <button onClick={add} disabled={!valid} className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40">Adicionar</button>
              {contracts.length === 0 ? <button onClick={() => setContracts(EXEMPLOS)} className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-2 hover:bg-surface-2">Carregar exemplos</button> : null}
            </div>
          </Panel>

          {summary.exposure.length ? (
            <Panel title="Exposição líquida por submercado" subtitle={`MW médio ativos no último mês com PLD (${summary.latestMonth ?? "—"}). Positivo = comprado, negativo = vendido.`}>
              <Table
                head={["Submercado", "Exposição (MWm)", "Contratos"]}
                align={["left", "right", "right"]}
                rows={summary.exposure.map((e) => [e.submarket, num(e.netMWm, 1), String(e.contracts)])}
              />
            </Panel>
          ) : null}

          <Panel title="Contratos" subtitle="Liquidação = Σ (PLD_mês − preço)·energia (comprador; simétrico para vendedor), nos meses com PLD realizado.">
            {contracts.length ? (
              <Table
                head={["Rótulo", "Sub", "Lado", "MWm", "Preço", "Período", "Meses liq.", "Resultado", ""]}
                align={["left", "left", "left", "right", "right", "left", "right", "right", "right"]}
                rows={summary.results.map((r) => [
                  r.contract.label ?? "—",
                  r.contract.submarket,
                  r.contract.side,
                  num(r.contract.volumeMWm, 0),
                  brl(r.contract.priceRS, 0),
                  `${r.contract.start} → ${r.contract.end}`,
                  r.openMonths ? `${r.coveredMonths} (+${r.openMonths} aberto)` : String(r.coveredMonths),
                  r.coveredMonths ? brl(r.settledRS, 0) : "—",
                  <button key="x" onClick={() => remove(r.contract.id)} className="text-critical hover:underline" title="Remover">remover</button>,
                ])}
              />
            ) : (
              <p className="text-xs text-muted">Nenhum contrato. Adicione acima ou carregue os exemplos.</p>
            )}
          </Panel>

          <Panel title="PLD médio mensal (referência)" subtitle="Base da liquidação, calculado do painel realizado do app por submercado.">
            <Table
              head={["Mês", ...SUBS]}
              align={["left", "right", "right", "right", "right"]}
              rows={months.slice(-12).map((m) => [m, ...SUBS.map((s) => { const v = pld.byMonth[m]?.[s]; return v === undefined ? "—" : brl(v, 0); })])}
            />
          </Panel>
        </>
      ) : null}
    </div>
  );
}
