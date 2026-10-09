import Image from "next/image";
import Link from "next/link";
import { MapPin } from "lucide-react";
import type { PlantSummary } from "@/lib/analysis";
import { brl, num, pct } from "@/lib/fmt";
import { StatusChip } from "@/components/ui";
import { PhotoPlaceholder } from "./PhotoPlaceholder";
import { SoldBar } from "./Sold";

export function mwp(kwp: number) {
  return `${num(kwp / 1000, 1)} MWp`;
}

/** Card de usina: só o que decide o clique — rentabilidade, cota, prazo de retorno. */
export function PlantCard({ s, priority = false }: { s: PlantSummary; cta?: "outline" | "solid"; priority?: boolean }) {
  return (
    <Link
      href={`/usinas/${s.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-white transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-[0_16px_40px_-16px_rgba(15,42,68,0.25)]"
    >
      <div className={`relative overflow-hidden bg-surface-3 ${s.cover ? "aspect-[16/10]" : "h-28"}`}>
        {s.cover ? (
          <Image src={s.cover} alt="" fill sizes="(min-width:1024px) 380px, (min-width:640px) 50vw, 100vw" className="object-cover transition duration-500 group-hover:scale-[1.03]" priority={priority} />
        ) : (
          <PhotoPlaceholder compact />
        )}
        <div className="absolute left-3 top-3 flex gap-1.5">
          <StatusChip status={s.status} className="bg-white/95" />
          {s.ppaActive && <span className="rounded-full bg-white/95 px-2.5 py-0.5 text-[12px] font-semibold text-good ring-1 ring-inset ring-good/25">PPA ativo</span>}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-[17px] font-semibold text-ink group-hover:text-brand">{s.name}</h3>
        <p className="mt-0.5 flex items-center gap-1 text-[13px] text-muted">
          <MapPin className="size-3.5" aria-hidden /> {s.municipio}, {s.uf}
        </p>
        <p className="mt-4 text-[30px] font-bold leading-none text-good tnum">
          {pct(s.irrNominalPct)}
          <span className="ml-1.5 text-[14px] font-medium text-muted">ao ano</span>
        </p>
        <p className="mt-2 text-[14px] text-ink-2">
          Cota de <b className="text-ink">{brl(s.cotaPriceBRL, 0)}</b>
          {s.paybackYears != null && (
            <>
              {" "}
              · retorno em <b className="text-ink">{num(Math.ceil(s.paybackYears))} anos</b>
            </>
          )}
        </p>
        <SoldBar slug={s.slug} total={s.totalCotas} demoSold={s.demoSoldCotas} status={s.status} className="mt-auto pt-5" />
      </div>
    </Link>
  );
}
