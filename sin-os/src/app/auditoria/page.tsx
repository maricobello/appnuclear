"use client";

import { Fragment, useMemo, useState } from "react";
import { Bell, Bot, Database, ExternalLink, Play, RefreshCw } from "lucide-react";
import { EChart, type ChartOption } from "@/components/EChart";
import { Badge, Disclosure, ErrorBox, Loading, PageHeader, Panel, ScrollX, statusLabel, statusLevel, Table } from "@/components/ui";
import type { AuditoriaResp, ConfiancaResp } from "@/lib/apiTypes";
import { baseOption, C, line, timeAxis, valueAxis } from "@/lib/chart";
import { ago, dateTime, num } from "@/lib/fmt";
import { useApi } from "@/lib/useApi";

const KEY_STORE = "sinos.adminKey";

export default function AuditoriaPage() {
  const { data, error, mutate, isValidating } = useApi<AuditoriaResp>("/api/auditoria", 30_000);
  const trust = useApi<ConfiancaResp>("/api/confianca", 300_000).data;
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const storedKey = () => {
    try {
      return sessionStorage.getItem(KEY_STORE) ?? "";
    } catch {
      return "";
    }
  };

  async function run() {
    setRunning(true);
    setRunMsg(null);
    try {
      const k = key || storedKey();
      try { if (key) sessionStorage.setItem(KEY_STORE, key); } catch { /* armazenamento indisponível */ }
      const res = await fetch("/api/auditoria/run", { method: "POST", headers: k ? { "x-admin-key": k } : {} });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setRunMsg(
        body.throttled
          ? "Limite de 1 execução por minuto sem credencial — mostrando a última."
          : `Auditoria concluída em ${num(body.run.durationMs / 1000, 1)} s · score ${body.run.overallScore}/100.` +
              (body.report ? " Agente IA gerou relatório." : body.agentError ? ` Agente IA falhou: ${body.agentError}` : body.agentEligible ? "" : " (agente IA não acionado: sem credencial ou sem GROQ_API_KEY)"),
      );
      await mutate();
    } catch (e) {
      setRunMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function testAlert() {
    setRunMsg(null);
    try {
      const k = key || storedKey();
      const res = await fetch("/api/auditoria/alert-test", { method: "POST", headers: k ? { "x-admin-key": k } : {} });
      const body = await res.json();
      setRunMsg(
        body.sent
          ? `Notificação de teste enviada (${body.destination}). Confira o app/canal.`
          : body.throttled
            ? "Teste já enviado há pouco — limite de 1 por hora sem credencial."
            : body.error ?? `Falha ao enviar (HTTP ${res.status}).`,
      );
    } catch (e) {
      setRunMsg(e instanceof Error ? e.message : String(e));
    }
  }

  const hist = useMemo<ChartOption | null>(() => {
    if (!data?.history.length) return null;
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => `${v}/100` },
      xAxis: timeAxis(),
      yAxis: valueAxis("score", { min: 0, max: 100, scale: false }),
      series: [line("Score geral", data.history.map((h) => [h.startedAt, h.overallScore]), C.series[0], { showSymbol: data.history.length < 30, symbolSize: 8 })],
    };
  }, [data]);

  const l = data?.latest;
  const report = data?.reports[0];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Agente auditor"
        subtitle="Verifica as fontes públicas a cada 15 minutos; quando algo degrada, o agente de IA investiga e diz a causa provável."
        right={
          <div className="flex flex-wrap items-center gap-2">
            {data?.auth.required ? (
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="ADMIN_KEY (fica na sessão)"
                aria-label="Chave de administrador"
                className="h-11 w-52 rounded-[10px] bg-surface-2 sm:h-9 px-3 text-[14px] text-ink outline-none focus:ring-2 focus:ring-accent/50"
              />
            ) : null}
            <button
              onClick={run}
              disabled={running}
              className="inline-flex min-h-11 sm:min-h-9 items-center gap-1.5 rounded-full bg-accent-fill px-4 text-[13px] font-semibold text-on-accent hover:brightness-110 disabled:opacity-50"
            >
              {running ? <RefreshCw size={14} className="animate-spin" aria-hidden /> : <Play size={14} aria-hidden />}
              {running ? "Auditando…" : "Rodar auditoria"}
            </button>
          </div>
        }
      />
      {runMsg ? <div className="rounded-2xl bg-surface-2 px-4 py-3 text-[13px] text-ink-2">{runMsg}</div> : null}
      {error && !data ? <ErrorBox error={error} /> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Saúde geral" subtitle={l ? `Última verificação ${ago(l.startedAt)} · ${num(l.durationMs / 1000, 1)} s` : "Nenhuma execução"}>
          {l ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline gap-2">
                <span className="tnum text-[56px] font-semibold leading-none tracking-[-0.03em] text-ink">{l.overallScore}</span>
                <span className="text-[15px] text-muted">de 100</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge level="good">{l.counts.ok} OK</Badge>
                <Badge level="warning">{l.counts.degraded} degradadas</Badge>
                <Badge level="critical">{l.counts.down} fora do ar</Badge>
                <Badge level="neutral">{l.counts.disabled} desativadas</Badge>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-muted">Clique em “Rodar auditoria”. Em produção, o agendamento roda sozinho a cada 15 minutos.</p>
          )}
          <div className="mt-5 flex flex-col gap-2 text-[13px] text-muted">
            <span className="flex items-center gap-1.5">
              <Database size={13} aria-hidden /> Persistência:{" "}
              {data ? (data.storage === "firestore" ? <Badge level="good">Firestore {data.firebase.projectId}</Badge> : <Badge level="warning">memória (configure Firebase)</Badge>) : "—"}
            </span>
            <span className="flex items-center gap-1.5">
              <Bot size={13} aria-hidden /> Agente IA:{" "}
              {data ? data.agent.configured ? <Badge level="good">{data.agent.model}</Badge> : <Badge level="warning">defina GROQ_API_KEY</Badge> : "—"}
            </span>
            <span className="flex items-center gap-1.5">
              <Bell size={13} aria-hidden /> Alertas:{" "}
              {data ? (
                data.alerts.configured ? (
                  <>
                    <Badge level="good">{data.alerts.destination === "ntfy" ? "push (ntfy)" : "webhook"}</Badge>
                    <button onClick={testAlert} className="text-accent hover:underline">enviar teste</button>
                  </>
                ) : (
                  <Badge level="warning">defina ALERT_WEBHOOK_URL</Badge>
                )
              ) : "—"}
            </span>
            {data?.firebase.error ? <span className="text-critical">Firebase: {data.firebase.error}</span> : null}
          </div>
        </Panel>
        <Panel className="xl:col-span-2" title="Histórico do score" subtitle="Execuções guardadas">
          {hist ? <EChart option={hist} height={220} label="Histórico do score de auditoria" dim={isValidating} /> : <p className="text-[13px] text-muted">Sem histórico ainda.</p>}
        </Panel>
      </div>

      <Panel title="Fontes" subtitle="Toque numa linha para ver as checagens" bodyClassName="px-2 pb-3 pt-1">
        {l ? (
          <ScrollX label="Fontes auditadas">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  {["Fonte", "Status", "Score", "Latência", "Último dado"].map((h, i) => (
                    <th key={h} className={`whitespace-nowrap px-3 py-2 text-[12px] font-medium text-muted ${i >= 2 && i <= 3 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="tnum">
                {l.sources.map((s) => (
                  <Fragment key={s.id}>
                    <tr className="cursor-pointer border-b border-line hover:bg-surface-2/60" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
                      <td className="px-3 py-2.5">
                        <span className="block text-ink">{s.name}</span>
                        <span className="block text-[12px] text-muted">{s.provider}</span>
                      </td>
                      <td className="px-3 py-2.5"><Badge level={statusLevel(s.status)}>{statusLabel[s.status]}</Badge></td>
                      <td className="px-3 py-2.5 text-right text-ink-2">{s.status === "disabled" ? "—" : s.score}</td>
                      <td className="px-3 py-2.5 text-right text-ink-2">{s.latencyMs !== null ? `${s.latencyMs} ms` : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">{s.latestTs ? ago(s.latestTs) : "—"}</td>
                    </tr>
                    {open === s.id ? (
                      <tr className="border-b border-line bg-surface-2/60">
                        <td colSpan={5} className="px-4 py-3">
                          <p className="mb-2 text-[12px] text-muted">
                            HTTP {s.httpStatus ?? "—"} · {s.attempts} tentativa(s) · {num(s.points)} pontos
                          </p>
                          {s.error ? <p className="mb-2 break-words text-[13px] text-critical">{s.error}</p> : null}
                          <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                            {s.checks.map((c) => (
                              <li key={c.id} className="flex items-start gap-2">
                                <Badge level={statusLevel(c.status)}>{c.label}</Badge>
                                <span className="text-ink-2">{c.detail}</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </ScrollX>
        ) : data ? (
          <p className="px-3 text-[13px] text-muted">Sem execuções registradas.</p>
        ) : (
          <Loading height={200} />
        )}
        {l?.cross.length ? (
          <div className="mt-4 px-3">
            <h3 className="mb-2 text-[13px] font-semibold text-ink">Checagens cruzadas</h3>
            <ul className="flex flex-col gap-2 text-[13px]">
              {l.cross.map((c) => (
                <li key={c.id} className="flex items-start gap-2">
                  <Badge level={statusLevel(c.status)}>{statusLabel[c.status]}</Badge>
                  <span className="text-ink-2">{c.label}:</span>
                  <span className="text-muted">{c.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>

      <Panel title="Relatório do agente de IA" subtitle={report ? `${report.model} · ${dateTime(report.createdAt)} · ${report.toolCalls.length} chamadas de ferramenta` : "Roda quando a auditoria detecta degradação, uma vez por dia ou manualmente com credencial"}>
        {report ? (
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="flex items-center gap-2">
              <Badge level={report.severity === "critical" ? "critical" : report.severity === "warning" ? "warning" : "good"}>{report.severity}</Badge>
              <span className="text-ink-2">{report.summary}</span>
            </div>
            <ul className="flex flex-col gap-2">
              {report.findings.map((f, i) => (
                <li key={i} className="rounded-xl bg-surface-2 p-2.5">
                  <div className="flex items-center gap-2">
                    <Badge level={f.severity === "critical" ? "critical" : f.severity === "warning" ? "warning" : "neutral"}>{f.severity}</Badge>
                    <span className="font-medium text-ink">{f.sourceId} — {f.title}</span>
                  </div>
                  <dl className="mt-1.5 grid grid-cols-[88px_1fr] gap-x-2 gap-y-0.5 text-muted">
                    <dt>Evidência</dt><dd className="text-ink-2">{f.evidence}</dd>
                    <dt>Hipótese</dt><dd className="text-ink-2">{f.hypothesis}</dd>
                    <dt>Ação</dt><dd className="text-ink-2">{f.action}</dd>
                  </dl>
                </li>
              ))}
            </ul>
            {report.toolCalls.length ? (
              <p className="text-[12px] text-muted">Ferramentas: {report.toolCalls.map((t) => `${t.name}(${t.ms} ms)`).join(" · ")}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-[13px] leading-relaxed text-muted">
            Nenhum relatório ainda. Configure <code className="text-ink-2">ADMIN_KEY</code> na Vercel (a <code className="text-ink-2">GROQ_API_KEY</code> da Iara já serve ao agente) e rode a auditoria com a chave. O agente re-sonda as fontes com problema, consulta o histórico no Firestore, inspeciona amostras e checa PLD×CMO antes de concluir.
          </p>
        )}
      </Panel>

      <Disclosure title="Detalhes" hint="SLO, confiança nos dados, telemetria e catálogo">
        {data?.slo?.samples ? (
          <Panel
            title="SLO das fontes"
            subtitle={`Últimas ${data.slo.samples} execuções · disponibilidade = não estar fora do ar; conformidade = OK em todas as checagens`}
          >
            <div className="mb-3 flex flex-wrap gap-2 text-[13px]">
              <Badge level={data.slo.healthyPct >= 95 ? "good" : data.slo.healthyPct >= 80 ? "warning" : "critical"}>saudável em {num(data.slo.healthyPct, 1)}% dos runs</Badge>
              {data.slo.meanScore !== null ? <Badge level="neutral">score médio {num(data.slo.meanScore, 1)}</Badge> : null}
            </div>
            <Table
              head={["Fonte", "Amostras", "Disponibilidade", "Conformidade", "Latência p50", "Latência p95"]}
              align={["left", "right", "right", "right", "right", "right"]}
              rows={data.slo.sources.map((s) => [
                s.expectedDown ? `${s.name} (bloqueio esperado; coberto pelo CMO)` : s.name,
                s.samples,
                <Badge key="a" level={s.expectedDown ? "neutral" : s.availabilityPct >= 99 ? "good" : s.availabilityPct >= 95 ? "warning" : "critical"}>{num(s.availabilityPct, 1)}%</Badge>,
                `${num(s.okPct, 1)}%`,
                s.latencyP50 !== null ? `${num(s.latencyP50)} ms` : "—",
                s.latencyP95 !== null ? `${num(s.latencyP95)} ms` : "—",
              ])}
            />
          </Panel>
        ) : null}

        {trust ? (
          <Panel
            title="Confiança nos dados abertos"
            subtitle={`Impressão digital de cada dia fechado (últimos ${trust.windowDays} dias): avisa quando a fonte republica o passado ou entrega dias incompletos`}
          >
            <div className="mb-3 flex flex-wrap gap-2 text-[13px]">
              <Badge level={trust.totalRevisions30d === 0 ? "good" : "warning"}>{trust.totalRevisions30d} revisão(ões) retroativa(s) em 30 dias</Badge>
            </div>
            <Table
              head={["Fonte", "Selo", "Completude (10 dias)", "Revisões (30 d)", "Observações"]}
              align={["left", "left", "right", "right", "left"]}
              rows={trust.seals.map((s) => [
                s.name,
                s.monitored ? <Badge key="l" level={s.level === "alta" ? "good" : s.level === "média" ? "warning" : "critical"}>{s.level}</Badge> : <Badge key="l" level="neutral">sem dado real</Badge>,
                s.completeness ? `${s.completeness.completeDays}/${s.completeness.days}` : "—",
                s.revisions30d,
                s.reasons.length ? s.reasons.join(" · ") : s.monitored ? "nenhuma revisão nem lacuna detectada" : "fonte indisponível ou estimada nesta leitura",
              ])}
            />
            {trust.recentRevisions.length ? (
              <div className="mt-3">
                <p className="mb-1 text-[12px] font-semibold text-ink-2">Últimas revisões detectadas</p>
                <Table
                  head={["Detectada", "Fonte", "Dia revisado", "Pontos alterados", "Maior mudança", "Δ da média"]}
                  align={["left", "left", "left", "right", "right", "right"]}
                  rows={trust.recentRevisions.slice(0, 8).map((r) => [dateTime(r.detectedAt), r.source, r.date, r.changedPoints, `${num(r.maxAbsDiff, 2)} (${num(100 * r.maxRelDiff, 0)}%)`, num(r.meanShift, 2)])}
                />
              </div>
            ) : null}
          </Panel>
        ) : null}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Panel title="Telemetria observada" subtitle="Chamadas reais desta instância">
            {data?.telemetry.length ? (
              <Table
                head={["Host", "n", "p50", "p95", "Erros"]}
                align={["left", "right", "right", "right", "right"]}
                rows={data.telemetry.map((t) => [t.host, t.count, `${num(t.p50)} ms`, `${num(t.p95)} ms`, t.errors])}
              />
            ) : (
              <p className="text-[13px] text-muted">Sem chamadas registradas nesta instância.</p>
            )}
          </Panel>
          <Panel className="xl:col-span-2" title="Catálogo de APIs e SLAs" subtitle="O que o auditor verifica">
            {data ? (
              <Table
                head={["Fonte", "Provedor", "Região", "Categoria", "Cadência", "SLA frescor", "Licença", "Docs"]}
                rows={data.registry.map((s) => [
                  s.name,
                  s.provider,
                  s.region,
                  s.category,
                  s.cadence,
                  `${s.freshnessSlaHours} h`,
                  s.license,
                  <a key="d" href={s.docs} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    docs <ExternalLink size={11} aria-hidden />
                  </a>,
                ])}
              />
            ) : (
              <Loading height={200} />
            )}
          </Panel>
        </div>
      </Disclosure>
    </div>
  );
}
