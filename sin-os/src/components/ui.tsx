"use client";

import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, CircleCheck, CircleMinus, CircleX, TriangleAlert, ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { ago, dateTime } from "@/lib/fmt";
import { AnimatedNumber, EASE } from "./motion";

/* ------------------------------------------------------------------ painel */

/** Painel do terminal: cabeçalho compacto (rótulo + ações) e corpo denso. */
export function Panel({
  title,
  subtitle,
  right,
  children,
  className = "",
  bodyClassName = "p-3",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`flex min-w-0 flex-col rounded-md border border-line bg-surface ${className}`}>
      <header className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-3 py-1.5">
        <div className="min-w-0">
          <h2 className="truncate text-[12px] font-semibold tracking-wide text-ink">{title}</h2>
          {subtitle ? <p className="text-[11px] leading-snug text-muted">{subtitle}</p> : null}
        </div>
        {right ? <div className="flex shrink-0 flex-wrap items-center gap-1.5">{right}</div> : null}
      </header>
      <div className={`min-w-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------ sparkline */

export function Sparkline({
  values,
  color = "#3987e5",
  width = 120,
  height = 28,
  fill = true,
  className,
}: {
  values: (number | null)[];
  color?: string;
  width?: number;
  height?: number;
  fill?: boolean;
  className?: string;
}) {
  const gid = useId().replace(/:/g, "");
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  if (v.length < 2) return <svg width={width} height={height} className={className} aria-hidden />;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const xy = values.map((x, i) => (x === null || !Number.isFinite(x) ? null : ([(i / (values.length - 1)) * (width - 3) + 1.5, height - 2.5 - ((x - min) / span) * (height - 5)] as const)));
  const pts = xy.filter(Boolean) as (readonly [number, number])[];
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={className} aria-hidden>
      {fill ? (
        <>
          <defs>
            <linearGradient id={`g${gid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${d}L${last[0].toFixed(1)},${height}L${pts[0][0].toFixed(1)},${height}Z`} fill={`url(#g${gid})`} />
        </>
      ) : null}
      <path d={d} fill="none" stroke={color} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  );
}

