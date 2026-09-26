"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { ErrorBox, Loading, PageHeader, Panel, Stat, Table } from "@/components/ui";
import { bookSummary, hoursInMonth, isMonth, markToForward, openExposure, parseContracts, type Contract, type MonthlyPld, type Side } from "@/lib/market/book";
import { toCsv } from "@/lib/csv";
import { brl, num } from "@/lib/fmt";
import { SUBS, type Sub } from "@/lib/sources/types";
import { useApi } from "@/lib/useApi";

type PldMensalResp = MonthlyPld & { meta: { latestTs: number | null }; simulated: boolean; fallback: string | null };

const STORE_KEY = "sinos.carteira.v1";
const FWD_KEY = "sinos.carteira.fwd.v1";

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
  const onStorage = (e: StorageEvent) => (e.key === STORE_KEY || e.key === FWD_KEY) && cb();
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

type Fwd = Partial<Record<Sub, number>>;
function readFwdRaw(): string {
  try {
    return localStorage.getItem(FWD_KEY) ?? "{}";
  } catch {
    return "{}";
  }
}
function parseFwd(raw: string): Fwd {
  try {
    const o = JSON.parse(raw);
    return Object.fromEntries(SUBS.filter((k) => Number.isFinite(o?.[k])).map((k) => [k, Number(o[k])])) as Fwd;
  } catch {
    return {};
  }
}
function writeFwd(f: Fwd) {
  try { localStorage.setItem(FWD_KEY, JSON.stringify(f)); } catch { /* sem storage: vale só até recarregar */ }
  listeners.forEach((l) => l());
}

