"use client";

import { ChevronDown, Download, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { EChart, type ChartOption } from "@/components/EChart";
import { Badge, Button, Disclosure, Empty, Panel, Table, type Level } from "@/components/ui";
import { baseOption, C, categoryAxis, valueAxis } from "@/lib/chart";
import { toCsv } from "@/lib/csv";
import { resultadosCarteira, type AlertaGestao, type LinhaResultado } from "@/lib/gd/gestao";
import type { UcGD, UsinaGD } from "@/lib/gd/types";
import { removeUsina, upsertUc, upsertUsina, useCarteira } from "@/lib/gd/workspace";

const rs = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const kwh = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Math.round(v).toLocaleString("pt-BR"));
const SEV: Record<AlertaGestao["sev"], Level> = { alta: "critical", media: "warning", baixa: "neutral" };
const ucKey = (s: string | undefined) => (s ? s.replace(/\D/g, "") || s : "sem UC");

/** Campo numérico que só grava ao sair do campo (ou Enter): a carteira não é reescrita a cada tecla. */
function Num({ label, value, onCommit, suffix, step = "any", width = "w-full" }: { label: string; value: number | undefined; onCommit: (v: number | undefined) => void; suffix?: string; step?: string; width?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined ? "" : String(value));
  const commit = () => {
    if (draft === null) return;
    const t = draft.trim().replace(",", ".");
    const v = t === "" ? undefined : Number(t);
    if (v === undefined || Number.isFinite(v)) onCommit(v);
    setDraft(null);
  };
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[12px] text-muted">
      {label}
      <span className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className={`h-9 ${width} min-w-0 rounded-lg bg-surface-2 px-2.5 text-[14px] text-ink`}
        />
        {suffix ? <span className="shrink-0 text-[12px]">{suffix}</span> : null}
      </span>
    </label>
  );
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function charts(linhas: LinhaResultado[]): { energia: ChartOption; economia: ChartOption; garantia: ChartOption } {
  const refs = linhas.map((l) => l.ref);
  const base = baseOption();
  return {
    energia: {
      ...base,
      xAxis: categoryAxis(refs),
      yAxis: valueAxis("kWh", { scale: false }),
      series: [
        { name: "Consumida", type: "bar", data: linhas.map((l) => l.consumoKwh), itemStyle: { color: C.series[1], borderRadius: [4, 4, 0, 0] }, barMaxWidth: 22 },
        { name: "Compensada", type: "line", data: linhas.map((l) => l.compensadaKwh), symbolSize: 6, lineStyle: { width: 2, color: C.series[0] }, itemStyle: { color: C.series[0] } },
      ],
    },
    economia: {
      ...base,
      xAxis: categoryAxis(refs),
      yAxis: [valueAxis("R$", { scale: false }), valueAxis("%", { scale: false, splitLine: { show: false }, position: "right" })],
      series: [
        { name: "Economia R$", type: "bar", data: linhas.map((l) => ({ value: l.economiaRs, itemStyle: { color: (l.economiaRs ?? 0) >= 0 ? C.good : C.critical, borderRadius: [4, 4, 0, 0] } })), barMaxWidth: 22 },
        { name: "Economia %", type: "line", yAxisIndex: 1, data: linhas.map((l) => l.economiaPct), symbolSize: 6, lineStyle: { width: 2, color: C.series[3] }, itemStyle: { color: C.series[3] } },
      ],
    },
    garantia: {
      ...base,
      xAxis: categoryAxis(refs),
      yAxis: valueAxis("R$", { scale: false }),
      series: [
        { name: "Realizado", type: "bar", data: linhas.map((l) => l.despesaRs), itemStyle: { color: C.series[0], borderRadius: [4, 4, 0, 0] }, barMaxWidth: 22 },
        { name: "Teto assegurado", type: "line", data: linhas.map((l) => l.assegRs), symbol: "circle", symbolSize: 7, lineStyle: { width: 2, type: "dashed", color: C.warning }, itemStyle: { color: C.warning } },
      ],
    },
  };
}

