"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useConnection, useSignMessage } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { TARGET_CHAIN_ID } from "@/lib/web3/chains";
import { useT } from "@/i18n/client";

/**
 * Sign-In with Ethereum (EIP-4361): a pessoa prova que controla a carteira assinando uma
 * mensagem legível (sem custo, sem transação). O servidor confere domínio, nonce de uso único,
 * rede e validade e emite um cookie HttpOnly. Usado para áreas autenticadas (KYC, carteira).
 */

type SiweState = {
  address: string | null;
  status: "idle" | "loading" | "signing" | "error";
  error: string | null;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
  isSignedIn: boolean;
};

const Ctx = createContext<SiweState | null>(null);

export function SiweProvider({ children }: { children: ReactNode }) {
  const { address } = useConnection();
  const sign = useSignMessage();
  const [sessionAddress, setSessionAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<SiweState["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const { d, locale } = useT();

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { address: string | null }) => setSessionAddress(d.address))
      .catch(() => setSessionAddress(null))
      .finally(() => setStatus("idle"));
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setSessionAddress(null);
  }, []);

  // trocou de conta na carteira → a sessão anterior não vale para a nova conta
  const isSignedIn = Boolean(address && sessionAddress && address.toLowerCase() === sessionAddress.toLowerCase());

  const signIn = useCallback(async () => {
    if (!address) return false;
    setError(null);
    setStatus("signing");
    try {
      const { nonce } = (await fetch("/api/auth/nonce", { cache: "no-store" }).then((r) => r.json())) as { nonce: string };
      const now = new Date();
      const message = createSiweMessage({
        domain: window.location.host,
        address,
        statement: d.wal.siweStatement,
        uri: window.location.origin,
        version: "1",
        chainId: TARGET_CHAIN_ID,
        nonce,
        issuedAt: now,
        expirationTime: new Date(now.getTime() + 10 * 60_000),
      });
      const signature = await sign.mutateAsync({ message });
      const res = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, signature }) });
      const data = (await res.json()) as { address?: string; error?: string };
      if (!res.ok || !data.address) throw new Error(locale === "pt" && data.error ? data.error : d.wal.sigFailed);
      setSessionAddress(data.address);
      setStatus("idle");
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/reject|denied|cancel/i.test(msg) ? d.wal.sigCancelled : msg);
      setStatus("error");
      return false;
    }
  }, [address, sign, d, locale]);

  const value = useMemo<SiweState>(() => ({ address: sessionAddress, status, error, signIn, signOut, isSignedIn }), [sessionAddress, status, error, signIn, signOut, isSignedIn]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSiwe(): SiweState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSiwe fora do SiweProvider");
  return v;
}
