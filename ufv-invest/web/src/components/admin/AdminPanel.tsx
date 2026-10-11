"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEther, formatUnits, getAddress, isAddress, parseAbi, parseUnits, stringToHex, type Abi, type Address } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { useConnection, useReadContract, useReadContracts } from "wagmi";
import { Check, Copy, ExternalLink } from "lucide-react";
import { erc20Abi, identityRegistryAbi, mockUsdtAbi, offeringAbi, plantTokenAbi, roles } from "@/lib/web3/abi";
import { chainName, explorerUrl, TARGET_CHAIN_ID } from "@/lib/web3/chains";
import { networkDeployment, plantContracts } from "@/lib/web3/deployments";
import { useTx } from "@/lib/web3/useTx";
import { useMounted, useNowSec } from "@/lib/useNow";
import { shortAddr } from "@/lib/fmt";
import { KYC_COUNTRIES, KYC_COUNTRY_CODES } from "@/lib/countries";
import { useT } from "@/i18n/client";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { useSiwe } from "@/components/wallet/useSiwe";
import { TxStatus } from "@/components/plant/InvestPanel";
import { Badge, buttonClass, Card, CardHeader, cx, Notice } from "@/components/ui";

/**
 * Tela do operador: tudo é feito com a carteira conectada, direto nos contratos (o site não guarda
 * chave nenhuma). Os próprios contratos conferem os papéis; aqui os botões só ficam desabilitados
 * quando a carteira não tem o papel, para evitar uma assinatura que vai reverter.
 * Tela interna, só em português.
 */

export type AdminPlant = { slug: string; name: string; symbol: string };
type Deployed = AdminPlant & { token: Address; offering: Address };
type Kind = "registry" | "token" | "offering";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const chainId: 56 | 97 = TARGET_CHAIN_ID;
const abiOf: Record<Kind, Abi> = { registry: identityRegistryAbi, token: plantTokenAbi, offering: offeringAbi };
/** Leitura comum aos três contratos (AccessControlDefaultAdminRules) */
const adminRulesAbi = parseAbi(["function defaultAdmin() view returns (address)", "function pendingDefaultAdmin() view returns (address newAdmin, uint48 schedule)"]);
const same = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const countryByNumeric = Object.fromEntries(Object.entries(KYC_COUNTRIES).map(([k, v]) => [v, k])) as Record<number, string>;

/** Depois de qualquer transação, relê todos os contratos da tela (ex.: aceitar a administração muda os botões das ofertas). */
function useRefreshAll() {
  const qc = useQueryClient();
  return useCallback(() => void qc.invalidateQueries(), [qc]);
}

