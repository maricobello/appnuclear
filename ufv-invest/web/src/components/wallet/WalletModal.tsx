"use client";

import { useEffect, useRef, useState } from "react";
import { useConnect, useConnectors, type Connector } from "wagmi";
import { ExternalLink, ShieldCheck, Smartphone, Wallet, X } from "lucide-react";
import { TARGET_CHAIN_ID, walletNotes } from "@/lib/web3/chains";
import { Badge, buttonClass, cx } from "@/components/ui";

const installLinks = [
  { name: "Rabby", url: "https://rabby.io" },
  { name: "MetaMask", url: "https://metamask.io/download" },
  { name: "Binance Wallet", url: "https://www.binance.com/pt-BR/web3wallet" },
];

export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const connectors = useConnectors();
  const connect = useConnect();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const discovered = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const generic = connectors.find((c) => c.id === "injected");
  const wc = connectors.find((c) => c.type === "walletConnect");
  const hasWindowEthereum = typeof window !== "undefined" && "ethereum" in window;

  const ordered = [...discovered].sort((a, b) => Number(Boolean(walletNotes[b.id]?.recommended)) - Number(Boolean(walletNotes[a.id]?.recommended)));

  async function go(c: Connector) {
    setError(null);
    setPending(c.uid);
    try {
      await connect.mutateAsync({ connector: c, chainId: TARGET_CHAIN_ID });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/reject|denied|cancel/i.test(msg) ? "Conexão cancelada na carteira." : "Não foi possível conectar. Desbloqueie a carteira e tente de novo.");
    } finally {
      setPending(null);
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      className="m-auto w-[min(440px,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/70"
      aria-labelledby="wallet-modal-title"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 id="wallet-modal-title" className="text-[16px] font-semibold">
          Conectar carteira
        </h2>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Fechar">
          <X className="size-5" />
        </button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
        {ordered.length > 0 ? (
          <ul className="space-y-2">
            {ordered.map((c) => {
              const note = walletNotes[c.id];
              return (
                <li key={c.uid}>
                  <button
                    onClick={() => go(c)}
                    disabled={pending !== null}
                    className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-3 text-left transition hover:border-brand/50 hover:bg-surface-3 disabled:opacity-60"
                  >
                    {/* ícone fornecido pela própria carteira via EIP-6963 (data: URI) */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {c.icon ? <img src={c.icon} alt="" className="size-9 rounded-lg" /> : <Wallet className="size-9 p-1.5 text-muted" />}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 font-medium">
                        {c.name}
                        {note?.recommended && <Badge tone="good">recomendada</Badge>}
                      </span>
                      {note && <span className="mt-0.5 block text-[12px] text-muted">{note.note}</span>}
                    </span>
                    {pending === c.uid && <span className="text-[12px] text-brand">abrindo…</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-xl border border-line bg-surface-2 p-4 text-[14px] text-ink-2">
            <p>Nenhuma carteira de extensão foi detectada neste navegador.</p>
            {generic && hasWindowEthereum && (
              <button className={cx(buttonClass.secondary, "mt-3 w-full")} onClick={() => go(generic)} disabled={pending !== null}>
                <Wallet className="size-4" /> Usar a carteira do navegador
              </button>
            )}
            <p className="mt-3 text-[13px] text-muted">Instale uma carteira somente pelo site oficial:</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {installLinks.map((l) => (
                <li key={l.url}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[13px] text-ink-2 hover:text-ink">
                    {l.name} <ExternalLink className="size-3" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {wc && (
          <button onClick={() => go(wc)} disabled={pending !== null} className="mt-3 flex w-full items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-3 text-left transition hover:border-brand/50 disabled:opacity-60">
            <Smartphone className="size-9 rounded-lg bg-series-2/15 p-1.5 text-series-2" />
            <span>
              <span className="block font-medium">WalletConnect</span>
              <span className="block text-[12px] text-muted">Binance app, Trust Wallet e outras no celular, ou Ledger Live — via QR code</span>
            </span>
          </button>
        )}

        {error && <p className="mt-3 text-[13px] text-critical" role="alert">{error}</p>}

        <div className="mt-5 flex gap-3 rounded-xl border border-good/25 bg-good/5 p-3 text-[12px] text-ink-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-good" />
          <div>
            <b className="text-ink">Segurança:</b> a UFV Invest nunca pede sua frase de recuperação (seed) nem chave privada. Para valores altos, use
            uma carteira de hardware (Ledger/Trezor) conectada à Rabby ou MetaMask. Confira sempre o endereço do contrato antes de assinar.
          </div>
        </div>
      </div>
    </dialog>
  );
}
