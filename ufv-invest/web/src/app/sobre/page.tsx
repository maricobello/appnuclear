import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Eye, Leaf, Lightbulb, ShieldCheck } from "lucide-react";
import { buttonClass, Container, cx, IconBubble } from "@/components/ui";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getT();
  return { title: d.about.meta, description: d.about.metaDesc };
}

export default async function Sobre() {
  const { d } = await getT();
  const a = d.about;
  const values = [
    { icon: Eye, title: a.v1, text: a.v1d },
    { icon: ShieldCheck, title: a.v2, text: a.v2d },
    { icon: Leaf, title: a.v3, text: a.v3d },
    { icon: Lightbulb, title: a.v4, text: a.v4d },
  ];
  return (
    <Container className="pt-8">
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_440px]">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight text-ink">{a.h1}</h1>
          <p className="mt-1 text-[15px] font-medium text-good">{a.tag}</p>
          <div className="mt-5 max-w-2xl space-y-4 text-[15px] leading-relaxed text-ink-2">
            <p>{a.p1}</p>
            <p>{a.p2}</p>
            <p>{a.p3}</p>
          </div>
        </div>
        <div className="rounded-2xl glass bg-[linear-gradient(135deg,rgba(61,220,132,0.10)_0%,rgba(96,165,250,0.06)_100%)] p-8 text-ink">
          <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-leaf">Aferi Capital</div>
          <p className="mt-3 text-[22px] font-bold leading-snug">{a.boxTitle}</p>
          <p className="mt-4 text-[14px] text-ink-2">{a.boxText}</p>
        </div>
      </div>

      <section className="mt-14" aria-labelledby="valores">
        <h2 id="valores" className="text-[22px] font-bold text-ink">
          {a.values}
        </h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {values.map((v) => (
            <li key={v.title} className="glass rounded-2xl p-5">
              <IconBubble>
                <v.icon className="size-5" />
              </IconBubble>
              <h3 className="mt-3 text-[15px] font-semibold text-ink">{v.title}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{v.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12 rounded-2xl bg-[radial-gradient(ellipse_at_top,rgba(61,220,132,0.25),transparent_70%)] border border-brand/25 p-8 text-center text-ink sm:p-10">
        <h2 className="text-[22px] font-bold">{a.cta}</h2>
        <Link href="/usinas" className={cx(buttonClass.secondary, "mt-5")}>
          {a.ctaBtn} <ArrowRight className="size-4" />
        </Link>
      </section>
    </Container>
  );
}
