"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { LiveSource, LiveState, LiveStatus } from "@/lib/audit/live";
import { ago, nf } from "@/lib/fmt";
import { useApi } from "@/lib/useApi";
import { Panel } from "./ui";

/** Estado de todas as fontes agora (a mesma consulta serve o menu lateral, a home e o topo do Terminal). */
export const useLiveSources = () => useApi<LiveStatus>("/api/fontes", 60_000);

export const LIVE_STYLE: Record<LiveState, { dot: string; label: string }> = {
  live: { dot: "bg-good", label: "Ao vivo" },
  alt: { dot: "bg-serious", label: "Alternativa" },
  stale: { dot: "bg-warning", label: "Atrasada" },
  down: { dot: "bg-critical", label: "Fora do ar" },
  off: { dot: "bg-muted", label: "Desativada" },
  pending: { dot: "bg-muted", label: "Verificando" },
};

const n0 = nf(0);

/** Respondendo = ao vivo ou por caminho alternativo; as opcionais desativadas não contam. */
export function sourceTally(s: LiveStatus | undefined) {
  if (!s) return null;
  const total = s.sources.length - s.counts.off;
  return { ok: s.counts.live + s.counts.alt, total, down: s.counts.down, stale: s.counts.stale, pending: s.counts.pending };
}

function detailOf(s: LiveSource) {
  if (s.state === "live" || s.state === "stale") return [s.latestTs ? `dado ${ago(s.latestTs)}` : null, s.latencyMs !== null ? `${n0.format(s.latencyMs)} ms` : null].filter(Boolean).join(" · ");
  return s.note ?? "";
}

function SourceRow({ s }: { s: LiveSource }) {
  const st = LIVE_STYLE[s.state];
  return (
    <li className="flex min-h-12 items-center gap-2.5 border-b border-line py-2" title={[s.provider, s.note, s.fetchedAt ? `consultada ${ago(s.fetchedAt)}` : null].filter(Boolean).join(" · ")}>
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${st.dot}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] text-ink">{s.name}</span>
        <span className="block truncate text-[12px] text-muted">{s.provider}</span>
      </span>
      <span className="min-w-0 max-w-[45%] shrink-0 text-right">
        <span className="block text-[13px] font-medium text-ink-2">{st.label}</span>
        <span className="tnum block truncate text-[12px] text-muted">{detailOf(s)}</span>
      </span>
    </li>
  );
}

/** "APIs conectadas": cada fonte com o estado agora, a idade do último dado e a latência. */
export function ApiStatusPanel() {
  const { data, error } = useLiveSources();
  const t = sourceTally(data);
  const active = data?.sources.filter((s) => s.state !== "off") ?? [];
  const off = data?.sources.filter((s) => s.state === "off") ?? [];
  const subtitle = t
    ? `${t.ok} de ${t.total} respondendo agora${data?.audit ? ` · auditoria ${data.audit.score}/100 ${ago(data.audit.at)}` : ""}`
    : error
      ? "Não foi possível consultar as fontes agora"
      : "Consultando as fontes…";
  return (
    <Panel
      title="APIs conectadas"
      subtitle={subtitle}
      right={
        <Link href="/auditoria" className="text-[13px] font-medium text-accent hover:underline">
          Auditor
        </Link>
      }
    >
      {active.length ? (
        <>
          <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
            {active.map((s) => (
              <SourceRow key={s.id} s={s} />
            ))}
          </ul>
          {off.length ? (
            <p className="mt-3 text-[12px] text-muted">
              Desativadas (opcionais): {off.map((s) => `${s.name} — ${s.note ?? "não configurada"}`).join(" · ")}.
            </p>
          ) : null}
        </>
      ) : (
        <div className="skeleton h-32" aria-hidden />
      )}
    </Panel>
  );
}

/** Selo do topo no visual Terminal: "APIs 14/15", com o score da última auditoria. */
export function SourcesPill() {
  const { data } = useLiveSources();
  const t = sourceTally(data);
  const tone = !t ? "text-muted border-line" : t.down ? "text-critical border-critical/40" : t.stale ? "text-warning border-warning/40" : "text-good border-good/35";
  const problems = data?.sources.filter((s) => s.state === "down" || s.state === "stale").map((s) => `${s.name}: ${LIVE_STYLE[s.state].label.toLowerCase()}`) ?? [];
  return (
    <Link
      href="/auditoria"
      className={`inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-[4px] border px-2 text-[12px] hover:bg-surface-2 ${tone}`}
      title={problems.length ? problems.join(" · ") : "Todas as fontes respondendo"}
    >
      <ShieldCheck size={13} aria-hidden />
      <span className="tnum font-semibold">APIs {t ? `${t.ok}/${t.total}` : "—"}</span>
      {data?.audit ? <span className="tnum text-muted">· score {data.audit.score}</span> : null}
    </Link>
  );
}