/* ------------------------------------------------------------- status */

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
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[4px] border px-1.5 py-px text-[11px] font-medium ${cls}`}>
      <Icon size={11} aria-hidden />
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
  note?: string | null;
  error: string | null;
  latestTs: number | null;
}

/** Estado operacional de uma fonte, no vocabulário de mesa: LIVE · FALLBACK · STALE · ERROR · SIM. */
export type DataState = "LIVE" | "FALLBACK" | "STALE" | "ERROR" | "SIM";

export function sourceState(meta: SourceMetaView | null | undefined, staleAfterMs = 3 * 3600_000, now = Date.now()): DataState | null {
  if (!meta) return null;
  if (meta.simulated) return "SIM";
  if (!meta.ok) return "ERROR";
  if (meta.fallback) return "FALLBACK";
  if (meta.latestTs && now - meta.latestTs > staleAfterMs) return "STALE";
  return "LIVE";
}

const STATE: Record<DataState, { cls: string; dot: string; title: string }> = {
  LIVE: { cls: "text-good border-good/30", dot: "bg-good live-dot", title: "Dado atual, fonte primária" },
  FALLBACK: { cls: "text-serious border-serious/35", dot: "bg-serious", title: "Fonte primária indisponível — usando caminho alternativo" },
  STALE: { cls: "text-warning border-warning/35", dot: "bg-warning", title: "Dado mais antigo que o esperado" },
  ERROR: { cls: "text-critical border-critical/40", dot: "bg-critical", title: "Fonte indisponível" },
  SIM: { cls: "text-warning border-warning/40 bg-warning/10", dot: "bg-warning", title: "Dado SIMULADO (fonte indisponível)" },
};

export function StatusTag({ state, at, detail, compact = false }: { state: DataState | null; at?: number | null; detail?: string | null; compact?: boolean }) {
  if (!state) return null;
  const s = STATE[state];
  return (
    <span
      title={[s.title, detail, at ? `última observação ${dateTime(at)} (${ago(at)})` : null].filter(Boolean).join(" · ")}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[4px] border px-1.5 py-px font-mono text-[10px] font-semibold tracking-wider ${s.cls}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {state}
      {!compact && at ? <span className="font-sans font-normal tracking-normal text-muted">{ago(at)}</span> : null}
    </span>
  );
}

/** Procedência do dado (compatível com as telas existentes). */
export function SourceTag({ meta, label, staleAfterMs }: { meta?: SourceMetaView | null; label?: string; staleAfterMs?: number }) {
  if (!meta) return null;
  const state = sourceState(meta, staleAfterMs);
  return (
    <span className="inline-flex items-center gap-1.5">
      {label ? <span className="text-[11px] text-muted">{label}</span> : null}
      {meta.note?.startsWith("PLD oficial") && state === "LIVE" ? <span className="rounded-[4px] border border-accent/40 px-1 py-px text-[10px] font-semibold text-accent">CCEE</span> : null}
      <StatusTag state={state} at={meta.latestTs} detail={meta.fallback ?? meta.error ?? meta.note} />
    </span>
  );
}

/** Faixa discreta de problema de dados: importante, mas sem dominar a tela. Expande os detalhes. */
export function SimBanner({ metas }: { metas: (SourceMetaView | null | undefined)[] }) {
  const sim = metas.filter((m): m is SourceMetaView => !!m && (m.simulated || !!m.fallback || !m.ok));
  const [open, setOpen] = useState(false);
  const anySim = sim.some((m) => m.simulated);
  const anyDown = sim.some((m) => !m.ok && !m.simulated);
  return (
    <AnimatePresence initial={false}>
      {sim.length ? (
        <motion.div
          role="status"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.22, ease: EASE }}
          className={`overflow-hidden rounded-md border-l-2 ${anySim ? "border-l-warning bg-warning/[0.07]" : anyDown ? "border-l-critical bg-critical/[0.07]" : "border-l-serious bg-serious/[0.06]"}`}
        >
          <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]" aria-expanded={open}>
            <TriangleAlert size={13} className={`shrink-0 ${anySim ? "text-warning" : anyDown ? "text-critical" : "text-serious"}`} aria-hidden />
            <span className="shrink-0 font-semibold text-ink">{anySim ? "Parte dos dados desta tela é SIMULADA." : anyDown ? "Fonte indisponível." : "Fonte primária indisponível — usando fallback."}</span>
            <span className="hidden min-w-0 flex-1 truncate text-muted sm:inline">
              {sim.map((m) => `${m.id}: ${shortReason(m.fallback ?? m.error ?? "")}`).join(" · ")}
            </span>
            <ChevronDown size={13} className={`ml-auto shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
          </button>
          <AnimatePresence initial={false}>
            {open ? (
              <motion.ul initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-0.5 px-3 pb-2 pl-8 text-[11px] text-ink-2">
                {sim.map((m) => (
                  <li key={m.id} className="break-words">
                    <span className="font-mono text-muted">{m.id}</span> — {m.fallback ?? m.error}
                  </li>
                ))}
              </motion.ul>
            ) : null}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Motivo curto: "…CCEE indisponível: HTTP 403: Acesso bloqueado (…)" → "CCEE indisponível: HTTP 403". */
function shortReason(s: string): string {
  const m = /([^—;]*indispon[íi]vel[^:]*:\s*HTTP \d{3})/i.exec(s) ?? /(HTTP \d{3})/.exec(s);
  return (m?.[1] ?? s).trim().slice(0, 90);
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-critical/35 bg-critical/[0.06] px-3 py-2 text-[12px] text-critical">
      <CircleX size={14} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 break-words">{error instanceof Error ? error.message : String(error)}</span>
      {onRetry ? (
        <button onClick={onRetry} className="shrink-0 rounded border border-critical/40 px-1.5 py-px text-[11px] hover:bg-critical/10">
          tentar de novo
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ height = 16, className = "" }: { height?: number | string; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ height }} aria-hidden />;
}

