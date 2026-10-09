"use client";

import { cx } from "@/components/ui";
import { useT } from "@/i18n/client";

const STEPS = ["0", "1", "2", "3", "4", "5"] as const;

/** Fluxo de aquisição (linha do tempo vertical numerada) */
export function FlowSteps({ current = 0, compact = false }: { current?: number; compact?: boolean }) {
  const { d } = useT();
  const ACQUISITION_STEPS = STEPS.map((k) => ({ title: d.flow[k].t, text: d.flow[k].d }));
  return (
    <ol className="relative">
      {ACQUISITION_STEPS.map((s, i) => (
        <li key={s.title} className={cx("relative flex gap-3", compact ? "pb-3" : "pb-4", "last:pb-0")}>
          {i < ACQUISITION_STEPS.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-22px)] w-px bg-line-strong" aria-hidden />}
          <span
            className={cx(
              "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold",
              i < current ? "bg-leaf text-brand-ink" : i === current ? "bg-brand text-brand-ink ring-4 ring-brand-soft" : "bg-surface-2 text-ink-2 ring-1 ring-line-strong",
            )}
            aria-current={i === current ? "step" : undefined}
          >
            {i < current ? "✓" : i + 1}
          </span>
          <div className="pt-0.5">
            <div className="text-[13px] font-semibold text-ink">{s.title}</div>
            <div className="text-[12px] leading-snug text-muted">{s.text}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
