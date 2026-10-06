import Link from "next/link";
import { ArrowUpRight, MapPin } from "lucide-react";
import type { PlantSummary } from "@/lib/analysis";
import { brl, brlCompact, num, pct, statusLabel } from "@/lib/fmt";
import { PlantArt } from "@/components/landing/PlantArt";
import { OfferProgress } from "./OfferProgress";

const statusStyle: Record<string, string> = {
  captacao: "bg-brand text-brand-ink",
  construcao: "bg-[#3987e5] text-white",
  operacao: "bg-good text-[#05230f]",
};

/** Card da vitrine — capa, rentabilidade alvo, renda por cota, mínimo, prazo e captação. */
export function ShowcaseCard({ s, priority = false }: { s: PlantSummary; priority?: boolean }) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-[0_24px_60px_-24px_rgba(245,165,36,0.35)]">
      <div className="relative aspect-[16/10] overflow-hidden">
        {s.cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- capa estática em /public
          <img src={s.cover} alt={`${s.illustrative ? "Ilustração" : "Vista"} da ${s.name}`} loading={priority ? "eager" : "lazy"} className="size-full object-cover transition duration-500 group-hover:scale-[1.04]" />
        ) : (
          <PlantArt slug={s.slug} mounting={s.mounting} title={`Ilustração da ${s.name}`} className="size-full transition duration-500 group-hover:scale-[1.04]" />
        )}
        <div className="absolute left-3 top-3 flex gap-1.5">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusStyle[s.status]}`}>{statusLabel[s.status]}</span>
          {s.illustrative && <span className="rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">Ilustrativo</span>}
        </div>
        <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 font-mono text-[11px] text-white backdrop-blur">{s.symbol}</span>
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[12px] text-white backdrop-blur">
            <MapPin className="size-3.5" /> {s.municipio}/{s.uf}
          </span>
          <span className="rounded-full bg-black/55 px-2.5 py-1 text-[12px] text-white backdrop-blur">
            {num(s.dcKWp / 1000, 2)} MWp · {s.mounting === "single-axis" ? "tracker" : "fixa"}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-[18px] font-semibold tracking-tight text-ink">
          <Link href={`/usinas/${s.slug}`} className="after:absolute after:inset-0 focus-visible:outline-none">
            {s.name}
          </Link>
        </h3>
        <p className="mt-1 line-clamp-2 text-[13px] text-muted">{s.tagline}</p>

        <div className="mt-4 flex items-end justify-between gap-3 rounded-xl border border-brand/20 bg-brand-soft px-4 py-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-brand/80">Rentabilidade alvo</div>
            <div className="text-[26px] font-semibold leading-none text-brand tnum">
              {pct(s.irrNominalPct)} <span className="text-[13px] font-medium">a.a.</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-muted">por cota/mês</div>
            <div className="text-[15px] font-semibold text-ink tnum">≈ {brl(s.monthlyPerCotaBRL)}</div>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
          <div>
            <dt className="text-[11px] text-muted">Investimento mínimo</dt>
            <dd className="font-semibold tnum">{brl(s.minInvestmentBRL, 0)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">Prazo</dt>
            <dd className="font-semibold tnum">{s.horizonYears} anos</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">Retorno do capital</dt>
            <dd className="font-semibold tnum">{s.paybackYears != null ? `${num(s.paybackYears, 1)} anos` : "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">Cenário pessimista (P10)</dt>
            <dd className="font-semibold tnum">{pct(s.irrP10Pct)} a.a.</dd>
          </div>
        </dl>

        <div className="mt-4">
          <OfferProgress slug={s.slug} status={s.status} totalCotas={s.totalCotas} softCapCotas={s.softCapCotas} offeringStart={s.offeringStart} offeringEnd={s.offeringEnd} />
        </div>

        {s.tags.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {s.tags.map((t) => (
              <li key={t} className="rounded-md border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">
                {t}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex items-center justify-between border-t border-line pt-4 text-[13px]">
          <span className="text-muted">Captação total {brlCompact(s.investmentBRL)}</span>
          <span className="inline-flex items-center gap-1 font-semibold text-brand">
            {s.status === "captacao" ? "Investir" : "Ver usina"} <ArrowUpRight className="size-4 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </article>
  );
}
