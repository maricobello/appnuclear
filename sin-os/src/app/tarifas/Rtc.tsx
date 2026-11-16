"use client";

import { useMemo, useState } from "react";
import { Badge, Disclosure, Panel, Segmented, Stat, Table } from "@/components/ui";
import { aliquotasDoAno, TRANSICAO, type PremissasReforma } from "@/lib/tarifa/calc";
import { ART28_P3_P4, baseCibs, calcularCibs, CLASSIF_ENERGIA, exclusaoCompensada, RTC_FONTE, type OperacaoEnergia } from "@/lib/tarifa/rtc";

const brl = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
const NOME: Record<string, string> = { CBS: "CBS (União)", IBSUF: "IBS estadual", IBSMun: "IBS municipal" };

function N({ label, value, onChange, suffix }: { label: string; value: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[12px] text-muted">
      {label}
      <span className="flex items-center gap-1">
        <input type="number" inputMode="decimal" step="any" value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} className="h-10 w-full min-w-0 rounded-lg bg-surface-2 px-2.5 text-[14px] text-ink" />
        {suffix ? <span className="shrink-0 text-[12px]">{suffix}</span> : null}
      </span>
    </label>
  );
}

export interface PropsRtc {
  /** TE, TUSD e bandeira sem tributos, em R$/MWh (da linha escolhida). */
  teMwh: number;
  tusdMwh: number;
  bandeiraMwh: number;
  /** Tributos de hoje, em %. */
  icmsPct: number;
  pisPct: number;
  cofinsPct: number;
  consumoInicial: number;
  prem: Pick<PremissasReforma, "cbsRef" | "ibsRef">;
}

/**
 * Apuração de CBS e IBS de uma fatura com a regra oficial da Receita Federal (Calculadora RTC):
 * base por fora (sem ICMS, PIS, Cofins e COSIP), CST e cClassTrib de energia elétrica e a exclusão
 * da energia compensada na GD (art. 28, § 3º).
 */