function UsinaEditor({ u, refs }: { u: UsinaGD; refs: string[] }) {
  const set = (patch: Partial<UsinaGD>) => upsertUsina({ id: u.id, ...patch });
  // botão próprio (não Disclosure): <details> aninhado herdaria o estado "aberto" do pai no ícone
  const [mesesAberto, setMesesAberto] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface-2/50 p-3">
      <div className="flex items-center gap-2">
        <input value={u.nome ?? ""} onChange={(e) => set({ nome: e.target.value.slice(0, 60) })} placeholder="Nome da usina" aria-label="Nome da usina" className="h-9 min-w-0 flex-1 rounded-lg bg-surface-2 px-2.5 text-[14px] font-semibold text-ink" />
        <button
          onClick={() => {
            if (window.confirm(`Remover a usina ${u.nome ?? u.id}?`)) removeUsina(u.id);
          }}
          className="grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-ink"
          aria-label={`Remover a usina ${u.nome ?? u.id}`}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <p className="text-[12px] text-muted">Custos mensais da usina inteira. Cada UC paga a sua parte pelo percentual de rateio.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Num label="Locação da usina" value={u.locacaoRsMes} onCommit={(v) => set({ locacaoRsMes: v })} suffix="R$/mês" />
        <Num label="Aluguel do terreno" value={u.terrenoRsMes} onCommit={(v) => set({ terrenoRsMes: v })} suffix="R$/mês" />
        <Num label="Manutenção (O&M)" value={u.omRsMes} onCommit={(v) => set({ omRsMes: v })} suffix="R$/mês" />
        <Num label="Remuneração variável" value={u.variavelRsMes} onCommit={(v) => set({ variavelRsMes: v })} suffix="R$/mês" />
        <Num label="Variável por kWh compensado" value={u.variavelRsKwh} onCommit={(v) => set({ variavelRsKwh: v })} suffix="R$/kWh" />
        <Num label="Economia assegurada" value={u.economiaAssegPct} onCommit={(v) => set({ economiaAssegPct: v === undefined ? undefined : Math.min(100, Math.max(0, v)) })} suffix="%" />
      </div>
      {refs.length ? (
        <div className="flex flex-col gap-2">
          <button type="button" onClick={() => setMesesAberto((v) => !v)} aria-expanded={mesesAberto} className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-full px-3 text-[14px] font-medium text-accent hover:bg-accent/10">
            Lançamentos por mês
            <ChevronDown size={16} className={`transition-transform ${mesesAberto ? "rotate-180" : ""}`} aria-hidden />
            <span className="ml-1 font-normal text-muted">fatura da UC geradora e ajustes que mudam no mês</span>
          </button>
          {mesesAberto ? (
          <Table
            label={`Lançamentos da usina ${u.nome ?? u.id}`}
            stack={false}
            head={["Mês", "Fatura da geradora (R$)", "Remuneração variável (R$)"]}
            rows={refs.map((ref) => [
              ref,
              <Num key="g" label="" value={u.meses?.[ref]?.faturaGeracaoRs} onCommit={(v) => set({ meses: { [ref]: { ...u.meses?.[ref], faturaGeracaoRs: v } } })} width="w-32" />,
              <Num key="v" label="" value={u.meses?.[ref]?.variavelRsMes} onCommit={(v) => set({ meses: { [ref]: { ...u.meses?.[ref], variavelRsMes: v } } })} width="w-32" />,
            ])}
          />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ucRateioRow({ uc, usinas, cadastrada }: { uc: string; usinas: UsinaGD[]; cadastrada?: UcGD }) {
  const set = (patch: Partial<UcGD>) => upsertUc({ uc, ...patch });
  const tipo = cadastrada?.contrato?.tipo ?? "";
  return [
    uc,
    <select key="u" value={cadastrada?.usinaId ?? ""} onChange={(e) => set({ usinaId: e.target.value || undefined })} aria-label={`Usina da UC ${uc}`} className="h-9 max-w-[180px] rounded-lg bg-surface-2 px-2 text-[13px] text-ink">
      <option value="">—</option>
      {usinas.map((s) => (
        <option key={s.id} value={s.id}>
          {s.nome || s.id}
        </option>
      ))}
    </select>,
    <Num key="r" label="" value={cadastrada?.rateioPct} onCommit={(v) => set({ rateioPct: v === undefined ? undefined : Math.min(100, Math.max(0, v)) })} suffix="%" width="w-24" />,
    <select
      key="c"
      value={tipo}
      onChange={(e) => set({ contrato: e.target.value ? { ...cadastrada?.contrato, tipo: e.target.value as NonNullable<UcGD["contrato"]>["tipo"] } : undefined })}
      aria-label={`Contrato da UC ${uc}`}
      className="h-9 rounded-lg bg-surface-2 px-2 text-[13px] text-ink"
    >
      <option value="">pela usina</option>
      <option value="assinatura">assinatura (desconto)</option>
      <option value="locacao">aluguel próprio</option>
    </select>,
    tipo === "assinatura" ? (
      <Num key="d" label="" value={cadastrada?.contrato?.descontoPct} onCommit={(v) => set({ contrato: { tipo: "assinatura", ...cadastrada?.contrato, descontoPct: v } })} suffix="% desc." width="w-20" />
    ) : tipo === "locacao" ? (
      <Num key="a" label="" value={cadastrada?.contrato?.aluguelRsMes} onCommit={(v) => set({ contrato: { tipo: "locacao", ...cadastrada?.contrato, aluguelRsMes: v } })} suffix="R$/mês" width="w-24" />
    ) : (
      <span key="n" className="text-muted">—</span>
    ),
  ];
}

export function Gestao() {
  const carteira = useCarteira();
  const res = useMemo(() => resultadosCarteira(carteira), [carteira]);
  const [sel, setSel] = useState("");
  // a seção de usinas abre quando não há usina e fica aberta depois (senão fecharia ao adicionar a primeira)
  const [usinasAberto, setUsinasAberto] = useState(false);
  if (!carteira.usinas.length && !usinasAberto) setUsinasAberto(true);
  const ucIds = useMemo(() => [...new Set([...carteira.faturas.map((f) => ucKey(f.uc)), ...carteira.ucs.map((u) => ucKey(u.uc))])].sort(), [carteira]);
  const opcoes = [...res.usinas.map((u) => ({ v: `usina:${u.id}`, l: `${u.nome} (todas as UCs)` })), ...res.ucs.map((u) => ({ v: u.uc, l: `UC ${u.uc}${u.apelido ? ` · ${u.apelido}` : ""}` }))];
  const atual = opcoes.some((o) => o.v === sel) ? sel : (opcoes[0]?.v ?? "");
  const ucRes = res.ucs.find((u) => u.uc === atual);
  const usRes = atual.startsWith("usina:") ? res.usinas.find((u) => `usina:${u.id}` === atual) : undefined;
  const linhas: LinhaResultado[] = useMemo(() => {
    if (ucRes) return ucRes.linhas;
    if (!usRes) return [];
    // consolidado: soma as UCs da usina mês a mês
    const membros = res.ucs.filter((u) => u.usinaId === usRes.id);
    return usRes.linhas.map((l) => {
      const ls = membros.map((m) => m.linhas.find((x) => x.ref === l.ref)).filter((x): x is LinhaResultado => !!x);
      const sum = (f: (x: LinhaResultado) => number | null) => ls.reduce((s, x) => s + (f(x) ?? 0), 0);
      const asseg = ls.every((x) => x.assegRs !== null) ? sum((x) => x.assegRs) : null;
      return {
        ref: l.ref,
        rateioPct: usRes.rateioSomaPct,
        assegPct: ls[0]?.assegPct ?? null,
        consumoKwh: sum((x) => x.consumoKwh),
        compensadaKwh: sum((x) => x.compensadaKwh),
        distribuidoraRs: sum((x) => x.distribuidoraRs),
        custos: { geracaoRs: sum((x) => x.custos.geracaoRs), locacaoRs: sum((x) => x.custos.locacaoRs), terrenoRs: sum((x) => x.custos.terrenoRs), omRs: sum((x) => x.custos.omRs), variavelRs: sum((x) => x.custos.variavelRs), contratoRs: sum((x) => x.custos.contratoRs) },
        custosGdRs: l.custosGdRs,
        despesaRs: l.despesaRs,
        cativoRs: l.cativoRs,
        cativoOrigem: null,
        economiaRs: l.economiaRs,
        economiaPct: l.economiaPct,
        assegRs: asseg,
        faltaAssegRs: asseg === null ? null : l.despesaRs - asseg,
      };
    });
  }, [ucRes, usRes, res.ucs]);
  const total = ucRes?.total ?? usRes?.total;
  const alertas = [...(ucRes?.alertas ?? []), ...(usRes?.alertas ?? []), ...(usRes ? res.ucs.filter((u) => u.usinaId === usRes.id).flatMap((u) => u.alertas) : [])];
  const graf = useMemo(() => charts(linhas), [linhas]);
  const refsUsina = (id: string) => [...new Set(carteira.faturas.filter((f) => carteira.ucs.some((u) => u.usinaId === id && ucKey(u.uc) === ucKey(f.uc))).map((f) => f.ref).filter((r): r is string => !!r))].sort();

  const exportar = () => {
    const header = ["mes", "rateio_pct", "consumo_kwh", "compensada_kwh", "fatura_distribuidora_rs", "locacao_rs", "terreno_rs", "om_rs", "variavel_rs", "geradora_rs", "contrato_rs", "despesa_total_gd_rs", "cativo_simulado_rs", "economia_rs", "economia_pct", "economia_assegurada_pct", "teto_assegurado_rs", "acima_do_teto_rs"];
    const rows = linhas.map((l) => [l.ref, l.rateioPct, l.consumoKwh, l.compensadaKwh, l.distribuidoraRs, l.custos.locacaoRs, l.custos.terrenoRs, l.custos.omRs, l.custos.variavelRs, l.custos.geracaoRs, l.custos.contratoRs, l.despesaRs, l.cativoRs, l.economiaRs, l.economiaPct, l.assegPct, l.assegRs, l.faltaAssegRs]);
    download(`sinos-gd-resultados-${atual.replace(/[^\w-]/g, "_")}.csv`, toCsv(header, rows, `SIN OS - resultados financeiros da GD (${atual}); gerado ${new Date().toISOString()}`));
  };

  return (
    <Panel
      title="Resultados financeiros"
      subtitle="Despesa com a GD (fatura da distribuidora + a parte da UC nos custos da usina, pelo rateio) contra o cativo simulado (quanto pagaria sem GD) e a economia assegurada no contrato."
      right={
        opcoes.length ? (
          <>
            <select value={atual} onChange={(e) => setSel(e.target.value)} aria-label="UC ou usina" className="h-9 max-w-[260px] rounded-lg bg-surface-2 px-2 text-[13px] text-ink">
              {opcoes.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.l}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={exportar} disabled={!linhas.length}>
              <Download size={14} aria-hidden />
              CSV
            </Button>
          </>
        ) : null
      }
    >
      {!carteira.faturas.length ? (
        <Empty label="Envie as faturas das UCs beneficiárias para ver o resultado mês a mês." />
      ) : (
        <div className="flex flex-col gap-4">
          <Disclosure title="Usinas e custos" hint={carteira.usinas.length ? `${carteira.usinas.length} usina(s)` : "cadastre a usina para ratear os custos"} defaultOpen={usinasAberto}>
            {carteira.usinas.map((u) => (
              <UsinaEditor key={u.id} u={u} refs={refsUsina(u.id)} />
            ))}
            <div>
              <Button variant="secondary" onClick={() => upsertUsina({ id: `u${Date.now().toString(36)}`, nome: `Usina ${carteira.usinas.length + 1}` })}>
                <Plus size={14} aria-hidden />
                Adicionar usina
              </Button>
            </div>
          </Disclosure>
          <Disclosure title="UCs, rateio e contrato" hint="o rateio informado à distribuidora deve fechar 100% por usina">
            <Table
              label="Rateio das UCs"
              stack={false}
              head={["UC", "Usina", "Rateio", "Contrato", ""]}
              rows={ucIds.map((id) => ucRateioRow({ uc: id, usinas: carteira.usinas, cadastrada: carteira.ucs.find((u) => ucKey(u.uc) === id) }))}
            />
          </Disclosure>

          {alertas.length ? (
            <ul className="flex flex-col gap-2" aria-label="Alertas dos resultados">
              {alertas.map((a, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-surface-2/40 px-3 py-2 text-[13px]">
                  <Badge level={SEV[a.sev]}>{a.sev}</Badge>
                  {a.impactoRs ? <span className="tnum ml-auto font-medium text-ink sm:order-last">{rs(a.impactoRs)}</span> : null}
                  <span className="w-full text-ink-2 sm:w-auto sm:min-w-0 sm:flex-1">{a.msg}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {total ? (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Despesa total com a GD", rs(total.despesaRs)],
                ["Cativo simulado", rs(total.cativoRs)],
                ["Economia percebida", `${rs(total.economiaRs)} · ${pct(total.economiaPct)}`],
                ["Acima do teto assegurado", rs(total.faltaAssegRs)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-2xl bg-surface-2/60 p-3">
                  <dt className="text-[12px] text-muted">{k}</dt>
                  <dd className="tnum text-[17px] font-semibold text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <Table
            label="Resultado mês a mês"
            head={["Mês", "Rateio", "Distribuidora", "Custos GD", "Despesa", "Cativo", "Economia", "%", "Teto", "Acima do teto"]}
            align={["left", "right", "right", "right", "right", "right", "right", "right", "right", "right"]}
            rows={linhas.map((l) => [
              l.ref,
              pct(l.rateioPct),
              rs(l.distribuidoraRs),
              rs(l.custosGdRs),
              rs(l.despesaRs),
              <span key="c" title={l.cativoOrigem ? `cativo pela ${l.cativoOrigem}` : undefined}>
                {rs(l.cativoRs)}
              </span>,
              <span key="e" className={(l.economiaRs ?? 0) < 0 ? "text-critical" : ""}>
                {rs(l.economiaRs)}
              </span>,
              <span key="p" className={(l.economiaPct ?? 0) < 0 ? "text-critical" : ""}>
                {pct(l.economiaPct)}
              </span>,
              rs(l.assegRs),
              <span key="f" className={(l.faltaAssegRs ?? 0) > 0 ? "font-medium text-critical" : "text-muted"}>
                {l.faltaAssegRs !== null && l.faltaAssegRs > 0 ? rs(l.faltaAssegRs) : "—"}
              </span>,
            ])}
          />
          <Disclosure title="Custos rateados mês a mês" hint="locação, terreno, O&M, variável, geradora e contrato">
            <Table
              label="Custos rateados"
              head={["Mês", "Locação", "Terreno", "O&M", "Variável", "Geradora", "Contrato", "Total", "Consumo kWh", "Compensada kWh"]}
              align={["left", "right", "right", "right", "right", "right", "right", "right", "right", "right"]}
              rows={linhas.map((l) => [l.ref, rs(l.custos.locacaoRs), rs(l.custos.terrenoRs), rs(l.custos.omRs), rs(l.custos.variavelRs), rs(l.custos.geracaoRs), rs(l.custos.contratoRs), rs(l.custosGdRs), kwh(l.consumoKwh), kwh(l.compensadaKwh)])}
            />
          </Disclosure>

          {linhas.length ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {(
                [
                  ["Energia consumida × compensada", graf.energia, "Energia consumida e compensada por mês"],
                  ["Economia mensal", graf.economia, "Economia mensal em reais e em percentual"],
                  ["Realizado × economia assegurada", graf.garantia, "Despesa realizada e teto com a economia assegurada"],
                ] as const
              ).map(([t, o, l]) => (
                <figure key={t} className="min-w-0 rounded-2xl bg-surface-2/40 p-3">
                  <figcaption className="mb-1 text-[13px] font-semibold text-ink">{t}</figcaption>
                  <EChart option={o} height={240} label={l} />
                </figure>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
