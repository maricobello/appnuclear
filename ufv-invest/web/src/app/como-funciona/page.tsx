import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { buttonClass, Container, cx } from "@/components/ui";
import { ContactButton } from "@/components/aferi/ContactButton";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getT();
  return { title: d.como.meta, description: d.como.metaDesc };
}

export default async function ComoFunciona() {
  const { d } = await getT();
  const c = d.como;
  const steps = [
    { title: c.s1, text: c.s1d, href: "/usinas", cta: c.s1c },
    { title: c.s2, text: c.s2d, href: "/simulador", cta: c.s2c },
    { title: c.s3, text: c.s3d, href: "/usinas", cta: c.s3c },
    { title: c.s4, text: c.s4d, href: "/portfolio", cta: c.s4c },
  ];
  const faq = [
    [c.q1, c.a1],
    [c.q2, c.a2],
    [c.q3, c.a3],
    [c.q4, c.a4],
    [c.q5, c.a5],
  ];
  return (
    <Container className="pt-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight text-ink">{c.h1}</h1>
          <p className="mt-1 text-[15px] text-muted">{c.sub}</p>
          <ol className="mt-8 space-y-0">
            {steps.map((s, i) => (
              <li key={s.title} className="relative flex gap-5 pb-8 last:pb-0">
                {i < steps.length - 1 && <span className="absolute left-[19px] top-11 h-[calc(100%-36px)] w-px bg-line-strong" aria-hidden />}
                <span className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-leaf text-[16px] font-bold text-brand-ink shadow-[0_0_0_6px_var(--brand-soft)]">{i + 1}</span>
                <div className="pt-1.5">
                  <h2 className="text-[16px] font-semibold text-ink">
                    {s.title}
                  </h2>
                  <p className="mt-1 max-w-xl text-[14px] leading-relaxed text-ink-2">{s.text}</p>
                  <Link href={s.href} className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-good hover:underline">
                    {s.cta} <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <aside className="space-y-4 lg:pt-16">
          <div className="rounded-2xl bg-brand-soft p-6">
            <h2 className="text-[17px] font-semibold text-ink">{d.sup.questions}</h2>
            <p className="mt-1 text-[14px] text-ink-2">{d.sup.team}</p>
            <ContactButton className={cx(buttonClass.outline, "mt-4")} />
          </div>
        </aside>
      </div>

      <section className="mt-16" aria-labelledby="faq">
        <h2 id="faq" className="text-[22px] font-bold text-ink">
          {c.faq}
        </h2>
        <div className="mt-4 divide-y divide-line glass rounded-2xl">
          {faq.map(([q, a]) => (
            <details key={q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-medium text-ink">
                {q} <ChevronDown className="size-4 shrink-0 text-muted transition group-open:rotate-180" />
              </summary>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{a}</p>
            </details>
          ))}
        </div>
        <p className="mt-3 text-[13px] text-muted">
          {c.more}{" "}
          <Link href="/seguranca" className="font-semibold text-good hover:underline">
            {c.moreLink}
          </Link>
          .
        </p>
      </section>
    </Container>
  );
}
