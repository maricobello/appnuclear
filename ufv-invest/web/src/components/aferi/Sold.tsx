"use client";

import { useOfferingStats } from "@/lib/useOffering";
import { num } from "@/lib/fmt";
import { cx } from "@/components/ui";

type Props = { slug: string; total: number; demoSold: number; status: "operacao" | "implantacao" | "encerrada" };

function useStats({ slug, total, demoSold, status }: Props) {
  const s = useOfferingStats(slug, { total, demoSold: status === "encerrada" ? total : demoSold });
  return s;
}

/** Barra fina de cotas adquiridas (cards da vitrine) */
export function SoldBar(p: Props & { className?: string }) {
  const s = useStats(p);
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
          aria-label={`${pct}% das cotas adquiridas`}
        >
          <div className={cx("h-full rounded-full", p.status === "implantacao" ? "bg-series-1" : "bg-gradient-to-r from-brand/70 to-brand")} style={{ width: `${Math.min(100, s.pct)}%` }} />
        </div>
        <span className="text-[12px] font-medium text-ink-2 tnum">{pct}% vendido</span>
      </div>
    </div>
  );
}

/** Anel de porcentagem (card de destaque do herói) */
export function SoldGauge(p: Props & { size?: number }) {
  const s = useStats(p);
  const size = p.size ?? 56;
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const pct = Math.min(100, s.pct);
  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${Math.round(pct)}% das cotas adquiridas`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth="5" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--leaf)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-ink text-[11px] font-semibold">
          {Math.round(pct)}%
        </text>
      </svg>
      <div>
        <div className="text-[15px] font-semibold text-ink tnum">{Math.round(pct)}%</div>
        <div className="text-[12px] text-muted">Cotas adquiridas</div>
      </div>
    </div>
  );
}

/** Bloco "56% cotas adquiridas · 2.500 / 5.000 cotas disponíveis" (página da usina) */
export function SoldPanel(p: Props & { illustrative?: boolean }) {
  const s = useStats(p);
  const available = Math.max(0, s.total - s.sold);
  return (
    <div>
      <div className="text-[28px] font-bold leading-none text-ink tnum">{Math.round(s.pct)}%</div>
      <div className="mt-1 text-[13px] text-muted">Cotas adquiridas</div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-leaf" style={{ width: `${Math.min(100, s.pct)}%` }} />
      </div>
      <div className="mt-3 text-[15px] font-semibold text-ink tnum">
        {num(available)} / {num(s.total)}
      </div>
      <div className="text-[12px] text-muted">Cotas disponíveis</div>
      {s.investors != null && <div className="mt-2 text-[12px] text-muted">{num(s.investors)} investidores</div>}
      {s.source === "ilustrativo" && (
        <div className="mt-2 text-[11px] text-muted">{p.illustrative ? "Subscrição ilustrativa · contrato ainda não implantado" : "Subscrição informada pela gestora · contrato ainda não implantado na rede"}</div>
      )}
    </div>
  );
}
