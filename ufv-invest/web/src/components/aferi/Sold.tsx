"use client";

import { useOfferingStats } from "@/lib/useOffering";
import { cx } from "@/components/ui";
import { useT } from "@/i18n/client";

type Props = { slug: string; total: number; demoSold: number; status: "operacao" | "implantacao" | "encerrada" };

function useStats({ slug, total, demoSold, status }: Props) {
  const s = useOfferingStats(slug, { total, demoSold: status === "encerrada" ? total : demoSold });
  return s;
}

/** Barra fina de cotas adquiridas (cards da vitrine) */
export function SoldBar(p: Props & { className?: string }) {
  const s = useStats(p);
  const { d, t } = useT();
  const pct = Math.round(s.pct);
  return (
    <div className={p.className}>
      <div className="flex items-center gap-3">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t(d.sold.aria, { p: pct })}
        >
          <div className={cx("h-full rounded-full", p.status === "implantacao" ? "bg-series-1" : "bg-gradient-to-r from-brand/70 to-brand")} style={{ width: `${Math.min(100, s.pct)}%` }} />
        </div>
        <span className="text-[12px] font-medium text-ink-2 tnum">{t(d.sold.label, { p: pct })}</span>
      </div>
    </div>
  );
}
