"use client";

import { FileDown } from "lucide-react";
import { useMemo, useState } from "react";
import { PanelVeil } from "@/components/LoadingVeil";
import { Badge, Button, Disclosure, Empty, ErrorBox, Loading, Panel, Segmented, Stat, Table, type Level } from "@/components/ui";
import { useBusyFlag } from "@/lib/busy";
import type { Enquadramento } from "@/lib/gd/rules";
import type { Bandeira, TarifaVigente } from "@/lib/sources/aneel";
import { PREMISSAS_PADRAO } from "@/lib/tarifa/calc";
import { conferirUsina, faturaUsina, tarifaUsinaDe, type ComponentesFio, type EntradaUsina } from "@/lib/tarifa/usina";
import { useApi } from "@/lib/useApi";

const SUBS = ["A4", "A3a", "A3", "A2", "AS"] as const;
type Sub = (typeof SUBS)[number];
const brl = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const dataBr = (s: string | null | undefined) => (s ? s.split("-").reverse().join("/") : "—");

interface Resp {
  tarifa: TarifaVigente;
  bandeira: Bandeira;
  fio: Record<"ponta" | "fora", ComponentesFio> | null;
}

function N({ label, value, onChange, suffix, step = "any" }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; step?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[12px] text-muted">
      {label}
      <span className="flex items-center gap-1">
        <input type="number" inputMode="decimal" step={step} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value) || 0)} className="h-10 w-full min-w-0 rounded-lg bg-surface-2 px-2.5 text-[14px] text-ink" />
        {suffix ? <span className="shrink-0 text-[12px]">{suffix}</span> : null}
      </span>
    </label>
  );
}

function Sel<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[12px] text-muted">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="h-10 w-full min-w-0 rounded-lg bg-surface-2 px-2.5 text-[14px] text-ink">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const STATUS: Record<string, Level> = { conforme: "good", atenção: "warning", divergente: "critical", "—": "neutral" };
const NIVEL: Record<string, Level> = { alta: "critical", media: "warning", info: "neutral" };

