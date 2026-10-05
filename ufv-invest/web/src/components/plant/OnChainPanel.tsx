"use client";

import Link from "next/link";
import { formatUnits, hexToString, type Hex } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { ExternalLink, FileCheck2 } from "lucide-react";
import { offeringAbi, plantTokenAbi } from "@/lib/web3/abi";
import { chainName, explorerUrl, TARGET_CHAIN_ID } from "@/lib/web3/chains";
import { plantContracts } from "@/lib/web3/deployments";
import { dateBR, num, shortAddr, usdt } from "@/lib/fmt";

export function docName(name: Hex): string {
  try {
    return hexToString(name, { size: 32 }).replace(/\0+$/, "");
  } catch {
    return shortAddr(name, 6);
  }
}

export function OnChainPanel({ slug, dataHash }: { slug: string; dataHash: string }) {
  const c = plantContracts(slug);
  const enabled = Boolean(c?.token);
  const ZERO = "0x0000000000000000000000000000000000000000" as const;
  const tok = c?.token ?? ZERO;
  const off = c?.offering ?? ZERO;

  const base = useReadContracts({
    allowFailure: true,
    query: { enabled, refetchInterval: 60_000 },
    contracts: [
      { address: tok, abi: plantTokenAbi, functionName: "totalSupply", chainId: TARGET_CHAIN_ID },
      { address: tok, abi: plantTokenAbi, functionName: "maxSupply", chainId: TARGET_CHAIN_ID },
      { address: tok, abi: plantTokenAbi, functionName: "totalDistributed", chainId: TARGET_CHAIN_ID },
      { address: off, abi: offeringAbi, functionName: "totalRaised", chainId: TARGET_CHAIN_ID },
      { address: off, abi: offeringAbi, functionName: "investorCount", chainId: TARGET_CHAIN_ID },
    ],
  });
  const docs = useReadContract({ address: c?.token, abi: plantTokenAbi, functionName: "getAllDocuments", chainId: TARGET_CHAIN_ID, query: { enabled } });
  const names = (docs.data ?? []) as readonly Hex[];
  const docDetails = useReadContracts({
    allowFailure: true,
    query: { enabled: enabled && names.length > 0 },
    contracts: names.map((n) => ({ address: tok, abi: plantTokenAbi, functionName: "getDocument", args: [n], chainId: TARGET_CHAIN_ID }) as const),
  });

  if (!c) {
    return (
      <div className="space-y-2 text-[13px] text-ink-2">
        <p>Contratos ainda não implantados na {chainName}.</p>
        <p className="text-muted">
          Impressão digital desta análise (SHA-256): <span className="break-all font-mono text-[11px] text-ink-2">{dataHash}</span>
        </p>
      </div>
    );
  }

  const r = base.data;
  const val = (i: number) => (r?.[i]?.status === "success" ? (r[i].result as bigint) : undefined);
  const dec = c.paymentTokenDecimals;
  const rows: [string, string][] = [
    ["Cotas emitidas", val(0) !== undefined ? `${num(Number(val(0)))} de ${val(1) !== undefined ? num(Number(val(1))) : "—"}` : "—"],
    ["Receita distribuída", val(2) !== undefined ? usdt(Number(formatUnits(val(2)!, dec))) : "—"],
    ...(c.offering
      ? ([
          ["Em custódia na oferta", val(3) !== undefined ? usdt(Number(formatUnits(val(3)!, dec))) : "—"],
          ["Investidores", val(4) !== undefined ? num(Number(val(4))) : "—"],
        ] as [string, string][])
      : []),
  ];

  return (
    <div className="space-y-4 text-[13px]">
      <dl className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right tnum text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="space-y-1.5">
        {[
          ["Token", c.token],
          ["Oferta", c.offering],
          ["Registro KYC", c.identityRegistry],
        ].map(([k, a]) =>
          a ? (
            <a key={k} href={explorerUrl("address", a)} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 hover:border-line-strong">
              <span className="text-muted">{k}</span>
              <span className="inline-flex items-center gap-1 font-mono text-[12px] text-ink-2">
                {shortAddr(a, 6)} <ExternalLink className="size-3" />
              </span>
            </a>
          ) : null,
        )}
      </div>
      <div>
        <div className="font-medium text-ink-2">Documentos registrados no contrato</div>
        {names.length === 0 ? (
          <p className="mt-1 text-muted">Nenhum documento registrado ainda.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {names.map((n, i) => {
              const dd = docDetails.data?.[i];
              const doc = dd?.status === "success" ? (dd.result as readonly [string, Hex, bigint]) : undefined;
              return (
                <li key={n} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                  <div className="flex items-center gap-2 text-ink">
                    <FileCheck2 className="size-4 text-good" /> {docName(n)}
                  </div>
                  {doc && (
                    <div className="mt-1 text-[11px] text-muted">
                      <div className="break-all font-mono">sha256 {doc[1].slice(2)}</div>
                      <div>registrado em {dateBR(Number(doc[2]) * 1000, true)}</div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Link href="/verificar" className="mt-2 inline-block text-[13px] text-brand underline-offset-2 hover:underline">
          Verificar um relatório PDF →
        </Link>
      </div>
    </div>
  );
}
