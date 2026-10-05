"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useConnection, useReadContracts } from "wagmi";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { erc20Abi, identityRegistryAbi, mockUsdtAbi, offeringAbi, plantTokenAbi } from "@/lib/web3/abi";
import { chainName, explorerUrl, TARGET_CHAIN_ID } from "@/lib/web3/chains";
import { plantContracts } from "@/lib/web3/deployments";
import { stepText, useTx } from "@/lib/web3/useTx";
import { useNowSec } from "@/lib/useNow";
import { brl, dateBR, num, shortAddr, usdt } from "@/lib/fmt";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { Badge, buttonClass, cx, Notice } from "@/components/ui";

const STATES = ["Agendada", "Aberta", "Meta atingida", "Não atingiu a meta", "Encerrada", "Cancelada"] as const;

export function TxStatus({ state }: { state: ReturnType<typeof useTx>["state"] }) {
  if (state.step === "idle") return null;
  return (
    <div className={cx("mt-3 rounded-lg border px-3 py-2 text-[13px]", state.step === "error" ? "border-critical/30 bg-critical/5 text-critical" : state.step === "done" ? "border-good/30 bg-good/5 text-good" : "border-line bg-surface-2 text-ink-2")} role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        {state.step === "done" ? <CheckCircle2 className="size-4" /> : state.step !== "error" ? <Loader2 className="size-4 animate-spin" /> : null}
        <span>{state.step === "error" ? state.error : `${state.label ? `${state.label}: ` : ""}${stepText[state.step]}`}</span>
      </div>
      {state.hash && (
        <a href={explorerUrl("tx", state.hash)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] text-ink-2 underline-offset-2 hover:underline">
          ver transação {shortAddr(state.hash, 6)} <ExternalLink className="size-3" />
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
      { address: off, abi: offeringAbi, functionName: "withdrawalDeadline", args: [me], chainId: TARGET_CHAIN_ID },
      { address: registry, abi: identityRegistryAbi, functionName: "isVerified", args: [me], chainId: TARGET_CHAIN_ID },
      { address: pay, abi: erc20Abi, functionName: "balanceOf", args: [me], chainId: TARGET_CHAIN_ID },
      { address: pay, abi: erc20Abi, functionName: "allowance", args: [me, off], chainId: TARGET_CHAIN_ID },
      { address: tok, abi: plantTokenAbi, functionName: "balanceOf", args: [me], chainId: TARGET_CHAIN_ID },
    ],
  });

  const d = reads.data;
  const v = <T,>(i: number) => (d?.[i]?.status === "success" ? (d[i].result as T) : undefined);
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
  const deadline = v<bigint>(10);
  const verified = isConnected ? v<boolean>(11) : undefined;
  const balance = isConnected ? v<bigint>(12) : undefined;
  const allowance = isConnected ? v<bigint>(13) : undefined;
  const tokenBalance = isConnected ? v<bigint>(14) : undefined;
  const dec = c?.paymentTokenDecimals ?? 18;

  // teto: um campo com centenas de dígitos vira Infinity e BigInt(Infinity) derrubaria o render
  const cotas = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(Number(cotasInput) || 0)));
  const cost = price !== undefined ? price * BigInt(cotas) : undefined;
  const myCotas = commitment ? Number(commitment[0]) : 0;
  const myPaid = commitment?.[1] ?? 0n;
  const settled = commitment?.[3] ?? false;
  const refunded = commitment?.[4] ?? false;
  const canWithdraw = myCotas > 0 && deadline !== undefined && now <= Number(deadline) && (state === 1 || state === 2 || state === 3);

  const progress = useMemo(() => (hardCap ? Number((sold * 10000n) / hardCap) / 100 : 0), [sold, hardCap]);
  const softPct = hardCap && softCap ? Number((softCap * 10000n) / hardCap) / 100 : 0;
  const after = () => reads.refetch();

  if (!c || !offering) {
    return (
      <div className="space-y-3 text-[14px] text-ink-2">
        <Notice tone="info" title={`Oferta ainda não implantada na ${chainName}`}>
          Os contratos desta usina ainda não foram publicados nesta rede. Veja como implantar no README de <code className="font-mono">contracts/</code>.
        </Notice>
        <div className="rounded-xl border border-line bg-surface-2 p-3 text-[13px]">
          <div className="flex justify-between">
            <span className="text-muted">Preço da cota</span>
            <span className="tnum">
              {brl(cotaPriceBRL, 0)} ≈ {usdt(cotaPriceUSDT)}
            </span>
          </div>
          <div className="mt-1 flex justify-between">
            <span className="text-muted">Renda estimada</span>
            <span className="tnum">{brl(monthlyPerCotaBRL)}/cota/mês</span>
          </div>
        </div>
      </div>
    );
  }

  const fmtU = (x?: bigint) => (x === undefined ? "—" : usdt(Number(formatUnits(x, dec))));

  return (
    <div className="text-[14px]">
      <div className="flex items-center justify-between">
        <Badge tone={state === 1 ? "brand" : state === 4 ? "good" : state === 3 || state === 5 ? "critical" : "default"}>{state !== undefined ? STATES[state] : "carregando…"}</Badge>
        <a href={explorerUrl("address", offering)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-muted hover:text-ink">
          {shortAddr(offering)} <ExternalLink className="size-3" />
        </a>
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-[13px]">
          <span className="text-ink-2">
            <b className="text-ink tnum">{num(Number(sold))}</b> de {hardCap ? num(Number(hardCap)) : "—"} cotas
          </span>
          <span className="tnum text-muted">{num(progress, 1)}%</span>
        </div>
        <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Cotas vendidas">
          <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, progress)}%` }} />
          {softPct > 0 && <div className="absolute top-0 h-full w-0.5 bg-ink-2" style={{ left: `${softPct}%` }} title="meta mínima" />}
        </div>
        <div className="mt-1 flex justify-between text-[12px] text-muted">
          <span>meta mínima {softCap ? num(Number(softCap)) : "—"}</span>
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
              <span className="text-muted">Sua reserva</span>
              <span className="tnum">
                {num(myCotas)} cotas · {fmtU(myPaid)}
              </span>
            </div>
          )}
          {(tokenBalance ?? 0n) > 0n && (
            <div className="mt-1 flex justify-between">
              <span className="text-muted">Cotas na carteira</span>
              <span className="tnum">
                {num(Number(tokenBalance))} {symbol}
              </span>
            </div>
          )}
          {canWithdraw && (
            <>
              <p className="mt-2 text-[12px] text-muted">Você pode desistir até {dateBR(Number(deadline) * 1000, true)} e receber {fmtU(myPaid)} de volta.</p>
              <button className={cx(buttonClass.secondary, "mt-2 w-full")} disabled={tx.busy} onClick={async () => (await tx.run("Desistência", { address: offering, abi: offeringAbi, functionName: "withdraw" })) && after()}>
                Desistir e receber {fmtU(myPaid)}
              </button>
            </>
          )}
          {state === 4 && myCotas > 0 && !settled && (
            <button className={cx(buttonClass.primary, "mt-3 w-full")} disabled={tx.busy} onClick={async () => (await tx.run("Recebimento das cotas", { address: offering, abi: offeringAbi, functionName: "claimTokens" })) && after()}>
              Receber minhas {num(myCotas)} cotas
            </button>
          )}
          {(state === 3 || state === 5) && myCotas > 0 && !refunded && (
            <button className={cx(buttonClass.primary, "mt-3 w-full")} disabled={tx.busy} onClick={async () => (await tx.run("Reembolso", { address: offering, abi: offeringAbi, functionName: "refund" })) && after()}>
              Resgatar reembolso de {fmtU(myPaid)}
            </button>
          )}
        </div>
      )}

      {/* Fluxo de compra */}
      <div className="mt-4">
        {!isConnected ? (
          <ConnectButton full />
        ) : state === 0 ? (
          <Notice tone="info">A oferta abre em {start ? dateBR(Number(start) * 1000, true) : "—"}.</Notice>
        ) : state === 1 ? (
          verified === false ? (
            <Notice tone="warning" title="Verificação de identidade necessária">
              Só carteiras com KYC aprovado podem investir.{" "}
              <Link href="/carteira#kyc" className="font-medium text-brand underline-offset-2 hover:underline">
                Fazer KYC
              </Link>
            </Notice>
          ) : (
            <div className="space-y-3">
              <div>
                <label htmlFor="invest-cotas" className="text-[13px] text-ink-2">
                  Cotas (mín. {num(minCotas)}
                  {maxPerInvestor ? `, máx. ${num(Number(maxPerInvestor))} por investidor` : ""})
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
                  <dt className="text-muted">Total</dt>
                  <dd className="font-semibold tnum">{fmtU(cost)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Equivalente</dt>
                  <dd className="tnum">≈ {brl(cost !== undefined ? Number(formatUnits(cost, dec)) * usdtBrl : undefined)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Renda estimada</dt>
                  <dd className="tnum text-good">≈ {brl(cotas * monthlyPerCotaBRL)}/mês</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Seu saldo</dt>
                  <dd className="tnum">{fmtU(balance)}</dd>
                </div>
              </dl>

              {TARGET_CHAIN_ID === 97 && balance !== undefined && cost !== undefined && balance < cost && (
                <button className={cx(buttonClass.secondary, "w-full")} disabled={tx.busy} onClick={async () => (await tx.run("Faucet de USDT de teste", { address: c.paymentToken!, abi: mockUsdtAbi, functionName: "faucet" })) && after()}>
                  Pegar USDT de teste (faucet)
                </button>
              )}

              {cost !== undefined && cotas >= minCotas && allowance !== undefined && allowance < cost ? (
                <>
                  <p className="text-[12px] text-muted">
                    Passo 1 de 2: autorize exatamente {fmtU(cost)} para o contrato da oferta{" "}
                    <a className="font-mono underline-offset-2 hover:underline" href={explorerUrl("address", offering)} target="_blank" rel="noopener noreferrer">
                      {shortAddr(offering)}
                    </a>
                    . Nunca pedimos aprovação ilimitada.
                  </p>
                  <button
                    className={cx(buttonClass.primary, "w-full")}
                    disabled={tx.busy || (balance !== undefined && balance < cost)}
                    onClick={async () => (await tx.run("Aprovação de USDT", { address: c.paymentToken!, abi: erc20Abi, functionName: "approve", args: [offering, cost] })) && after()}
                  >
                    Aprovar {fmtU(cost)}
                  </button>
                </>
              ) : (
                <button
                  className={cx(buttonClass.primary, "w-full")}
                  disabled={tx.busy || cotas < minCotas || cost === undefined || (balance !== undefined && balance < cost)}
                  onClick={async () => (await tx.run("Investimento", { address: offering, abi: offeringAbi, functionName: "commit", args: [BigInt(cotas)] })) && after()}
                >
                  {allowance !== undefined && cost !== undefined && allowance >= cost ? "Passo 2 de 2: " : ""}Investir em {num(cotas)} cotas
                </button>
              )}
              <p className="text-[12px] text-muted">O valor fica em custódia no contrato. Você pode desistir em até 5 dias; se a meta mínima não for atingida, tudo é devolvido.</p>
            </div>
          )
        ) : state === 2 ? (
          <Notice tone="good">Meta atingida! A oferta será encerrada após o prazo de desistência e as cotas serão entregues.</Notice>
        ) : state === 4 ? (
          <Notice tone="good">
            Oferta encerrada. Cotas e rendimentos na{" "}
            <Link href="/carteira" className="font-medium underline-offset-2 hover:underline">
              sua carteira
            </Link>
            .
          </Notice>
        ) : state === 3 || state === 5 ? (
          <Notice tone="warning">{state === 3 ? "A meta mínima não foi atingida." : "A oferta foi cancelada."} Quem investiu pode resgatar 100% do valor.</Notice>
        ) : null}
      </div>
      <TxStatus state={tx.state} />
    </div>
  );
}
