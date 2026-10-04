import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import type { PlantSummary } from "@/lib/analysis";
import { brl, num, pct, statusLabel } from "@/lib/fmt";
import { Badge } from "@/components/ui";

export function PlantCard({ s }: { s: PlantSummary }) {
  return (
    <Link
      href={`/usinas/${s.slug}`}
      className="group flex flex-col rounded-2xl border border-line bg-surface p-5 transition hover:-translate-y-0.5 hover:border-brand/40 hover:bg-surface-2"
    >
      <div className="flex items-center justify-between gap-2">
        <Badge tone={s.status === "captacao" ? "brand" : s.status === "operacao" ? "good" : "info"}>{statusLabel[s.status]}</Badge>
        <span className="font-mono text-[12px] text-muted">{s.symbol}</span>
      </div>
      <h3 className="mt-4 text-[19px] font-semibold tracking-tight text-ink">{s.name}</h3>
      <p className="mt-1 flex items-center gap-1 text-[13px] text-muted">
        <MapPin className="size-3.5" /> {s.municipio}/{s.uf} · {num(s.dcKWp)} kWp {s.mounting === "single-axis" ? "· tracker" : "· fixa"}
      </p>
      <p className="mt-3 line-clamp-2 text-[14px] text-ink-2">{s.tagline}</p>
      <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">TIR</dt>
          <dd className="mt-0.5 text-[17px] font-semibold text-brand tnum">{pct(s.irrNominalPct)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">Payback</dt>
          <dd className="mt-0.5 text-[17px] font-semibold tnum">{s.paybackYears != null ? `${num(s.paybackYears, 1)} a` : "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">P50</dt>
          <dd className="mt-0.5 text-[17px] font-semibold tnum">{num(s.p50MWh / 1000, 1)} GWh</dd>
        </div>
      </dl>
      <div className="mt-4 flex items-center justify-between text-[13px]">
        <span className="text-muted">
          Cota {brl(s.cotaPriceBRL, 0)} · ~{brl(s.monthlyPerCotaBRL)}/mês
        </span>
        <ArrowRight className="size-4 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand" />
      </div>
    </Link>
  );
}
