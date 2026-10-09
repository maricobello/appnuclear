"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu, Search, X } from "lucide-react";
import { Logo } from "./Logo";
import { AccountButton } from "./wallet/AccountButton";
import { buttonClass, cx, Container } from "./ui";
import { TARGET_CHAIN_ID } from "@/lib/web3/chains";
import { useT } from "@/i18n/client";
import { LangSwitcher } from "./i18n/LangSwitcher";

const NAV = [
  ["/usinas", "usinas"],
  ["/simulador", "simulador"],
  ["/portfolio", "portfolio"],
  ["/como-funciona", "como"],
] as const;

function SearchBox({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { d } = useT();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <form
      role="search"
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const q = input.current?.value.trim() ?? "";
        router.push(q ? `/usinas?q=${encodeURIComponent(q)}` : "/usinas");
        onDone();
      }}
    >
      <label htmlFor="busca-global" className="sr-only">
        {d.nav.searchLabel}
      </label>
      <input
        id="busca-global"
        ref={input}
        type="search"
        placeholder={d.nav.searchPh}
        className="h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] outline-none focus:border-brand"
        onKeyDown={(e) => e.key === "Escape" && onDone()}
      />
      <button type="submit" className={cx(buttonClass.primary, "h-10")}>
        {d.nav.searchBtn}
      </button>
    </form>
  );
}

export function Header() {
  const path = usePathname();
  const { d } = useT();
  const nav = NAV.map(([href, k]) => ({ href, label: d.nav[k] }));
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path?.startsWith(href));

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-page/70 backdrop-blur-xl backdrop-saturate-150">
      <Container className="flex h-16 items-center justify-between gap-4">
        <div className="flex shrink-0 items-center gap-2.5">
          <Link href="/">
            <Logo />
          </Link>
          {TARGET_CHAIN_ID === 97 && (
            <span title={d.common.testnetTitle} className="hidden rounded-full bg-warning/10 px-2 py-0.5 text-[10px] sm:inline font-semibold uppercase tracking-wide text-warning">
              {d.common.testnet}
            </span>
          )}
        </div>
        <nav className="hidden items-center gap-1 lg:flex" aria-label={d.nav.main}>
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={cx("rounded-full px-3.5 py-1.5 text-[14px] font-medium transition", active(n.href) ? "bg-white/[0.08] text-ink ring-1 ring-inset ring-white/10" : "text-muted hover:text-ink")}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1 sm:gap-2">
          <button className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-ink" onClick={() => setSearch((s) => !s)} aria-label={d.nav.search} aria-expanded={search}>
            {search ? <X className="size-5" /> : <Search className="size-5" />}
          </button>
          <LangSwitcher />
          <AccountButton />
          <button className="rounded-lg p-2 text-ink-2 lg:hidden" onClick={() => setOpen((o) => !o)} aria-label={d.nav.openMenu} aria-expanded={open}>
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </Container>
      {search && (
        <div className="border-t border-line bg-page/95">
          <Container className="py-3">
            <SearchBox onDone={() => setSearch(false)} />
          </Container>
        </div>
      )}
      {open && (
        <nav className="border-t border-line bg-page/95 lg:hidden" aria-label={d.nav.mainMobile}>
          <Container className="flex flex-col py-2">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className={cx("rounded-lg px-3 py-2.5 text-[15px] hover:bg-surface-2", active(n.href) ? "font-semibold text-ink" : "text-ink-2")}>
                {n.label}
              </Link>
            ))}
            <Link href="/sobre" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-[15px] text-ink-2 hover:bg-surface-2">
              {d.nav.sobre}
            </Link>
          </Container>
        </nav>
      )}
    </header>
  );
}
