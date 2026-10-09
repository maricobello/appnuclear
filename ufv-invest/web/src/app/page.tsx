import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Leaf, MapPin, Percent, Receipt, Sun, Users, Zap } from "lucide-react";
import { getAllAnalyses, summarize } from "@/lib/analysis";
import { brl, num, pct } from "@/lib/fmt";
import { buttonClass, Container, cx, IconBubble, StatusChip } from "@/components/ui";
import { PlantCard, mwp } from "@/components/aferi/PlantCard";
import { SoldGauge } from "@/components/aferi/Sold";
import { PhotoPlaceholder } from "@/components/aferi/PhotoPlaceholder";

const steps = [
  { n: 1, title: "Explore os ativos", text: "Compare usinas por local, potência e rentabilidade." },
  { n: 2, title: "Analise os dados", text: "Geração, riscos e relatório de auditoria abertos." },
  { n: 3, title: "Confira as condições", text: "Valor da cota, prazos e regras da oferta." },
  { n: 4, title: "Invista e acompanhe", text: "Receba a renda e acompanhe no seu portfólio." },
];

export default async function Home() {
  const all = (await getAllAnalyses()).map(summarize);
  const featured = all.find((s) => s.status === "operacao") ?? all[0];
  const highlights = all.filter((s) => s.status !== "encerrada").slice(0, 4);
  const totalMWp = all.reduce((s, x) => s + x.dcKWp, 0) / 1000;
  const totalCotas = all.reduce((s, x) => s + x.totalCotas, 0);
  const totalGWh = all.reduce((s, x) => s + x.p50MWh, 0) / 1000;

  return (
    <>
      {/* ─── Herói ─── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(60rem_30rem_at_85%_10%,rgba(34,181,115,0.14),transparent_60%),radial-gradient(50rem_26rem_at_0%_100%,rgba(42,120,214,0.08),transparent_60%)]" />
          <div className="dot-pattern absolute inset-0 opacity-60" />
        </div>
        <Container className="relative grid items-center gap-10 pb-24 pt-14 sm:pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:pb-32 lg:pt-24">
          <div className="max-w-xl">
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-good">Investimentos em energia solar</p>
            <h1 className="mt-4 text-[40px] font-bold leading-[1.05] tracking-tight text-navy sm:text-[56px]">
              Energia limpa,
              <br />
              <span className="text-[#16a34a]">rendimentos reais.</span>
            </h1>
            <p className="mt-5 max-w-md text-[17px] leading-relaxed text-ink-2">
              Invista em usinas solares de forma simples, segura e transparente. Acompanhe seus ativos e faça parte da transição energética.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/usinas" className={cx(buttonClass.primary, "px-5 py-3 text-[15px]")}>
                Explorar usinas <ArrowRight className="size-4" />
              </Link>
              <Link href="/como-funciona" className={cx(buttonClass.secondary, "px-5 py-3 text-[15px]")}>
                Como funciona
              </Link>
            </div>
          </div>

          {featured && (
            <Link
              href={`/usinas/${featured.slug}`}
              className="group mx-auto block w-full max-w-sm rounded-2xl bg-white p-3 shadow-[0_24px_60px_-20px_rgba(15,42,68,0.45)] ring-1 ring-black/5 transition hover:-translate-y-1 lg:ml-auto lg:mr-4"
            >
              <div className="relative aspect-[16/9] overflow-hidden rounded-xl bg-surface-3">
                {featured.cover ? <Image src={featured.cover} alt={`Foto da ${featured.name}`} fill sizes="380px" className="object-cover" priority /> : <PhotoPlaceholder />}
              </div>
              <div className="px-2 pb-2 pt-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[16px] font-semibold text-ink group-hover:text-brand">{featured.name}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-[12px] text-muted">
                      <MapPin className="size-3.5" /> {featured.municipio} - {featured.uf}
                    </div>
                  </div>
                  <StatusChip status={featured.status} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
                  <div className="flex items-start gap-2.5">
                    <IconBubble className="size-8">
                      <Zap className="size-4" />
                    </IconBubble>
                    <div className="flex flex-col-reverse">
                      <p className="text-[11px] text-muted">Potência instalada</p>
                      <p className="text-[15px] font-semibold text-ink tnum">{mwp(featured.dcKWp)}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <IconBubble className="size-8">
                      <Receipt className="size-4" />
                    </IconBubble>
                    <div className="flex flex-col-reverse">
                      <p className="text-[11px] text-muted">Valor da cota</p>
                      <p className="text-[15px] font-semibold text-ink tnum">{brl(featured.cotaPriceBRL, 0)}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <IconBubble className="size-8">
                      <Percent className="size-4" />
                    </IconBubble>
                    <div className="flex flex-col-reverse">
                      <p className="text-[11px] text-muted">Rentabilidade estimada</p>
                      <p className="text-[15px] font-semibold text-ink tnum">{pct(featured.irrNominalPct)} a.a.</p>
                    </div>
                  </div>
                  <SoldGauge slug={featured.slug} total={featured.totalCotas} demoSold={featured.demoSoldCotas} status={featured.status} size={48} />
                </div>
              </div>
            </Link>
          )}
        </Container>
      </section>

      {/* ─── Números ─── */}
      <Container className="relative z-10 -mt-14">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line shadow-[0_12px_40px_-16px_rgba(15,42,68,0.25)] ring-1 ring-line lg:grid-cols-4">
          {[
            { icon: <Sun className="size-5" />, value: num(all.length), label: "Usinas cadastradas" },
            { icon: <Zap className="size-5" />, value: `${num(totalMWp, 1)} MWp`, label: "Capacidade instalada" },
            { icon: <Users className="size-5" />, value: num(totalCotas), label: "Cotas disponibilizadas" },
            { icon: <Leaf className="size-5" />, value: `${num(totalGWh, 1)} GWh`, label: "Energia limpa por ano (P50)" },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-4 bg-white px-5 py-5 sm:px-6">
              <IconBubble>{s.icon}</IconBubble>
              <div className="flex min-w-0 flex-col-reverse">
                <p className="text-[12px] text-muted">{s.label}</p>
                <p className="text-[22px] font-bold text-ink tnum sm:text-[24px]">{s.value}</p>
              </div>
            </div>
          ))}
        </div>
      </Container>

      {/* ─── Oportunidades ─── */}
      <Container className="mt-16">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-[24px] font-bold tracking-tight text-navy">Oportunidades em destaque</h2>
          <Link href="/usinas" className="inline-flex shrink-0 items-center gap-1 text-[14px] font-semibold text-good hover:underline">
            Ver todas as usinas <ArrowRight className="size-4" />
          </Link>
        </div>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {highlights.map((s) => (
            <PlantCard key={s.slug} s={s} />
          ))}
        </div>
      </Container>

      {/* ─── Como funciona ─── */}
      <Container className="mt-16">
        <section className="relative overflow-hidden rounded-2xl text-white">
          <div className="absolute inset-0 bg-[linear-gradient(120deg,#0f2a44_0%,#123a5c_60%,#0f4a46_100%)]" />
          <div className="relative grid gap-8 p-8 sm:p-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <h2 className="text-[26px] font-bold tracking-tight">Como funciona?</h2>
              <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-white/80">
                Em poucos passos você pode investir em usinas solares e receber distribuições mensais.
              </p>
              <Link href="/como-funciona" className={cx(buttonClass.primary, "mt-6")}>
                Entenda o processo <ArrowRight className="size-4" />
              </Link>
            </div>
            <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {steps.map((s) => (
                <li key={s.n} className="rounded-xl bg-white/10 p-4 text-center ring-1 ring-white/15 backdrop-blur-sm">
                  <span className="mx-auto flex size-9 items-center justify-center rounded-full bg-leaf text-[14px] font-bold text-navy">{s.n}</span>
                  <div className="mt-3 text-[14px] font-semibold leading-snug">{s.title}</div>
                  <p className="mt-1 text-[12px] leading-snug text-white/70">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </Container>

      {/* ─── Chamada final ─── */}
      <Container className="mt-6">
        <section className="relative overflow-hidden rounded-2xl text-white">
          <div className="absolute inset-0 bg-[linear-gradient(110deg,#0b5a35_0%,#0e8441_55%,#22b573_100%)]" />
          <div className="relative flex flex-wrap items-center justify-between gap-6 p-8 sm:p-10">
            <div>
              <h2 className="text-[26px] font-bold tracking-tight">Faça parte da transição energética.</h2>
              <p className="mt-2 text-[15px] text-white/80">Investimentos em energia solar com propósito, tecnologia e transparência.</p>
            </div>
            <Link href="/usinas" className={cx(buttonClass.primary, "px-5 py-3")}>
              Explorar usinas <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>
      </Container>
    </>
  );
}
