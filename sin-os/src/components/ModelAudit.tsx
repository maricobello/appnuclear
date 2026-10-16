"use client";

import type { ModelAudit, ModelCheck, ModelCheckStatus } from "@/lib/audit/models";
import { ago } from "@/lib/fmt";
import { useApi } from "@/lib/useApi";
import { Disclosure, ErrorBox, Loading, Panel } from "./ui";

const STATUS: Record<ModelCheckStatus, { dot: string; label: string }> = {
  pass: { dot: "bg-good", label: "Aprovado" },
  warn: { dot: "bg-warning", label: "Atenção" },
  fail: { dot: "bg-critical", label: "Reprovado" },
};

function CheckRow({ c }: { c: ModelCheck }) {
  const st = STATUS[c.status];
  return (
    <li className="flex items-start gap-3 border-b border-line py-2.5 last:border-0">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${st.dot}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] text-ink">
          <span className="sr-only">{st.label}: </span>
          {c.label}
          {c.sub ? <span className="text-muted"> · {c.sub}</span> : null}
        </span>
        <span className="block text-[12px] leading-snug text-muted">{c.detail}</span>
      </span>
      <span className="max-w-[40%] shrink-0 text-right">
        <span className="tnum block text-[14px] font-medium text-ink-2">{c.display}</span>
        <span className="block text-[12px] text-muted">alvo {c.target}</span>
      </span>
    </li>
  );
}

const ORDER: Record<ModelCheckStatus, number> = { fail: 0, warn: 1, pass: 2 };

/** Mesmo critério em vários submercados vira uma linha só (o pior status manda). */
function groupIssues(checks: ModelCheck[]) {
  const groups = new Map<string, { label: string; target: string; status: ModelCheckStatus; items: ModelCheck[] }>();
  for (const c of checks) {
    if (c.status === "pass") continue;
    const key = `${c.model}|${c.label}`;
    const g = groups.get(key) ?? { label: c.label, target: c.target, status: c.status, items: [] };
    g.items.push(c);
    if (ORDER[c.status] < ORDER[g.status]) g.status = c.status;
    groups.set(key, g);
  }
  return [...groups.entries()].map(([key, g]) => ({ key, ...g })).sort((a, b) => ORDER[a.status] - ORDER[b.status]);
}

function IssueRow({ g }: { g: ReturnType<typeof groupIssues>[number] }) {
  const st = STATUS[g.status];
  const first = g.items[0];
  return (
    <li className="flex items-start gap-3 border-b border-line py-2.5 last:border-0">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${st.dot}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] text-ink">
          <span className="sr-only">{st.label}: </span>
          {g.label}
        </span>
        <span className="block text-[12px] leading-snug text-muted">
          {first.sub && g.items.length > 1 ? `${first.sub}: ` : first.sub ? `${first.sub} · ` : ""}
          {first.detail}
        </span>
      </span>
      <span className="max-w-[40%] shrink-0 text-right">
        {g.items.map((c) => (
          <span key={c.id} className="tnum block text-[13px] font-medium text-ink-2">
            {c.sub ? `${c.sub} ` : ""}
            {c.display}
          </span>
        ))}
        <span className="block text-[12px] text-muted">alvo {g.target}</span>
      </span>
    </li>
  );
}

/** Auditoria dos modelos no PLD real: nota, pontos de atenção e todos os critérios por modelo. */
export function ModelAuditPanel() {
  const { data, error, mutate, isLoading } = useApi<ModelAudit>("/api/auditoria/modelos", 30 * 60_000);
  const issues = data ? groupIssues(data.checks) : [];
  const groups = data ? [...new Set(data.checks.map((c) => c.model))].map((m) => [m, data.checks.filter((c) => c.model === m)] as const) : [];
  const tone = !data ? "text-muted" : data.score >= 85 ? "text-good" : data.score >= 60 ? "text-warning" : "text-critical";
  return (
    <Panel
      title="Auditoria dos modelos"
      subtitle={
        data
          ? `${data.counts.pass} aprovados · ${data.counts.warn} em atenção · ${data.counts.fail} reprovados · calculada ${ago(data.generatedAt)}`
          : "Previsão, bandas, volatilidade, regimes, bateria e auditor, sobre o PLD real"
      }
      right={
        data ? (
          <span className={`tnum text-[22px] font-semibold ${tone}`} title="Aprovado vale 1, atenção 0,5, reprovado 0">
            {data.score}
            <span className="text-[13px] font-normal text-muted">/100</span>
          </span>
        ) : null
      }
    >
      {data ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-muted">{data.dataNote}. Recalculada no máximo a cada hora.</p>
          {data.trackRecord?.some((t) => t.days < data.trackMinDays) ? (
            <p className="text-[13px] text-muted">
              Registro das previsões publicadas (o que a tela mostrou × o PLD que aconteceu):{" "}
              {data.trackRecord.map((t) => `${t.sub} ${t.days} dia${t.days === 1 ? "" : "s"}`).join(" · ")}. Entra na nota a partir de {data.trackMinDays} dias conferidos.
            </p>
          ) : null}
          {issues.length ? (
            <div>
              <h3 className="text-[13px] font-semibold text-ink-2">Pontos de atenção</h3>
              <ul>
                {issues.map((g) => (
                  <IssueRow key={g.key} g={g} />
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[14px] text-good">Todos os critérios aprovados.</p>
          )}
          <Disclosure title={`Todos os ${data.checks.length} critérios`} hint="por modelo e submercado">
            <div className="flex flex-col gap-4">
              {groups.map(([model, list]) => (
                <section key={model}>
                  <h3 className="text-[13px] font-semibold text-ink-2">{model}</h3>
                  <ul>
                    {list.map((c) => (
                      <CheckRow key={c.id} c={c} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </Disclosure>
        </div>
      ) : error && !isLoading ? (
        <ErrorBox error={error} onRetry={() => mutate()} />
      ) : (
        <Loading height={160} label="Rodando os modelos no PLD real (a primeira vez leva até 2 min)…" />
      )}
    </Panel>
  );
}
