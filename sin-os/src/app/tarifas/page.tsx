"use client";

import { ChevronDown, FileDown, Pencil, RotateCcw } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { EChart, type ChartOption } from "@/components/EChart";
import { Badge, Button, Disclosure, Empty, ErrorBox, Loading, PageHeader, Panel, Segmented, Stat, Table } from "@/components/ui";
import { baseOption, C, categoryAxis, valueAxis } from "@/lib/chart";
import { useApi } from "@/lib/useApi";
import { useBusyFlag } from "@/lib/busy";
import { PanelVeil } from "@/components/LoadingVeil";
import { Usina } from "./Usina";
import { efetiva, ICMS_UF, PREMISSAS_PADRAO, simularReforma, type Decomposicao, type PremissasReforma } from "@/lib/tarifa/calc";
import type { Bandeira, Linha, TarifaVigente } from "@/lib/sources/aneel";

const SUBGRUPOS = ["B1", "B2", "B3", "A4", "A3a", "A3", "A2", "AS"] as const;
const NAO_CONSUMIDOR = new Set(["Geração", "Distribuição", "Energia suprimento"]);
type Sub = (typeof SUBGRUPOS)[number];
const brl = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const kwh = (v: number) => `R$ ${brl(v, 4)}`;
const pct = (v: number) => `${brl(v * 100, 2)}%`;
const dataBr = (s: string) => (s ? s.split("-").reverse().join("/") : "—");
const chave = (l: Linha) => [l.modalidade, l.subclasse, l.detalhe, l.posto, l.unidade].join("|");

function Campo({ label, value, onChange, suffix = "%", step = "0.01", readOnly = false, action }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; step?: string; readOnly?: boolean; action?: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[12px] text-muted">
      {label}
      <span className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          readOnly={readOnly}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`h-10 w-full min-w-0 rounded-lg px-2.5 text-[14px] ${readOnly ? "bg-surface-2/50 text-ink-2" : "bg-surface-2 text-ink"}`}
        />
        {suffix ? <span className="shrink-0 text-[12px]">{suffix}</span> : null}
        {action}
      </span>
    </label>
  );
}