/** Baixa um arquivo gerado no navegador (nada sai do dispositivo). */
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const add = () => {
    if (!valid) return;
    const c: Contract = { id: editing ?? uid(), label: f.label || undefined, submarket: f.submarket, side: f.side, volumeMWm: Number(f.volumeMWm), priceRS: Number(f.priceRS), start: f.start, end: f.end };
    setContracts((cs) => (editing ? cs.map((x) => (x.id === editing ? c : x)) : [...cs, c]));
    setEditing(null);
  };
  const edit = (c: Contract) => {
    setEditing(c.id);
    setF({ label: c.label ?? "", submarket: c.submarket, side: c.side, volumeMWm: String(c.volumeMWm), priceRS: String(c.priceRS), start: c.start, end: c.end });
  };
  const remove = (id: string) => {
    setContracts((cs) => cs.filter((c) => c.id !== id));
    if (editing === id) setEditing(null);
  };

  // curva a termo informada pelo usuário (ex.: cotação BBCE) — só para marcar os meses em aberto
  const fwdRaw = useSyncExternalStore(subscribe, readFwdRaw, () => "{}");
  const fwd = useMemo(() => parseFwd(fwdRaw), [fwdRaw]);
  const setFwd = (sub: Sub, v: string) => {
    const next: Fwd = { ...fwd };
    if (v === "" || !Number.isFinite(Number(v))) delete next[sub];
    else next[sub] = Number(v);
    writeFwd(next);
  };
  const openRows = useMemo(() => (summary ? openExposure(summary.results) : []), [summary]);
  const mtm = useMemo(() => (summary ? markToForward(summary.results, fwd) : null), [summary, fwd]);

  const exportCsv = () => {
    if (!summary) return;
    const rows = summary.results.flatMap((r) =>
      r.months.map((m) => [r.contract.label ?? "", r.contract.submarket, r.contract.side, r.contract.volumeMWm, r.contract.priceRS, m.month, m.energyMWh, m.pld?.toFixed(2) ?? "", (m.settlementRS ?? m.estimateRS)?.toFixed(2) ?? "", m.covered ? "liquidado" : m.partial ? "parcial" : "aberto"]),
    );
    download(
      `sinos-carteira-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(["rotulo", "submercado", "lado", "mw_medio", "preco_rs_mwh", "mes", "energia_mwh", "pld_medio_rs_mwh", "resultado_rs", "status"], rows, `SIN OS - carteira (swap sobre PLD medio mensal); gerado ${new Date().toISOString()}`),
      "text/csv;charset=utf-8",
    );
  };
  const exportJson = () => download(`sinos-carteira-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(contracts, null, 2), "application/json");
  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = parseContracts(JSON.parse(await file.text()));
      if (!parsed.length) throw new Error("nenhum contrato válido no arquivo");
      setContracts((cs) => [...cs.filter((c) => !parsed.some((p) => p.id === c.id)), ...parsed]);
      setMsg(`${parsed.length} contrato(s) importado(s).`);
    } catch (e) {
      setMsg(`Falha ao importar: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

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
            <Stat
              label="Meses em aberto"
              value={String(summary.openMonths)}
              hint={summary.partialMonths ? `inclui ${summary.partialMonths} parcial(is): estimativa ${brl(summary.partialRS, 0)} pela média até agora` : "dependem da curva a termo"}
            />
            <Stat label="Cobertura do PLD" value={months.length ? `${months[0]} … ${months[months.length - 1]}` : "—"} hint={`${months.length} meses no app`} />
          </div>

          <Panel title={editing ? "Editar contrato" : "Adicionar contrato"} subtitle="Swap sobre o PLD do submercado. Volume em MW médio; preço fixo em R$/MWh; período em meses (AAAA-MM).">
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
              <button onClick={add} disabled={!valid} className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40">{editing ? "Salvar alterações" : "Adicionar"}</button>
              {editing ? <button onClick={() => setEditing(null)} className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-2 hover:bg-surface-2">Cancelar edição</button> : null}
              {contracts.length === 0 ? <button onClick={() => setContracts(EXEMPLOS)} className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-2 hover:bg-surface-2">Carregar exemplos</button> : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs">
              <button onClick={exportCsv} disabled={!contracts.length} className="rounded-md border border-line px-2.5 py-1 text-ink-2 hover:bg-surface-2 disabled:opacity-40" title="Resultado mês a mês de cada contrato">↓ CSV da carteira</button>
              <button onClick={exportJson} disabled={!contracts.length} className="rounded-md border border-line px-2.5 py-1 text-ink-2 hover:bg-surface-2 disabled:opacity-40" title="Backup dos contratos para restaurar em outro navegador">↓ Backup (JSON)</button>
              <label className="cursor-pointer rounded-md border border-line px-2.5 py-1 text-ink-2 hover:bg-surface-2" title="Restaurar contratos de um backup JSON">
                ↑ Importar JSON
                <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => { void importJson(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              {msg ? <span className="text-muted" role="status">{msg}</span> : null}
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

          {openRows.length ? (
            <Panel
              title="Exposição a termo — meses em aberto"
              subtitle="Energia líquida por mês ainda sem PLD realizado (MWh; + comprado, − vendido). Informe a sua curva a termo (ex.: cotação BBCE do dia) para marcar a mercado — o valor fica só neste navegador."
            >
              <div className="mb-3 flex flex-wrap items-end gap-2 text-xs">
                {SUBS.map((s) => (
                  <label key={s} className="flex flex-col gap-1">
                    Termo {s} (R$/MWh)
                    <input className={`${inputCls} w-28`} type="number" min="0" step="1" value={fwd[s] ?? ""} placeholder="—" onChange={(e) => setFwd(s, e.target.value)} />
                  </label>
                ))}
                {mtm && mtm.pricedMonths ? (
                  <div className="ml-2 flex flex-col">
                    <span className="text-muted">MtM dos meses em aberto</span>
                    <span className={`text-lg font-semibold ${mtm.mtmRS >= 0 ? "text-good" : "text-critical"}`}>{brl(mtm.mtmRS, 0)}</span>
                    <span className="text-[11px] text-muted">{mtm.pricedMonths} mês(es)-contrato marcados{mtm.unpricedMonths ? ` · ${mtm.unpricedMonths} sem preço` : ""}</span>
                  </div>
                ) : null}
              </div>
              <Table
                head={["Mês", ...SUBS, "Total"]}
                align={["left", "right", "right", "right", "right", "right"]}
                rows={openRows.slice(0, 24).map((r) => [r.month, ...SUBS.map((s) => (r.bySub[s] === undefined ? "—" : num(r.bySub[s]!, 0))), num(r.totalMWh, 0)])}
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
                  r.openMonths ? `${r.coveredMonths} (+${r.openMonths} aberto${r.partialMonths ? `, ${r.partialMonths} parcial` : ""})` : String(r.coveredMonths),
                  r.coveredMonths ? brl(r.settledRS, 0) : "—",
                  <span key="x" className="inline-flex gap-3">
                    <button onClick={() => edit(r.contract)} className="text-accent hover:underline" title="Editar">editar</button>
                    <button onClick={() => remove(r.contract.id)} className="text-critical hover:underline" title="Remover">remover</button>
                  </span>,
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
              rows={months.slice(-12).map((m) => [
                pld.hours && SUBS.some((s) => (pld.hours?.[m]?.[s] ?? Infinity) < hoursInMonth(m)) ? `${m} (parcial)` : m,
                ...SUBS.map((s) => { const v = pld.byMonth[m]?.[s]; return v === undefined ? "—" : brl(v, 0); }),
              ])}
            />
          </Panel>
        </>
      ) : null}
    </div>
  );
}
