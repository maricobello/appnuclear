import Link from "next/link";
import { Logo } from "./Logo";
import { Container } from "./ui";
import { getT } from "@/i18n/server";

export async function Footer() {
  const { d } = await getT();
  const cols = [
    {
      title: d.footer.platform,
      links: [
        ["/usinas", d.nav.usinas],
        ["/simulador", d.nav.simulador],
        ["/como-funciona", d.nav.como],
        ["/portfolio", d.footer.myPortfolio],
      ],
    },
    {
      title: d.footer.company,
      links: [
        ["/sobre", d.nav.sobre],
        ["/seguranca", d.footer.security],
        ["/verificar", d.footer.verify],
        ["/portfolio/suporte", d.footer.support],
      ],
    },
  ];
  return (
    <footer className="mt-24 border-t border-line text-ink-2">
      <Container className="grid gap-10 py-12 md:grid-cols-[2fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-muted">
            {d.footer.tagline}
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.title} className="text-[14px]">
            <div className="font-semibold text-ink">{c.title}</div>
            <ul className="mt-2 space-y-0.5">
              {c.links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="inline-block py-1.5 hover:text-ink">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Container>
      <div className="border-t border-line">
        <Container className="flex flex-wrap items-center justify-between gap-3 py-5 text-[12px] text-muted">
          <p>
            {d.footer.disclaimer}{" "}
            <Link href="/seguranca" className="underline underline-offset-2 hover:text-ink">
              {d.footer.risks}
            </Link>
          </p>
          <p>© {new Date().getFullYear()} Aferi Capital</p>
        </Container>
      </div>
    </footer>
  );
}
