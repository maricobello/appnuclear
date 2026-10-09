"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import type { PlantSummary } from "@/lib/analysis";
import { EChart } from "@/components/charts/EChart";
import { base, C, catAxis, valAxis } from "@/components/charts/theme";
import { useT } from "@/i18n/client";
import { buttonClass, Card, cx, StatusChip } from "@/components/ui";
import { Stepper } from "./Stepper";
import { PhotoPlaceholder } from "./PhotoPlaceholder";
import { FlowSteps } from "./FlowSteps";
import { InterestDialog } from "./InterestDialog";


export function SimulatorView({ items }: { items: PlantSummary[] }) {
  const sp = useSearchParams();
  const { d, t, f } = useT();
  const { brl, num, pct } = f;
  const sm = d.sim;
  const router = useRouter();
  const open = useMemo(() => items.filter((i) => i.status !== "encerrada"), [items]);
  const [slug, setSlug] = useState(open.find((i) => i.slug === sp.get("usina"))?.slug ?? open[0]?.slug);
  const p = useMemo(() => open.find((i) => i.slug === slug) ?? open[0], [open, slug]);
  const [n, setN] = useState(Math.max(1, Math.min(p?.totalCotas ?? 1, Number(sp.get("cotas")) || 10)));
  const [simulated, setSimulated] = useState(Boolean(sp.get("cotas")));
  const [interest, setInterest] = useState(false);
  const results = useRef<HTMLDivElement>(null);

  const yearly = p?.incomePerCotaByYear;
  const price = p?.cotaPriceBRL ?? 0;
  const cumulative = useMemo(() => {
    const out: { year: number; value: number }[] = [];
    for (const y of yearly ?? []) out.push({ year: y.year, value: (out.at(-1)?.value ?? 0) + y.value * n });
    return out;
  }, [yearly, n]);
  const option = useMemo(
    () => ({
      ...base(),
      grid: { ...base().grid, top: 52 },
      xAxis: catAxis(cumulative.map((c) => c.year)),
      yAxis: valAxis("R$", (v: number) => new Intl.NumberFormat(f.tag, { notation: "compact", maximumFractionDigits: 1 }).format(v)),
      series: [
        { name: sm.cumulative, type: "bar", barMaxWidth: 14, itemStyle: { color: C.s2, borderRadius: [3, 3, 0, 0] }, data: cumulative.map((c) => +c.value.toFixed(0)) },
        { name: sm.invested, type: "line", symbol: "none", lineStyle: { color: C.s1, width: 2, type: "dashed" }, data: cumulative.map(() => n * price) },
      ],
      tooltip: { ...base().tooltip, valueFormatter: (v: number) => brl(v, 0) },
    }),
    [cumulative, n, price, brl, f.tag, sm.cumulative, sm.invested],
  );

  if (!p) return null;
  const total = n * p.cotaPriceBRL;
  const monthly = n * p.monthlyPerCotaBRL;
  const choose = (s: string) => {
    setSlug(s);
    const np = open.find((i) => i.slug === s);
    if (np) setN((x) => Math.min(x, np.totalCotas));
    router.replace(`/simulador?usina=${s}&cotas=${n}`, { scroll: false });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-6">
        <Card className="p-5">
          <div className="grid gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
            {/* ativo */}
            <div>
              <label htmlFor="sim-usina" className="text-[12px] font-medium text-muted">
                {sm.plant}
              </label>
              <select id="sim-usina" value={p.slug} onChange={(e) => choose(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-line-strong bg-surface-2 px-3 text-ink text-[14px] font-medium text-ink outline-none focus:border-brand">
                {open.map((i) => (
                  <option key={i.slug} value={i.slug}>
                    {i.name} — {i.municipio}/{i.uf}
                  </option>
                ))}
              </select>
              <div className="mt-3 flex items-center gap-3">
                <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-surface-3">{p.cover ? <Image src={p.cover} alt="" fill sizes="80px" className="object-cover" /> : <PhotoPlaceholder compact label={d.gal.soon} />}</div>
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold text-ink">{p.name}</div>
                  <div className="flex items-center gap-1 text-[12px] text-muted">
                    <MapPin className="size-3" /> {p.municipio} - {p.uf}
                  </div>
                  <StatusChip status={p.status} className="mt-1" />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4">
                <div>
                  <div className="text-[12px] text-muted">{sm.pricePerShare}</div>
                  <div className="text-[17px] font-bold text-ink tnum">{brl(p.cotaPriceBRL, 0)}</div>
                </div>
                <div>
                  <div className="text-[12px] text-muted">{sm.monthlyPerShare}</div>
                  <div className="text-[17px] font-bold text-ink tnum">{brl(p.monthlyPerCotaBRL)}</div>
                </div>
              </div>
            </div>
            {/* cálculo */}
            <div className="md:border-l md:border-line md:pl-6">
              <Stepper id="sim-cotas" label={sm.qty} value={n} onChange={setN} min={1} max={p.totalCotas} />
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[12px] text-muted">{sm.total}</div>
                  <div className="text-[22px] font-bold text-ink tnum">{brl(total, 0)}</div>
                </div>
                <div>
                  <div className="text-[12px] text-muted">{sm.monthlyEst}</div>
                  <div className="text-[22px] font-bold text-good tnum">{brl(monthly)}</div>
                </div>
                <div>
                  <div className="text-[12px] text-muted">{sm.annual}</div>
                  <div className="text-[17px] font-bold text-good tnum">{t(sm.pa, { v: pct(p.irrNominalPct) })}</div>
                </div>
                <div>
                  <div className="text-[12px] text-muted">{sm.selic}</div>
                  <div className="text-[17px] font-bold text-ink-2 tnum">{t(sm.pa, { v: pct(p.selicPct, 2) })}</div>
                </div>
              </div>
              <button
                className={cx(buttonClass.primary, "mt-5 w-full py-3")}
                onClick={() => {
                  setSimulated(true);
                  router.replace(`/simulador?usina=${p.slug}&cotas=${n}`, { scroll: false });
                  setTimeout(() => results.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                }}
              >
                {sm.run}
              </button>
            </div>
          </div>
        </Card>

        <section ref={results} aria-labelledby="cenarios" className="scroll-mt-24">
          <h2 id="cenarios" className="text-[15px] font-semibold text-ink">
            {sm.scenarios}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {p.scenarios.map((s) => (
              <div key={s.name} className={cx("rounded-xl border p-4", s.name === "base" ? "border-brand bg-brand-soft/60" : "border-line bg-white/[0.02]")}>
                <div className="text-[13px] font-semibold text-ink">{sm.sc[s.name]}</div>
                <div className="text-[11px] text-muted">{sm.hint[s.name]}</div>
                <div className="mt-2 text-[18px] font-bold text-ink tnum">{Number.isFinite(s.irrNominalPct) ? t(sm.pa, { v: pct(s.irrNominalPct) }) : "—"}</div>
                <div className={cx("text-[14px] font-semibold tnum", s.name === "base" ? "text-good" : "text-ink-2")}>{t(sm.perMonth, { v: brl(s.avgMonthlyPerCotaBRL * n) })}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">{sm.disclaimer}</p>

          {simulated && (
            <Card className="mt-5 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-semibold text-ink">{sm.chartTitle}</h3>
                <span className="text-[12px] text-muted">
                  {t(sm.chartMeta, { n: num(n), v: brl(cumulative.at(-1)?.value ?? 0, 0), y: p.horizonYears })}
                </span>
              </div>
              <EChart option={option} height={260} label={sm.chartAria} />
            </Card>
          )}
        </section>
      </div>

      <aside className="space-y-4">
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-ink">{d.inv.flow}</h2>
          <div className="mt-4">
            <FlowSteps current={simulated ? 1 : 0} compact />
          </div>
          <button className={cx(buttonClass.primary, "mt-5 w-full")} onClick={() => setInterest(true)}>
            {sm.interest}
          </button>
          <a href={`/usinas/${p.slug}/investir`} className={cx(buttonClass.secondary, "mt-2 w-full")}>
            {sm.withWallet}
          </a>
        </Card>
      </aside>
      <InterestDialog open={interest} onClose={() => setInterest(false)} usina={{ slug: p.slug, name: p.name }} cotas={n} />
    </div>
  );
}
