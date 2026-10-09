import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MapPin, Receipt, Zap } from "lucide-react";
import type { PlantSummary } from "@/lib/analysis";
import { brl, num, pct } from "@/lib/fmt";
import { buttonClass, cx, StatusChip } from "@/components/ui";
import { PhotoPlaceholder } from "./PhotoPlaceholder";
import { SoldBar } from "./Sold";

export function mwp(kwp: number) {
  return `${num(kwp / 1000, 1)} MWp`;
}

/** Card de usina da vitrine (início e lista de usinas) */
export function PlantCard({ s, cta = "outline", priority = false }: { s: PlantSummary; cta?: "outline" | "solid"; priority?: boolean }) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(15,42,68,0.04),0_8px_24px_-12px_rgba(15,42,68,0.12)] transition hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(15,42,68,0.05),0_16px_32px_-12px_rgba(15,42,68,0.2)]">
      <Link href={`/usinas/${s.slug}`} className="relative block aspect-[16/9] overflow-hidden bg-surface-3" tabIndex={-1} aria-hidden>
        {s.cover ? (
          <Image src={s.cover} alt="" fill sizes="(min-width:1280px) 300px, (min-width:768px) 45vw, 100vw" className="object-cover transition duration-500 group-hover:scale-[1.03]" priority={priority} />
        ) : (
          <PhotoPlaceholder />
        )}
        <StatusChip status={s.status} className="absolute left-3 top-3 bg-white/95 shadow-sm" />
        <span
          className={cx(
            "absolute right-3 top-3 rounded-full px-2.5 py-0.5 text-[11px] font-semibold shadow-sm ring-1 ring-inset",
            s.ppaActive ? "bg-white/95 text-good ring-good/25" : "bg-white/95 text-ink-2 ring-line-strong",
          )}
        >
          {s.ppaActive ? "PPA ativo" : "Sem PPA"}
        </span>
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-[15px] font-semibold leading-snug text-ink">
          <Link href={`/usinas/${s.slug}`} className="hover:text-brand">
            {s.name}
          </Link>
        </h3>
        <p className="mt-0.5 flex items-center gap-1 text-[12px] text-muted">
          <MapPin className="size-3.5" aria-hidden /> {s.municipio} - {s.uf}
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="flex items-start gap-2">
            <Zap className="mt-0.5 size-4 text-good" aria-hidden />
            <div className="flex flex-col-reverse">
              <p className="text-[11px] text-muted">Potência</p>
              <p className="text-[14px] font-semibold text-ink tnum">{mwp(s.dcKWp)}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Receipt className="mt-0.5 size-4 text-good" aria-hidden />
            <div className="flex flex-col-reverse">
              <p className="text-[11px] text-muted">Valor da cota</p>
              <p className="text-[14px] font-semibold text-ink tnum">{brl(s.cotaPriceBRL, 0)}</p>
            </div>
          </div>
        </div>

        <SoldBar slug={s.slug} total={s.totalCotas} demoSold={s.demoSoldCotas} status={s.status} className="mt-4" />

        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3">
          <div className="flex flex-col-reverse">
            <p className="text-[11px] text-muted">Rent. estimada</p>
            <p className="text-[14px] font-semibold text-ink tnum">{pct(s.irrNominalPct)} a.a.</p>
          </div>
          <div className="flex flex-col-reverse">
            <p className="text-[11px] text-muted">ROI ({s.horizonYears} anos)</p>
            <p className="text-[14px] font-semibold text-good tnum">{pct(s.roiTotalPct, 0)}</p>
          </div>
          <div className="flex flex-col-reverse text-right">
            <p className="text-[11px] text-muted">Retorno</p>
            <p className="text-[14px] font-semibold text-ink tnum">{s.paybackYears != null ? `${num(Math.ceil(s.paybackYears))} anos` : "—"}</p>
          </div>
        </div>

        <div className="mt-auto pt-4">
          <Link href={`/usinas/${s.slug}`} className={cx(cta === "solid" ? buttonClass.primary : buttonClass.outline, "w-full")}>
            Ver detalhes <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    </article>
  );
}
