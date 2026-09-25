import { CircleAlert, CircleCheck, CircleDashed, CircleMinus, CircleX, FlaskConical, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { ago } from "@/lib/fmt";

export function Panel({
  title,
  subtitle,
  right,
  children,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-line bg-surface ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold tracking-wide text-ink">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
        </div>
        {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Sparkline({ values, color = "#3987e5", width = 120, height = 32 }: { values: (number | null)[]; color?: string; width?: number; height?: number }) {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  if (v.length < 2) return <svg width={width} height={height} aria-hidden />;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const pts = values
    .map((x, i) => (x === null ? null : `${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 3 - ((x - min) / span) * (height - 6)).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");
  const last = pts.split(" ").pop()!.split(",");
  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <polyline points={pts} fill="none" stroke="#5b6574" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={3} fill={color} stroke="#0f141b" strokeWidth={2} />
    </svg>
  );
}

/** Stat tile: rótulo · valor · delta (vs período nomeado) · tendência. */
export function Stat({
  label,
  value,
  unit,
  delta,
  deltaGood,
  hint,
  spark,
  sparkColor,
  swatch,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: string | null;
  deltaGood?: boolean | null;
  hint?: string;
  spark?: (number | null)[];
  sparkColor?: string;
  swatch?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-2 rounded-lg border border-line bg-surface p-3.5">
      <div className="flex items-center gap-2 text-xs text-ink-2">
        {swatch ? <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: swatch }} aria-hidden /> : null}
        <span className="truncate">{label}</span>
      </div>
      <div className="min-w-0 text-2xl font-semibold leading-none text-ink">
        {value}
        {unit ? <span className="ml-1 text-xs font-normal text-muted">{unit}</span> : null}
      </div>
      {spark ? <Sparkline values={spark} color={sparkColor} width={140} height={26} /> : null}
      {delta || hint ? (
        <div className="flex flex-col gap-0.5 text-xs">
          {delta ? <span className={deltaGood === null || deltaGood === undefined ? "text-muted" : deltaGood ? "text-good" : "text-serious"}>{delta}</span> : null}
          {hint ? <span className="text-[11px] text-muted">{hint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export type Level = "good" | "warning" | "serious" | "critical" | "neutral";

const LEVEL: Record<Level, { cls: string; Icon: typeof CircleCheck }> = {
  good: { cls: "text-good border-good/30 bg-good/10", Icon: CircleCheck },
  warning: { cls: "text-warning border-warning/30 bg-warning/10", Icon: TriangleAlert },
  serious: { cls: "text-serious border-serious/30 bg-serious/10", Icon: CircleAlert },
  critical: { cls: "text-critical border-critical/40 bg-critical/10", Icon: CircleX },
  neutral: { cls: "text-muted border-line bg-surface-2", Icon: CircleMinus },
};

/** Status sempre com ícone + rótulo (nunca só cor). */
export function Badge({ level, children, title }: { level: Level; children: ReactNode; title?: string }) {
  const { cls, Icon } = LEVEL[level];
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      <Icon size={12} aria-hidden />
      {children}
    </span>
  );
}

export const statusLevel = (s: string): Level =>
  s === "ok" || s === "pass" ? "good" : s === "degraded" || s === "warn" ? "warning" : s === "down" || s === "fail" ? "critical" : "neutral";

export const statusLabel: Record<string, string> = {
  ok: "OK",
  degraded: "Degradada",
  down: "Fora do ar",
  disabled: "Desativada",
  pass: "OK",
  warn: "Atenção",
  fail: "Falha",
  skip: "N/A",
};

export interface SourceMetaView {
  id: string;
  ok: boolean;
  simulated: boolean;
  fallback: string | null;
  error: string | null;
  latestTs: number | null;
}

/** Procedência do dado: ao vivo · fallback · simulado. */
export function SourceTag({ meta, label }: { meta?: SourceMetaView | null; label?: string }) {
  if (!meta) return null;
  if (meta.simulated)
    return (
      <span title={meta.fallback ?? ""} className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning">
        <FlaskConical size={12} aria-hidden /> {label ? `${label} · ` : ""}simulado
      </span>
    );
  if (!meta.ok)
    return (
      <span title={meta.error ?? ""} className="inline-flex items-center gap-1 rounded border border-critical/40 bg-critical/10 px-1.5 py-0.5 text-[11px] text-critical">
        <CircleX size={12} aria-hidden /> {label ? `${label} · ` : ""}indisponível
      </span>
    );
  if (meta.fallback)
    return (
      <span title={meta.fallback} className="inline-flex items-center gap-1 rounded border border-serious/40 bg-serious/10 px-1.5 py-0.5 text-[11px] text-serious">
        <CircleDashed size={12} aria-hidden /> {label ? `${label} · ` : ""}fallback
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-2" title={`última observação ${ago(meta.latestTs)}`}>
      <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-good" aria-hidden />
      {label ? `${label} · ` : ""}ao vivo · {ago(meta.latestTs)}
    </span>
  );
}

export function SimBanner({ metas }: { metas: (SourceMetaView | null | undefined)[] }) {
  const sim = metas.filter((m): m is SourceMetaView => !!m && (m.simulated || !!m.fallback));
  if (!sim.length) return null;
  const anySim = sim.some((m) => m.simulated);
  return (
    <div role="status" className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${anySim ? "border-warning/40 bg-warning/10 text-warning" : "border-serious/40 bg-serious/10 text-serious"}`}>
      <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
      <div>
        <strong>{anySim ? "Atenção: parte dos dados desta tela é SIMULADA." : "Fonte primária indisponível — usando fallback."}</strong>{" "}
        {sim.map((m) => `${m.id}: ${m.fallback ?? m.error}`).join(" · ")}
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-critical/40 bg-critical/10 p-3 text-sm text-critical">
      <CircleX size={16} className="mt-0.5 shrink-0" aria-hidden />
      <span>{error instanceof Error ? error.message : String(error)}</span>
    </div>
  );
}

export function Loading({ label = "Carregando dados e calibrando modelos…", height = 240 }: { label?: string; height?: number }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted" style={{ height }}>
      <span className="live-dot mr-2 inline-block h-2 w-2 rounded-full bg-accent" aria-hidden />
      {label}
    </div>
  );
}

export function Table({ head, rows, align }: { head: ReactNode[]; rows: ReactNode[][]; align?: ("left" | "right" | "center")[] }) {
  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-2 py-2 font-medium" style={{ textAlign: align?.[i] ?? "left" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line/60 last:border-0 hover:bg-surface-2">
              {r.map((c, j) => (
                <td key={j} className="whitespace-nowrap px-2 py-1.5 text-ink-2" style={{ textAlign: align?.[j] ?? "left" }}>
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

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-2.5 py-1 text-xs transition-colors ${value === o.value ? "bg-surface-3 text-ink" : "text-muted hover:text-ink-2"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        {subtitle ? <p className="mt-0.5 max-w-3xl text-xs text-muted">{subtitle}</p> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}
