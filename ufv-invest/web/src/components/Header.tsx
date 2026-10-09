"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Menu, Search, X } from "lucide-react";
import { Logo } from "./Logo";
import { AccountButton } from "./wallet/AccountButton";
import { buttonClass, cx, Container } from "./ui";
import { TARGET_CHAIN_ID } from "@/lib/web3/chains";

const nav = [
  { href: "/", label: "Início" },
  { href: "/usinas", label: "Usinas" },
  { href: "/como-funciona", label: "Como funciona" },
  { href: "/sobre", label: "Sobre nós" },
];

function SearchBox({ onDone }: { onDone: () => void }) {
  const router = useRouter();
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
        Buscar usina por nome ou cidade
      </label>
      <input
        id="busca-global"
        ref={input}
        type="search"
        placeholder="Buscar usina ou cidade…"
        className="h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] outline-none focus:border-brand"
        onKeyDown={(e) => e.key === "Escape" && onDone()}
      />
      <button type="submit" className={cx(buttonClass.primary, "h-10")}>
        Buscar
      </button>
    </form>
  );
}

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path?.startsWith(href));

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur-md">
      {TARGET_CHAIN_ID === 97 && (
        <div className="bg-surface-2 py-1 text-center text-[11px] text-muted">
          Demonstração na BNB Smart Chain <b className="font-semibold text-ink-2">Testnet</b> · projetos ilustrativos, tokens sem valor real
        </div>
      )}
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link href="/" aria-label="Aferi Capital — início" className="shrink-0">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Principal">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={cx("relative rounded-lg px-3 py-2 text-[14px] font-medium transition", active(n.href) ? "text-ink after:absolute after:inset-x-3 after:-bottom-[13px] after:h-0.5 after:rounded-full after:bg-leaf" : "text-ink-2 hover:text-ink")}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1 sm:gap-2">
          <button className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-ink" onClick={() => setSearch((s) => !s)} aria-label="Buscar usinas" aria-expanded={search}>
            {search ? <X className="size-5" /> : <Search className="size-5" />}
          </button>
          <AccountButton />
          <Link href="/usinas" className={cx(buttonClass.primary.replace("inline-flex", "hidden sm:inline-flex"), "px-4")}>
            Explorar usinas <ArrowRight className="size-4" />
          </Link>
          <button className="rounded-lg p-2 text-ink-2 lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="Abrir menu" aria-expanded={open}>
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </Container>
      {search && (
        <div className="border-t border-line bg-white">
          <Container className="py-3">
            <SearchBox onDone={() => setSearch(false)} />
          </Container>
        </div>
      )}
      {open && (
        <nav className="border-t border-line bg-white lg:hidden" aria-label="Principal (móvel)">
          <Container className="flex flex-col py-2">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className={cx("rounded-lg px-3 py-2.5 text-[15px] hover:bg-surface-2", active(n.href) ? "font-semibold text-ink" : "text-ink-2")}>
                {n.label}
              </Link>
            ))}
            <Link href="/portfolio" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-[15px] text-ink-2 hover:bg-surface-2">
              Meu portfólio
            </Link>
            <Link href="/usinas" onClick={() => setOpen(false)} className={cx(buttonClass.primary.replace("inline-flex", "flex sm:hidden"), "mt-2")}>
              Explorar usinas <ArrowRight className="size-4" />
            </Link>
          </Container>
        </nav>
      )}
    </header>
  );
}
