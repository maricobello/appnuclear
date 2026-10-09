"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useConnection, useReadContracts } from "wagmi";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { erc20Abi, identityRegistryAbi, mockUsdtAbi, offeringAbi, plantTokenAbi } from "@/lib/web3/abi";
import { chainName, explorerUrl, TARGET_CHAIN_ID } from "@/lib/web3/chains";
import { plantContracts } from "@/lib/web3/deployments";
import { useTx } from "@/lib/web3/useTx";
import { useNowSec } from "@/lib/useNow";
import { shortAddr } from "@/lib/fmt";
import { useT } from "@/i18n/client";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { Badge, buttonClass, cx, Notice } from "@/components/ui";


export function TxStatus({ state }: { state: ReturnType<typeof useTx>["state"] }) {
  const { d, t } = useT();
  if (state.step === "idle") return null;
  const stepText = state.step === "error" ? "" : d.tx[state.step];
  return (
    <div className={cx("mt-3 rounded-lg border px-3 py-2 text-[13px]", state.step === "error" ? "border-critical/30 bg-critical/5 text-critical" : state.step === "done" ? "border-good/30 bg-good/5 text-good" : "border-line bg-surface-2 text-ink-2")} role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        {state.step === "done" ? <CheckCircle2 className="size-4" /> : state.step !== "error" ? <Loader2 className="size-4 animate-spin" /> : null}
        <span>{state.step === "error" ? state.error : `${state.label ? `${state.label}: ` : ""}${stepText}`}</span>
      </div>
      {state.hash && (
        <a href={explorerUrl("tx", state.hash)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] text-ink-2 underline-offset-2 hover:underline">
          {t(d.ip.viewTx, { h: shortAddr(state.hash, 6) })} <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}

export function InvestPanel({
  slug,
  symbol,
  cotaPriceBRL,
  cotaPriceUSDT,
  minCotas: minCotasCatalog,
  monthlyPerCotaBRL,
  usdtBrl,
}: {
  slug: string;
  symbol: string;
  cotaPriceBRL: number;
  cotaPriceUSDT: number;
  minCotas: number;
  monthlyPerCotaBRL: number;
  usdtBrl: number;
}) {
  const c = plantContracts(slug);
  const { d: L, t, f } = useT();
  const ip = L.ip;
  const { brl, num, usdt, date: dateBR } = f;
  const { address, isConnected } = useConnection();
  const tx = useTx();
  const now = useNowSec();
  const [cotasInput, setCotasInput] = useState(String(Math.max(minCotasCatalog, 10)));

  const ZERO = "0x0000000000000000000000000000000000000000" as const;
  const offering = c?.offering;
  const enabled = Boolean(offering && c?.paymentToken && c?.identityRegistry);
  const me = address ?? ZERO;
  const off = offering ?? ZERO;
  const registry = c?.identityRegistry ?? ZERO;
  const pay = c?.paymentToken ?? ZERO;
  const tok = c?.token ?? ZERO;

  const reads = useReadContracts({
    allowFailure: true,
    query: { enabled, refetchInterval: 20_000 },
    contracts: [
      { address: off, abi: offeringAbi, functionName: "state", chainId: TARGET_CHAIN_ID },
      { address: off, abi: offeringAbi, functionName: "pricePerCota", chainId: TARGET_CHAIN_ID },
      { address: off, abi: offeringAbi, functionName: "minCotas", chainId: TARGET_CHAIN_ID },
      { address: off, abi: offeringAbi, functionName: "maxCotasPerInvestor", chainId: TARGET_CHAIN_ID },
      { address: off, abi: offeringAbi, functionName: "cotasSold", chainId: TARGET_CHAIN_ID },
      { address: off, abi: offeringAbi, functionName: "hardCapCotas", chainId: TARGET_CHAIN_ID },
      { address: off, abi: offeringAbi, functionName: "softCapCotas", chainId: TARGET_CHAIN_ID },
      { address: off, abi: offeringAbi, functionName: "startTime", chainId: TARGET_CHAIN_ID },
      { address: off, abi: offeringAbi, functionName: "endTime", chainId: TARGET_CHAIN_ID },
      { address: off, abi: offeringAbi, functionName: "commitmentOf", args: [me], chainId: TARGET_CHAIN_ID },
      { address: off, abi: offeringAbi, functionName: "withdrawableOf", args: [me], chainId: TARGET_CHAIN_ID },
      { address: registry, abi: identityRegistryAbi, functionName: "isVerified", args: [me], chainId: TARGET_CHAIN_ID },
      { address: pay, abi: erc20Abi, functionName: "balanceOf", args: [me], chainId: TARGET_CHAIN_ID },
      { address: pay, abi: erc20Abi, functionName: "allowance", args: [me, off], chainId: TARGET_CHAIN_ID },
      { address: tok, abi: plantTokenAbi, functionName: "balanceOf", args: [me], chainId: TARGET_CHAIN_ID },
      { address: off, abi: offeringAbi, functionName: "hasWithdrawn", args: [me], chainId: TARGET_CHAIN_ID },
    ],
  });

  const data = reads.data;
  const v = <T,>(i: number) => (data?.[i]?.status === "success" ? (data[i].result as T) : undefined);
  const state = v<number>(0);
  const price = v<bigint>(1);
  const minCotas = Number(v<bigint>(2) ?? BigInt(minCotasCatalog));
  const maxPerInvestor = v<bigint>(3);
  const sold = v<bigint>(4) ?? 0n;
  const hardCap = v<bigint>(5);
  const softCap = v<bigint>(6);
  const start = v<bigint>(7);
  const end = v<bigint>(8);
  const commitment = v<readonly [bigint, bigint, bigint, boolean, boolean]>(9);
  // desistência por aporte (tranche): só aportes com menos de 5 dias são devolvidos
  const withdrawable = v<readonly [bigint, bigint, bigint]>(10);
  const verified = isConnected ? v<boolean>(11) : undefined;
  const balance = isConnected ? v<bigint>(12) : undefined;
  const allowance = isConnected ? v<bigint>(13) : undefined;
  const tokenBalance = isConnected ? v<bigint>(14) : undefined;
  const withdrewBefore = isConnected ? v<boolean>(15) === true : false;
  const dec = c?.paymentTokenDecimals ?? 18;

  // teto: um campo com centenas de dígitos vira Infinity e BigInt(Infinity) derrubaria o render
  const cotas = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(Number(cotasInput) || 0)));
  const cost = price !== undefined ? price * BigInt(cotas) : undefined;
  const myCotas = commitment ? Number(commitment[0]) : 0;
  const myPaid = commitment?.[1] ?? 0n;
  const settled = commitment?.[3] ?? false;
  const refunded = commitment?.[4] ?? false;
  const wCotas = withdrawable ? Number(withdrawable[0]) : 0;
  const wAmount = withdrawable?.[1] ?? 0n;
  const wDeadline = withdrawable ? Number(withdrawable[2]) : 0;
  const canWithdraw = wCotas > 0 && now <= wDeadline && (state === 1 || state === 2 || state === 3);

  const progress = useMemo(() => (hardCap ? Number((sold * 10000n) / hardCap) / 100 : 0), [sold, hardCap]);
  const softPct = hardCap && softCap ? Number((softCap * 10000n) / hardCap) / 100 : 0;
  const after = () => reads.refetch();

  if (!c || !offering) {
    return (
      <div className="space-y-3 text-[14px] text-ink-2">
        <Notice tone="info" title={t(ip.notDeployed, { c: chainName })}>
          {ip.notDeployedText}
        </Notice>
        <div className="rounded-xl border border-line bg-surface-2 p-3 text-[13px]">
          <div className="flex justify-between">
            <span className="text-muted">{ip.sharePrice}</span>
            <span className="tnum">
              {brl(cotaPriceBRL, 0)} ≈ {usdt(cotaPriceUSDT)}
            </span>
          </div>
          <div className="mt-1 flex justify-between">
            <span className="text-muted">{ip.estIncome}</span>
            <span className="tnum">{t(ip.perShareMonth, { v: brl(monthlyPerCotaBRL) })}</span>
          </div>
        </div>
      </div>
    );
  }

  const fmtU = (x?: bigint) => (x === undefined ? "—" : usdt(Number(formatUnits(x, dec))));

  return (
    <div className="text-[14px]">
      <div className="flex items-center justify-between">
        <Badge tone={state === 1 ? "brand" : state === 4 ? "good" : state === 3 || state === 5 ? "critical" : "default"}>{state !== undefined ? ip.state[String(state) as "0"] : ip.loading}</Badge>
        <a href={explorerUrl("address", offering)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-muted hover:text-ink">
          {shortAddr(offering)} <ExternalLink className="size-3" />
        </a>
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-[13px]">
          <span className="text-ink-2">
            {t(ip.soldOf, { a: num(Number(sold)), b: hardCap ? num(Number(hardCap)) : "—" })}
          </span>
          <span className="tnum text-muted">{num(progress, 1)}%</span>
        </div>
        <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={ip.soldAria}>
          <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, progress)}%` }} />
          {softPct > 0 && <div className="absolute top-0 h-full w-0.5 bg-ink-2" style={{ left: `${softPct}%` }} title={ip.softCap} />}
        </div>
        <div className="mt-1 flex justify-between text-[12px] text-muted">
          <span>{t(ip.softCapN, { n: softCap ? num(Number(softCap)) : "—" })}</span>
          <span>
            {start ? dateBR(Number(start) * 1000) : "—"} → {end ? dateBR(Number(end) * 1000) : "—"}
          </span>
        </div>
      </div>

      {/* Posição do investidor */}
      {isConnected && (myCotas > 0 || (tokenBalance ?? 0n) > 0n) && (
        <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3 text-[13px]">
          {myCotas > 0 && (
            <div className="flex justify-between">
              <span className="text-muted">{ip.reserve}</span>
              <span className="tnum">
                {t(ip.reserveV, { n: num(myCotas), v: fmtU(myPaid) })}
              </span>
            </div>
          )}
          {(tokenBalance ?? 0n) > 0n && (
            <div className="mt-1 flex justify-between">
              <span className="text-muted">{ip.inWallet}</span>
              <span className="tnum">
                {num(Number(tokenBalance))} {symbol}
              </span>
            </div>
          )}
          {canWithdraw && (
            <>
              <p className="mt-2 text-[12px] text-muted">
                {t(ip.withdrawText, { n: num(wCotas), v: fmtU(wAmount), d: dateBR(wDeadline * 1000, true) })}
                {wCotas < myCotas && ip.withdrawOlder}
                {ip.withdrawNoRe}
              </p>
              <button className={cx(buttonClass.secondary, "mt-2 w-full")} disabled={tx.busy} onClick={async () => (await tx.run(ip.lbl.withdraw, { address: offering, abi: offeringAbi, functionName: "withdraw" })) && after()}>
                {t(ip.withdrawBtn, { v: fmtU(wAmount) })}
              </button>
            </>
          )}
          {state === 4 && myCotas > 0 && !settled && (
            <button className={cx(buttonClass.primary, "mt-3 w-full")} disabled={tx.busy} onClick={async () => (await tx.run(ip.lbl.claim, { address: offering, abi: offeringAbi, functionName: "claimTokens" })) && after()}>
              {t(ip.claimBtn, { n: num(myCotas) })}
            </button>
          )}
          {(state === 3 || state === 5) && myCotas > 0 && !refunded && (
            <button className={cx(buttonClass.primary, "mt-3 w-full")} disabled={tx.busy} onClick={async () => (await tx.run(ip.lbl.refund, { address: offering, abi: offeringAbi, functionName: "refund" })) && after()}>
              {t(ip.refundBtn, { v: fmtU(myPaid) })}
            </button>
          )}
        </div>
      )}

      {/* Fluxo de compra */}
      <div className="mt-4">
        {!isConnected ? (
          <ConnectButton full />
        ) : state === 0 ? (
          <Notice tone="info">{t(ip.opensAt, { d: start ? dateBR(Number(start) * 1000, true) : "—" })}</Notice>
        ) : state === 1 ? (
          withdrewBefore ? (
            <Notice tone="info" title={ip.withdrew}>
              {ip.withdrewText}
            </Notice>
          ) : verified === false ? (
            <Notice tone="warning" title={ip.kycTitle}>
              {ip.kycText}{" "}
              <Link href="/carteira#kyc" className="font-medium text-brand underline-offset-2 hover:underline">
                {ip.kycLink}
              </Link>
            </Notice>
          ) : (
            <div className="space-y-3">
              <div>
                <label htmlFor="invest-cotas" className="text-[13px] text-ink-2">
                  {t(ip.cotasLabel, { min: num(minCotas), max: maxPerInvestor ? t(ip.cotasMax, { n: num(Number(maxPerInvestor)) }) : "" })}
                </label>
                <input
                  id="invest-cotas"
                  type="number"
                  inputMode="numeric"
                  min={minCotas}
                  step={1}
                  value={cotasInput}
                  onChange={(e) => setCotasInput(e.target.value.replace(/[^\d]/g, ""))}
                  className="mt-1 w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2.5 text-right text-[16px] tnum text-ink"
                />
              </div>
              <dl className="space-y-1 rounded-xl border border-line bg-surface-2 p-3 text-[13px]">
                <div className="flex justify-between">
                  <dt className="text-muted">{ip.total}</dt>
                  <dd className="font-semibold tnum">{fmtU(cost)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">{ip.equiv}</dt>
                  <dd className="tnum">≈ {brl(cost !== undefined ? Number(formatUnits(cost, dec)) * usdtBrl : undefined)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">{ip.estIncome}</dt>
                  <dd className="tnum text-good">{t(ip.perMonth, { v: brl(cotas * monthlyPerCotaBRL) })}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">{ip.balance}</dt>
                  <dd className="tnum">{fmtU(balance)}</dd>
                </div>
              </dl>

              {TARGET_CHAIN_ID === 97 && balance !== undefined && cost !== undefined && balance < cost && (
                <button className={cx(buttonClass.secondary, "w-full")} disabled={tx.busy} onClick={async () => (await tx.run(ip.lbl.faucet, { address: c.paymentToken!, abi: mockUsdtAbi, functionName: "faucet" })) && after()}>
                  {ip.faucet}
                </button>
              )}

              {cost !== undefined && cotas >= minCotas && allowance !== undefined && allowance < cost ? (
                <>
                  <p className="text-[12px] text-muted">
                    {t(ip.step1, { v: fmtU(cost) })}{" "}
                    <a className="font-mono underline-offset-2 hover:underline" href={explorerUrl("address", offering)} target="_blank" rel="noopener noreferrer">
                      {shortAddr(offering)}
                    </a>
                    {ip.noUnlimited}
                  </p>
                  <button
                    className={cx(buttonClass.primary, "w-full")}
                    disabled={tx.busy || (balance !== undefined && balance < cost)}
                    onClick={async () => (await tx.run(ip.lbl.approve, { address: c.paymentToken!, abi: erc20Abi, functionName: "approve", args: [offering, cost] })) && after()}
                  >
                    {t(ip.approve, { v: fmtU(cost) })}
                  </button>
                </>
              ) : (
                <button
                  className={cx(buttonClass.primary, "w-full")}
                  disabled={tx.busy || cotas < minCotas || cost === undefined || (balance !== undefined && balance < cost)}
                  onClick={async () => (await tx.run(ip.lbl.invest, { address: offering, abi: offeringAbi, functionName: "commit", args: [BigInt(cotas)] })) && after()}
                >
                  {allowance !== undefined && cost !== undefined && allowance >= cost ? ip.step2 : ""}
                  {t(ip.investN, { n: num(cotas) })}
                </button>
              )}
              <p className="text-[12px] text-muted">
                {ip.custody}
              </p>
            </div>
          )
        ) : state === 2 ? (
          <Notice tone="good">{ip.reached}</Notice>
        ) : state === 4 ? (
          <Notice tone="good">
            {ip.closedIn}{" "}
            <Link href="/carteira" className="font-medium underline-offset-2 hover:underline">
              {ip.yourWallet}
            </Link>
            .
          </Notice>
        ) : state === 3 || state === 5 ? (
          <Notice tone="warning">
            {state === 3 ? ip.failed : ip.cancelled}
            {ip.refundAll}
          </Notice>
        ) : null}
      </div>
      <TxStatus state={tx.state} />
    </div>
  );
}