export function AdminPanel({ plants }: { plants: AdminPlant[] }) {
  const mounted = useMounted();
  const { address, isConnected } = useConnection();
  const net = networkDeployment();
  const deployed = useMemo<Deployed[]>(
    () =>
      plants.flatMap((p) => {
        const c = plantContracts(p.slug);
        return c?.offering ? [{ ...p, token: c.token, offering: c.offering }] : [];
      }),
    [plants],
  );

  if (!mounted) return <div className="h-64 animate-pulse rounded-xl bg-surface-2" />;
  const registry = net.identityRegistry;
  const notDeployed = !registry && (
    <Notice tone="info" title={`Contratos ainda não implantados na ${chainName}`}>
      Depois do deploy (contracts/scripts/deploy.ts), os endereços entram em src/data/deployments.json e as operações abaixo passam a funcionar. O prontuário já pode ser
      emitido.
    </Notice>
  );
  if (!isConnected || !address) {
    return (
      <div className="space-y-6">
        {notDeployed}
        <Card className="p-6">
          <p className="text-[14px] text-ink-2">Conecte a carteira de administração para continuar.</p>
          <div className="mt-4">
            <ConnectButton />
          </div>
        </Card>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {notDeployed}
      <ProntuarioCard />
      {registry && (
        <>
          <AdminRolesCard me={address} registry={registry} plants={deployed} />
          {TARGET_CHAIN_ID === 97 && <RelayerCard me={address} registry={registry} />}
          <KycCard me={address} registry={registry} />
          <OfferingsCard me={address} plants={deployed} decimals={net.paymentTokenDecimals} />
          {net.paymentToken && <DistributionCard me={address} plants={deployed} payment={net.paymentToken} decimals={net.paymentTokenDecimals} />}
        </>
      )}
    </div>
  );
}

// ─── Prontuário econômico-financeiro (PDF confidencial) ──────────────────────────────────────

function ProntuarioCard() {
  const siwe = useSiwe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gerar = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!siwe.isSignedIn && !(await siwe.signIn())) throw new Error("É preciso confirmar o login com a assinatura da carteira.");
      const r = await fetch("/api/prontuario", { cache: "no-store" });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Falha ao gerar (${r.status}).`);
      }
      const blob = await r.blob();
      const name = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? "prontuario-aferi.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader
        title="Prontuário econômico-financeiro"
        subtitle="PDF confidencial recalculado na hora: levantamento das usinas, modelo de remuneração, DRE projetada, estresse, auditoria de perdas e revisão técnica."
        right={
          <button className={buttonClass.primary} disabled={busy} onClick={gerar}>
            {busy ? "Gerando…" : "Gerar PDF"}
          </button>
        }
      />
      <div className="space-y-2 px-5 pb-5 text-[12px] text-muted">
        {error && (
          <p className="text-[13px] text-critical" role="alert">
            {error}
          </p>
        )}
        <p>Exige login com a carteira e papel administrativo nos contratos (ou o endereço na variável ADMIN_WALLETS da Vercel).</p>
      </div>
    </Card>
  );
}

function AddressLink({ a }: { a: string }) {
  return (
    <a href={explorerUrl("address", a)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-muted hover:text-ink">
      {shortAddr(a)} <ExternalLink className="size-3" />
    </a>
  );
}

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-ink-2 hover:bg-surface-2 hover:text-ink"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
    >
      {ok ? <Check className="size-3.5 text-good" /> : <Copy className="size-3.5" />} {ok ? "copiado" : "copiar"}
    </button>
  );
}

// ─── Administração dos contratos (transferência em 2 etapas) ─────────────────────────────────

function AdminRolesCard({ me, registry, plants }: { me: Address; registry: Address; plants: Deployed[] }) {
  const now = useNowSec();
  const tx = useTx();
  const refresh = useRefreshAll();
  const { f } = useT();
  const list = useMemo(
    () => [
      { key: "registry", label: "Registro de investidores (KYC)", address: registry, kind: "registry" as Kind },
      ...plants.flatMap((p) => [
        { key: `${p.slug}:token`, label: `${p.name} · cotas ${p.symbol}`, address: p.token, kind: "token" as Kind },
        { key: `${p.slug}:offering`, label: `${p.name} · oferta`, address: p.offering, kind: "offering" as Kind },
      ]),
    ],
    [registry, plants],
  );
  const reads = useReadContracts({
    allowFailure: true,
    query: { refetchInterval: 30_000 },
    contracts: list.flatMap((c) => [
      { address: c.address, abi: adminRulesAbi, functionName: "defaultAdmin" as const, chainId },
      { address: c.address, abi: adminRulesAbi, functionName: "pendingDefaultAdmin" as const, chainId },
    ]),
  });
  const rows = list.map((c, i) => {
    const admin = reads.data?.[2 * i]?.result as Address | undefined;
    const pending = reads.data?.[2 * i + 1]?.result as readonly [Address, number] | undefined;
    const pendingToMe = pending && same(pending[0], me) ? Number(pending[1]) : null;
    return { ...c, admin, pending, pendingToMe, ready: pendingToMe !== null && pendingToMe > 0 && now > pendingToMe };
  });
  const mine = rows.filter((r) => same(r.admin, me)).length;
  const ready = rows.filter((r) => r.ready);
  const waiting = rows.filter((r) => r.pendingToMe !== null && !r.ready);

  const accept = async (rs: typeof rows) => {
    for (const r of rs) {
      const ok = await tx.run(`Aceitar administração: ${r.label}`, { address: r.address, abi: abiOf[r.kind], functionName: "acceptDefaultAdminTransfer" });
      if (!ok) break;
    }
    refresh();
  };

  return (
    <Card>
      <CardHeader
        title="Administração dos contratos"
        subtitle={`Você é administrador de ${mine} de ${rows.length} contratos.${ready.length ? ` ${ready.length} prontos para aceitar.` : ""}`}
        right={
          ready.length > 1 ? (
            <button className={buttonClass.primary} disabled={tx.busy} onClick={() => accept(ready)}>
              Aceitar todos ({ready.length})
            </button>
          ) : undefined
        }
      />
      <div className="px-5 pb-5">
        {waiting.length > 0 && (
          <Notice tone="info" title="Transferência de administração em andamento">
            Por segurança, a troca de administrador tem espera de 2 dias. A partir de {f.date(Math.max(...waiting.map((w) => w.pendingToMe ?? 0)) * 1000, true)} você
            aceita aqui (uma assinatura por contrato). Até lá, a carteira que fez o deploy continua administradora.
          </Notice>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-left text-[12px] text-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">Contrato</th>
                <th className="py-2 pr-3 font-medium">Administrador</th>
                <th className="py-2 font-medium">Transferência</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-line/60 last:border-0">
                  <td className="py-2.5 pr-3">
                    <div className="text-ink">{r.label}</div>
                    <AddressLink a={r.address} />
                  </td>
                  <td className="py-2.5 pr-3">{r.admin ? same(r.admin, me) ? <Badge tone="good">você</Badge> : <AddressLink a={r.admin} /> : "—"}</td>
                  <td className="py-2.5">
                    {r.pendingToMe !== null ? (
                      r.ready ? (
                        <button className={cx(buttonClass.primary, "px-3 py-1.5 text-[12px]")} disabled={tx.busy} onClick={() => accept([r])}>
                          Aceitar
                        </button>
                      ) : (
                        <span className="text-muted">para você a partir de {f.date(r.pendingToMe * 1000, true)}</span>
                      )
                    ) : r.pending && r.pending[0] !== ZERO ? (
                      <span className="text-muted">
                        para <AddressLink a={r.pending[0]} />
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TxStatus state={tx.state} />
      </div>
    </Card>
  );
}

// ─── Relayer do KYC (testnet) ─────────────────────────────────────────────────────────────────

type RelayerInfo = { enabled: boolean; address: Address | null; registry: Address | null; hasRole: boolean | null; balanceWei: string | null };

function RelayerCard({ me, registry }: { me: Address; registry: Address }) {
  const tx = useTx();
  const refresh = useRefreshAll();
  const [info, setInfo] = useState<RelayerInfo | null>(null);
  const load = useCallback(() => {
    fetch("/api/kyc/relayer", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<RelayerInfo>) : null))
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);
  useEffect(load, [load]);
  const admin = useReadContract({ address: registry, abi: identityRegistryAbi, functionName: "defaultAdmin", chainId });
  const isAdmin = same(admin.data, me);
  const balance = info?.balanceWei ? BigInt(info.balanceWei) : null;
  const low = balance !== null && balance < 2_000_000_000_000_000n; // 0,002 tBNB ≈ centenas de aprovações a 0,1 gwei

  return (
    <Card>
      <CardHeader title="Relayer do KYC (testnet)" subtitle="A carteira do site que aprova o KYC de demonstração na hora. Só tem permissão de KYC; não mexe em fundos." />
      <div className="space-y-3 px-5 pb-5 text-[13px]">
        {!info ? (
          <p className="text-muted">carregando…</p>
        ) : !info.enabled || !info.address ? (
          <Notice tone="warning" title="Relayer desativado">
            Defina SESSION_SECRET (ou KYC_RELAYER_PRIVATE_KEY) nas variáveis de ambiente da Vercel.
          </Notice>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted">Endereço</span>
              <span className="break-all font-mono text-[12px] text-ink">{info.address}</span>
              <CopyButton text={info.address} />
              <a href={explorerUrl("address", info.address)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink">
                BscScan <ExternalLink className="size-3" />
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted">Permissão de KYC</span>
              {info.hasRole ? <Badge tone="good">ativa</Badge> : <Badge tone="warning">sem permissão</Badge>}
              {info.hasRole === false && (
                <button
                  className={cx(buttonClass.primary, "px-3 py-1.5 text-[12px]")}
                  disabled={tx.busy || !isAdmin}
                  title={isAdmin ? undefined : "Só o administrador do registro pode autorizar"}
                  onClick={async () => (await tx.run("Autorizar relayer", { address: registry, abi: identityRegistryAbi, functionName: "grantRole", args: [roles.COMPLIANCE_ROLE, info.address] })) && (load(), refresh())}
                >
                  Autorizar relayer
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted">Saldo para gás</span>
              <span className="tnum text-ink">{balance === null ? "—" : `${Number(formatEther(balance)).toFixed(4)} tBNB`}</span>
              {low && <Badge tone="warning">baixo</Badge>}
            </div>
            {low && <p className="text-[12px] text-muted">Envie tBNB (faucet da BNB Chain) para o endereço acima para o KYC automático continuar funcionando.</p>}
            {info.hasRole === false && (
              <p className="text-[12px] text-muted">Isso acontece quando o SESSION_SECRET muda (o endereço do relayer muda junto). Autorize o novo endereço e, se quiser, revogue o antigo.</p>
            )}
          </>
        )}
        <TxStatus state={tx.state} />
      </div>
    </Card>
  );
}

// ─── KYC manual ───────────────────────────────────────────────────────────────────────────────

function KycCard({ me, registry }: { me: Address; registry: Address }) {
  const tx = useTx();
  const refresh = useRefreshAll();
  const now = useNowSec();
  const { f } = useT();
  const [wallet, setWallet] = useState("");
  const [country, setCountry] = useState("BR");
  const [days, setDays] = useState("365");
  const target = isAddress(wallet.trim()) ? getAddress(wallet.trim()) : undefined;
  const role = useReadContract({ address: registry, abi: identityRegistryAbi, functionName: "hasRole", args: [roles.COMPLIANCE_ROLE, me], chainId });
  const inv = useReadContract({ address: registry, abi: identityRegistryAbi, functionName: "investorOf", args: [target ?? ZERO], chainId, query: { enabled: Boolean(target) } });
  const isCompliance = role.data === true;
  const [registered, countryNum, expiresAt] = inv.data ?? [false, 0, 0n];
  const validDays = Math.min(3650, Math.max(1, Math.floor(Number(days) || 0)));
  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames(["pt-BR"], { type: "region" });
    } catch {
      return null;
    }
  }, []);
  const input = "mt-1 w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-[14px] text-ink placeholder:text-muted";

  return (
    <Card>
      <CardHeader title="KYC manual" subtitle="Aprovar ou revogar uma carteira no registro de investidores (papel COMPLIANCE)." />
      <div className="space-y-3 px-5 pb-5 text-[13px]">
        {!isCompliance && role.isFetched && <Notice tone="warning">Esta carteira não tem COMPLIANCE_ROLE no registro; as ações abaixo vão falhar.</Notice>}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px_120px]">
          <label className="text-ink-2">
            Carteira do investidor
            <input className={cx(input, "font-mono")} placeholder="0x…" value={wallet} onChange={(e) => setWallet(e.target.value)} spellCheck={false} />
          </label>
          <label className="text-ink-2">
            País
            <select className={input} value={country} onChange={(e) => setCountry(e.target.value)}>
              {KYC_COUNTRY_CODES.map((c) => (
                <option key={c} value={c}>
                  {names?.of(c) ?? c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-ink-2">
            Validade (dias)
            <input className={cx(input, "tnum")} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />
          </label>
        </div>
        {target && inv.isFetched && (
          <p className="text-ink-2">
            Situação atual:{" "}
            {registered ? (
              <>
                <Badge tone={Number(expiresAt) > now ? "good" : "warning"}>{Number(expiresAt) > now ? "verificada" : "vencida"}</Badge> · {names?.of(countryByNumeric[countryNum] ?? "") ?? countryNum} · até{" "}
                {f.date(Number(expiresAt) * 1000)}
              </>
            ) : (
              <Badge>não verificada</Badge>
            )}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            className={buttonClass.primary}
            disabled={!target || tx.busy || !isCompliance}
            onClick={async () =>
              target &&
              (await tx.run("Aprovar KYC", {
                address: registry,
                abi: identityRegistryAbi,
                functionName: "setInvestor",
                args: [target, KYC_COUNTRIES[country as keyof typeof KYC_COUNTRIES], BigInt(Math.floor(Date.now() / 1000) + validDays * 86_400)],
              })) &&
              refresh()
            }
          >
            Aprovar por {validDays} dias
          </button>
          {registered && (
            <button
              className={buttonClass.secondary}
              disabled={!target || tx.busy || !isCompliance}
              onClick={async () => target && (await tx.run("Revogar KYC", { address: registry, abi: identityRegistryAbi, functionName: "removeInvestor", args: [target] })) && refresh()}
            >
              Revogar
            </button>
          )}
        </div>
        <TxStatus state={tx.state} />
      </div>
    </Card>
  );
}

// ─── Ofertas: encerrar, entregar cotas, cancelar ──────────────────────────────────────────────

const OFFERING_FIELDS = [
  "state",
  "cotasSold",
  "softCapCotas",
  "hardCapCotas",
  "totalRaised",
  "endTime",
  "withdrawalsCloseAt",
  "finalized",
  "settlementCompleted",
  "investorsLength",
  "settleCursor",
  "defaultAdmin",
  "FINALIZE_GRACE_PERIOD",
] as const;

function OfferingsCard({ me, plants, decimals }: { me: Address; plants: Deployed[]; decimals: number }) {
  const tx = useTx();
  const now = useNowSec();
  const refresh = useRefreshAll();
  const { d, f } = useT();
  const reads = useReadContracts({
    allowFailure: true,
    query: { refetchInterval: 30_000 },
    contracts: plants.flatMap((p) => OFFERING_FIELDS.map((functionName) => ({ address: p.offering, abi: offeringAbi, functionName, chainId }))),
  });
  const n = OFFERING_FIELDS.length;

  return (
    <Card>
      <CardHeader title="Ofertas" subtitle="Encerrar com sucesso, entregar as cotas aos investidores ou cancelar (todos recebem o reembolso)." />
      <div className="divide-y divide-line/60 px-5 pb-5 text-[13px]">
        {plants.map((p, i) => {
          const v = <T,>(field: (typeof OFFERING_FIELDS)[number]) => reads.data?.[i * n + OFFERING_FIELDS.indexOf(field)]?.result as T | undefined;
          const state = v<number>("state");
          const sold = v<bigint>("cotasSold") ?? 0n;
          const closesAt = Number(v<bigint>("withdrawalsCloseAt") ?? 0n);
          const grace = Number(v<bigint>("FINALIZE_GRACE_PERIOD") ?? 0n);
          const finalized = v<boolean>("finalized") === true;
          const settled = v<boolean>("settlementCompleted") === true;
          const investors = Number(v<bigint>("investorsLength") ?? 0n);
          const cursor = Number(v<bigint>("settleCursor") ?? 0n);
          const isAdmin = same(v<Address>("defaultAdmin"), me);
          const canFinalize = state === 2 && now > closesAt && (isAdmin || now > closesAt + grace);
          const canSettle = finalized && !settled;
          // cancelar só faz sentido antes do resultado (agendada, aberta ou meta atingida)
          const canCancel = isAdmin && (state === 0 || state === 1 || state === 2);
          const raised = v<bigint>("totalRaised");
          return (
            <div key={p.slug} className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">{p.name}</span>
                  <Badge tone={state === 1 ? "brand" : state === 4 ? "good" : state === 3 || state === 5 ? "critical" : "default"}>{state !== undefined ? d.ip.state[String(state) as "0"] : "…"}</Badge>
                </div>
                <AddressLink a={p.offering} />
              </div>
              <div className="mt-2 grid gap-x-6 gap-y-1 text-ink-2 sm:grid-cols-2">
                <span>
                  Vendidas: <b className="tnum text-ink">{f.num(Number(sold))}</b> de {f.num(Number(v<bigint>("hardCapCotas") ?? 0n))} (meta {f.num(Number(v<bigint>("softCapCotas") ?? 0n))})
                </span>
                <span>
                  Captado: {raised === undefined ? "—" : f.usdt(Number(formatUnits(raised, decimals)))}
                  {finalized && " · enviado à tesouraria"}
                </span>
                <span>Fim da captação: {f.date(Number(v<bigint>("endTime") ?? 0n) * 1000, true)}</span>
                <span>Desistências até: {closesAt ? f.date(closesAt * 1000, true) : "—"}</span>
                <span>
                  Investidores: {f.num(investors)}
                  {finalized && ` · cotas entregues a ${f.num(Math.min(cursor, investors))}`}
                </span>
              </div>
              {/* só as ações que fazem sentido no estado atual da oferta */}
              {(state === 2 || canSettle || canCancel) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {state === 2 && (
                    <button className={cx(buttonClass.primary, "px-3 py-1.5 text-[12px]")} disabled={tx.busy || !canFinalize} onClick={async () => (await tx.run(`Encerrar ${p.symbol}`, { address: p.offering, abi: offeringAbi, functionName: "finalize" })) && refresh()}>
                      Encerrar com sucesso
                    </button>
                  )}
                  {canSettle && (
                    <button className={cx(buttonClass.primary, "px-3 py-1.5 text-[12px]")} disabled={tx.busy} onClick={async () => (await tx.run(`Entregar cotas ${p.symbol}`, { address: p.offering, abi: offeringAbi, functionName: "settle", args: [50n] })) && refresh()}>
                      Entregar cotas (lote de 50)
                    </button>
                  )}
                  {canCancel && (
                    <button
                      className={cx(buttonClass.secondary, "px-3 py-1.5 text-[12px] text-critical")}
                      disabled={tx.busy}
                      onClick={async () => {
                        if (!window.confirm(`Cancelar a oferta de ${p.name}? É irreversível: todos os investidores poderão pedir o reembolso integral.`)) return;
                        if (await tx.run(`Cancelar ${p.symbol}`, { address: p.offering, abi: offeringAbi, functionName: "cancel" })) refresh();
                      }}
                    >
                      Cancelar oferta
                    </button>
                  )}
                </div>
              )}
              {state === 2 && now <= closesAt && <p className="mt-2 text-[12px] text-muted">Meta atingida. O encerramento libera depois do prazo de desistência.</p>}
              {state === 2 && now > closesAt && !canFinalize && <p className="mt-2 text-[12px] text-muted">Só o administrador da oferta encerra antes do fim da carência.</p>}
            </div>
          );
        })}
        <TxStatus state={tx.state} />
      </div>
    </Card>
  );
}

// ─── Distribuição de rendimentos ──────────────────────────────────────────────────────────────

function DistributionCard({ me, plants, payment, decimals }: { me: Address; plants: Deployed[]; payment: Address; decimals: number }) {
  const tx = useTx();
  const refresh = useRefreshAll();
  const { f } = useT();
  const [slug, setSlug] = useState(plants[0]?.slug ?? "");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const p = plants.find((x) => x.slug === slug) ?? plants[0];
  const tok = p?.token ?? ZERO;
  const reads = useReadContracts({
    allowFailure: true,
    query: { enabled: Boolean(p) },
    contracts: [
      { address: tok, abi: plantTokenAbi, functionName: "mintingFinished", chainId },
      { address: tok, abi: plantTokenAbi, functionName: "totalSupply", chainId },
      { address: tok, abi: plantTokenAbi, functionName: "totalDistributed", chainId },
      { address: tok, abi: plantTokenAbi, functionName: "hasRole", args: [roles.DISTRIBUTOR_ROLE, me], chainId },
      { address: payment, abi: erc20Abi, functionName: "balanceOf", args: [me], chainId },
      { address: payment, abi: erc20Abi, functionName: "allowance", args: [me, tok], chainId },
    ],
  });
  const r = reads.data;
  const mintingFinished = r?.[0]?.result === true;
  const supply = (r?.[1]?.result as bigint | undefined) ?? 0n;
  const distributed = r?.[2]?.result as bigint | undefined;
  const isDistributor = r?.[3]?.result === true;
  const balance = r?.[4]?.result as bigint | undefined;
  const allowance = (r?.[5]?.result as bigint | undefined) ?? 0n;
  const value = (() => {
    try {
      return amount ? parseUnits(amount.replace(",", "."), decimals) : 0n;
    } catch {
      return 0n;
    }
  })();
  const periodOk = /^\d{4}-\d{2}$/.test(period);
  const after = refresh;
  const input = "mt-1 w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-[14px] text-ink placeholder:text-muted";
  if (!p) return null;

  return (
    <Card>
      <CardHeader title="Distribuir rendimentos" subtitle="Deposita USDT no contrato da usina; cada cotista saca a parte proporcional às suas cotas (papel DISTRIBUTOR)." />
      <div className="space-y-3 px-5 pb-5 text-[13px]">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_140px]">
          <label className="text-ink-2">
            Usina
            <select className={input} value={p.slug} onChange={(e) => setSlug(e.target.value)}>
              {plants.map((x) => (
                <option key={x.slug} value={x.slug}>
                  {x.name} ({x.symbol})
                </option>
              ))}
            </select>
          </label>
          <label className="text-ink-2">
            Valor (USDT)
            <input className={cx(input, "tnum")} inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} />
          </label>
          <label className="text-ink-2">
            Período
            <input className={cx(input, "tnum")} placeholder="2027-03" value={period} onChange={(e) => setPeriod(e.target.value.trim())} />
          </label>
        </div>
        <p className="text-ink-2">
          Cotas emitidas: {f.num(Number(supply))} · já distribuído: {distributed === undefined ? "—" : f.usdt(Number(formatUnits(distributed, decimals)))} · seu saldo:{" "}
          {balance === undefined ? "—" : f.usdt(Number(formatUnits(balance, decimals)))}
        </p>
        {!mintingFinished ? (
          <Notice tone="info">A distribuição abre depois que a oferta é encerrada e todas as cotas são entregues.</Notice>
        ) : !isDistributor ? (
          <Notice tone="warning">Esta carteira não tem DISTRIBUTOR_ROLE no token desta usina.</Notice>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {TARGET_CHAIN_ID === 97 && (
            <button className={buttonClass.secondary} disabled={tx.busy} onClick={async () => (await tx.run("Faucet de USDT de teste", { address: payment, abi: mockUsdtAbi, functionName: "faucet" })) && after()}>
              Pegar USDT de teste
            </button>
          )}
          {allowance < value ? (
            <button
              className={buttonClass.primary}
              disabled={tx.busy || value === 0n || !mintingFinished || !isDistributor}
              onClick={async () => (await tx.run("Aprovação de USDT", { address: payment, abi: erc20Abi, functionName: "approve", args: [tok, value] })) && after()}
            >
              1/2 · Aprovar {value ? f.usdt(Number(formatUnits(value, decimals))) : "USDT"}
            </button>
          ) : (
            <button
              className={buttonClass.primary}
              disabled={tx.busy || value === 0n || !periodOk || !mintingFinished || !isDistributor}
              onClick={async () =>
                (await tx.run(`Distribuição ${p.symbol} ${period}`, { address: tok, abi: plantTokenAbi, functionName: "distribute", args: [value, stringToHex(period, { size: 32 })] })) &&
                (setAmount(""), after())
              }
            >
              2/2 · Distribuir {value ? f.usdt(Number(formatUnits(value, decimals))) : ""}
            </button>
          )}
        </div>
        <TxStatus state={tx.state} />
      </div>
    </Card>
  );
}
