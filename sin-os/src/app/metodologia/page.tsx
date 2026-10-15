import Link from "next/link";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader, Panel } from "@/components/ui";
import { methodology } from "@/lib/methodology";

export const dynamic = "force-static";

const SECTIONS = [
  ["tempo", "Tempo e versão"],
  ["fontes", "Dicionário de dados"],
  ["auditor", "Regras do auditor"],
  ["confianca", "Selo de confiança"],
  ["renovaveis", "Corte e balanço"],
  ["previsao", "Backtest por regime"],
  ["bess", "BESS"],
  ["alertas", "Alertas de mercado"],
] as const;

const num = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** Tabela com quebra de linha (a Table do painel não quebra, aqui o texto é longo). */
function TextTable({ head, rows, mono = [], nowrap = [] }: { head: string[]; rows: ReactNode[][]; mono?: number[]; nowrap?: number[] }) {
  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-line-strong">
            {head.map((h) => (
              <th key={h} className="eyebrow px-2 py-1.5 text-left font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line/60 align-top last:border-0">
              {r.map((c, j) => (
                <td key={j} className={`px-2 py-1.5 leading-snug text-ink-2 ${mono.includes(j) ? "break-all font-mono text-[11px]" : ""} ${nowrap.includes(j) ? "whitespace-nowrap" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rows({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[10rem_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-ink-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-1.5 text-xs leading-relaxed text-ink-2">
      {items.map((x, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-muted">•</span>
          <span className="min-w-0">{x}</span>
        </li>
      ))}
    </ul>
  );
}

export default function MetodologiaPage() {
  const m = methodology();
  const br = m.sources.filter((s) => s.id.startsWith("ccee") || s.id.startsWith("ons"));
  const rest = m.sources.filter((s) => !br.includes(s));
  const { regimes } = m.forecast;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Metodologia"
        subtitle="Dicionário de dados de cada fonte e as regras que o agente auditor aplica. Os limites desta página são lidos das mesmas constantes que o código usa: o que está publicado aqui é o que roda."
        right={
          <a href="/api/metodologia" className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-[11px] text-accent hover:border-accent/50">
            JSON <ExternalLink size={11} aria-hidden />
          </a>
        }
      />

      <nav aria-label="Seções" className="flex flex-wrap gap-1.5">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded border border-line px-2 py-0.5 text-[11px] text-ink-2 hover:border-accent/50 hover:text-ink">
            {label}
          </a>
        ))}
      </nav>

      <section id="tempo" className="scroll-mt-16">
        <Panel title="Tempo e versão" subtitle="Como o app lida com fuso, hora de captura e versão do código">
          <Rows
            items={[
              ["Armazenamento", m.time.storage],
              ["Fuso", m.time.zone],
              ["Hora e dia", m.time.hour],
              ["Captura", m.time.capture],
              [
                "Versão do código",
                <a key="v" href={m.version.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-accent hover:underline">
                  {m.version.commit ?? "repositório"} <ExternalLink size={11} aria-hidden />
                </a>,
              ],
              ["Limites do PLD", `piso R$ ${num(m.limits.min)} · teto estrutural R$ ${num(m.limits.maxStructural)} · teto horário R$ ${num(m.limits.maxHourly)} (${m.limits.year}, ${m.limits.source})`],
            ]}
          />
        </Panel>
      </section>

      <section id="fontes" className="flex scroll-mt-16 flex-col gap-3">
        <Panel title="Dicionário de dados" subtitle="Uma linha por fonte; o detalhe de colunas e transformações vem logo abaixo">
          <TextTable
            head={["Fonte", "Grão", "Instante na origem", "SLA", "Faixa válida"]}
            rows={m.sources.map((s) => [
              <a key="n" href={`#src-${s.id}`} className="text-ink hover:text-accent">
                {s.name}
              </a>,
              s.grain,
              s.time,
              `${s.freshnessSlaHours} h`,
              `${num(s.range.min)} a ${num(s.range.max)} ${s.range.unit}`,
            ])}
            nowrap={[3]}
          />
        </Panel>

        {[
          { title: "Brasil — CCEE e ONS", list: br, open: true },
          { title: "Contexto — Europa, Reino Unido, clima, câmbio e combustíveis", list: rest, open: false },
        ].map((g) => (
          <div key={g.title} className="flex flex-col gap-2">
            <h2 className="eyebrow px-1 pt-1">{g.title}</h2>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {g.list.map((s) => (
                <details key={s.id} id={`src-${s.id}`} open={g.open} className="group min-w-0 scroll-mt-16 rounded-md border border-line bg-surface">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0">
                      <span className="block text-[12px] font-semibold text-ink">{s.name}</span>
                      <span className="block font-mono text-[10.5px] text-muted">
                        {s.id} · {s.provider}
                      </span>
                    </span>
                    <ChevronDown size={14} className="mt-0.5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <div className="flex flex-col gap-3 border-t border-line p-3">
                    <Rows
                      items={[
                        ["Arquivo / rota", <span key="f" className="break-all font-mono text-[11px]">{s.files.join(" · ")}</span>],
                        ["Instante", s.time],
                        ["Frequência", `${s.cadence} · SLA de frescor ${s.freshnessSlaHours} h`],
                        ["Faixa válida", `${num(s.range.min)} a ${num(s.range.max)} ${s.range.unit} — ${s.range.why}`],
                        ["Versão", s.version],
                        ["Licença", <a key="l" href={s.docs} target="_blank" rel="noreferrer" className="text-accent hover:underline">{s.license}</a>],
                      ]}
                    />
                    <TextTable head={["Coluna na origem", "No app", "Unidade", "Obs."]} rows={s.fields.map((f) => [f.col, f.as, f.unit, f.note ?? ""])} mono={[0, 1]} />
                    <List items={s.steps} />
                  </div>
                </details>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section id="auditor" className="flex scroll-mt-16 flex-col gap-3">
        <Panel title="Regras do auditor" subtitle={`Sete checagens por fonte, com peso. Score = ${m.audit.score}. Status: ${m.audit.status}.`}>
          <TextTable head={["Checagem", "Peso", "Passa", "Alerta", "Reprova"]} rows={m.audit.rules.map((r) => [r.label, r.weight, r.pass, r.warn, r.fail])} />
        </Panel>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Panel title="Faixa e frescor por fonte" subtitle="Valor fora da faixa conta na checagem de Validade; idade acima do SLA, na de Frescor">
            <TextTable
              head={["Fonte", "SLA", "Faixa", "Por quê"]}
              rows={m.sources.map((s) => [s.name, `${s.freshnessSlaHours} h`, `${num(s.range.min)} a ${num(s.range.max)} ${s.range.unit}`, s.range.why])}
              nowrap={[1]}
            />
          </Panel>
          <Panel title="Checagens cruzadas" subtitle="Uma fonte conferindo a outra">
            <List items={m.audit.cross.map((c) => <><span className="text-ink">{c.label}:</span> {c.rule}</>)} />
          </Panel>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <section id="confianca" className="scroll-mt-16">
          <Panel title="Selo de confiança" subtitle="Detecta republicação silenciosa e dia incompleto">
            <Rows
              items={[
                ["Fontes", m.trust.sources.join(" · ")],
                ["Impressão digital", m.trust.digest],
                ["Revisão", m.trust.revision],
                ["Selo", m.trust.seal],
                ["Corte mensal", m.sources.find((s) => s.id === "ons_curtailment")?.version ?? ""],
              ]}
            />
          </Panel>
        </section>
        <section id="renovaveis" className="scroll-mt-16">
          <Panel title="Corte e balanço" subtitle="Conferências feitas sobre os arquivos do ONS antes de mostrar o corte">
            <List items={m.renewables.rules} />
          </Panel>
        </section>
      </div>

      <section id="previsao" className="scroll-mt-16">
        <Panel
          title="Backtest por regime"
          subtitle="Onde o modelo ganha e onde perde do ingênuo"
          right={
            <Link href="/previsao" className="text-[11px] text-accent hover:underline">
              ver resultado na Previsão
            </Link>
          }
        >
          <div className="flex flex-col gap-3">
            <Rows
              items={[
                ["Previsão publicada", m.forecast.published],
                ["Ingênuo", m.forecast.naive],
                ["Walk-forward", m.forecast.walkForward],
                ["Métrica", m.forecast.metric],
              ]}
            />
            <TextTable
              head={["Regime", "Grupos"]}
              rows={[
                ["Período hidrológico", regimes.estacao.map((r) => r.label).join(" · ")],
                ["Reservatório (EAR)", regimes.reservatorio.map((r) => r.label).join(" · ")],
                ["Faixa de PLD", regimes.faixa_pld.map((r) => r.label).join(" · ")],
              ]}
            />
            <List items={m.forecast.regimeNotes} />
          </div>
        </Panel>
      </section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <section id="bess" className="scroll-mt-16">
          <Panel title="BESS" subtitle="Cada fonte de receita e cada perda separadas">
            <List items={m.bess} />
          </Panel>
        </section>
        <section id="alertas" className="scroll-mt-16">
          <Panel title="Alertas de mercado" subtitle="Enviados por ntfy quando o PLD do dia ou o corte passam do limite">
            <List items={[...m.alerts.rules, m.alerts.target, m.alerts.dedupe]} />
          </Panel>
        </section>
      </div>
    </div>
  );
}
