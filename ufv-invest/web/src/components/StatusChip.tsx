"use client";

import { useT } from "@/i18n/client";
import { cx } from "./ui";

/** Selo de status da usina, no padrão da vitrine */
export function StatusChip({ status, className }: { status: "operacao" | "implantacao" | "encerrada"; className?: string }) {
  const map = {
    operacao: { c: "bg-brand-soft text-good ring-good/25", dot: "bg-leaf" },
    implantacao: { c: "bg-info/10 text-info ring-info/25", dot: "bg-series-1" },
    encerrada: { c: "bg-surface-3 text-ink-2 ring-line-strong", dot: "bg-muted" },
  } as const;
  const { d } = useT();
  const m = map[status];
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ring-inset", m.c, className)}>
      <span className={cx("size-1.5 rounded-full", m.dot)} aria-hidden />
      {d.status[status]}
    </span>
  );
}
