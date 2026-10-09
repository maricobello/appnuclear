"use client";

import { useEffect, useState } from "react";
import { useConnection } from "wagmi";
import { shortAddr } from "@/lib/fmt";
import { useSiwe } from "./useSiwe";

export type Profile = { name: string | null; kyc: "nenhum" | "pendente" | string; initials: string; label: string };

/** Nome do investidor (do pedido de KYC, quando houver) para o cabeçalho e o portfólio */
export function useProfile(): Profile & { address?: string; signedIn: boolean } {
  const { address } = useConnection();
  const siwe = useSiwe();
  const [data, setData] = useState<{ name: string | null; kyc: string }>({ name: null, kyc: "nenhum" });

  useEffect(() => {
    if (!siwe.isSignedIn) return;
    let alive = true;
    fetch("/api/kyc", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { status?: string; nome?: string } | null) => alive && d && setData({ name: d.nome ?? null, kyc: d.status ?? "nenhum" }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [siwe.isSignedIn, address]);

  const name = siwe.isSignedIn ? data.name : null;
  const initials = name
    ? name
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w[0])
        .filter((_, i, a) => i === 0 || i === a.length - 1)
        .join("")
        .toUpperCase()
    : (address?.slice(2, 4) ?? "").toUpperCase();
  return { name, kyc: siwe.isSignedIn ? data.kyc : "nenhum", initials, label: name ?? (address ? shortAddr(address) : ""), address, signedIn: siwe.isSignedIn };
}