/** Lápis (preencher à mão) ↔ seta circular (voltar ao automático), discreto ao lado do campo. */
function BotaoManual({ manual, onToggle, nome }: { manual: boolean; onToggle: () => void; nome: string }) {
  const Icon = manual ? RotateCcw : Pencil;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        onToggle();
      }}
      title={manual ? `Voltar ${nome} automático` : `Preencher ${nome} à mão`}
      aria-label={manual ? `Voltar ${nome} automático` : `Preencher ${nome} à mão`}
      className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
    >
      <Icon size={13} aria-hidden />
    </button>
  );
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Seleção de distribuidora: a seta abre a lista inteira; digitar filtra. */
function BuscaDistribuidora({ value, options, onChange, ufs }: { value: string; options: string[]; onChange: (v: string) => void; ufs: Record<string, string> }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState<string | null>(null);
  const [ativo, setAtivo] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtradas = useMemo(() => {
    if (!busca) return options;
    const q = semAcento(busca).replace(/[^a-z0-9]/g, "");
    return options.filter((o) => semAcento(o).replace(/[^a-z0-9]/g, "").includes(q) || semAcento(ufs[o] ?? "") === q);
  }, [busca, options, ufs]);
  const escolher = (v: string) => {
    onChange(v);
    setBusca(null);
    setAberto(false);
    inputRef.current?.blur();
  };
  return (
    <div className="relative min-w-0">
      <div className="flex h-10 items-center rounded-lg bg-surface-2">
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={aberto}
          aria-controls="tarifas-lista-agentes"
          aria-label="Distribuidora"
          value={busca ?? value}
          onFocus={(e) => {
            e.currentTarget.select();
            setAberto(true);
          }}
          onChange={(e) => {
            setBusca(e.target.value);
            setAtivo(0);
            setAberto(true);
          }}
          onBlur={() => setTimeout(() => (setAberto(false), setBusca(null)), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setAberto(true);
              setAtivo((i) => Math.min(filtradas.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAtivo((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter" && filtradas[ativo]) {
              e.preventDefault();
              escolher(filtradas[ativo]);
            } else if (e.key === "Escape") {
              setAberto(false);
              setBusca(null);
            }
          }}
          className="h-10 w-full min-w-0 bg-transparent px-2.5 text-[14px] text-ink outline-none"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Abrir lista de distribuidoras"
          onMouseDown={(e) => {
            e.preventDefault();
            setBusca(null);
            setAtivo(Math.max(0, options.indexOf(value)));
            setAberto((a) => !a);
            if (!aberto) inputRef.current?.focus();
          }}
          className="grid h-10 w-9 shrink-0 place-items-center text-muted hover:text-ink"
        >
          <ChevronDown size={16} aria-hidden className={aberto ? "rotate-180 transition-transform" : "transition-transform"} />
        </button>
      </div>
      {aberto ? (
        <ul id="tarifas-lista-agentes" role="listbox" className="absolute left-0 right-0 top-11 z-30 max-h-72 overflow-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
          {filtradas.length ? (
            filtradas.map((o, i) => (
              <li
                key={o}
                role="option"
                aria-selected={o === value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  escolher(o);
                }}
                onMouseEnter={() => setAtivo(i)}
                ref={(el) => {
                  if (el && i === ativo && aberto) el.scrollIntoView({ block: "nearest" });
                }}
                className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-[14px] ${i === ativo ? "bg-surface-2" : ""} ${o === value ? "font-semibold text-ink" : "text-ink-2"}`}
              >
                <span className="truncate">{o}</span>
                {ufs[o] ? <span className="shrink-0 text-[12px] text-muted">{ufs[o]}</span> : null}
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-[13px] text-muted">Nenhuma distribuidora com esse nome.</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

function Escolha({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[12px] text-muted">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-full min-w-0 rounded-lg bg-surface-2 px-2.5 text-[14px] text-ink">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface Lista {
  agentes: string[];
  bandeira: Bandeira;
  /** UF de cada distribuidora (ANEEL: CNPJ × municípios atendidos). */
  uf?: Record<string, string>;
}
interface Resp {
  tarifa: TarifaVigente;
  bandeira: Bandeira;
  decomposicao: Decomposicao | null;
}

export default function TarifasPage() {
  const lista = useApi<Lista>("/api/tarifas", 3600_000);
  const [agente, setAgente] = useState("CPFL-PAULISTA");
  const [sub, setSub] = useState<Sub>("B1");
  const [modal, setModal] = useState("");
  const [sel, setSel] = useState("");
  // null = automático (ICMS pela UF da distribuidora; PIS/Cofins de referência); número = preenchido à mão
  const [manual, setManual] = useState<{ icms: number | null; pis: number | null; cofins: number | null }>({ icms: null, pis: null, cofins: null });
  const [band, setBand] = useState("atual");
  const [aba, setAba] = useState<"consumidor" | "usina">("consumidor");
  const [prem, setPrem] = useState<PremissasReforma>(PREMISSAS_PADRAO);
  const [fat, setFat] = useState({ preco: 0, consumo: 300 });

  const base = useApi<Resp>(`/api/tarifas?agente=${encodeURIComponent(agente)}&subgrupo=${sub}`, 1800_000);
  // tarifas de consumidor: sem TUSDg (Geração), sem tarifas entre distribuidoras e sem linhas por acessante
  const linhas = useMemo(() => (base.data?.tarifa.linhas ?? []).filter((l) => !NAO_CONSUMIDOR.has(l.modalidade) && (!l.acessante || l.acessante === "Não se aplica")), [base.data]);
  const modalidades = useMemo(() => [...new Set(linhas.map((l) => l.modalidade))], [linhas]);
  const modalidade = modalidades.includes(modal) ? modal : (modalidades.find((m) => m === "Convencional") ?? modalidades[0] ?? "");
  // a linha "cheia" (subclasse = classe, sem detalhe SCEE/APE) primeiro; depois as sociais e as de GD
  const peso = (l: Linha) => (l.subclasse === l.classe ? 0 : 2) + (l.detalhe === "Não se aplica" ? 0 : 1);
  const visiveis = useMemo(() => linhas.filter((l) => l.modalidade === modalidade).sort((a, b) => peso(a) - peso(b) || a.classe.localeCompare(b.classe, "pt-BR") || a.subclasse.localeCompare(b.subclasse, "pt-BR") || a.posto.localeCompare(b.posto, "pt-BR")), [linhas, modalidade]);
  const energia = visiveis.filter((l) => l.unidade === "MWh");
  const linha = visiveis.find((l) => chave(l) === sel) ?? energia.find((l) => l.subclasse === "Residencial" && l.detalhe === "Não se aplica") ?? energia[0] ?? visiveis[0];

  const compUrl = linha
    ? `/api/tarifas?${new URLSearchParams({ agente, subgrupo: sub, modalidade: linha.modalidade, subclasse: linha.subclasse, detalhe: linha.detalhe, posto: linha.posto, unidade: linha.unidade })}`
    : null;
  const comp = useApi<Resp>(compUrl, 1800_000, { veil: false });
  const dec = comp.data?.decomposicao ?? null;

  const uf = lista.data?.uf?.[agente] ?? null;
  const auto = { icms: Math.round((uf && ICMS_UF[uf] !== undefined ? ICMS_UF[uf] : PREMISSAS_PADRAO.icms) * 10000) / 100, pis: Math.round(PREMISSAS_PADRAO.pis * 10000) / 100, cofins: Math.round(PREMISSAS_PADRAO.cofins * 10000) / 100 };
  const trib = { icms: manual.icms ?? auto.icms, pis: manual.pis ?? auto.pis, cofins: manual.cofins ?? auto.cofins };
  const alternar = (k: keyof typeof manual) => setManual((m) => ({ ...m, [k]: m[k] === null ? trib[k] : null }));
  const definir = (k: keyof typeof manual, v: number) => setManual((m) => ({ ...m, [k]: v }));

  const bandeira = base.data?.bandeira ?? lista.data?.bandeira;
  const bandOpts = [{ value: "atual", label: bandeira ? `Vigente (${bandeira.competencia}): ${bandeira.nome}` : "Vigente" }, { value: "Verde", label: "Verde" }, ...(bandeira?.tabela ?? []).map((t) => ({ value: t.nome, label: `${t.nome} (+R$ ${brl(t.adicionalMwh)}/MWh)` }))];
  const bandMwh = band === "atual" ? (bandeira?.adicionalMwh ?? 0) : band === "Verde" ? 0 : (bandeira?.tabela.find((t) => t.nome === band)?.adicionalMwh ?? 0);
  const isEnergia = linha?.unidade === "MWh";
  const ef = linha && isEnergia ? efetiva(linha.te, linha.tusd, bandMwh, { icms: trib.icms / 100, pis: trib.pis / 100, cofins: trib.cofins / 100 }) : null;
  const baseMwh = linha && isEnergia ? linha.te + linha.tusd + bandMwh : null;
  const reforma = useMemo(() => (baseMwh === null ? [] : simularReforma(baseMwh, { ...prem, icms: trib.icms / 100, pis: trib.pis / 100, cofins: trib.cofins / 100 })), [baseMwh, prem, trib.icms, trib.pis, trib.cofins]);

  const decOpt = useMemo<ChartOption | null>(() => {
    if (!dec?.grupos.length) return null;
    const g = [...dec.grupos].reverse();
    return {
      ...baseOption(),
      grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
      legend: { top: 0, textStyle: { color: C.muted } },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: unknown) => `R$ ${brl(Number(v))}/MWh` },
      xAxis: valueAxis("R$/MWh"),
      yAxis: categoryAxis(g.map((x) => x.grupo)),
      series: [
        { name: "TE", type: "bar", stack: "t", data: g.map((x) => x.te), itemStyle: { color: C.series[0] } },
        { name: "TUSD", type: "bar", stack: "t", data: g.map((x) => x.tusd), itemStyle: { color: C.series[1] } },
      ],
    } as ChartOption;
  }, [dec]);

  const refOpt = useMemo<ChartOption | null>(() => {
    if (!reforma.length) return null;
    const anos = reforma.map((r) => String(r.ano));
    const s = (name: string, k: "semTributosKwh" | "icmsKwh" | "pisCofinsKwh" | "cbsKwh" | "ibsKwh", color: string) => ({ name, type: "bar", stack: "t", data: reforma.map((r) => r[k]), itemStyle: { color } });
    return {
      ...baseOption(),
      grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
      legend: { top: 0, textStyle: { color: C.muted } },
      tooltip: { trigger: "axis", valueFormatter: (v: unknown) => `R$ ${brl(Number(v), 4)}/kWh` },
      xAxis: categoryAxis(anos),
      yAxis: valueAxis("R$/kWh", { min: 0 }),
      series: [
        s("Tarifa sem tributos", "semTributosKwh", C.series[0]),
        s("ICMS", "icmsKwh", C.series[2]),
        s("PIS/Cofins", "pisCofinsKwh", C.series[3]),
        s("CBS", "cbsKwh", C.series[1]),
        s("IBS", "ibsKwh", C.series[4] ?? C.series[1]),
        { name: "Custo líquido p/ empresa (com crédito)", type: "line", data: reforma.map((r) => r.liquidoEmpresaKwh), symbol: "circle", lineStyle: { type: "dashed" }, itemStyle: { color: C.muted } },
      ],
    } as ChartOption;
  }, [reforma]);

  const err = base.error ?? lista.error;
  const t = base.data?.tarifa;
  const [exportando, setExportando] = useState(false);
  useBusyFlag(exportando, "Gerando laudo…");
  const exportar = async () => {
    if (!t || !linha) return;
    setExportando(true);
    try {
      const [{ jsPDF }, { montarLaudo, nomeArquivo }] = await Promise.all([import("jspdf"), import("@/lib/tarifa/laudo")]);
      const origem = (k: keyof typeof manual, ref: string) => (manual[k] === null ? ref : "informado manualmente");
      const bandNome = band === "atual" ? (bandeira ? `${bandeira.nome} (vigente ${bandeira.competencia})` : "Vigente") : band;
      const dados = {
        geradoEm: new Date(),
        distribuidora: agente,
        uf,
        subgrupo: sub,
        modalidade,
        linha: { subclasse: linha.subclasse, detalhe: linha.detalhe, posto: linha.posto, unidade: linha.unidade, te: linha.te, tusd: linha.tusd },
        reh: t.reh,
        vigencia: { inicio: t.inicio, fim: t.fim },
        proxima: t.proxima,
        geracaoAneel: t.geracaoAneel,
        decomposicao: dec,
        bandeira: { nome: bandNome, adicionalMwh: bandMwh },
        tributos: { ...trib, origem: { icms: origem("icms", uf ? `referência ${uf}` : "padrão"), pis: origem("pis", "referência"), cofins: origem("cofins", "referência") } },
        efetiva: ef,
        fatura: fat.preco > 0 ? { precoKwh: fat.preco, consumoKwh: fat.consumo } : null,
        reforma,
        premissasReforma: { cbsRef: prem.cbsRef, ibsRef: prem.ibsRef, icmsNaBase: prem.icmsNaBase },
      };
      montarLaudo(jsPDF, dados).save(nomeArquivo(dados));
    } finally {
      setExportando(false);
    }
  };
  const auditoria = ef && fat.preco > 0 ? { dif: fat.preco - ef.comTributosKwh, pct: (fat.preco / ef.comTributosKwh - 1) * 100 } : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tarifas & tributos"
        subtitle="Tarifa homologada de todas as distribuidoras (ANEEL, atualizada todo dia), componentes abertos, tarifa efetiva com tributos e simulação da reforma tributária (CBS/IBS) até 2033."
        right={
          <div className="flex flex-wrap items-center gap-2">
            {t ? <Badge level="good" title={`Conjunto regenerado pela ANEEL em ${dataBr(t.geracaoAneel ?? "")}`}>ANEEL · {dataBr(t.geracaoAneel ?? "")}</Badge> : null}
            {aba === "consumidor" ? (
              <Button variant="secondary" onClick={exportar} disabled={!t || !linha || exportando || base.trocando || comp.trocando}>
                <FileDown size={14} aria-hidden /> {exportando ? "Gerando…" : "Exportar laudo (PDF)"}
              </Button>
            ) : null}
          </div>
        }
      />

      <Segmented
        label="Tipo de unidade"
        value={aba}
        options={[
          { value: "consumidor", label: "Consumidor" },
          { value: "usina", label: "Usina (gerador)" },
        ]}
        onChange={setAba}
      />

      <Panel title={aba === "usina" ? "Distribuidora" : "Distribuidora e subgrupo"} subtitle="A vigente é a resolução homologatória que cobre o dia de hoje.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-1 text-[12px] text-muted">
          <span>Distribuidora ({lista.data?.agentes.length ?? "…"})</span>
          <BuscaDistribuidora
            value={agente}
            options={lista.data?.agentes ?? [agente]}
            ufs={lista.data?.uf ?? {}}
            onChange={(v) => {
              setAgente(v);
              setSel("");
              setModal("");
            }}
          />
        </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Campo
              label={manual.icms === null ? `ICMS ${uf ? `(${uf}, automático)` : "(UF não identificada)"}` : "ICMS (manual)"}
              value={trib.icms}
              readOnly={manual.icms === null}
              onChange={(v) => definir("icms", v)}
              action={<BotaoManual nome="o ICMS" manual={manual.icms !== null} onToggle={() => alternar("icms")} />}
            />
            <span className="text-[12px] text-muted">{manual.icms !== null ? `Referência ${uf ?? "—"}: ${pct(auto.icms / 100)} · vale o valor digitado` : uf ? "Alíquota de referência da UF da distribuidora" : lista.data ? "Padrão de 18%: toque no lápis para informar" : "…"}</span>
          </div>
        </div>
        {aba === "consumidor" ? (
        <>
        <div className="mt-3 flex flex-wrap gap-3">
          <Segmented
            label="Subgrupo"
            value={sub}
            options={SUBGRUPOS.map((s) => ({ value: s, label: s }))}
            onChange={(v) => {
              setSub(v);
              setSel("");
              setModal("");
            }}
          />
          {modalidades.length > 1 ? <Segmented label="Modalidade" value={modalidade} options={modalidades.map((m) => ({ value: m, label: m }))} onChange={(v) => { setModal(v); setSel(""); }} /> : null}
        </div>
        {t ? (
          <p className="mt-3 text-[13px] text-muted">
            <b className="text-ink">{t.reh}</b> · vigência {dataBr(t.inicio)} a {dataBr(t.fim)}
            {t.proxima ? ` · próxima: ${dataBr(t.proxima.inicio)} (${t.proxima.reh})` : ""}
          </p>
        ) : null}
        </>
        ) : null}
      </Panel>

      {err ? <ErrorBox error={err} onRetry={() => { void base.mutate(); void lista.mutate(); }} /> : null}

      {aba === "usina" ? (
        <Usina agente={agente} uf={uf} icmsPct={trib.icms} icmsOrigem={manual.icms !== null ? "informado manualmente" : uf ? `referência ${uf}` : "padrão"} />
      ) : (
      <>

      <Panel title="Tarifa vigente (sem tributos)" subtitle="Tarifa de aplicação em R$/MWh (energia) e R$/kW (demanda). Toque numa linha para abrir os componentes.">
        {base.isLoading && !t ? (
          <Loading />
        ) : visiveis.length ? (
          <Table
            label="Tarifas homologadas"
            head={["Subclasse", "Detalhe", "Posto", "Un.", "TUSD", "TE", "Total"]}
            align={["left", "left", "left", "left", "right", "right", "right"]}
            rowClass={(i) => (visiveis[i] && linha && chave(visiveis[i]) === chave(linha) ? "bg-surface-2" : "cursor-pointer")}
            rows={visiveis.map((l) => [
              <button key="s" type="button" className="text-left underline-offset-2 hover:underline" onClick={() => setSel(chave(l))}>
                {l.subclasse}
              </button>,
              l.detalhe,
              l.posto,
              `R$/${l.unidade}`,
              brl(l.tusd),
              brl(l.te),
              <b key="t">{brl(l.tusd + l.te)}</b>,
            ])}
          />
        ) : (
          <Empty label="Sem linhas para este subgrupo nesta distribuidora." />
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel
          title="Componentes da tarifa"
          subtitle={linha ? `${linha.modalidade} · ${linha.subclasse} · ${linha.posto} (R$/${linha.unidade})` : "Escolha uma linha"}
          right={dec?.residuo != null && !comp.trocando ? <Badge level={Math.abs(dec.residuo) <= 1 ? "good" : "warning"} title="Soma dos componentes menos TE+TUSD publicadas">{Math.abs(dec.residuo) <= 1 ? "fecha com a tarifa" : `resíduo R$ ${brl(dec.residuo)}`}</Badge> : null}
        >
          <div className="relative min-h-[120px]">
          <PanelVeil show={comp.trocando} label="Carregando componentes da ANEEL…" />
          {comp.isLoading && !dec ? (
            <Loading />
          ) : dec?.grupos.length ? (
            <>
              {decOpt ? <EChart option={decOpt} height={280} label="Componentes por grupo" /> : null}
              <Disclosure title={`Ver os ${dec.itens.length} componentes`}>
                <Table
                  label="Componentes"
                  head={["Componente", "Grupo", "Parcela", "R$/" + (linha?.unidade ?? "MWh")]}
                  align={["left", "left", "left", "right"]}
                  stack={false}
                  rows={dec.itens.map((i) => [<span key="c" title={i.codigo}>{i.rotulo}</span>, i.grupo, i.parcela, brl(i.valorMwh, 2)])}
                />
              </Disclosure>
            </>
          ) : (
            <Empty label="A ANEEL não publicou componentes para esta linha (ou ainda não para esta vigência)." />
          )}
          </div>
        </Panel>

        <Panel title="Tarifa efetiva (com tributos)" subtitle="Como sai na fatura: ICMS e PIS/Cofins calculados por dentro, bandeira somada à energia.">
          {!linha ? (
            <Empty />
          ) : !isEnergia ? (
            <Empty label="Linha de demanda (R$/kW): escolha uma linha em R$/MWh para a tarifa por kWh." />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
                <Campo label={manual.icms === null ? `ICMS${uf ? ` (${uf})` : ""}` : "ICMS (manual)"} value={trib.icms} readOnly={manual.icms === null} onChange={(v) => definir("icms", v)} action={<BotaoManual nome="o ICMS" manual={manual.icms !== null} onToggle={() => alternar("icms")} />} />
                <Campo label={manual.pis === null ? "PIS (ref.)" : "PIS (manual)"} value={trib.pis} readOnly={manual.pis === null} onChange={(v) => definir("pis", v)} action={<BotaoManual nome="o PIS" manual={manual.pis !== null} onToggle={() => alternar("pis")} />} />
                <Campo label={manual.cofins === null ? "Cofins (ref.)" : "Cofins (manual)"} value={trib.cofins} readOnly={manual.cofins === null} onChange={(v) => definir("cofins", v)} action={<BotaoManual nome="a Cofins" manual={manual.cofins !== null} onToggle={() => alternar("cofins")} />} />
              </div>
              <div className="mt-3">
                <Escolha label="Bandeira" value={band} options={bandOpts} onChange={setBand} />
              </div>
              {ef ? (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="Sem tributos" value={brl(ef.semTributosKwh, 4)} unit="R$/kWh" />
                  <Stat label="Com tributos" value={brl(ef.comTributosKwh, 4)} unit="R$/kWh" hint={`carga tributária +${brl(ef.cargaPct, 1)}%`} />
                  <Stat label="ICMS" value={brl(ef.icmsKwh, 4)} unit="R$/kWh" />
                  <Stat label="PIS + Cofins" value={brl(ef.pisKwh + ef.cofinsKwh, 4)} unit="R$/kWh" />
                  <Stat label="Bandeira" value={brl(bandMwh / 1000, 4)} unit="R$/kWh" />
                </div>
              ) : null}
              <p className="mt-3 text-[12px] text-muted">O ICMS sai automático pela UF da distribuidora (referência estadual: confira faixas de isenção e a classe). PIS/Cofins mudam todo mês por distribuidora: para auditar, toque no lápis e use as alíquotas da fatura.</p>

              <div className="mt-5 border-t border-line pt-4">
                <h3 className="text-[14px] font-semibold text-ink">Auditoria rápida da fatura</h3>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <Campo label="Preço cobrado (com tributos)" value={fat.preco} onChange={(v) => setFat({ ...fat, preco: v })} suffix="R$/kWh" step="0.0001" />
                  <Campo label="Consumo do mês" value={fat.consumo} onChange={(v) => setFat({ ...fat, consumo: v })} suffix="kWh" step="1" />
                </div>
                {auditoria ? (
                  <p className="mt-2 text-[13px]">
                    <Badge level={Math.abs(auditoria.pct) <= 1 ? "good" : Math.abs(auditoria.pct) <= 3 ? "warning" : "critical"}>{auditoria.pct >= 0 ? "+" : ""}{brl(auditoria.pct, 2)}%</Badge>{" "}
                    {kwh(auditoria.dif)}/kWh em relação à tarifa calculada; no mês, {auditoria.dif >= 0 ? "cobrado a mais" : "cobrado a menos"} ≈ R$ {brl(Math.abs(auditoria.dif * fat.consumo))}. Diferenças acima de 1% pedem conferência (alíquotas, bandeira, dias de leitura em duas vigências).
                  </p>
                ) : (
                  <p className="mt-2 text-[12px] text-muted">Digite o preço unitário com tributos que aparece na fatura (R$/kWh) para comparar.</p>
                )}
              </div>
            </>
          )}
        </Panel>
      </div>

      <Panel
        title="Reforma tributária: CBS e IBS na tarifa (simulação 2026–2033)"
        subtitle="Sim, CBS e IBS incidem sobre a energia elétrica. Eles substituem PIS/Cofins (2027) e ICMS (2029 a 2033). Alíquotas de referência são estimativas editáveis."
      >
        {!reforma.length ? (
          <Empty label="Escolha uma linha de energia (R$/MWh) acima." />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Campo label="CBS de referência" value={Math.round(prem.cbsRef * 10000) / 100} onChange={(v) => setPrem({ ...prem, cbsRef: v / 100 })} />
              <Campo label="IBS de referência" value={Math.round(prem.ibsRef * 10000) / 100} onChange={(v) => setPrem({ ...prem, ibsRef: v / 100 })} />
              <Escolha label="ICMS na base do IBS/CBS?" value={prem.icmsNaBase ? "sim" : "nao"} options={[{ value: "nao", label: "Não (LC 214/2025)" }, { value: "sim", label: "Sim (cenário conservador)" }]} onChange={(v) => setPrem({ ...prem, icmsNaBase: v === "sim" })} />
            </div>
            {refOpt ? <div className="mt-4"><EChart option={refOpt} height={320} label="Tarifa por ano da transição" /></div> : null}
            <Table
              label="Transição ano a ano"
              head={["Ano", "ICMS", "PIS/Cofins", "CBS", "IBS", "Consumidor final", "vs. 2026", "Empresa (líquido)", "O que muda"]}
              align={["left", "right", "right", "right", "right", "right", "right", "right", "left"]}
              rows={reforma.map((r) => [
                <b key="a">{r.ano}</b>,
                brl(r.icmsKwh, 4),
                brl(r.pisCofinsKwh, 4),
                r.ano === 2026 ? <span key="c" title="destacado e compensado">({brl(r.destaqueTesteKwh, 4)})</span> : brl(r.cbsKwh, 4),
                brl(r.ibsKwh, 4),
                <b key="t">{brl(r.totalKwh, 4)}</b>,
                `${r.totalKwh >= reforma[0].totalKwh ? "+" : ""}${brl((r.totalKwh / reforma[0].totalKwh - 1) * 100, 1)}%`,
                brl(r.liquidoEmpresaKwh, 4),
                <span key="n" className="text-[12px] text-muted">{r.nota}</span>,
              ])}
            />
            <Disclosure title="Como a simulação funciona e o que ainda precisa ser conferido">
              <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-ink-2">
                <li>Base: TE + TUSD + bandeira da linha escolhida, em R$/kWh, sem tributos.</li>
                <li>ICMS e PIS/Cofins são calculados por dentro, como na fatura de hoje: base ÷ (1 − alíquotas).</li>
                <li>CBS e IBS são calculados por fora, sobre o valor sem esses tributos. A LC 214/2025 tira ICMS, PIS/Cofins e o próprio IBS/CBS da base (o cenário conservador inclui o ICMS).</li>
                <li>Em 2026 é só teste: CBS de 0,9% e IBS de 0,1% aparecem destacados na nota e são compensados com PIS/Cofins, sem custo novo. Por isso o valor fica entre parênteses.</li>
                <li>Para empresas no regime regular, CBS e IBS dão crédito integral; a coluna &quot;Empresa (líquido)&quot; tira esse crédito. Consumidor residencial não tem crédito.</li>
                <li>Conferir: as alíquotas de referência definitivas (resolução do Senado e calibragem anual); a alíquota do IBS de cada estado e município; o cashback de energia para famílias de baixa renda do CadÚnico (LC 214/2025); a regra de energia compensada na GD (SCEE); e como a ANEEL vai tratar os tributos nos reajustes.</li>
              </ul>
            </Disclosure>
          </>
        )}
      </Panel>
      </>
      )}
    </div>
  );
}