export function Usina({ agente, uf, icmsPct, icmsOrigem }: { agente: string; uf: string | null; icmsPct: number; icmsOrigem: string }) {
  const [sub, setSub] = useState<Sub>("A4");
  const [modalidade, setModalidade] = useState<"Verde" | "Azul">("Verde");
  const [regime, setRegime] = useState<"SCEE" | "fora">("SCEE");
  const [enq, setEnq] = useState<Enquadramento>("GD II");
  const [ano, setAno] = useState(new Date().getFullYear());
  const [pis, setPis] = useState(Math.round(PREMISSAS_PADRAO.pis * 10000) / 100);
  const [cofins, setCofins] = useState(Math.round(PREMISSAS_PADRAO.cofins * 10000) / 100);
  const [band, setBand] = useState("atual");
  const [m, setM] = useState({ consP: 1200, consF: 18000, injP: 0, injF: 160000, cred: 0, aloc: 120000, dcU: 250, dmU: 240, dcP: 250, dcF: 250, dmP: 230, dmF: 245, dgC: 1000, dgM: 980, reativo: 0, cip: 0, outros: 0 });
  const [modo, setModo] = useState<"excedente" | "total">("excedente");
  const [isenta, setIsenta] = useState(true);
  const [icmsNc, setIcmsNc] = useState(true);
  const [real, setReal] = useState<Record<string, number>>({});
  const [totalReal, setTotalReal] = useState(0);
  const [exportando, setExportando] = useState(false);
  useBusyFlag(exportando, "Gerando laudo da usina…");

  const q = useApi<Resp>(`/api/tarifas?agente=${encodeURIComponent(agente)}&subgrupo=${sub}&usina=${modalidade}`, 1800_000);
  const t = q.data?.tarifa;
  const tarifa = useMemo(() => (t ? tarifaUsinaDe(t.linhas, modalidade, q.data?.fio ?? null) : null), [t, modalidade, q.data?.fio]);
  const bandeira = q.data?.bandeira;
  const bandMwh = band === "atual" ? (bandeira?.adicionalMwh ?? 0) : band === "Verde" ? 0 : (bandeira?.tabela.find((x) => x.nome === band)?.adicionalMwh ?? 0);
  const bandNome = band === "atual" ? (bandeira ? `${bandeira.nome} (vigente ${bandeira.competencia})` : "vigente") : band;

  const entrada: EntradaUsina = {
    regime,
    enquadramento: enq,
    ano,
    consumo: { ponta: m.consP, fora: m.consF },
    injecao: { ponta: m.injP, fora: m.injF },
    creditoAnteriorKwh: m.cred,
    alocadoOutrasKwh: m.aloc,
    demandaContratada: modalidade === "Verde" ? { unica: m.dcU } : { ponta: m.dcP, fora: m.dcF },
    demandaMedida: modalidade === "Verde" ? { unica: m.dmU } : { ponta: m.dmP, fora: m.dmF },
    demandaGerContratada: m.dgC,
    demandaInjMedida: m.dgM,
    modoDemandaGeracao: modo,
    bandeiraMwh: bandMwh,
    tributos: { icms: icmsPct / 100, pis: pis / 100, cofins: cofins / 100 },
    icmsIsentaCompensada: isenta,
    icmsSobreNaoCompensada: icmsNc,
    reativoRs: m.reativo,
    cipRs: m.cip,
    outrosRs: m.outros,
  };
  const fat = tarifa ? faturaUsina(tarifa, entrada) : null;
  const conf = fat ? conferirUsina(fat, real, totalReal || undefined) : null;
  const set = (k: keyof typeof m) => (v: number) => setM((x) => ({ ...x, [k]: v }));

  const exportar = async () => {
    if (!fat || !tarifa || !t) return;
    setExportando(true);
    try {
      const [{ jsPDF }, { montarLaudoUsina, nomeArquivoUsina }] = await Promise.all([import("jspdf"), import("@/lib/tarifa/laudo")]);
      const dados = {
        geradoEm: new Date(),
        distribuidora: agente,
        uf,
        subgrupo: sub,
        reh: t.reh,
        vigencia: { inicio: t.inicio, fim: t.fim },
        geracaoAneel: t.geracaoAneel,
        bandeira: `${bandNome} (+R$ ${brl(bandMwh)}/MWh)`,
        tarifa,
        entrada,
        fatura: fat,
        conferencia: conf,
        origemTributos: `ICMS ${brl(icmsPct)}% (${icmsOrigem}) · PIS ${brl(pis)}% · Cofins ${brl(cofins)}%`,
      };
      montarLaudoUsina(jsPDF, dados).save(nomeArquivoUsina(dados));
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Usina (gerador): tarifa e contrato"
        subtitle="Unidade onde fica a usina, no grupo A: energia compensada por posto, Fio B não compensado, demanda de consumo e de geração (TUSDg). Para microgeração no grupo B, use a tela de Geração distribuída."
        right={
          <Button variant="secondary" onClick={exportar} disabled={!fat || exportando || q.trocando}>
            <FileDown size={14} aria-hidden /> {exportando ? "Gerando…" : "Exportar laudo da usina (PDF)"}
          </Button>
        }
      >
        <div className="flex flex-wrap gap-3">
          <Segmented label="Subgrupo da usina" value={sub} options={SUBS.map((s) => ({ value: s, label: s }))} onChange={setSub} />
          <Segmented label="Modalidade" value={modalidade} options={[{ value: "Verde", label: "Verde" }, { value: "Azul", label: "Azul" }]} onChange={setModalidade} />
          <Segmented label="Regime" value={regime} options={[{ value: "SCEE", label: "SCEE (GD)" }, { value: "fora", label: "Fora do SCEE" }]} onChange={setRegime} />
        </div>
        {q.error ? <div className="mt-3"><ErrorBox error={q.error} onRetry={() => void q.mutate()} /></div> : null}
        {q.isLoading && !tarifa ? (
          <Loading height={140} />
        ) : !tarifa ? (
          <Empty label={`A ${agente} não tem tarifa ${modalidade} no ${sub} vigente nos dados da ANEEL.`} />
        ) : (
          <div className="relative mt-4">
            <PanelVeil show={q.trocando} label="Carregando tarifa da usina…" />
            {t ? <p className="mb-3 text-[13px] text-muted"><b className="text-ink">{t.reh}</b> · vigência {dataBr(t.inicio)} a {dataBr(t.fim)}</p> : null}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="TE ponta" value={brl(tarifa.energia.ponta.te)} unit="R$/MWh" />
              <Stat label="TUSD ponta" value={brl(tarifa.energia.ponta.tusd)} unit="R$/MWh" />
              <Stat label="TE fora ponta" value={brl(tarifa.energia.fora.te)} unit="R$/MWh" />
              <Stat label="TUSD fora ponta" value={brl(tarifa.energia.fora.tusd)} unit="R$/MWh" />
              <Stat label={modalidade === "Verde" ? "Demanda (TUSD)" : "Demanda ponta / fora"} value={modalidade === "Verde" ? brl(tarifa.demanda.unica ?? 0) : `${brl(tarifa.demanda.ponta ?? 0)} / ${brl(tarifa.demanda.fora ?? 0)}`} unit="R$/kW" />
              <Stat label="TUSDg (geração)" value={tarifa.tusdg === null ? "—" : brl(tarifa.tusdg)} unit="R$/kW" hint={tarifa.tusdg === null ? "não publicada" : undefined} />
            </div>
            <p className="mt-3 text-[12px] text-muted">
              Fio B na energia: ponta {tarifa.fio ? `R$ ${brl(tarifa.fio.ponta.fioB)}` : "—"} · fora ponta {tarifa.fio ? `R$ ${brl(tarifa.fio.fora.fioB)}` : "—"} por MWh.
              {modalidade === "Azul" || tarifa.fio?.ponta.fioB === 0 ? " Nesta modalidade o Fio B está na demanda, não na energia." : " Na Verde, a ponta carrega o Fio B da demanda de ponta."}
            </p>
          </div>
        )}
      </Panel>

      <Panel title="Medição e contrato do mês" subtitle="Valores da fatura ou da memória de massa. Pontos regulatórios em aberto ficam como opção.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {regime === "SCEE" ? <Sel label="Enquadramento" value={enq} options={[{ value: "GD I", label: "GD I (até 07/01/2023)" }, { value: "GD II", label: "GD II" }, { value: "GD III", label: "GD III (>500 kW não despachável)" }]} onChange={setEnq} /> : null}
          {regime === "SCEE" ? <N label="Ano de referência" value={ano} onChange={setAno} step="1" /> : null}
          <N label="Consumo da rede ponta" value={m.consP} onChange={set("consP")} suffix="kWh" />
          <N label="Consumo da rede fora ponta" value={m.consF} onChange={set("consF")} suffix="kWh" />
          {regime === "SCEE" ? <N label="Injeção ponta" value={m.injP} onChange={set("injP")} suffix="kWh" /> : null}
          {regime === "SCEE" ? <N label="Injeção fora ponta" value={m.injF} onChange={set("injF")} suffix="kWh" /> : null}
          {regime === "SCEE" ? <N label="Crédito anterior disponível" value={m.cred} onChange={set("cred")} suffix="kWh" /> : null}
          {regime === "SCEE" ? <N label="Alocado a outras UCs (rateio)" value={m.aloc} onChange={set("aloc")} suffix="kWh" /> : null}
          {modalidade === "Verde" ? (
            <>
              <N label="Demanda contratada (consumo)" value={m.dcU} onChange={set("dcU")} suffix="kW" />
              <N label="Demanda medida (consumo)" value={m.dmU} onChange={set("dmU")} suffix="kW" />
            </>
          ) : (
            <>
              <N label="Demanda contratada ponta" value={m.dcP} onChange={set("dcP")} suffix="kW" />
              <N label="Demanda contratada fora ponta" value={m.dcF} onChange={set("dcF")} suffix="kW" />
              <N label="Demanda medida ponta" value={m.dmP} onChange={set("dmP")} suffix="kW" />
              <N label="Demanda medida fora ponta" value={m.dmF} onChange={set("dmF")} suffix="kW" />
            </>
          )}
          <N label={regime === "fora" ? "MUSD contratado (geração)" : "Demanda de geração contratada"} value={m.dgC} onChange={set("dgC")} suffix="kW" />
          <N label="Injeção máxima medida" value={m.dgM} onChange={set("dgM")} suffix="kW" />
          <N label="PIS" value={pis} onChange={setPis} suffix="%" step="0.01" />
          <N label="Cofins" value={cofins} onChange={setCofins} suffix="%" step="0.01" />
          <Sel
            label="Bandeira"
            value={band}
            options={[{ value: "atual", label: bandeira ? `Vigente (${bandeira.competencia}${bandeira.defasada ? ", mês atual não publicado" : ""}): ${bandeira.nome}` : "Vigente" }, { value: "Verde", label: "Verde" }, ...(bandeira?.tabela ?? []).map((x) => ({ value: x.nome, label: `${x.nome} (+R$ ${brl(x.adicionalMwh)}/MWh)` }))]}
            onChange={setBand}
          />
          <N label="Reativo excedente (da fatura)" value={m.reativo} onChange={set("reativo")} suffix="R$" />
          <N label="CIP (da fatura)" value={m.cip} onChange={set("cip")} suffix="R$" />
          <N label="Outros (multas, juros)" value={m.outros} onChange={set("outros")} suffix="R$" />
        </div>
        {regime === "SCEE" ? (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Sel label="Base da TUSDg (conferir §7º art. 655-J)" value={modo} options={[{ value: "excedente", label: "Injeção que excede a demanda de consumo" }, { value: "total", label: "Toda a demanda de injeção" }]} onChange={setModo} />
            <Sel label="ICMS na energia compensada" value={isenta ? "isenta" : "tributa"} options={[{ value: "isenta", label: "Isento (Conv. ICMS 16/2015)" }, { value: "tributa", label: "Tributado" }]} onChange={(v) => setIsenta(v === "isenta")} />
            <Sel label="ICMS sobre o Fio B não compensado" value={icmsNc ? "sim" : "nao"} options={[{ value: "sim", label: "Sim (maioria dos estados)" }, { value: "nao", label: "Não" }]} onChange={(v) => setIcmsNc(v === "sim")} />
          </div>
        ) : null}
        <p className="mt-3 text-[12px] text-muted">ICMS {brl(icmsPct)}% ({icmsOrigem}), ajustável na caixa do ICMS no topo.</p>
      </Panel>

      {fat ? (
        <>
          {regime === "SCEE" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Compensado ponta" value={brl(fat.compensacao.compensado.ponta, 0)} unit="kWh" />
              <Stat label="Compensado fora ponta" value={brl(fat.compensacao.compensado.fora, 0)} unit="kWh" />
              <Stat label="Faturado (rede)" value={brl(fat.compensacao.faturado.ponta + fat.compensacao.faturado.fora, 0)} unit="kWh" />
              <Stat label="Fator entre postos" value={brl(fat.compensacao.fatorPontaFora, 4)} hint="TE fora ponta ÷ TE ponta" />
              <Stat label="Excedente (equiv. FP)" value={brl(fat.compensacao.excedenteKwh, 0)} unit="kWh" />
              <Stat label="Saldo após rateio" value={brl(fat.compensacao.novoSaldoKwh, 0)} unit="kWh" />
            </div>
          ) : null}

          <Panel
            title="Fatura esperada × fatura real"
            subtitle="Digite o valor de cada item como está na fatura (R$, com tributos) para conferir. Tolerância: até 1% conforme, até 3% atenção."
            right={conf?.total ? <Badge level={STATUS[conf.total.status]}>{conf.total.status} · {conf.total.dif >= 0 ? "+" : ""}R$ {brl(conf.total.dif)}</Badge> : null}
          >
            <Table
              label="Fatura da usina"
              head={["Item", "Qtd.", "Tarifa", "Sem trib.", "Tributos", "Esperado", "Na fatura", "Diferença"]}
              align={["left", "right", "right", "right", "right", "right", "right", "right"]}
              rows={[
                ...fat.linhas.map((l) => {
                  const c = conf?.itens.find((i) => i.id === l.id);
                  return [
                    <span key="d" title={l.nota}>{l.descricao}</span>,
                    `${brl(l.quantidade, l.unidade === "kW" ? 1 : 0)} ${l.unidade}`,
                    l.tarifa === null ? "—" : brl(l.tarifa, 4),
                    brl(l.liquido),
                    brl(l.icms + l.pisCofins),
                    <b key="e">{brl(l.total)}</b>,
                    <input
                      key="r"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      aria-label={`Valor na fatura: ${l.descricao}`}
                      value={real[l.id] === undefined || Number.isNaN(real[l.id]) ? "" : real[l.id]}
                      onChange={(e) => setReal((r) => ({ ...r, [l.id]: e.target.value === "" ? NaN : Number(e.target.value) }))}
                      className="h-8 w-28 rounded-md bg-surface-2 px-2 text-right text-[13px] text-ink"
                    />,
                    c?.dif === null || c?.dif === undefined ? "—" : <Badge key="s" level={STATUS[c.status]}>{c.dif >= 0 ? "+" : ""}{brl(c.dif)}</Badge>,
                  ];
                }),
                [
                  <b key="t">Total</b>,
                  "",
                  "",
                  brl(fat.totalLiquido),
                  brl(fat.totalTributos),
                  <b key="e">{brl(fat.total)}</b>,
                  <input key="r" type="number" inputMode="decimal" step="0.01" aria-label="Total da fatura real" value={totalReal || ""} onChange={(e) => setTotalReal(Number(e.target.value) || 0)} className="h-8 w-28 rounded-md bg-surface-2 px-2 text-right text-[13px] text-ink" />,
                  conf?.total ? <Badge key="s" level={STATUS[conf.total.status]}>{conf.total.dif >= 0 ? "+" : ""}{brl(conf.total.dif)}</Badge> : "—",
                ],
              ]}
            />
            {fat.alertas.length ? (
              <ul className="mt-4 flex flex-col gap-2">
                {fat.alertas.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-ink-2">
                    <Badge level={NIVEL[a.nivel]}>{a.nivel === "alta" ? "alta" : a.nivel === "media" ? "média" : "info"}</Badge>
                    <span>{a.texto}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>

          <Disclosure title="Checklist do auditor: armadilhas comuns na fatura da usina">
            <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-ink-2">
              <li>Enquadramento: UC protocolada até 07/01/2023 cobrada como GD II; percentual do Fio B do ano errado (2026 = 60%); Fio B sobre o consumo total em vez de só a energia compensada.</li>
              <li>GD III aplicada a fonte despachável ou a autoconsumo local (só vale acima de 500 kW, não despachável, remoto ou compartilhada com titular ≥ 25%).</li>
              <li>Demanda de injeção cobrada pela TUSD de consumo depois da revisão tarifária (deveria ser TUSDg), ou TUSD e TUSDg somadas sobre a mesma potência.</li>
              <li>Ultrapassagem calculada sobre a demanda toda em vez do excedente, ou sem a tolerância de 5%.</li>
              <li>Compensação entre postos sem o ajuste pela razão das TE, ou com a razão invertida; créditos expirados antes de 60 meses; rateio diferente do cadastrado.</li>
              <li>Bandeira cobrada sobre o consumo bruto (só incide sobre o consumo faturado após a compensação).</li>
              <li>ICMS cobrado sobre a energia compensada em estado que aderiu ao Convênio ICMS 16/2015; reativo e demanda não são isentos.</li>
              <li>Fator de potência apurado com a energia injetada (falsa baixa do fator de potência) e reativo cobrado fora do período.</li>
              <li>CIP calculada sobre o consumo bruto quando a lei municipal usa o faturado.</li>
            </ul>
          </Disclosure>
          <Disclosure title="Pontos regulatórios em aberto (ficam como opção no cálculo)">
            <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-ink-2">
              <li>§7º do art. 655-J da REN 1.000: como TUSD de consumo e TUSDg se combinam no mesmo ponto (opção “Base da TUSDg”).</li>
              <li>Razão entre postos: só TE (adotado) ou TE+TUSD.</li>
              <li>A partir de 2029: valoração do art. 17 da Lei 14.300 pela ANEEL (o cálculo usa 100% do Fio B como hipótese).</li>
              <li>ICMS sobre o Fio B não compensado e limite de potência da isenção: dependem do RICMS de cada estado.</li>
              <li>Reforma tributária: tratamento da energia compensada no IBS/CBS (LC 214/2025, alterada pela LC 227/2026).</li>
            </ul>
          </Disclosure>
        </>
      ) : null}
    </div>
  );
}
