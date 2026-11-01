"use client";

import { useMemo, useRef, useState } from "react";
import { EChart, type ChartOption } from "@/components/EChart";
import { Badge, Disclosure, MetricRow, Panel, Table, type Level } from "@/components/ui";
import { baseOption, C, categoryAxis, valueAxis } from "@/lib/chart";
import { dayLabel, num, sci } from "@/lib/fmt";
import {
  borderNote,
  busRows,
  chipLabels,
  classify,
  COMPENSATOR_GAP,
  ikA,
  isBorder,
  maxPlantMw,
  NO_MATCH_HINT,
  parseMw,
  scr,
  scrComposite,
  SCR_STRONG,
  searchBuses,
  weakest,
  type BusStrength,
  type ScrClass,
  type ShortCircuit,
} from "@/lib/grid/strength";

const HOURS = Array.from({ length: 24 }, (_, h) => `${h}h`);
const LEVEL: Record<ScrClass, Level> = { forte: "good", fraca: "warning", "muito fraca": "critical" };
const HINT: Record<ScrClass, string> = {
  forte: "rede forte para inversores",
  fraca: "rede fraca: o controle do inversor precisa de estudo",
  "muito fraca": "muito fraca: exige reforço, compensador síncrono ou inversor formador de rede",
};
const NO_MATCH = `Nenhuma barra encontrada. ${NO_MATCH_HINT}`;
const inputCls = "min-h-10 w-full rounded-xl bg-surface-2 px-3 text-[14px] text-ink outline-none focus:ring-2 focus:ring-accent aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-critical";
const mva = (v: number) => `${num(v, 0)} MVA`;
const label = (b: BusStrength) => `${b.nome} ${num(b.kv, 0)} kV${b.uf ? ` · ${b.uf}` : ""}`;

