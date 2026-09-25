"use client";

import { Fragment, useMemo, useState } from "react";
import { Bot, Database, ExternalLink, Play, RefreshCw } from "lucide-react";
import { EChart, type ChartOption } from "@/components/EChart";
import { Badge, ErrorBox, Loading, PageHeader, Panel, statusLabel, statusLevel, Table } from "@/components/ui";
import type { AuditoriaResp } from "@/lib/apiTypes";
import { baseOption, C, line, timeAxis, valueAxis } from "@/lib/chart";
import { ago, dateTime, num } from "@/lib/fmt";
import { useApi } from "@/lib/useApi";

const KEY_STORE = "sinos.adminKey";

export default function AuditoriaPage() {
  const { data, error, mutate, isValidating } = useApi<AuditoriaResp>("/api/auditoria", 30_000);
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
              (body.report ? " Agente IA gerou relatório." : body.agentError ? ` Agente IA falhou: ${body.agentError}` : body.agentEligible ? "" : " (agente IA não acionado: sem credencial ou sem ANTHROPIC_API_KEY)"),
      );
      await mutate();
    } catch (e) {
      setRunMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
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
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Agente auditor de APIs"
        subtitle="Camada 1 (determinística): disponibilidade, latência, frescor vs SLA, schema, completude, validade (faixas regulatórias), outliers de Hampel e integridade cruzada PLD×CMO. Camada 2 (IA): Claude investiga degradações com ferramentas e registra causa provável e ação."
        right={
          <div className="flex flex-wrap items-center gap-2">
            {data?.auth.required ? (
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="ADMIN_KEY (fica na sessão)"
                aria-label="Chave de administrador"
                className="w-48 rounded border border-line bg-surface px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
              />
            ) : null}
            <button
              onClick={run}
              disabled={running}
              className="inline-flex items-center gap-1.5 rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              {running ? <RefreshCw size={14} className="animate-spin" aria-hidden /> : <Play size={14} aria-hidden />}
              {running ? "Auditando…" : "Rodar auditoria"}
            </button>
          </div>
        }
      />
      {runMsg ? <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ink-2">{runMsg}</div> : null}
      {error && !data ? <ErrorBox error={error} /> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Saúde geral" subtitle={l ? `${dateTime(l.startedAt)} (${ago(l.startedAt)}) · gatilho: ${l.trigger} · ${num(l.durationMs / 1000, 1)} s` : "nenhuma execução"}>
          {l ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-semibold text-ink">{l.overallScore}</span>
                <span className="text-sm text-muted">/100</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge level="good">{l.counts.ok} OK</Badge>
                <Badge level="warning">{l.counts.degraded} degradadas</Badge>
                <Badge level="critical">{l.counts.down} fora do ar</Badge>
                <Badge level="neutral">{l.counts.disabled} desativadas</Badge>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted">Clique em “Rodar auditoria”. Em produção, o Vercel Cron (diário) e o workflow do GitHub Actions (a cada 15 min) executam automaticamente.</p>
          )}
          <div className="mt-4 flex flex-col gap-1.5 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <Database size={13} aria-hidden /> Persistência:{" "}
              {data ? (data.storage === "firestore" ? <Badge level="good">Firestore {data.firebase.projectId}</Badge> : <Badge level="warning">memória (configure Firebase)</Badge>) : "—"}
            </span>
            <span className="flex items-center gap-1.5">
              <Bot size={13} aria-hidden /> Agente IA:{" "}
              {data ? data.agent.configured ? <Badge level="good">{data.agent.model}</Badge> : <Badge level="warning">defina ANTHROPIC_API_KEY</Badge> : "—"}
            </span>
            {data?.firebase.error ? <span className="text-critical">Firebase: {data.firebase.error}</span> : null}
          </div>
        </Panel>
        <Panel className="xl:col-span-2" title="Histórico do score" subtitle="Execuções persistidas">
          {hist ? <EChart option={hist} height={210} label="Histórico do score de auditoria" dim={isValidating} /> : <p className="text-xs text-muted">Sem histórico ainda.</p>}
        </Panel>
      </div>

      <Panel title="Fontes auditadas" subtitle="Clique numa linha para ver as checagens">
        {l ? (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  {["Fonte", "Provedor", "Status", "Score", "HTTP", "Latência", "Tentativas", "Último dado", "Pontos", "Erro"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="tnum">
                {l.sources.map((s) => (
                  <Fragment key={s.id}>
                    <tr className="cursor-pointer border-b border-line/60 hover:bg-surface-2" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
                      <td className="whitespace-nowrap px-2 py-1.5 text-ink">{s.name}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-muted">{s.provider}</td>
                      <td className="px-2 py-1.5"><Badge level={statusLevel(s.status)}>{statusLabel[s.status]}</Badge></td>
                      <td className="px-2 py-1.5 text-right text-ink-2">{s.status === "disabled" ? "—" : s.score}</td>
                      <td className="px-2 py-1.5 text-right text-ink-2">{s.httpStatus ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right text-ink-2">{s.latencyMs !== null ? `${s.latencyMs} ms` : "—"}</td>
                      <td className="px-2 py-1.5 text-right text-ink-2">{s.attempts}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-ink-2">{s.latestTs ? ago(s.latestTs) : "—"}</td>
                      <td className="px-2 py-1.5 text-right text-ink-2">{num(s.points)}</td>
                      <td className="max-w-[320px] truncate px-2 py-1.5 text-critical" title={s.error}>{s.error ?? ""}</td>
                    </tr>
                    {open === s.id ? (
                      <tr className="border-b border-line/60 bg-surface-2">
                        <td colSpan={10} className="px-3 py-2">
                          <ul className="grid grid-cols-1 gap-1 md:grid-cols-2">
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
          </div>
        ) : data ? (
          <p className="text-xs text-muted">Sem execuções registradas.</p>
        ) : (
          <Loading height={200} />
        )}
        {l?.cross.length ? (
          <div className="mt-4 border-t border-line pt-3">
            <h3 className="mb-2 text-xs font-medium text-ink-2">Integridade cruzada</h3>
            <ul className="flex flex-col gap-1.5 text-xs">
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Relatório do agente IA" subtitle={report ? `${report.model} · ${dateTime(report.createdAt)} · ${report.toolCalls.length} chamadas de ferramenta · ${num(report.usage.inputTokens + report.usage.outputTokens)} tokens (${num(report.usage.cacheReadTokens)} em cache)` : "acionado quando a auditoria detecta degradação, na execução diária agendada ou manualmente com credencial"}>
          {report ? (
            <div className="flex flex-col gap-3 text-xs">
              <div className="flex items-center gap-2">
                <Badge level={report.severity === "critical" ? "critical" : report.severity === "warning" ? "warning" : "good"}>{report.severity}</Badge>
                <span className="text-ink-2">{report.summary}</span>
              </div>
              <ul className="flex flex-col gap-2">
                {report.findings.map((f, i) => (
                  <li key={i} className="rounded-md border border-line bg-surface-2 p-2.5">
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
                <p className="text-[11px] text-muted">Ferramentas: {report.toolCalls.map((t) => `${t.name}(${t.ms} ms)`).join(" · ")}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-muted">
              Nenhum relatório ainda. Configure <code className="text-ink-2">ANTHROPIC_API_KEY</code> e <code className="text-ink-2">ADMIN_KEY</code> na Vercel e rode a auditoria com a chave. O agente re-sonda as fontes com problema, consulta o histórico no Firestore, inspeciona amostras e checa PLD×CMO antes de concluir.
            </p>
          )}
        </Panel>
        <Panel title="Telemetria observada" subtitle="Chamadas reais desta instância (tráfego + auditorias)">
          {data?.telemetry.length ? (
            <Table
              head={["Host", "n", "p50", "p95", "Erros"]}
              align={["left", "right", "right", "right", "right"]}
              rows={data.telemetry.map((t) => [t.host, t.count, `${num(t.p50)} ms`, `${num(t.p95)} ms`, t.errors])}
            />
          ) : (
            <p className="text-xs text-muted">Sem chamadas registradas nesta instância.</p>
          )}
        </Panel>
      </div>

      <Panel title="Catálogo de APIs e SLAs" subtitle="O que o auditor verifica">
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
  );
}
