"use client";

import Link from "next/link";
import { formatUnits } from "viem";
import { useConnection, useReadContracts } from "wagmi";
import { Coins, ExternalLink } from "lucide-react";
import { plants } from "@/data/plants";
import { erc20Abi, identityRegistryAbi, offeringAbi, plantTokenAbi } from "@/lib/web3/abi";
import { chainName, explorerUrl, TARGET_CHAIN_ID } from "@/lib/web3/chains";
import { networkDeployment, plantContracts } from "@/lib/web3/deployments";
import { useTx } from "@/lib/web3/useTx";
import { brl, num, usdt } from "@/lib/fmt";
import { ConnectButton } from "./ConnectButton";
import { KycForm } from "./KycForm";
import { TxStatus } from "@/components/plant/InvestPanel";
import { Badge, buttonClass, Card, CardHeader, cx, Notice } from "@/components/ui";

const deployed = plants.map((p) => ({ plant: p, c: plantContracts(p.slug) })).filter((x) => x.c);

export function Portfolio() {
  const { address, isConnected } = useConnection();
  const net = networkDeployment();
  const tx = useTx();
  const me = address ?? "0x0000000000000000000000000000000000000000";

  const reads = useReadContracts({
    allowFailure: true,
    query: { enabled: isConnected, refetchInterval: 30_000 },
    contracts: [
      ...(net.identityRegistry ? [{ address: net.identityRegistry, abi: identityRegistryAbi, functionName: "isVerified", args: [me], chainId: TARGET_CHAIN_ID } as const] : []),
      ...(net.paymentToken ? [{ address: net.paymentToken, abi: erc20Abi, functionName: "balanceOf", args: [me], chainId: TARGET_CHAIN_ID } as const] : []),
      ...deployed.flatMap(({ c }) => [
        { address: c!.token, abi: plantTokenAbi, functionName: "balanceOf", args: [me], chainId: TARGET_CHAIN_ID } as const,
        { address: c!.token, abi: plantTokenAbi, functionName: "claimable", args: [me], chainId: TARGET_CHAIN_ID } as const,
        { address: c!.token, abi: plantTokenAbi, functionName: "claimed", args: [me], chainId: TARGET_CHAIN_ID } as const,
        ...(c!.offering ? [{ address: c!.offering, abi: offeringAbi, functionName: "commitmentOf", args: [me], chainId: TARGET_CHAIN_ID } as const] : []),
      ]),
    ],
  });

  if (!isConnected) {
    return (
      <Card className="mx-auto max-w-lg">
        <div className="p-8 text-center">
          <Coins className="mx-auto size-10 text-brand" />
          <h2 className="mt-4 text-xl font-semibold">Conecte sua carteira</h2>
          <p className="mt-2 text-[14px] text-ink-2">Veja suas cotas, rendimentos disponíveis para resgate e o status do seu KYC.</p>
          <div className="mt-6 flex justify-center">
            <ConnectButton />
          </div>
        </div>
      </Card>
    );
  }

  const data = reads.data ?? [];
  let i = 0;
  const next = <T,>() => {
    const r = data[i++];
    return r?.status === "success" ? (r.result as T) : undefined;
  };
  const verified = net.identityRegistry ? next<boolean>() : undefined;
  const usdtBal = net.paymentToken ? next<bigint>() : undefined;
  const rows = deployed.map(({ plant, c }) => {
    const balance = next<bigint>();
    const claimable = next<bigint>();
    const claimed = next<bigint>();
    const commitment = c!.offering ? next<readonly [bigint, bigint, bigint, boolean, boolean]>() : undefined;
    return { plant, c: c!, balance, claimable, claimed, commitment };
  });
  const dec = net.paymentTokenDecimals;
  const u = (x?: bigint) => (x === undefined ? "—" : usdt(Number(formatUnits(x, dec))));
  const totalClaimable = rows.reduce((s, r) => s + (r.claimable ?? 0n), 0n);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <div className="p-4">
              <div className="text-[12px] text-muted">Rendimentos a resgatar</div>
              <div className="mt-1 text-2xl font-semibold text-good tnum">{u(totalClaimable)}</div>
            </div>
          </Card>
          <Card>
            <div className="p-4">
              <div className="text-[12px] text-muted">USDT na carteira</div>
              <div className="mt-1 text-2xl font-semibold tnum">{u(usdtBal)}</div>
            </div>
          </Card>
          <Card>
            <div className="p-4">
              <div className="text-[12px] text-muted">KYC on-chain</div>
              <div className="mt-2">{verified === undefined ? <Badge>—</Badge> : verified ? <Badge tone="good">verificado</Badge> : <Badge tone="warning">pendente</Badge>}</div>
            </div>
          </Card>
        </div>

        <Card as="section">
          <CardHeader title="Minhas cotas" subtitle={chainName} />
          {deployed.length === 0 ? (
            <div className="p-5">
              <Notice tone="info">Nenhum contrato de usina implantado nesta rede ainda.</Notice>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => {
                const pending = r.commitment && r.commitment[0] > 0n && !r.commitment[3] && !r.commitment[4];
                return (
                  <li key={r.plant.slug} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                    <div className="min-w-0">
                      <Link href={`/usinas/${r.plant.slug}`} className="font-medium text-ink hover:text-brand">
                        {r.plant.name}
                      </Link>
                      <div className="mt-0.5 text-[13px] text-muted">
                        {num(Number(r.balance ?? 0n))} {r.plant.token.symbol} · valor de face {brl(Number(r.balance ?? 0n) * r.plant.token.cotaPriceBRL, 0)}
                        {pending && ` · reserva de ${num(Number(r.commitment![0]))} cotas em custódia`}
                      </div>
                      <div className="text-[12px] text-muted">Já resgatado: {u(r.claimed)}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-[12px] text-muted">Disponível</div>
                        <div className="font-semibold text-good tnum">{u(r.claimable)}</div>
                      </div>
                      <button
                        className={cx(buttonClass.primary, "px-3 py-2")}
                        disabled={tx.busy || !r.claimable || r.claimable === 0n}
                        onClick={async () => (await tx.run(`Resgate ${r.plant.token.symbol}`, { address: r.c.token, abi: plantTokenAbi, functionName: "claim" })) && reads.refetch()}
                      >
                        Resgatar
                      </button>
                      <a href={explorerUrl("token", r.c.token)} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-ink" aria-label={`Ver ${r.plant.token.symbol} no BscScan`}>
                        <ExternalLink className="size-4" />
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="px-5 pb-4">
            <TxStatus state={tx.state} />
          </div>
        </Card>
      </div>

      <Card as="section" className="self-start">
        <CardHeader id="kyc" title="Verificação de identidade (KYC)" subtitle="Exigida para investir e receber cotas" />
        <div className="p-5">
          <KycForm verifiedOnChain={verified} />
        </div>
      </Card>
    </div>
  );
}
