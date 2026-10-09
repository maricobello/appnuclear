import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, MapPin } from "lucide-react";
import type { PlantSummary } from "@/lib/analysis";
import { brl, num, pct } from "@/lib/fmt";
import { StatusChip } from "@/components/ui";
import { SoldBar } from "./Sold";

const hash = (t: string) => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function mwp(kwp: number) {
  return `${num(kwp / 1000, 1)} MWp`;
}

/** Card de usina: só o que decide o clique — rentabilidade, cota, prazo de retorno. */
export function PlantCard({ s, priority = false }: { s: PlantSummary; cta?: "outline" | "solid"; priority?: boolean }) {
  return (
    <Link
      href={`/usinas/${s.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-[20px] border border-line bg-surface transition duration-300 hover:-translate-y-1 hover:border-brand/30 hover:shadow-[0_30px_60px_-30px_rgba(61,220,132,0.35)]"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-navy">
        {s.cover ? (
          <Image src={s.cover} alt="" fill sizes="(min-width:1024px) 380px, (min-width:640px) 50vw, 100vw" className="object-cover transition duration-700 group-hover:scale-[1.05]" priority={priority} />
        ) : (
          <Image
            src="/images/lp/usina.jpg"
            alt=""
            fill
            sizes="(min-width:1024px) 380px, (min-width:640px) 50vw, 100vw"
            className="scale-125 object-cover transition duration-700 group-hover:scale-[1.32]"
            style={{ objectPosition: `${(hash(s.slug) % 80) + 10}% ${(hash(s.slug + "y") % 60) + 30}%`, filter: `blur(2px) hue-rotate(${(hash(s.slug) % 40) - 20}deg)` }}
            priority={priority}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/30 to-black/30" />
        <div className="absolute left-3 top-3 flex gap-1.5">
          <StatusChip status={s.status} className="!bg-black/55 backdrop-blur-md" />
          {s.ppaActive && <span className="rounded-full bg-black/55 px-2.5 py-0.5 text-[12px] font-semibold text-sun ring-1 ring-inset ring-sun/30 backdrop-blur-md">PPA ativo</span>}
        </div>
        <div className="absolute inset-x-5 bottom-3">
          <h3 className="text-[19px] font-semibold tracking-tight text-ink">{s.name}</h3>
          <p className="mt-0.5 flex items-center gap-1 text-[13px] text-ink-2">
            <MapPin className="size-3.5" aria-hidden /> {s.municipio}, {s.uf} · {mwp(s.dcKWp)}
          </p>
        </div>
      </div>
      <div className="flex flex-1 flex-col px-5 pb-5 pt-4">
        <div className="flex items-end justify-between gap-3">
          <p className="text-[34px] font-semibold leading-none tracking-tight text-brand tnum">
            {pct(s.irrNominalPct)}
            <span className="ml-1.5 text-[13px] font-medium tracking-normal text-muted">ao ano</span>
          </p>
          <span className="flex size-9 items-center justify-center rounded-full border border-line-strong text-ink-2 transition group-hover:border-brand group-hover:bg-brand group-hover:text-brand-ink">
            <ArrowUpRight className="size-4" aria-hidden />
          </span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-[13px]">
          <div className="bg-surface px-3 py-2.5">
            <dt className="text-muted">Cota</dt>
            <dd className="mt-0.5 font-semibold text-ink tnum">{brl(s.cotaPriceBRL, 0)}</dd>
          </div>
          <div className="bg-surface px-3 py-2.5">
            <dt className="text-muted">Retorno em</dt>
            <dd className="mt-0.5 font-semibold text-ink tnum">{s.paybackYears != null ? `${num(Math.ceil(s.paybackYears))} anos` : "—"}</dd>
          </div>
        </dl>
        <SoldBar slug={s.slug} total={s.totalCotas} demoSold={s.demoSoldCotas} status={s.status} className="mt-auto pt-5" />
      </div>
    </Link>
  );
}
