"use client";

import { useEffect, useRef, useState } from "react";
import { useChainId, useConnection, useDisconnect, useSwitchChain } from "wagmi";
import { Check, ChevronDown, Copy, ExternalLink, KeyRound, LogOut, Wallet } from "lucide-react";
import { chainName, explorerUrl, TARGET_CHAIN_ID } from "@/lib/web3/chains";
import { shortAddr } from "@/lib/fmt";
import { buttonClass, cx } from "@/components/ui";
import { WalletModal } from "./WalletModal";
import { useSiwe } from "./useSiwe";
import { useMounted } from "@/lib/useNow";

export function ConnectButton({ full = false }: { full?: boolean }) {
  const { address, isConnected, connector } = useConnection();
  const chainId = useChainId();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const siwe = useSiwe();
  const [modal, setModal] = useState(false);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const mounted = useMounted();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  if (!mounted || !isConnected || !address) {
    return (
      <>
        <button className={cx(buttonClass.primary, full && "w-full")} onClick={() => setModal(true)}>
          <Wallet className="size-4" /> Conectar carteira
        </button>
        <WalletModal open={modal} onClose={() => setModal(false)} />
      </>
    );
  }

  const wrongChain = chainId !== TARGET_CHAIN_ID;
  if (wrongChain) {
    return (
      <button className={cx(buttonClass.primary, "bg-warning", full && "w-full")} onClick={() => switchChain.mutate({ chainId: TARGET_CHAIN_ID })} disabled={switchChain.isPending}>
        Trocar para {chainName}
      </button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button className={cx(buttonClass.secondary, "pl-3", full && "w-full")} onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu">
        {/* eslint-disable-next-line @next/next/no-img-element -- ícone data: URI anunciado pela carteira (EIP-6963) */}
        {connector?.icon ? <img src={connector.icon} alt="" className="size-5 rounded" /> : <Wallet className="size-4" />}
        <span className="font-mono text-[13px]">{shortAddr(address)}</span>
        {siwe.isSignedIn && <KeyRound className="size-3.5 text-good" aria-label="sessão autenticada" />}
        <ChevronDown className="size-4 text-muted" />
      </button>
      {menu && (
        <div role="menu" className="absolute right-0 mt-2 w-72 rounded-xl border border-line-strong bg-surface p-2 shadow-2xl">
          <div className="px-2 py-2">
            <div className="text-[12px] text-muted">Conectado via {connector?.name ?? "carteira"} · {chainName}</div>
            <div className="mt-1 break-all font-mono text-[12px] text-ink-2">{address}</div>
          </div>
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[14px] text-ink-2 hover:bg-surface-2 hover:text-ink"
            onClick={() => {
              navigator.clipboard?.writeText(address);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="size-4 text-good" /> : <Copy className="size-4" />} {copied ? "Copiado" : "Copiar endereço"}
          </button>
          <a role="menuitem" href={explorerUrl("address", address)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg px-2 py-2 text-[14px] text-ink-2 hover:bg-surface-2 hover:text-ink">
            <ExternalLink className="size-4" /> Ver no BscScan
          </a>
          {!siwe.isSignedIn ? (
            <button role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[14px] text-ink-2 hover:bg-surface-2 hover:text-ink" onClick={() => siwe.signIn()}>
              <KeyRound className="size-4" /> {siwe.status === "signing" ? "Assine na carteira…" : "Entrar com assinatura (SIWE)"}
            </button>
          ) : (
            <div className="flex items-center gap-2 px-2 py-2 text-[13px] text-good">
              <KeyRound className="size-4" /> Sessão autenticada por assinatura
            </div>
          )}
          {siwe.error && <p className="px-2 pb-1 text-[12px] text-critical">{siwe.error}</p>}
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[14px] text-critical hover:bg-surface-2"
            onClick={async () => {
              await siwe.signOut();
              disconnect.mutate({});
              setMenu(false);
            }}
          >
            <LogOut className="size-4" /> Desconectar
          </button>
        </div>
      )}
    </div>
  );
}