export function Loading({ label = "Carregando dados e calibrando modelos…", height = 240 }: { label?: string; height?: number }) {
  return (
    <div className="relative overflow-hidden rounded-md" style={{ height }} role="status" aria-live="polite">
      <div className="skeleton absolute inset-0 opacity-60" />
      <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] text-muted">
        <span className="live-dot mr-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
        {label}
      </div>
    </div>
  );
}

export function Empty({ label = "Sem dados no período.", height = 120 }: { label?: string; height?: number }) {
  return (
    <div className="flex items-center justify-center rounded-md border border-dashed border-line px-3 text-center text-[11px] text-muted" style={{ height }}>
      {label}
    </div>
  );
}

/* ---------------------------------------------------------------- KPIs */

export function Delta({ value, suffix = "%", digits = 1, invert = false, title }: { value: number | null | undefined; suffix?: string; digits?: number; invert?: boolean; title?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="text-muted">—</span>;
  const up = value > 0;
  const flat = Math.abs(value) < 10 ** -digits / 2;
  const good = invert ? !up : up;
  const cls = flat ? "text-muted" : good ? "text-good" : "text-critical";
  return (
    <span className={`tnum inline-flex items-center gap-0.5 ${cls}`} title={title}>
      <span aria-hidden className="text-[8px]">{flat ? "■" : up ? "▲" : "▼"}</span>
      {new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value))}
      {suffix}
    </span>
  );
}

/** Card de KPI do terminal: rótulo, estado da fonte, valor animado, variação, sparkline e rodapé de fonte/hora. */
export function Kpi({
  label,
  value,
  format,
  unit,
  delta,
  deltaSuffix = "%",
  deltaTitle,
  spark,
  color = "#3b9eff",
  state,
  at,
  source,
  swatch,
  detail,
}: {
  label: string;
  value: number | null | undefined;
  format: (v: number) => string;
  unit?: string;
  delta?: number | null;
  deltaSuffix?: string;
  deltaTitle?: string;
  spark?: (number | null)[];
  color?: string;
  state?: DataState | null;
  at?: number | null;
  source?: string;
  swatch?: string;
  detail?: string | null;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border border-line bg-surface px-2.5 pb-2 pt-2">
      <div className="flex items-center justify-between gap-1">
        <span className="flex min-w-0 items-center gap-1.5">
          {swatch ? <span className="inline-block h-2 w-2 shrink-0 rounded-[2px]" style={{ background: swatch }} aria-hidden /> : null}
          <span className="eyebrow truncate">{label}</span>
        </span>
        <StatusTag state={state ?? null} at={at} compact detail={detail} />
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[19px] font-semibold leading-tight tracking-tight text-ink">
          <AnimatedNumber value={value} format={format} className="tnum" />
          {unit ? <span className="ml-1 text-[10.5px] font-normal tracking-normal text-muted">{unit}</span> : null}
        </span>
        {delta !== undefined ? (
          <span className="shrink-0 text-[11px]">
            <Delta value={delta} suffix={deltaSuffix} title={deltaTitle} />
          </span>
        ) : null}
      </div>
      <div className="h-6">{spark && spark.length > 1 ? <Sparkline values={spark} color={color} height={24} /> : null}</div>
      <div className="truncate text-[10px] text-muted" title={source}>
        {source ?? " "}
      </div>
    </div>
  );
}

