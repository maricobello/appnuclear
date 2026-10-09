"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useChainId, useConnection, useDisconnect, useSwitchChain } from "wagmi";
import { AlertTriangle, ArrowLeftRight, ChevronDown, FileText, KeyRound, LayoutDashboard, LogOut, User, Wallet } from "lucide-react";
import { chainName, TARGET_CHAIN_ID } from "@/lib/web3/chains";
import { useMounted } from "@/lib/useNow";
import { cx } from "@/components/ui";
import { WalletModal } from "./WalletModal";
import { useSiwe } from "./useSiwe";
import { useProfile } from "./useProfile";

/**
 * "Entrar": conecta a carteira (EIP-6963) e, em seguida, pede a assinatura SIWE — sem senha e
 * sem custo. Conectado, vira o menu do investidor (portfólio, transações, perfil, sair).
 */
export function AccountButton() {
  const mounted = useMounted();
  const { isConnected } = useConnection();
  const chainId = useChainId();
  const switchChain = useSwitchChain();
  const disconnect = useDisconnect();
  const siwe = useSiwe();
  const profile = useProfile();
  const [modal, setModal] = useState(false);
  const wantsLogin = useRef(false);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // depois de conectar pelo "Entrar", pede a assinatura uma única vez
  useEffect(() => {
    if (wantsLogin.current && isConnected && !siwe.isSignedIn && siwe.status === "idle") {
      wantsLogin.current = false;
      void siwe.signIn();
    }
  }, [isConnected, siwe]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  if (!mounted || !isConnected) {
    return (
      <>
        <button
          className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[14px] font-semibold text-[#06090e] shadow-[0_0_24px_-6px_rgba(245,181,68,0.55)] transition hover:bg-white/85"
          onClick={() => {
            wantsLogin.current = true;
            setModal(true);
          }}
        >
          <Wallet className="size-4" /> <span className="hidden sm:inline">Conectar carteira</span>
          <span className="sm:hidden">Conectar</span>
        </button>
        <WalletModal open={modal} onClose={() => setModal(false)} />
      </>
    );
  }

  const wrongChain = chainId !== TARGET_CHAIN_ID;
  const item = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] text-ink-2 hover:bg-surface-2 hover:text-ink";

  return (
    <div className="relative" ref={ref}>
      <button className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition hover:bg-surface-2" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu">
        <span className="flex size-8 items-center justify-center rounded-full bg-brand/15 text-[12px] font-semibold text-brand ring-1 ring-brand/30">{profile.initials || "?"}</span>
        <span className="hidden max-w-[150px] truncate text-[13px] font-medium text-ink sm:block">{profile.label}</span>
        {wrongChain ? <AlertTriangle className="size-4 text-warning" aria-label="rede errada" /> : <ChevronDown className="size-4 text-muted" />}
      </button>
      {menu && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-line bg-surface p-2 shadow-2xl">
          <div className="border-b border-line px-2.5 pb-2.5 pt-1.5">
            <div className="text-[14px] font-semibold text-ink">{profile.name ?? "Investidor"}</div>
            <div className="break-all font-mono text-[11px] text-muted">{profile.address}</div>
            <div className={cx("mt-1.5 inline-flex items-center gap-1 text-[12px]", siwe.isSignedIn ? "text-good" : "text-warning")}>
              <KeyRound className="size-3.5" /> {siwe.isSignedIn ? "Acesso confirmado por assinatura" : "Acesso não confirmado"}
            </div>
          </div>
          <div className="pt-1.5">
            {wrongChain && (
              <button role="menuitem" className={cx(item, "text-warning")} onClick={() => switchChain.mutate({ chainId: TARGET_CHAIN_ID })}>
                <AlertTriangle className="size-4" /> Trocar para {chainName}
              </button>
            )}
            {!siwe.isSignedIn && (
              <button role="menuitem" className={item} onClick={() => siwe.signIn()}>
                <KeyRound className="size-4" /> {siwe.status === "signing" ? "Assine na carteira…" : "Confirmar acesso (assinatura)"}
              </button>
            )}
            <Link role="menuitem" href="/portfolio" className={item} onClick={() => setMenu(false)}>
              <LayoutDashboard className="size-4" /> Meu portfólio
            </Link>
            <Link role="menuitem" href="/portfolio/transacoes" className={item} onClick={() => setMenu(false)}>
              <ArrowLeftRight className="size-4" /> Transações
            </Link>
            <Link role="menuitem" href="/portfolio/documentos" className={item} onClick={() => setMenu(false)}>
              <FileText className="size-4" /> Documentos
            </Link>
            <Link role="menuitem" href="/portfolio/perfil" className={item} onClick={() => setMenu(false)}>
              <User className="size-4" /> Perfil
            </Link>
            <button
              role="menuitem"
              className={cx(item, "text-critical hover:text-critical")}
              onClick={async () => {
                await siwe.signOut();
                disconnect.mutate({});
                setMenu(false);
              }}
            >
              <LogOut className="size-4" /> Sair
            </button>
          </div>
          {siwe.error && <p className="px-2.5 pb-1 text-[12px] text-critical">{siwe.error}</p>}
        </div>
      )}
    </div>
  );
}
