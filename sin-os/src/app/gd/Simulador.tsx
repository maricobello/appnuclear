"use client";

import { useMemo, useState } from "react";
import { Panel, Segmented, Table } from "@/components/ui";
import { analisarAssinatura, viabilidade } from "@/lib/gd/finance";
import { cronogramaFioB, enquadrar, garantiaFielCumprimento, type Modalidade } from "@/lib/gd/rules";

type Aba = "enq" | "viab" | "assin";
const rs = (v: number) => `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
const ano = new Date().getFullYear();

function Campo({ label, value, onChange, step = "any", suffix }: { label: string; value: number; onChange: (v: number) => void; step?: string; suffix?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[12px] text-muted">
      {label}
      <span className="flex items-center gap-1">
        <input type="number" inputMode="decimal" step={step} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))} className="h-10 w-full min-w-0 rounded-lg bg-surface-2 px-2.5 text-[14px] text-ink" />
        {suffix ? <span className="shrink-0 text-[12px]">{suffix}</span> : null}
      </span>
    </label>
  );
}

function Resultado({ itens }: { itens: [string, string][] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {itens.map(([k, v]) => (
        <div key={k} className="rounded-2xl bg-surface-2/60 p-3">
          <dt className="text-[12px] text-muted">{k}</dt>
          <dd className="tnum text-[18px] font-semibold text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Simulador() {
  const [aba, setAba] = useState<Aba>("enq");
  const [data, setData] = useState(`${ano}-01-15`);
  const [kw, setKw] = useState(75);
  const [modalidade, setModalidade] = useState<Modalidade>("local");
  const [titular, setTitular] = useState(100);
  const [tarifa, setTarifa] = useState(0.95);
  const [capex, setCapex] = useState(3200);
  const [sim, setSim] = useState(30);
  const [geracao, setGeracao] = useState(125);
  const [desc, setDesc] = useState(15);
  const [creditos, setCreditos] = useState(1000);

  const enq = useMemo(() => enquadrar({ dataProtocolo: data, potenciaKw: kw, fonte: "solar", modalidade, maiorTitularPct: titular }), [data, kw, modalidade, titular]);
  const viab = useMemo(() => (kw > 0 && tarifa > 0 ? viabilidade({ potenciaKwp: kw, tarifaRsKwh: tarifa, capexRsKwp: capex, simultaneidadePct: sim, geracaoKwhKwpMes: geracao, dataProtocolo: data, modalidade }) : null), [kw, tarifa, capex, sim, geracao, data, modalidade]);
  const assin = useMemo(() => (tarifa > 0 && creditos > 0 ? analisarAssinatura({ tarifaRsKwh: tarifa, descontoPct: desc, creditosKwhMes: creditos, anos: 6 }) : null), [tarifa, desc, creditos]);

  return (
    <Panel
      title="Simulador"
      subtitle="Premissas editáveis; valores de referência aparecem nas notas. Análise, não recomendação de investimento."
      right={
        <Segmented
          label="Simulação"
          value={aba}
          onChange={setAba}
          options={[
            { value: "enq", label: "Enquadramento" },
            { value: "viab", label: "Viabilidade" },
            { value: "assin", label: "Assinatura" },
          ]}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="flex min-w-0 flex-col gap-1 text-[12px] text-muted">
            Protocolo do pedido de acesso
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} className="h-10 w-full min-w-0 rounded-lg bg-surface-2 px-2.5 text-[14px] text-ink" />
          </label>
          <Campo label="Potência" value={kw} onChange={setKw} suffix="kW" />
          <label className="flex min-w-0 flex-col gap-1 text-[12px] text-muted">
            Modalidade
            <select value={modalidade} onChange={(e) => setModalidade(e.target.value as Modalidade)} className="h-10 w-full rounded-lg bg-surface-2 px-2 text-[14px] text-ink">
              <option value="local">Junto à carga</option>
              <option value="remoto">Autoconsumo remoto</option>
              <option value="compartilhada">Geração compartilhada</option>
              <option value="emuc">Múltiplas UCs</option>
            </select>
          </label>
          {aba === "enq" ? <Campo label="Maior titular (compartilhada)" value={titular} onChange={setTitular} suffix="%" /> : <Campo label="Tarifa com tributos" value={tarifa} onChange={setTarifa} suffix="R$/kWh" />}
          {aba === "viab" ? (
            <>
              <Campo label="CAPEX" value={capex} onChange={setCapex} suffix="R$/kWp" />
              <Campo label="Geração" value={geracao} onChange={setGeracao} suffix="kWh/kWp·mês" />
              <Campo label="Simultaneidade" value={sim} onChange={setSim} suffix="%" />
            </>
          ) : null}
          {aba === "assin" ? (
            <>
              <Campo label="Desconto contratado" value={desc} onChange={setDesc} suffix="%" />
              <Campo label="Créditos por mês" value={creditos} onChange={setCreditos} suffix="kWh" />
            </>
          ) : null}
        </div>

        {aba === "enq" ? (
          <div className="flex flex-col gap-3">
            <Resultado itens={[["Enquadramento", enq.enquadramento], ["Porte", enq.porte], ["Transição até", String(enq.transicaoAte - 1)], ["Garantia", `${garantiaFielCumprimento(kw, modalidade).pct}%`]]} />
            <p className="text-[13px] text-ink-2">{enq.motivo}.</p>
            <Table
              label="Fio B sobre a energia compensada"
              head={["Ano", "Fio B pago", "Observação"]}
              rows={cronogramaFioB(enq.enquadramento, Math.max(2023, ano - 1), ano + 5, enq.transicaoAte).map((c) => [String(c.ano), `${c.fioBPct}%`, c.pendente ? "regra do art. 17 (pendente; supõe 100%)" : ""])}
            />
            {enq.avisos.length ? (
              <ul className="list-disc pl-5 text-[12.5px] text-muted">
                {enq.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {aba === "viab" && viab ? (
          <div className="flex flex-col gap-3">
            <Resultado
              itens={[
                ["Economia no ano 1", rs(viab.economiaAno1Rs)],
                ["TIR", viab.tirPct === null ? "—" : `${viab.tirPct.toLocaleString("pt-BR")}% a.a.`],
                ["Payback", viab.paybackAnos === null ? "—" : `${viab.paybackAnos.toLocaleString("pt-BR")} anos`],
                ["VPL", rs(viab.vplRs)],
              ]}
            />
            <Table
              label="Marcos da simulação"
              head={["Ano", "Geração kWh", "Economia", "Fio B"]}
              align={["left", "right", "right", "right"]}
              rows={viab.marcos.map((m) => [String(m.ano), m.geracaoKwh.toLocaleString("pt-BR"), rs(m.economiaRs), `${m.fioBPct}%`])}
            />
            <p className="text-[12.5px] text-muted">Premissas: {[...viab.premissas, `CAPEX total ${rs(viab.capexRs)}`, `LCOE ${viab.lcoeRsKwh?.toLocaleString("pt-BR") ?? "—"} R$/kWh`].join("; ")}.</p>
          </div>
        ) : null}

        {aba === "assin" && assin ? (
          <div className="flex flex-col gap-3">
            <Table
              label="Desconto efetivo do assinante"
              head={["Ano", "Fio B", "Paga ao gerador", "Paga à distribuidora", "Economia/mês", "Desconto efetivo"]}
              align={["left", "right", "right", "right", "right", "right"]}
              rows={assin.porMes.map((a) => [String(a.ano), `${a.fioBPct}%`, rs(a.pagaGeradorRs), rs(a.pagaDistribuidoraRs), rs(a.economiaRs), `${a.descontoEfetivoPct.toLocaleString("pt-BR")}%`])}
            />
            {assin.alerta ? <p className="text-[13px] text-warning">Atenção: {assin.alerta}.</p> : null}
            <p className="text-[12.5px] text-muted">Premissas: {assin.premissas.join("; ")}.</p>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