/** Força da rede: nível de curto-circuito por subestação e a relação de curto-circuito (SCR) de um parque. */
export function GridStrength({ sc, date }: { sc: ShortCircuit; date: string }) {
  const rows = useMemo(() => busRows(sc), [sc]);
  const weak = useMemo(() => weakest(rows, 230, 12), [rows]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [mwIn, setMwIn] = useState("100");
  const resultRef = useRef<HTMLDivElement>(null);
  const found = useMemo(() => searchBuses(rows, query, 8), [rows, query]);
  const chips = useMemo(() => chipLabels(found.items, label), [found]);
  const bus = rows.find((b) => b.anarede === picked) ?? null;
  const mw = parseMw(mwIn);
  const mwBad = mwIn.trim() !== "" && mw === null;
  const alone = bus && mw ? scr(bus.skMin, mw) : null;
  const composite = bus && mw ? scrComposite(bus.skMin, mw, bus.ibrMw) : null;
  const cls = composite !== null ? classify(composite) : null;
  const note = bus ? borderNote(sc, bus) : null;
  const count = !query.trim()
    ? ""
    : !found.total
      ? NO_MATCH
      : found.total > found.items.length
        ? `${found.items.length} de ${num(found.total)} barras: refine a busca`
        : `${found.total} ${found.total === 1 ? "barra encontrada" : "barras encontradas"}`;
  const status = found.note ? `${found.note} ${count}` : count;

  const pick = (anarede: number, scroll: boolean) => {
    setPicked(anarede);
    if (scroll) {
      requestAnimationFrame(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        resultRef.current?.focus({ preventScroll: true });
      });
    }
  };

  const chart = useMemo<ChartOption>(
    () =>
      ({
        ...baseOption(),
        tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => mva(v) },
        grid: { ...baseOption().grid, right: 8 },
        xAxis: categoryAxis(HOURS),
        yAxis: valueAxis("MVA síncronos ligados", { scale: false }),
        series: [
          {
            name: "Máquinas síncronas ligadas",
            type: "bar",
            barMaxWidth: 16,
            data: sc.mvaSincrono.map((v, h) => ({
              value: v,
              itemStyle: { color: h === sc.horaFraca ? C.critical : h === sc.horaForte ? C.good : C.accent, borderRadius: [3, 3, 0, 0] },
            })),
          },
        ],
      }) as ChartOption,
    [sc],
  );

  const ok = sc.validacao.ok;
  const dif = sc.validacao.dif_rel_max;
  const f = sc.fontes;

  return (
    <div id="forca" className="flex scroll-mt-20 flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel
          className="xl:col-span-3"
          title="Força da rede: curto-circuito e SCR"
          subtitle={`Curto trifásico em cada barra (IEC 60909) com as máquinas síncronas ligadas em cada hora de ${dayLabel(date)}; a relação de curto-circuito diz se a rede aguenta um parque de inversores ali`}
          right={ok ? <Badge level="good">pandapower confere</Badge> : <Badge level="critical">conferência falhou</Badge>}
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-[13px] font-medium text-ink-2">Subestação</span>
              <input
                className={inputCls}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ex.: Paulino Neves, Ibiúna 345, Paulo Afonso"
                aria-describedby="forca-status"
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-ink-2">Potência do parque (MW)</span>
              <input className={inputCls} inputMode="decimal" value={mwIn} onChange={(e) => setMwIn(e.target.value)} aria-invalid={mwBad} aria-describedby={mwBad ? "forca-mw" : undefined} />
            </label>
          </div>
          {mwBad ? (
            <p id="forca-mw" className="mt-1 text-[12px] text-critical">
              Potência inválida: use só o número, como 100 ou 1.200,5.
            </p>
          ) : null}
          <p id="forca-status" role="status" className="mt-2 text-[12px] text-muted empty:hidden">
            {status}
          </p>
          {found.items.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Barras encontradas">
              {found.items.map((b, i) => (
                <button
                  key={b.anarede}
                  type="button"
                  aria-pressed={b.anarede === picked}
                  onClick={() => pick(b.anarede, false)}
                  className={`rounded-full px-3 py-1.5 text-[13px] ${b.anarede === picked ? "bg-accent text-white" : "bg-surface-2 text-ink hover:bg-surface-2/70"}`}
                >
                  {chips[i]}
                </button>
              ))}
            </div>
          ) : null}
          <div ref={resultRef} tabIndex={-1} aria-live="polite" className="mt-3 scroll-mt-24 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent">
            {bus ? (
              <>
                <MetricRow label={label(bus)} hint={`barra ${bus.anarede}${bus.sub ? ` · ${isBorder(bus) ? (sc.fronteira?.[bus.sub]?.pais ?? bus.sub) : bus.sub}` : ""}`} value="" tone="muted" />
                <MetricRow label="Potência de curto mínima" hint={`a menor do dia, às ${bus.hMin}h`} value={`${mva(bus.skMin)} · ${num(ikA(bus.skMin, bus.kv), 1)} kA`} />
                {bus.skMinAll > bus.skMin * COMPENSATOR_GAP ? (
                  <MetricRow
                    label="Com todos os compensadores ligados"
                    hint="o mínimo tira, para esta barra, o compensador síncrono cuja saída mais derruba o curto (N-1)"
                    value={`${mva(bus.skMinAll)}${mw ? ` · SCR ${num(scrComposite(bus.skMinAll, mw, bus.ibrMw), 1)}` : ""}`}
                    tone="muted"
                  />
                ) : null}
                <MetricRow
                  label="Potência de curto máxima do despacho"
                  hint={`a maior do dia, às ${bus.hMax}h; não serve para superação de disjuntor`}
                  value={`${mva(bus.skMax)} · ${num(ikA(bus.skMax, bus.kv), 1)} kA`}
                  tone="muted"
                />
                {bus.ibrMw > 0 ? (
                  <MetricRow
                    label="Eólica e solar já ligadas perto"
                    hint={`equivalente visto desta barra: ${num(bus.ibrStationMw, 0)} MW na própria subestação, as vizinhas pesadas pela proximidade elétrica`}
                    value={`${num(bus.ibrMw, 0)} MW`}
                    tone="muted"
                  />
                ) : null}
                <MetricRow
                  label={mw ? `SCR de um parque de ${num(mw, mw < 10 ? 1 : 0)} MW` : "SCR do parque"}
                  hint={cls ? `${HINT[cls]}${bus.ibrMw > 0 && alone !== null ? `; sozinho na barra seria ${num(alone, 1)}` : ""}` : undefined}
                  value={composite !== null && cls ? <Badge level={LEVEL[cls]}>{`${num(composite, 1)} · ${cls}`}</Badge> : mwBad ? "potência inválida" : "informe a potência"}
                />
                <MetricRow
                  label={`Maior parque com SCR ≥ ${SCR_STRONG}`}
                  hint={bus.ibrMw > 0 ? "pelo curto mínimo do dia, descontadas a eólica e a solar já ligadas" : "pelo curto mínimo do dia"}
                  value={`${num(maxPlantMw(bus.skMin, bus.ibrMw), 0)} MW`}
                  tone={maxPlantMw(bus.skMin, bus.ibrMw) > 0 ? "good" : "critical"}
                />
                {note ? <p className="mt-2 text-[12px] leading-relaxed text-warning">{note}</p> : null}
                {sc.inversores === false ? (
                  <p className="mt-2 text-[12px] leading-relaxed text-warning">Neste retrato faltou a eólica e a solar já ligadas: o SCR composto saiu igual ao simples.</p>
                ) : null}
              </>
            ) : (
              <p className="text-[13px] leading-relaxed text-muted">
                Busque uma subestação ou toque em uma das mais fracas da lista. O SCR usa o curto mínimo do dia de cada barra, na hora mais fraca dela.
              </p>
            )}
          </div>
        </Panel>
        <Panel className="xl:col-span-2" title="Mais fracas de 230 kV ou mais" subtitle="Menor curto do dia (e a hora); maior parque que ainda mantém SCR ≥ 3, descontadas a eólica e a solar já ligadas">
          {weak.length ? (
            <Table
              stack={false}
              label="Subestações mais fracas"
              head={["Subestação", "Curto mín.", "Parque máx."]}
              align={["left", "right", "right"]}
              rows={weak.map((b) => [
                <button key="n" type="button" onClick={() => pick(b.anarede, true)} className="block max-w-[150px] text-left sm:max-w-[200px]" title={label(b)}>
                  <span className="block truncate text-accent hover:underline">{b.nome}</span>
                  <span className="block text-[12px] text-muted">
                    {num(b.kv, 0)} kV{b.uf ? ` · ${b.uf}` : ""} · {b.hMin}h
                  </span>
                </button>,
                mva(b.skMin),
                `${num(maxPlantMw(b.skMin, b.ibrMw), 0)} MW`,
              ])}
            />
          ) : (
            <p className="text-[13px] text-muted">Sem barras de 230 kV ou mais neste relatório.</p>
          )}
        </Panel>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Máquinas síncronas ligadas" subtitle={`O curto cai quando o sol tira hidrelétricas e térmicas do ar: mais fraca às ${sc.horaFraca}h (vermelho), mais forte às ${sc.horaForte}h (verde)`}>
          <EChart option={chart} height={220} label="Potência síncrona ligada por hora" />
        </Panel>
        <Panel title="Como o curto é calculado" subtitle={sc.metodo}>
          <MetricRow
            label="Fontes"
            hint={
              f.usinas_pela_disponibilidade !== undefined
                ? `${num(f.usinas_pela_disponibilidade)} usinas pela disponibilidade sincronizada do ONS (${num(100 * (f.geracao_sincrona_com_disponibilidade ?? 0))}% da geração síncrona)`
                : undefined
            }
            value={`${num(f.usinas)} usinas · ${num(f.compensadores)} compensadores`}
            tone="muted"
          />
          <MetricRow
            label="Conferência com o pandapower"
            hint={`calc_sc nas horas ${sc.validacao.horas.map((h) => `${h}h`).join(" e ")}`}
            value={ok && dif !== null ? `diferença máx. ${sci(dif)}` : "falhou"}
            tone={ok ? "good" : "critical"}
          />
          {!ok && sc.validacao.erro ? <p className="mb-2 break-words text-[12px] leading-relaxed text-critical">{sc.validacao.erro}</p> : null}
          <Disclosure title="Premissas" hint={`${sc.premissas.length + 1} itens`}>
            <ul className="flex list-disc flex-col gap-1.5 pl-4 pt-1 text-[13px] leading-relaxed text-ink-2">
              {sc.premissas.map((t) => (
                <li key={t}>{t}</li>
              ))}
              <li>
                Faixas do SCR (IEEE 1204, CIGRE): {SCR_STRONG} ou mais é rede forte; de 2 a 3, fraca; abaixo de 2, muito fraca. É uma triagem: o estudo de acesso oficial do ONS segue obrigatório.
              </li>
            </ul>
          </Disclosure>
        </Panel>
      </div>
    </div>
  );
}
