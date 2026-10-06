"use client";

import { useReadContracts } from "wagmi";
import { offeringAbi } from "@/lib/web3/abi";
import { TARGET_CHAIN_ID } from "@/lib/web3/chains";
import { plantContracts } from "@/lib/web3/deployments";
import { useNowSec } from "@/lib/useNow";
import { dateBR, num } from "@/lib/fmt";
import { cx } from "@/components/ui";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

/**
 * Barra de captação do card da vitrine: lê a oferta on-chain quando implantada; senão mostra
 * a janela prevista no catálogo. Usinas em construção/operação aparecem como captação concluída.
 */
export function OfferProgress({
  slug,
  status,
  totalCotas,
  softCapCotas,
  offeringStart,
  offeringEnd,
}: {
  slug: string;
  status: "captacao" | "construcao" | "operacao";
  totalCotas: number;
  softCapCotas: number;
  offeringStart: string | null;
  offeringEnd: string | null;
}) {
  const c = plantContracts(slug);
  const off = c?.offering ?? ZERO;
  const live = status === "captacao" && Boolean(c?.offering);
  const now = useNowSec();
  const reads = useReadContracts({
    allowFailure: true,
    query: { enabled: live, refetchInterval: 30_000 },
    contracts: [
      { address: off, abi: offeringAbi, functionName: "cotasSold", chainId: TARGET_CHAIN_ID },
      { address: off, abi: offeringAbi, functionName: "hardCapCotas", chainId: TARGET_CHAIN_ID },
      { address: off, abi: offeringAbi, functionName: "endTime", chainId: TARGET_CHAIN_ID },
      { address: off, abi: offeringAbi, functionName: "investorCount", chainId: TARGET_CHAIN_ID },
    ],
  });

  if (status !== "captacao") {
    return (
      <div>
        <div className="flex justify-between text-[12px]">
          <span className="font-medium text-good">Captação concluída</span>
          <span className="tnum text-muted">100%</span>
        </div>
        <div className="mt-1.5 h-1.5 rounded-full bg-good" />
      </div>
    );
  }

  const r = reads.data;
  const val = (i: number) => (r?.[i]?.status === "success" ? (r[i].result as bigint) : undefined);
  const sold = live ? Number(val(0) ?? 0n) : 0;
  const cap = live ? Number(val(1) ?? BigInt(totalCotas)) : totalCotas;
  const endSec = live && val(2) ? Number(val(2)) : offeringEnd ? Math.floor(new Date(offeringEnd).getTime() / 1000) : 0;
  const startSec = offeringStart ? Math.floor(new Date(offeringStart).getTime() / 1000) : 0;
  const investors = live ? val(3) : undefined;
  const pctSold = cap > 0 ? (sold / cap) * 100 : 0;
  const softPct = cap > 0 ? (softCapCotas / cap) * 100 : 0;
  const daysLeft = now > 0 && endSec > now ? Math.ceil((endSec - now) / 86400) : 0;
  const notOpen = now > 0 && startSec > now;

  return (
    <div>
      <div className="flex justify-between text-[12px]">
        <span className="text-ink-2">
          {live ? (
            <>
              <b className="tnum text-ink">{num(pctSold, 1)}%</b> captado{investors !== undefined ? ` · ${num(Number(investors))} investidores` : ""}
            </>
          ) : notOpen ? (
            <>Abre em {dateBR(startSec * 1000)}</>
          ) : (
            <>Captação aberta</>
          )}
        </span>
        <span className="tnum text-muted">{daysLeft > 0 ? `${daysLeft} dias restantes` : endSec ? `até ${dateBR(endSec * 1000)}` : ""}</span>
      </div>
      <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={pctSold} aria-valuemin={0} aria-valuemax={100} aria-label="Captação">
        <div className={cx("h-full rounded-full bg-gradient-to-r from-[#f5a524] to-[#e08600]")} style={{ width: `${Math.max(live ? 1.5 : 0, Math.min(100, pctSold))}%` }} />
        <div className="absolute top-0 h-full w-px bg-ink/50" style={{ left: `${softPct}%` }} title="meta mínima" />
      </div>
    </div>
  );
}