/** Stat tile (compatível com as telas existentes), no estilo do terminal. */
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
    <div className="flex min-w-0 flex-col justify-between gap-1.5 rounded-md border border-line bg-surface px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        {swatch ? <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: swatch }} aria-hidden /> : null}
        <span className="eyebrow truncate">{label}</span>
      </div>
      <div className="tnum min-w-0 truncate text-[19px] font-semibold leading-tight tracking-tight text-ink">
        {value}
        {unit ? <span className="ml-1 text-[10.5px] font-normal tracking-normal text-muted">{unit}</span> : null}
      </div>
      {spark ? (
        <div className="h-6">
          <Sparkline values={spark} color={sparkColor} height={24} />
        </div>
      ) : null}
      {delta || hint ? (
        <div className="flex flex-col gap-0.5 text-[11px]">
          {delta ? <span className={deltaGood === null || deltaGood === undefined ? "text-muted" : deltaGood ? "text-good" : "text-critical"}>{delta}</span> : null}
          {hint ? <span className="text-[10.5px] leading-snug text-muted">{hint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Linha rótulo · valor para painéis de resumo (densa, alinhada à direita, tabular). */
export function MetricRow({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: "good" | "critical" | "warning" | "muted" }) {
  const cls = tone === "good" ? "text-good" : tone === "critical" ? "text-critical" : tone === "warning" ? "text-warning" : tone === "muted" ? "text-muted" : "text-ink";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5 last:border-0">
      <span className="min-w-0 text-[12px] text-ink-2">
        {label}
        {hint ? <span className="ml-1.5 text-[10.5px] text-muted">{hint}</span> : null}
      </span>
      <span className={`tnum shrink-0 text-[12.5px] font-semibold ${cls}`}>{value}</span>
    </div>
  );
}

/* --------------------------------------------------------------- tabela */

export function Table({ head, rows, align, dense = true }: { head: ReactNode[]; rows: ReactNode[][]; align?: ("left" | "right" | "center")[]; dense?: boolean }) {
  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-line-strong">
            {head.map((h, i) => (
              <th key={i} className="eyebrow whitespace-nowrap px-2 py-1.5 font-semibold" style={{ textAlign: align?.[i] ?? "left" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2">
              {r.map((c, j) => (
                <td key={j} className={`whitespace-nowrap px-2 text-ink-2 ${dense ? "py-1.5" : "py-2"}`} style={{ textAlign: align?.[j] ?? "left" }}>
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

/* ------------------------------------------------------------- controles */

/** Controle segmentado com indicador que desliza (layout animation). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "sm",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "xs";
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-surface-2 p-0.5">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`relative rounded-[4px] font-medium transition-colors ${size === "xs" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-[11.5px]"} ${active ? "text-ink" : "text-muted hover:text-ink-2"}`}
          >
            {active ? <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-[4px] border border-line-strong bg-surface-3" transition={{ type: "spring", stiffness: 500, damping: 40 }} /> : null}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  type = "button",
  className = "",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
}) {
  const cls =
    variant === "primary"
      ? "bg-accent text-[#04111f] hover:bg-[#5cb0ff] border-accent"
      : variant === "ghost"
        ? "border-transparent text-muted hover:text-ink hover:bg-surface-2"
        : "border-line-strong bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink";
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${cls} ${className}`}
    >
      {children}
    </motion.button>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-[17px] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-0.5 max-w-4xl text-[11.5px] leading-snug text-muted">{subtitle}</p> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}

/** Barra de confiança 0–1 (rótulo numérico + barra), para tabelas operacionais. */
export function ConfidenceBar({ value, title }: { value: number | null; title?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className="text-muted">—</span>;
  const pct = Math.round(100 * Math.min(1, Math.max(0, value)));
  const color = pct >= 80 ? "bg-good" : pct >= 55 ? "bg-warning" : "bg-serious";
  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      <span className="relative inline-block h-1 w-12 overflow-hidden rounded-full bg-surface-3">
        <motion.span className={`absolute inset-y-0 left-0 rounded-full ${color}`} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5, ease: EASE }} />
      </span>
      <span className="tnum text-[11px] text-ink-2">{pct}%</span>
    </span>
  );
}
