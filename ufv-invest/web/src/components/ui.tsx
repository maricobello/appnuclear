import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
}

export function Card({ children, className, as: As = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" }) {
  return <As className={cx("glass rounded-[var(--radius)]", className)}>{children}</As>;
}

export function CardHeader({ title, subtitle, right, id }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 id={id} className="text-[15px] font-semibold text-ink">
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "brand" | "default" }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cx("mt-1 truncate text-[22px] font-semibold leading-tight tnum", tone === "brand" ? "text-brand" : tone === "good" ? "text-good" : "text-ink")}>{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-muted">{hint}</div>}
    </div>
  );
}

export function Badge({ children, tone = "default", className }: { children: ReactNode; tone?: "default" | "brand" | "good" | "warning" | "critical" | "info"; className?: string }) {
  const tones = {
    default: "border-line-strong text-ink-2",
    brand: "border-brand/40 bg-brand-soft text-brand",
    good: "border-good/30 bg-good/10 text-good",
    warning: "border-warning/40 bg-warning/10 text-warning",
    critical: "border-critical/40 bg-critical/10 text-critical",
    info: "border-series-2/40 bg-series-2/10 text-info",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] font-medium", tones[tone], className)}>{children}</span>;
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warning" | "critical" | "good"; title?: ReactNode; children: ReactNode }) {
  const Icon = tone === "warning" ? AlertTriangle : tone === "critical" ? XCircle : tone === "good" ? CheckCircle2 : Info;
  const color = tone === "warning" ? "text-warning border-warning/30 bg-warning/5" : tone === "critical" ? "text-critical border-critical/30 bg-critical/5" : tone === "good" ? "text-good border-good/30 bg-good/5" : "text-info border-series-2/30 bg-series-2/5";
  return (
    <div className={cx("flex gap-3 rounded-[var(--radius)] border px-4 py-3 text-[13px]", color)} role={tone === "critical" ? "alert" : "status"}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 text-ink-2">
        {title && <div className="font-semibold text-ink">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function SectionTitle({ eyebrow, title, children, id, as: H = "h2" }: { eyebrow?: string; title: ReactNode; children?: ReactNode; id?: string; as?: "h1" | "h2" }) {
  return (
    <div className="max-w-3xl">
      {eyebrow && <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">{eyebrow}</div>}
      <H id={id} className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        {title}
      </H>
      {children && <p className="mt-3 text-[16px] text-ink-2">{children}</p>}
    </div>
  );
}

export const buttonClass = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-[14px] font-semibold text-brand-ink shadow-[0_0_24px_-8px_rgba(61,220,132,0.7)] transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-line-strong bg-white/[0.04] px-4 py-2.5 text-[14px] font-semibold text-ink transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50",
  outline:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-brand/40 bg-transparent px-4 py-2 text-[13px] font-semibold text-brand transition hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50",
  dark: "inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-[14px] font-semibold text-[#06090e] shadow-sm transition hover:bg-white/85 disabled:opacity-50",
  ghost: "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[14px] font-medium text-ink-2 transition hover:bg-surface-2 hover:text-ink disabled:opacity-50",
};

/** Selo de status da usina, no padrão da vitrine */
export function StatusChip({ status, className }: { status: "operacao" | "implantacao" | "encerrada"; className?: string }) {
  const map = {
    operacao: { label: "Em operação", c: "bg-brand-soft text-good ring-good/25", dot: "bg-leaf" },
    implantacao: { label: "Em implantação", c: "bg-info/10 text-info ring-info/25", dot: "bg-series-1" },
    encerrada: { label: "Oferta encerrada", c: "bg-surface-3 text-ink-2 ring-line-strong", dot: "bg-muted" },
  } as const;
  const m = map[status];
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ring-inset", m.c, className)}>
      <span className={cx("size-1.5 rounded-full", m.dot)} aria-hidden />
      {m.label}
    </span>
  );
}

/** Ícone em círculo verde suave (estatísticas e listas) */
export function IconBubble({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-good", className)}>{children}</span>;
}

export function SourceDot({ status }: { status: "live" | "cache" | "fallback" | "error" }) {
  const map = {
    live: { c: "bg-good", l: "ao vivo" },
    cache: { c: "bg-series-2", l: "cache" },
    fallback: { c: "bg-warning", l: "referência" },
    error: { c: "bg-critical", l: "erro" },
  } as const;
  const m = map[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
      <span className={cx("size-2 rounded-full", m.c)} aria-hidden />
      {m.l}
    </span>
  );
}
