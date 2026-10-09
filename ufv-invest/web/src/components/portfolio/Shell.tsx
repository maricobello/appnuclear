"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useConnection, useDisconnect } from "wagmi";
import { ArrowLeftRight, FileText, Headset, LayoutDashboard, LogOut, PlayCircle, User, Wallet } from "lucide-react";
import { useSiwe } from "@/components/wallet/useSiwe";
import { useProfile } from "@/components/wallet/useProfile";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { LogoMark } from "@/components/Logo";
import { buttonClass, cx } from "@/components/ui";
import { useMounted } from "@/lib/useNow";
import { setDemo, useDemo } from "./data";

const items = [
  { href: "/portfolio", label: "Meu portfólio", icon: LayoutDashboard },
  { href: "/portfolio/transacoes", label: "Transações", icon: ArrowLeftRight },
  { href: "/portfolio/documentos", label: "Documentos", icon: FileText },
  { href: "/portfolio/perfil", label: "Perfil", icon: User },
  { href: "/portfolio/suporte", label: "Suporte", icon: Headset },
];

/** Pede a carteira para ver dados reais; a demonstração não exige conexão */
export function RequireWallet({ children, allowDemo = true }: { children: ReactNode; allowDemo?: boolean }) {
  const mounted = useMounted();
  const { isConnected } = useConnection();
  const demo = useDemo();
  if (!mounted) return <div className="h-64 animate-pulse rounded-xl bg-surface-2" />;
  if (isConnected || (allowDemo && demo)) return <>{children}</>;
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-line bg-white p-8 text-center">
      <Wallet className="mx-auto size-10 text-good" />
      <h1 className="mt-4 text-[20px] font-semibold text-ink">Entre com a sua carteira</h1>
      <p className="mt-2 text-[14px] text-ink-2">Suas cotas, distribuições e documentos ficam registrados na BNB Chain e aparecem aqui quando você conecta a carteira.</p>
      <div className="mt-6 flex flex-col items-center gap-3">
        <ConnectButton />
        {allowDemo && (
          <button className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-good hover:underline" onClick={() => setDemo(true)}>
            <PlayCircle className="size-4" /> Ver um portfólio de demonstração
          </button>
        )}
      </div>
    </div>
  );
}

export function PortfolioShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const demo = useDemo();
  const mounted = useMounted();
  const siwe = useSiwe();
  const disconnect = useDisconnect();
  const profile = useProfile();
  const { isConnected } = useConnection();

  const exit = async () => {
    setDemo(false);
    await siwe.signOut();
    disconnect.mutate({});
    router.push("/");
  };

  const name = mounted && demo && !isConnected ? "Investidor (demonstração)" : profile.name ?? (mounted && isConnected ? profile.label : "Investidor");

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 pt-6 sm:px-6 lg:grid-cols-[230px_minmax(0,1fr)] lg:px-8">
      <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <nav aria-label="Área do investidor" className="flex gap-1 overflow-x-auto rounded-2xl bg-navy p-2 text-white lg:min-h-[520px] lg:flex-col lg:p-3">
          <div className="hidden items-center gap-2 px-2 pb-4 pt-1 lg:flex">
            <LogoMark className="size-7" inverted />
            <span className="text-[13px] font-semibold text-white/80">Área do investidor</span>
          </div>
          {items.map((it) => {
            const active = it.href === "/portfolio" ? path === "/portfolio" : path?.startsWith(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={cx("flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-[14px] transition", active ? "bg-white/12 font-semibold text-white ring-1 ring-white/15" : "text-white/75 hover:bg-white/8 hover:text-white")}
              >
                <it.icon className={cx("size-4", active && "text-leaf")} /> {it.label}
              </Link>
            );
          })}
          <button onClick={exit} className="flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-[14px] text-white/75 hover:bg-white/8 hover:text-white lg:mt-auto">
            <LogOut className="size-4" /> Sair
          </button>
        </nav>
      </aside>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div />
          {mounted && (isConnected || demo) && (
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-full bg-navy text-[12px] font-semibold text-white">{demo && !isConnected ? "DM" : profile.initials || "?"}</span>
              <span className="text-[14px] font-medium text-ink">{name}</span>
            </div>
          )}
        </div>
        {mounted && demo && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-2.5 text-[13px] text-ink-2" role="status">
            <span>
              <b className="text-warning">Demonstração:</b> dados fictícios para conhecer o portfólio. Nada aqui é uma posição real.
            </span>
            <button className={cx(buttonClass.ghost, "py-1 text-[13px]")} onClick={() => setDemo(false)}>
              Sair da demonstração
            </button>
          </div>
        )}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
