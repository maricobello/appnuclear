"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Empty, ErrorBox, Loading, PageHeader, Panel, SimBanner, type Level } from "@/components/ui";
import type { MercadoLivreResp, TermicasResp } from "@/lib/apiTypes";
import { MIGRACAO, RADAR_UPDATED, radarSorted, TEMA_LABEL, type RadarItem, type RadarStatus, type RadarTema } from "@/lib/market/radar";
import { useApi } from "@/lib/useApi";
import { useNow } from "@/lib/useNow";
import { Simulator } from "./Simulator";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** 2026-10-27 → 27/out/2026; 2026-08 → ago/2026; 2027 → 2027. */
const when = (d: string) => (d.length === 4 ? d : d.length === 7 ? `${MONTHS[Number(d.slice(5, 7)) - 1]}/${d.slice(0, 4)}` : `${Number(d.slice(8, 10))}/${MONTHS[Number(d.slice(5, 7)) - 1]}/${d.slice(0, 4)}`);
const STATUS_LEVEL: Record<RadarStatus, Level> = { vigente: "good", "em implantação": "warning", agendado: "neutral", pendente: "neutral" };
const DAY = 86400_000;

function RadarCard({ r }: { r: RadarItem }) {
  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-2xl bg-surface-2/60 p-4">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <time dateTime={r.data}>{when(r.data)}</time>
        <span aria-hidden>·</span>
        <span>{TEMA_LABEL[r.tema]}</span>
        <span className="ml-auto">
          <Badge level={STATUS_LEVEL[r.status]}>{r.status}</Badge>
        </span>
      </div>
      <h3 className="text-[15px] font-semibold leading-snug text-ink">{r.titulo}</h3>
      <p className="text-[14px] leading-relaxed text-ink-2">{r.oQueMuda}</p>
      <p className="text-[13px] leading-relaxed text-muted">
        <span className="font-medium text-ink-2">Quem sente: </span>
        {r.quemAfeta}
      </p>
      {r.marcos?.length ? (
        <ul className="flex flex-col gap-1 text-[13px] text-ink-2">
          {r.marcos.map((m) => (
            <li key={m.data + m.descricao} className="flex gap-2">
              <span className="tnum shrink-0 font-medium text-ink">{when(m.data)}</span>
              <span>{m.descricao}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {r.ressalva ? <p className="text-[12px] leading-relaxed text-warning">{r.ressalva}</p> : null}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[12px]">
        {r.naPlataforma ? (
          <Link href={r.naPlataforma.href} className="font-semibold text-accent hover:underline">
            {r.naPlataforma.label} →
          </Link>
        ) : null}
        {r.fontes.map((f) => (
          <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-muted hover:text-ink">
            {f.nome}
            <ExternalLink size={11} aria-hidden />
          </a>
        ))}
      </div>
    </article>
  );
}

export default function MercadoLivrePage() {
  const { data, error, mutate } = useApi<MercadoLivreResp>("/api/mercado-livre", 30 * 60_000);
  const { data: term } = useApi<TermicasResp>("/api/termicas", 30 * 60_000);
  const [tema, setTema] = useState<RadarTema | "todos">("todos");
  const items = useMemo(() => radarSorted().filter((r) => tema === "todos" || r.tema === tema), [tema]);
  const temas = useMemo(() => [...new Set(radarSorted().map((r) => r.tema))], []);
  const now = useNow(3600_000);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Mercado livre & Open Energy"
        subtitle="O que mudou no mercado, quando cada consumidor pode migrar e quanto contratar, com o custo e o risco medidos nos cenários de preço do planejamento."
      />
      <SimBanner metas={[data?.pld.meta]} label="CCEE" />

      <Panel
        title="Radar regulatório"
        subtitle={`As mudanças recentes que mexem com preço, risco ou acesso ao mercado livre, com a fonte de cada uma (atualizado em ${when(RADAR_UPDATED)})`}
        right={
          <select
            aria-label="Tema"
            className="min-h-9 rounded-xl bg-surface-2 px-2 text-[13px] text-ink outline-none focus:ring-2 focus:ring-accent"
            value={tema}
            onChange={(e) => setTema(e.target.value as RadarTema | "todos")}
          >
            <option value="todos">Todos os temas</option>
            {temas.map((t) => (
              <option key={t} value={t}>
                {TEMA_LABEL[t]}
              </option>
            ))}
          </select>
        }
      >
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {items.map((r) => (
            <RadarCard key={r.id} r={r} />
          ))}
        </div>
      </Panel>

      <div id="migrar" className="scroll-mt-20">
        <Panel title="Quando posso migrar?" subtitle="Quem pode escolher o fornecedor de energia, e desde quando">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {MIGRACAO.map((m) => {
              const t = Date.parse(`${m.desde}T00:00:00-03:00`);
              const days = now ? Math.ceil((t - now) / DAY) : null; // 0 no HTML estático: espera o relógio do navegador
              return (
                <div key={m.key} className="flex flex-col gap-1 rounded-2xl bg-surface-2/60 p-4">
                  <span className="text-[13px] font-medium text-muted">{m.label}</span>
                  <span className="text-[22px] font-semibold tracking-tight text-ink">{days !== null && days <= 0 ? "Já pode" : when(m.desde)}</span>
                  <span className="text-[13px] text-ink-2">{days === null ? "\u00a0" : days <= 0 ? `desde ${when(m.desde)}` : `faltam ${days.toLocaleString("pt-BR")} dias`}</span>
                  <span className="text-[12px] leading-relaxed text-muted">{m.detalhe}</span>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <div id="simulador" className="scroll-mt-20">
        {error && !data ? (
          <ErrorBox error={error} onRetry={() => mutate()} />
        ) : !data ? (
          <Loading height={320} />
        ) : !data.meses.length ? (
          <Panel title="Contratação ótima">
            <Empty label="Sem as faixas de preço do planejamento para os próximos 12 meses." height={160} />
          </Panel>
        ) : (
          <>
            {data.notes.length ? (
              <div role="status" className="mb-3 rounded-2xl bg-warning/12 px-4 py-2.5 text-[13px] text-ink-2">
                {data.notes.join(" ")}
              </div>
            ) : null}
            <Simulator data={data} essPerMwh={term?.essPerMwh ?? null} />
          </>
        )}
      </div>

      <Panel title="Como o modelo funciona" subtitle="Hipóteses e limites do simulador">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-relaxed text-ink-2">
          <li>
            O custo do ano é o contrato flat (volume × preço em todas as horas) mais a diferença entre a carga e o contrato liquidada ao PLD, hora a hora. Como ele é linear no volume, o CVaR é convexo e o volume ótimo minimiza
            (1 − β) × custo esperado + β × CVaR 95%.
          </li>
          <li>
            Cada cenário dá um nível de PLD por mês: lognormal com mediana no P50 e cauda no P90 da faixa publicada em{" "}
            <Link href="/planejamento" className="text-accent hover:underline">
              Planejamento
            </Link>
            , com piso no PLD mínimo. Os meses se movem juntos pela correlação implícita nos cenários do SDDP (a que reproduz a largura da média de 12 meses que o próprio SDDP produziu).
          </li>
          <li>As horas seguem a forma do PLD real do mesmo mês no último ano (desvio de cada hora para a média do dia), limitada ao piso e ao teto horário e recentrada para preservar o nível do mês.</li>
          <li>A carga entra como a média por mês e hora do dia; a variação entre dias de um mesmo mês fica de fora, assim como a energia incentivada, impostos, flexibilidade e sazonalização do contrato.</li>
          <li>
            A exposição de contraparte supõe que, se a comercializadora quebra, o resto do contrato é comprado ao PLD do cenário, sem recuperação. É a métrica de exposição de crédito usada em derivativos (EE e PFE 95%).
          </li>
        </ul>
      </Panel>
    </div>
  );
}
