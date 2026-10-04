"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "./Logo";
import { ConnectButton } from "./wallet/ConnectButton";
import { cx, Container } from "./ui";
import { TARGET_CHAIN_ID } from "@/lib/web3/chains";

const nav = [
  { href: "/usinas", label: "Usinas" },
  { href: "/carteira", label: "Minha carteira" },
  { href: "/seguranca", label: "Segurança" },
  { href: "/verificar", label: "Verificar relatório" },
];

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-page/85 backdrop-blur-md">
      {TARGET_CHAIN_ID === 97 && (
        <div className="border-b border-warning/20 bg-warning/10 py-1 text-center text-[12px] text-warning">
          Ambiente de demonstração na BNB Smart Chain <b>Testnet</b> — tokens sem valor real.
        </div>
      )}
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link href="/" aria-label="UFV Invest — início" className="shrink-0">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Principal">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx("rounded-lg px-3 py-2 text-[14px] font-medium transition", path?.startsWith(n.href) ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink")}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ConnectButton />
          <button className="rounded-lg p-2 text-ink-2 md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Abrir menu" aria-expanded={open}>
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </Container>
      {open && (
        <nav className="border-t border-line md:hidden" aria-label="Principal (móvel)">
          <Container className="flex flex-col py-2">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-[15px] text-ink-2 hover:bg-surface-2 hover:text-ink">
                {n.label}
              </Link>
            ))}
          </Container>
        </nav>
      )}
    </header>
  );
}
