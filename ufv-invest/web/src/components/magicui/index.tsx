import type { ReactNode } from "react";
import { cx } from "@/components/ui";

/** Border Beam (Magic UI): feixe de luz percorrendo a borda do elemento pai (que precisa ser relative + rounded). */
export function BorderBeam() {
  return <span className="border-beam" aria-hidden />;
}

/** Animated Shiny Text (Magic UI) */
export function ShinyText({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("shiny-text", className)}>{children}</span>;
}

/** Marquee (Magic UI): faixa rolante infinita, pausa no hover, bordas esmaecidas. */
export function Marquee({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("marquee overflow-hidden", className)}>
      <div className="marquee-track flex w-max gap-10">
        <div className="flex shrink-0 items-center gap-10">{children}</div>
        <div className="flex shrink-0 items-center gap-10" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Dot Pattern (Magic UI): fundo pontilhado com máscara radial. */
export function DotPattern({ className }: { className?: string }) {
  return <div className={cx("dot-pattern pointer-events-none absolute inset-0", className)} aria-hidden />;
}

/** Bento Grid (Magic UI) */
export function BentoGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("grid auto-rows-[minmax(13rem,auto)] gap-4 md:grid-cols-3", className)}>{children}</div>;
}

export function BentoCard({
  icon,
  title,
  text,
  className,
  children,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cx("group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-sm transition hover:shadow-md", className)}>
      {children && <div className="pointer-events-none absolute inset-0">{children}</div>}
      <div className="relative">
        <span className="flex size-10 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink transition group-hover:border-sun/60 group-hover:bg-brand-soft group-hover:text-brand">{icon}</span>
      </div>
      <div className="relative mt-8">
        <h3 className="text-[17px] font-semibold tracking-tight text-ink">{title}</h3>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{text}</p>
      </div>
    </div>
  );
}
