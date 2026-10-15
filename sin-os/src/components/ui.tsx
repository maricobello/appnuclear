"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, CircleAlert, CircleCheck, CircleMinus, CircleX, Info, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { themedColor } from "@/lib/chart";
import { ago, dateTime } from "@/lib/fmt";
import { useScheme } from "@/lib/theme";
import { AnimatedNumber, EASE } from "./motion";

/* ------------------------------------------------------------------ cartão */

/** Cartão: título curto, subtítulo opcional, ações à direita e corpo com respiro. */
export function Panel({
  title,
  subtitle,
  right,
  children,
  className = "",
  bodyClassName = "px-5 pb-5 pt-1",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`card flex min-w-0 flex-col ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pb-2 pt-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[13px] leading-snug text-muted">{subtitle}</p> : null}
        </div>
        {right ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{right}</div> : null}
      </header>
      <div className={`min-w-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** Título de seção da página (agrupa cartões). */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 px-1 pt-2">
      <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-ink">{children}</h2>
      {right}
    </div>
  );
}

/** Conteúdo secundário recolhido ("Mostrar detalhes"): a página abre só com o essencial. */
export function Disclosure({ title, hint, children, defaultOpen = false }: { title: string; hint?: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group" open={defaultOpen}>
      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[14px] font-medium text-accent transition-colors hover:bg-accent/10">
        {title}
        <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden />
        {hint ? <span className="ml-1 font-normal text-muted">{hint}</span> : null}
      </summary>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </details>
  );
}

