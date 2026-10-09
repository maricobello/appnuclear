import Link from "next/link";
import { ArrowRight, Banknote, Search, Sun } from "lucide-react";
import { getAllAnalyses, summarize } from "@/lib/analysis";
import { pct } from "@/lib/fmt";
import { buttonClass, Container, cx } from "@/components/ui";
import { PlantCard } from "@/components/aferi/PlantCard";

const steps = [
  { icon: Search, title: "Escolha", text: "uma usina solar" },
  { icon: Banknote, title: "Invista", text: "a partir de R$ 1.000" },
  { icon: Sun, title: "Receba", text: "a renda todo mês" },
];

export default async function Home() {
  const all = (await getAllAnalyses()).map(summarize);
  const open = all.filter((s) => s.status !== "encerrada");
  const top = [...open].sort((a, b) => b.irrNominalPct - a.irrNominalPct).slice(0, 3);
  const avgIrr = open.reduce((s, x) => s + x.irrNominalPct, 0) / Math.max(1, open.length);
  const selic = all[0]?.selicPct ?? 15;
  const bars = [
    { label: "Usinas Aferi", value: avgIrr, tone: "bg-leaf" },
    { label: "Selic", value: selic, tone: "bg-series-1" },
    { label: "Poupança", value: 6.17, tone: "bg-axis" },
  ];
  const max = Math.max(...bars.map((b) => b.value));

  return (
    <>
      {/* Herói */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(50rem_26rem_at_50%_-10%,rgba(34,181,115,0.16),transparent_70%)]" aria-hidden />
        <Container className="relative pb-16 pt-16 text-center sm:pb-20 sm:pt-24">
          <p className="mx-auto inline-flex rounded-full bg-brand-soft px-3 py-1 text-[13px] font-semibold text-good">Energia solar · a partir de R$ 1.000</p>
          <h1 className="mx-auto mt-6 max-w-3xl text-[44px] font-bold leading-[1.05] tracking-tight text-navy sm:text-[68px]">
            Sua renda vinda <span className="text-[#16a34a]">do sol.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-md text-[18px] text-ink-2">Compre cotas de usinas solares e receba todo mês.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/usinas" className={cx(buttonClass.primary, "px-6 py-3.5 text-[16px]")}>
              Ver usinas <ArrowRight className="size-4" />
            </Link>
            <Link href="/simulador" className={cx(buttonClass.secondary, "px-6 py-3.5 text-[16px]")}>
              Simular
            </Link>
          </div>
        </Container>
      </section>

      {/* Usinas */}
      <Container>
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-[26px] font-bold tracking-tight text-navy">Usinas em destaque</h2>
          <Link href="/usinas" className="inline-flex items-center gap-1 text-[14px] font-semibold text-good hover:underline">
            Ver todas <ArrowRight className="size-4" />
          </Link>
        </div>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {top.map((s, i) => (
            <PlantCard key={s.slug} s={s} priority={i === 0} />
          ))}
        </div>
      </Container>

      {/* Comparação */}
      <Container className="mt-20">
        <section className="grid items-center gap-10 rounded-3xl bg-surface-2 p-8 sm:p-12 lg:grid-cols-2">
          <div>
            <h2 className="text-[30px] font-bold leading-tight tracking-tight text-navy">Rende mais que a Selic.</h2>
            <p className="mt-3 text-[16px] text-ink-2">Média estimada das usinas abertas, ao ano. É projeção, não garantia.</p>
          </div>
          <ul className="space-y-4" aria-label="Rentabilidade ao ano">
            {bars.map((b) => (
              <li key={b.label}>
                <div className="flex justify-between text-[14px]">
                  <span className="font-medium text-ink">{b.label}</span>
                  <span className="font-bold text-ink tnum">{pct(b.value)}</span>
                </div>
                <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-white">
                  <div className={cx("h-full rounded-full", b.tone)} style={{ width: `${(b.value / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </Container>

      {/* Como funciona */}
      <Container className="mt-20">
        <h2 className="text-center text-[26px] font-bold tracking-tight text-navy">Simples assim</h2>
        <ol className="mx-auto mt-8 grid max-w-3xl gap-4 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="rounded-2xl border border-line bg-white p-6 text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-soft text-good">
                <s.icon className="size-6" aria-hidden />
              </span>
              <div className="mt-4 text-[13px] font-semibold text-muted">Passo {i + 1}</div>
              <div className="text-[19px] font-bold text-ink">{s.title}</div>
              <div className="text-[14px] text-ink-2">{s.text}</div>
            </li>
          ))}
        </ol>
      </Container>

      {/* Chamada final */}
      <Container className="mt-20">
        <section className="rounded-3xl bg-navy px-8 py-12 text-center text-white sm:py-16">
          <h2 className="text-[30px] font-bold tracking-tight">Comece com R$ 1.000.</h2>
          <Link href="/usinas" className={cx(buttonClass.primary, "mt-6 px-6 py-3.5 text-[16px]")}>
            Ver usinas <ArrowRight className="size-4" />
          </Link>
        </section>
      </Container>
    </>
  );
}