export function ApuracaoOficial(p: PropsRtc) {
  const [ano, setAno] = useState(2026);
  const [op, setOp] = useState<OperacaoEnergia>("consumo");
  const [consumo, setConsumo] = useState(p.consumoInicial > 0 ? p.consumoInicial : 1000);
  const [cosip, setCosip] = useState(0);
  const [compensado, setCompensado] = useState(0);
  const [potencia, setPotencia] = useState(75);

  const r = useMemo(() => {
    const t = TRANSICAO[Math.min(2033, Math.max(2026, ano))];
    const icms = (p.icmsPct / 100) * t.icmsFator;
    const pc = t.pisCofins ? (p.pisPct + p.cofinsPct) / 100 : 0;
    const semTrib = (consumo * (p.teMwh + p.tusdMwh + p.bandeiraMwh)) / 1000;
    const bruto = icms + pc < 0.95 ? semTrib / (1 - icms - pc) : semTrib;
    const icmsR = bruto * icms;
    const pisR = t.pisCofins ? (bruto * p.pisPct) / 100 : 0;
    const cofinsR = t.pisCofins ? (bruto * p.cofinsPct) / 100 : 0;
    const b = baseCibs({ ano, valor: bruto + cosip, cosip, icms: icmsR, pis: pisR, cofins: cofinsR });
    const aliq = aliquotasDoAno(ano, p.prem);
    const gd = op === "compensada";
    const exc = gd ? exclusaoCompensada(Math.min(compensado, consumo), p.teMwh / 1000, potencia) : null;
    const baseTrib = Math.max(0, b.base - (exc?.exclusao ?? 0));
    const principal = calcularCibs(gd ? "consumo" : op, ano, baseTrib, { estimativa: aliq });
    const excluida = gd && exc?.elegivel ? calcularCibs("compensada", ano, exc.exclusao, { potenciaKw: potencia, estimativa: aliq }) : null;
    return { bruto, icmsR, pisR, cofinsR, b, aliq, exc, principal, excluida, t };
  }, [ano, op, consumo, cosip, compensado, potencia, p]);

  const { principal } = r;
  const linhasTrib = r.aliq.dividido
    ? principal.tributos
    : [principal.tributos[0], { ...principal.tributos[1], tributo: "IBS" as never, aliquota: principal.tributos[1].aliquota + principal.tributos[2].aliquota, valor: principal.tributos[1].valor + principal.tributos[2].valor, devido: principal.tributos[1].devido + principal.tributos[2].devido }];

  return (
    <Panel
      title="Apuração oficial de CBS e IBS (Calculadora RTC da Receita Federal)"
      subtitle={`Regra e tabelas oficiais da Receita (base ${RTC_FONTE.versaoBase}, ${RTC_FONTE.dataBase.split("-").reverse().join("/")}): base de cálculo, CST e cClassTrib da energia elétrica (NCM ${RTC_FONTE.ncmEnergia}).`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Operação"
          value={op}
          options={[
            { value: "consumo", label: "Fornecimento ao consumidor" },
            { value: "compensada", label: "Consumidor com GD (SCEE)" },
            { value: "cadeia", label: "Venda na cadeia (geração, comercialização)" },
          ]}
          onChange={(v) => setOp(v as OperacaoEnergia)}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex min-w-0 flex-col gap-1 text-[12px] text-muted">
          Ano do fato gerador
          <select value={ano} onChange={(e) => setAno(Number(e.target.value))} className="h-10 w-full min-w-0 rounded-lg bg-surface-2 px-2.5 text-[14px] text-ink">
            {Object.keys(TRANSICAO).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <N label="Consumo faturado" value={consumo} onChange={setConsumo} suffix="kWh" />
        <N label="Iluminação pública (COSIP)" value={cosip} onChange={setCosip} suffix="R$" />
        {op === "compensada" ? (
          <>
            <N label="Energia compensada" value={compensado} onChange={setCompensado} suffix="kWh" />
            <N label="Potência da geração" value={potencia} onChange={setPotencia} suffix="kW" />
          </>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={op === "compensada" ? "Fornecimento (antes da compensação)" : "Valor da fatura"} value={`R$ ${brl(r.bruto + cosip)}`} hint={`ICMS R$ ${brl(r.icmsR)} · PIS/Cofins R$ ${brl(r.pisR + r.cofinsR)}`} />
        <Stat label="Base de CBS/IBS" value={`R$ ${brl(principal.base)}`} hint={r.exc?.exclusao ? `já sem R$ ${brl(r.exc.exclusao)} de energia compensada` : "valor sem ICMS, PIS, Cofins e COSIP"} />
        <Stat label={principal.teste ? "CBS + IBS destacados" : "CBS + IBS devidos"} value={`R$ ${brl(principal.teste ? principal.totalDestacado : principal.totalDevido)}`} hint={principal.teste ? "2026: destacado na nota, sem custo novo" : op === "cadeia" ? "100% diferido para a etapa de consumo" : undefined} />
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-muted">Enquadramento</span>
          <span className="flex flex-wrap gap-1.5">
            <Badge level="good">CST {principal.classificacao.cst}</Badge>
            <Badge level="good">cClassTrib {principal.classificacao.cClassTrib}</Badge>
            {r.excluida ? <Badge level="good">+ 830001</Badge> : null}
            <Badge level={r.aliq.oficial ? "good" : "warning"}>{r.aliq.oficial ? "alíquota oficial" : "alíquota estimada"}</Badge>
          </span>
        </div>
      </div>

      {r.exc && !r.exc.elegivel ? <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-ink-2">{r.exc.motivo}. A energia compensada fica na base, com tributação integral.</p> : null}
      {r.b.erros.length ? <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-ink-2">{r.b.erros.join(" · ")}</p> : null}

      <Table
        label="Tributos do documento fiscal"
        head={["Item", "CST", "cClassTrib", "Tributo", "Base (R$)", "Alíquota", "Valor (R$)", "Diferido (R$)", "Devido (R$)"]}
        align={["left", "left", "left", "left", "right", "right", "right", "right", "right"]}
        rows={[
          ...linhasTrib.map((t, i) => [
            i === 0 ? <b key="i">{op === "cadeia" ? "Venda de energia" : "Fornecimento de energia"}</b> : "",
            principal.classificacao.cst,
            principal.classificacao.cClassTrib,
            NOME[t.tributo] ?? "IBS (UF + município)",
            brl(principal.base),
            pct(t.aliquota),
            brl(t.valor),
            brl(t.diferido),
            principal.teste ? `(${brl(t.devido)})` : brl(t.devido),
          ]),
          ...(r.excluida
            ? [[<b key="e">Energia compensada (SCEE)</b>, "830", "830001", "CBS e IBS", `${brl(0)} (excluído R$ ${brl(r.exc?.exclusao ?? 0)})`, "sem alíquota", brl(0), brl(0), brl(0)]]
            : []),
        ]}
      />
      <p className="mt-2 text-[12px] text-muted">{principal.memoria}</p>

      <Disclosure title="Regras oficiais usadas e o que muda para energia">
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-ink-2">
          <li>
            Base de cálculo (regra da calculadora oficial): soma valor, acréscimos, juros, multas, encargos e Imposto Seletivo; tira COSIP, desconto incondicional, PIS, Cofins e ICMS. Por isso CBS e IBS são cobrados por fora e não incidem sobre o ICMS. PIS/Cofins só existem até 2026 e ICMS até 2032.
          </li>
          <li>Alíquotas oficiais publicadas pela Receita: só 2026 (CBS 0,9%, IBS estadual 0,1%, IBS municipal 0%). De 2027 em diante usamos as referências estimadas do painel acima, marcadas como estimativa.</li>
          <li>
            <b>{CLASSIF_ENERGIA.consumo.cst}/{CLASSIF_ENERGIA.consumo.cClassTrib}</b>: {CLASSIF_ENERGIA.consumo.resumo}
          </li>
          <li>
            <b>{CLASSIF_ENERGIA.cadeia.cst}/{CLASSIF_ENERGIA.cadeia.cClassTrib}</b>: {CLASSIF_ENERGIA.cadeia.resumo} ({CLASSIF_ENERGIA.cadeia.fundamento}).
          </li>
          <li>
            <b>{CLASSIF_ENERGIA.compensada.cst}/{CLASSIF_ENERGIA.compensada.cClassTrib}</b>: {CLASSIF_ENERGIA.compensada.resumo} Aqui a parte excluída é a energia compensada × TE sem tributos; TUSD, demanda, disponibilidade e reativo seguem tributados.
          </li>
          <li className="text-[12px] text-muted">{ART28_P3_P4}</li>
          <li>Arredondamento: meio para o par (HALF_EVEN) em 2 casas, como na calculadora oficial.</li>
          <li>
            Fonte: {RTC_FONTE.nome} ({RTC_FONTE.repositorio}, licença {RTC_FONTE.licenca}). Conferir ainda: a parte da TUSD que cada distribuidora tratar como custo da energia na compensação e as regras de cashback para baixa renda.
          </li>
        </ul>
      </Disclosure>
    </Panel>
  );
}