/** Rolagem horizontal acessível: só vira parada de teclado quando o conteúdo de fato rola. */
export function ScrollX({ children, label, className = "" }: { children: ReactNode; label?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={`scrollbar-thin relative overflow-x-auto ${className}`} tabIndex={scrolls ? 0 : undefined} role={scrolls ? "region" : undefined} aria-label={scrolls ? (label ?? "tabela com rolagem") : undefined}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------ sparkline */

export function Sparkline({
  values,
  color = "#0a84ff",
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
  const scheme = useScheme();
  const col = themedColor(color, scheme);
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
              <stop offset="0%" style={{ stopColor: col, stopOpacity: 0.18 }} />
              <stop offset="100%" style={{ stopColor: col, stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <path d={`${d}L${last[0].toFixed(1)},${height}L${pts[0][0].toFixed(1)},${height}Z`} fill={`url(#g${gid})`} />
        </>
      ) : null}
      <path d={d} fill="none" style={{ stroke: col }} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ------------------------------------------------------------- status */

export type Level = "good" | "warning" | "serious" | "critical" | "neutral";

const LEVEL: Record<Level, { cls: string; Icon: typeof CircleCheck }> = {
  good: { cls: "text-good bg-good/12", Icon: CircleCheck },
  warning: { cls: "text-warning bg-warning/14", Icon: TriangleAlert },
  serious: { cls: "text-serious bg-serious/12", Icon: CircleAlert },
  critical: { cls: "text-critical bg-critical/12", Icon: CircleX },
  neutral: { cls: "text-muted bg-surface-2", Icon: CircleMinus },
};

/** Status sempre com ícone + rótulo (nunca só cor). */
export function Badge({ level, children, title }: { level: Level; children: ReactNode; title?: string }) {
  const { cls, Icon } = LEVEL[level];
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium ${cls}`}>
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
  note?: string | null;
  error: string | null;
  latestTs: number | null;
}

/** Estado operacional de uma fonte. */
export type DataState = "LIVE" | "FALLBACK" | "STALE" | "ERROR" | "SIM";

export function sourceState(meta: SourceMetaView | null | undefined, staleAfterMs = 3 * 3600_000, now = Date.now()): DataState | null {
  if (!meta) return null;
  if (meta.simulated) return "SIM";
  if (!meta.ok) return "ERROR";
  if (meta.fallback) return "FALLBACK";
  if (meta.latestTs && now - meta.latestTs > staleAfterMs) return "STALE";
  return "LIVE";
}

const STATE: Record<DataState, { label: string; dot: string; title: string }> = {
  LIVE: { label: "Ao vivo", dot: "bg-good", title: "Dado atual, fonte primária" },
  FALLBACK: { label: "Fonte alternativa", dot: "bg-serious", title: "Fonte primária indisponível — usando caminho alternativo" },
  STALE: { label: "Atrasado", dot: "bg-warning", title: "Dado mais antigo que o esperado" },
  ERROR: { label: "Indisponível", dot: "bg-critical", title: "Fonte indisponível" },
  SIM: { label: "Simulado", dot: "bg-warning", title: "Dado SIMULADO (fonte indisponível)" },
};

export function StatusTag({ state, at, detail, compact = false }: { state: DataState | null; at?: number | null; detail?: string | null; compact?: boolean }) {
  if (!state) return null;
  const s = STATE[state];
  return (
    <span title={[s.title, detail, at ? `última observação ${dateTime(at)} (${ago(at)})` : null].filter(Boolean).join(" · ")} className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-muted">
      <span className={`inline-block h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
      {!compact && at ? <span>· {ago(at)}</span> : null}
    </span>
  );
}

/** Procedência do dado: fonte + estado, discreto (com `time`, também há quanto tempo é a última observação). */
export function SourceTag({ meta, label, staleAfterMs, time = false }: { meta?: SourceMetaView | null; label?: string; staleAfterMs?: number; time?: boolean }) {
  if (!meta) return null;
  const state = sourceState(meta, staleAfterMs);
  const official = meta.note?.startsWith("PLD oficial") && state === "LIVE";
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
      {label || official ? <span>{official ? "CCEE oficial" : label} ·</span> : null}
      <StatusTag state={state} at={meta.latestTs} compact={!time} detail={meta.fallback ?? meta.error ?? meta.note} />
    </span>
  );
}

/**
 * Linha de procedência logo abaixo do título, sempre com a mesma altura: reservada enquanto carrega,
 * discreta quando tudo está ao vivo ("PLD · Ao vivo · há 5 min") e em destaque quando há fonte
 * alternativa, falha ou simulação (toque para ver o detalhe). Como a altura não muda, a página não pula
 * quando os dados chegam. A 1ª fonte da lista é a principal da tela.
 */
export function SimBanner({ metas, label, staleAfterMs }: { metas: (SourceMetaView | null | undefined)[]; label?: string; staleAfterMs?: number }) {
  const known = metas.filter((m): m is SourceMetaView => !!m);
  const sim = known.filter((m) => m.simulated || !!m.fallback || !m.ok);
  const [open, setOpen] = useState(false);
  if (!sim.length) {
    return (
      <div className="flex min-h-11 items-center px-1 sm:min-h-9" aria-busy={known.length ? undefined : true}>
        {known.length ? <SourceTag meta={known[0]} label={label} staleAfterMs={staleAfterMs} time /> : null}
      </div>
    );
  }
  const anySim = sim.some((m) => m.simulated);
  const anyDown = sim.some((m) => !m.ok && !m.simulated);
  const pldOnly = sim.length > 0 && sim.every((m) => m.id === "ccee_pld" && m.ok && !m.simulated);
  const tone = anySim ? "bg-warning/12" : anyDown ? "bg-critical/10" : "bg-surface-2";
  // sobre o fundo colorido o cinza secundário não chega a 4,5:1; usa o texto secundário escuro
  const sub = anySim || anyDown ? "text-ink-2" : "text-muted";
  const Icon = anySim || anyDown ? TriangleAlert : Info;
  const iconCls = anySim ? "text-warning" : anyDown ? "text-critical" : "text-accent";
  const title = anySim ? "Parte dos dados desta tela é simulada" : anyDown ? "Uma fonte está indisponível" : pldOnly ? "PLD estimado pelo CMO do ONS" : "Usando fonte alternativa";
  const summary = pldOnly ? "a CCEE não está respondendo a este servidor; a regra de formação é a mesma (CMO limitado ao piso e ao teto)" : sim.map((m) => `${m.id}: ${shortReason(m.fallback ?? m.error ?? "")}`).join(" · ");
  return (
    <motion.div role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22, ease: EASE }} className={`overflow-hidden rounded-2xl ${tone}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex min-h-11 w-full items-center gap-2.5 px-4 text-left text-[13px] sm:min-h-9" aria-expanded={open}>
        <Icon size={16} className={`shrink-0 ${iconCls}`} aria-hidden />
        <span className="min-w-0 truncate font-medium text-ink">{title}</span>
        <span className={`hidden min-w-0 flex-1 truncate md:inline ${sub}`}>{summary}</span>
        <ChevronDown size={16} className={`ml-auto shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.ul initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-1 px-4 pb-3 pl-11 text-[13px] text-ink-2">
            {sim.map((m) => (
              <li key={m.id} className="break-words">
                <span className={sub}>{m.id}</span> — {m.fallback ?? m.error}
              </li>
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

/** Motivo curto: "…CCEE indisponível: HTTP 403: Acesso bloqueado (…)" → "CCEE indisponível: HTTP 403". */
function shortReason(s: string): string {
  const m = /([^—;]*indispon[íi]vel[^:]*:\s*HTTP \d{3})/i.exec(s) ?? /(HTTP \d{3})/.exec(s);
  return (m?.[1] ?? s).trim().slice(0, 90);
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-critical/10 px-4 py-3 text-[13px] text-critical">
      <CircleX size={16} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 break-words">{error instanceof Error ? error.message : String(error)}</span>
      {onRetry ? (
        <button onClick={onRetry} className="shrink-0 rounded-full bg-critical/15 px-3 py-1 text-[12px] font-medium hover:bg-critical/25">
          Tentar de novo
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ height = 16, className = "" }: { height?: number | string; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ height }} aria-hidden />;
}

export function Loading({ label = "Carregando…", height = 240 }: { label?: string; height?: number }) {
  return (
    <div className="relative overflow-hidden rounded-xl" style={{ height }} role="status" aria-live="polite">
      <div className="skeleton absolute inset-0 opacity-70" />
      <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-[13px] text-muted">{label}</div>
    </div>
  );
}

export function Empty({ label = "Sem dados no período.", height = 120 }: { label?: string; height?: number }) {
  return (
    <div className="flex items-center justify-center rounded-xl bg-surface-2 px-4 text-center text-[13px] text-muted" style={{ height }}>
      {label}
    </div>
  );
}

/* ---------------------------------------------------------------- KPIs */

const nfDelta = (d: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

export function Delta({ value, suffix = "%", digits = 1, invert = false, title }: { value: number | null | undefined; suffix?: string; digits?: number; invert?: boolean; title?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="text-muted">—</span>;
  const flat = Math.abs(value) < 10 ** -digits / 2;
  const up = value > 0;
  const good = invert ? !up : up;
  const cls = flat ? "text-muted" : good ? "text-good" : "text-critical";
  return (
    <span className={`tnum font-medium ${cls}`} title={title}>
      {flat ? "" : up ? "+" : "−"}
      {nfDelta(digits).format(Math.abs(value))}
      {suffix}
    </span>
  );
}

/** Indicador: rótulo, número grande, variação e minigráfico. Procedência no `title` (passe o mouse). */
export function Kpi({
  label,
  value,
  format,
  unit,
  delta,
  deltaSuffix = "%",
  deltaTitle,
  spark,
  color = "#0a84ff",
  state,
  at,
  source,
  swatch,
  detail,
  foot,
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
  foot?: ReactNode;
}) {
  const warn = state && state !== "LIVE" && state !== "FALLBACK" ? STATE[state] : null;
  return (
    <div className="card flex min-w-0 flex-col px-4 pb-3 pt-3.5" title={[source, detail, at ? `atualizado ${dateTime(at)}` : null].filter(Boolean).join(" · ") || undefined}>
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
        {swatch ? <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: swatch }} aria-hidden /> : null}
        <span className="truncate">{label}</span>
        {warn ? <span className={`ml-auto h-2 w-2 shrink-0 rounded-full ${warn.dot}`} title={warn.label} aria-label={warn.label} /> : null}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          <AnimatedNumber value={value} format={format} className="tnum" />
        </span>
        {unit ? <span className="text-[13px] text-muted">{unit}</span> : null}
      </div>
      {delta !== undefined || foot ? (
        <div className="mt-0.5 flex min-h-5 items-center justify-between gap-2 text-[13px]">
          {delta !== undefined ? <Delta value={delta} suffix={deltaSuffix} title={deltaTitle} /> : <span />}
          {foot ? <span className="truncate text-muted">{foot}</span> : null}
        </div>
      ) : null}
      {spark && spark.length > 1 ? (
        <div className="mt-2 h-8">
          <Sparkline values={spark} color={color} height={32} />
        </div>
      ) : null}
    </div>
  );
}

/** Indicador estático (valor já formatado). */
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
    <div className="card flex min-w-0 flex-col gap-1 px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
        {swatch ? <span className="inline-block h-2 w-2 rounded-full" style={{ background: swatch }} aria-hidden /> : null}
        <span className="truncate">{label}</span>
      </div>
      <div className="tnum flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        <span className="min-w-0 truncate">{value}</span>
        {unit ? <span className="text-[13px] font-normal tracking-normal text-muted">{unit}</span> : null}
      </div>
      {spark ? (
        <div className="h-8">
          <Sparkline values={spark} color={sparkColor} height={32} />
        </div>
      ) : null}
      {delta || hint ? (
        <div className="flex flex-col gap-0.5 text-[13px]">
          {delta ? <span className={deltaGood === null || deltaGood === undefined ? "text-muted" : deltaGood ? "text-good" : "text-critical"}>{delta}</span> : null}
          {hint ? <span className="leading-snug text-muted">{hint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Linha rótulo · valor (lista agrupada, estilo Ajustes). */
export function MetricRow({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: "good" | "critical" | "warning" | "muted" }) {
  const cls = tone === "good" ? "text-good" : tone === "critical" ? "text-critical" : tone === "warning" ? "text-warning" : tone === "muted" ? "text-muted" : "text-ink";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-0">
      <span className="min-w-0 text-[14px] text-ink-2">
        {label}
        {hint ? <span className="ml-1.5 text-[12px] text-muted">{hint}</span> : null}
      </span>
      <span className={`tnum shrink-0 text-[14px] font-semibold ${cls}`}>{value}</span>
    </div>
  );
}

/* --------------------------------------------------------------- tabela */

/**
 * Tabela de dados. No celular, tabela larga vira lista (a 1ª coluna é o título de cada item e as demais
 * aparecem como pares rótulo/valor), sem rolar para o lado. Matriz numérica (`stack={false}`) continua
 * tabela, com a 1ª coluna fixa ao rolar.
 */
export function Table({
  head,
  rows,
  align,
  dense = true,
  label,
  stack,
  rowClass,
}: {
  head: ReactNode[];
  rows: ReactNode[][];
  align?: ("left" | "right" | "center")[];
  dense?: boolean;
  label?: string;
  /** Padrão: empilha no celular a partir de 5 colunas. */
  stack?: boolean;
  /** Classe extra da linha (só na tabela). */
  rowClass?: (i: number) => string | undefined;
}) {
  const stacked = stack ?? head.length >= 5;
  const pin = stacked ? "" : "max-sm:sticky max-sm:left-0 max-sm:z-[1] max-sm:bg-surface";
  const table = (
    <ScrollX label={label}>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line">
            {head.map((h, i) => (
              <th key={i} className={`whitespace-nowrap px-3 py-2 text-[12px] font-medium text-muted ${i === 0 ? pin : ""}`} style={{ textAlign: align?.[i] ?? "left" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.map((r, i) => (
            <tr key={i} className={`border-b border-line transition-colors last:border-0 hover:bg-surface-2/60 ${rowClass?.(i) ?? ""}`}>
              {r.map((c, j) => (
                <td key={j} className={`whitespace-nowrap px-3 text-ink-2 ${dense ? "py-2" : "py-2.5"} ${j === 0 ? pin : ""}`} style={{ textAlign: align?.[j] ?? "left" }}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollX>
  );
  if (!stacked) return table;
  return (
    <>
      <StackedRows head={head} rows={rows} label={label} className="sm:hidden" />
      <div className="hidden sm:block">{table}</div>
    </>
  );
}

/** Linhas de tabela como lista (celular): título = 1ª coluna; o resto em pares rótulo/valor. */
export function StackedRows({ head, rows, label, className = "" }: { head: ReactNode[]; rows: ReactNode[][]; label?: string; className?: string }) {
  return (
    <ul aria-label={label} className={`flex flex-col ${className}`}>
      {rows.map((r, i) => (
        <li key={i} className="border-b border-line py-3 first:pt-1 last:border-0">
          <div className="text-[15px] font-medium text-ink">{r[0]}</div>
          <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] min-[360px]:grid-cols-3">
            {r.slice(1).map((c, j) => {
              const h = head[j + 1];
              // valor curto ocupa uma coluna; texto médio, duas; frase longa (ou ações), a linha toda
              const len = typeof c === "string" ? c.length : 0;
              const span = !h || len > 22 ? "col-span-full" : len > 12 ? "col-span-2" : "";
              return (
                <div key={j} className={`min-w-0 ${span}`}>
                  <dt className={h ? "text-[12px] text-muted" : "sr-only"}>{h || "Ações"}</dt>
                  <dd className="tnum min-w-0 break-words text-ink-2">{c === null || c === undefined || c === "" ? "—" : c}</dd>
                </div>
              );
            })}
          </dl>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------- controles */

/** Controle segmentado no estilo iOS (o indicador desliza). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "sm",
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "xs";
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[10px] bg-surface-2 p-[3px]">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            title={o.title}
            aria-label={o.title}
            onClick={() => onChange(o.value)}
            className={`relative inline-flex min-h-11 items-center justify-center rounded-[8px] font-medium transition-colors ${size === "xs" ? "px-2.5 text-[12px] sm:min-h-7" : "px-3 text-[13px] sm:min-h-8"} ${active ? "text-ink" : "text-muted hover:text-ink"}`}
          >
            {active ? <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-[8px] bg-seg-thumb shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_1px_rgba(0,0,0,0.04)]" transition={{ type: "spring", stiffness: 500, damping: 40 }} /> : null}
            <span className="relative inline-flex items-center gap-1">{o.label}</span>
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
      ? "bg-accent-fill text-on-accent hover:brightness-110"
      : variant === "ghost"
        ? "text-accent hover:bg-accent/10"
        : "bg-surface-2 text-ink hover:bg-surface-3";
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      className={`inline-flex min-h-11 sm:min-h-9 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-[background-color,filter] disabled:cursor-not-allowed disabled:opacity-40 ${cls} ${className}`}
    >
      {children}
    </motion.button>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.025em] text-ink sm:text-[32px]">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-3xl text-[15px] leading-snug text-muted">{subtitle}</p> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}

/** Barra de confiança 0–1 (barra + número), para tabelas. */
export function ConfidenceBar({ value, title }: { value: number | null; title?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className="text-muted">—</span>;
  const pct = Math.round(100 * Math.min(1, Math.max(0, value)));
  const color = pct >= 80 ? "bg-good" : pct >= 55 ? "bg-warning" : "bg-serious";
  return (
    <span className="inline-flex items-center gap-2" title={title}>
      <span className="relative inline-block h-1.5 w-14 overflow-hidden rounded-full bg-surface-3">
        <motion.span className={`absolute inset-y-0 left-0 rounded-full ${color}`} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5, ease: EASE }} />
      </span>
      <span className="tnum text-[12px] text-ink-2">{pct}%</span>
    </span>
  );
}
