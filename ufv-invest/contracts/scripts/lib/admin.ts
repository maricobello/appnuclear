import fs from "node:fs";
import { createHash } from "node:crypto";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { Signer } from "ethers";
import { encodeBytes32String, formatUnits, getAddress, isAddress, parseUnits, ZeroHash } from "ethers";
import { DEFAULT_WEB_DEPLOYMENTS_FILE, readRecord, recordPath, type WebDeployments } from "./deployments";

const STATES = ["Pending", "Active", "Succeeded", "Failed", "Finalized", "Cancelled"] as const;

export interface Addresses {
  chainId: number;
  identityRegistry: string;
  paymentToken: string;
  paymentDecimals: number;
  plants: Record<string, { token: string; offering: string }>;
  pendingAdminTransfers: { contract: string; address: string; newAdmin: string; acceptAfter: number }[];
}

/** Endereços da rede atual: deployments/<chainId>.json, ou o deployments.json do front. */
export async function loadAddresses(
  hre: HardhatRuntimeEnvironment,
  opts: { recordFile?: string; webFile?: string } = {},
): Promise<Addresses> {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const rec = readRecord(opts.recordFile ?? recordPath(chainId));
  if (rec?.identityRegistry && rec.paymentToken) {
    return {
      chainId,
      identityRegistry: rec.identityRegistry.address,
      paymentToken: rec.paymentToken.address,
      paymentDecimals: rec.paymentToken.decimals,
      plants: Object.fromEntries(
        Object.entries(rec.plants).map(([k, p]) => [k, { token: p.token.address, offering: p.offering.address }]),
      ),
      pendingAdminTransfers: rec.pendingAdminTransfers ?? [],
    };
  }
  const webFile = opts.webFile ?? DEFAULT_WEB_DEPLOYMENTS_FILE;
  const web = (fs.existsSync(webFile) ? JSON.parse(fs.readFileSync(webFile, "utf8")) : {}) as WebDeployments;
  const n = web[String(chainId)];
  if (!n?.identityRegistry || !n.paymentToken) throw new Error(`sem deploy registrado para chainId ${chainId}`);
  return {
    chainId,
    identityRegistry: n.identityRegistry,
    paymentToken: n.paymentToken,
    paymentDecimals: n.paymentTokenDecimals ?? 18,
    plants: Object.fromEntries(
      Object.entries(n.plants ?? {})
        .filter(([, p]) => p.token && p.offering)
        .map(([k, p]) => [k, { token: p.token!, offering: p.offering! }]),
    ),
    pendingAdminTransfers: [],
  };
}

function plantOf(a: Addresses, slug: string | undefined) {
  if (!slug) throw new Error(`defina PLANT (uma de: ${Object.keys(a.plants).join(", ")})`);
  const p = a.plants[slug];
  if (!p) throw new Error(`usina "${slug}" não implantada nesta rede (${Object.keys(a.plants).join(", ")})`);
  return p;
}

/** bytes32 a partir de texto curto (≤ 31 bytes) ou de um hex de 32 bytes. */
export function toBytes32(value: string): string {
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase();
  return encodeBytes32String(value);
}

export function sha256File(file: string): string {
  return `0x${createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

// ─── KYC ────────────────────────────────────────────────────────────────────────────────────

export async function kycApprove(
  hre: HardhatRuntimeEnvironment,
  a: Addresses,
  opts: { addresses: string[]; country?: number; days?: number; log?: (m: string) => void },
) {
  const log = opts.log ?? console.log;
  if (!opts.addresses.length) throw new Error("defina ADDRESSES (separados por vírgula)");
  const wallets = opts.addresses.map((x) => {
    if (!isAddress(x)) throw new Error(`endereço inválido: ${x}`);
    return getAddress(x);
  });
  const registry = await hre.ethers.getContractAt("IdentityRegistry", a.identityRegistry);
  const latest = await hre.ethers.provider.getBlock("latest");
  const expiresAt = BigInt(latest!.timestamp) + BigInt(Math.round((opts.days ?? 365) * 86_400));
  const country = opts.country ?? 76;
  for (let i = 0; i < wallets.length; i += 100) {
    const chunk = wallets.slice(i, i + 100);
    const tx = await registry.setInvestors(
      chunk,
      chunk.map(() => country),
      chunk.map(() => expiresAt),
    );
    await tx.wait();
    log(`KYC aprovado para ${chunk.length} carteira(s) até ${new Date(Number(expiresAt) * 1000).toISOString()} (tx ${tx.hash})`);
  }
  return expiresAt;
}

export async function kycRemove(hre: HardhatRuntimeEnvironment, a: Addresses, addresses: string[], log = console.log) {
  const registry = await hre.ethers.getContractAt("IdentityRegistry", a.identityRegistry);
  for (const w of addresses) {
    const tx = await registry.removeInvestor(getAddress(w));
    await tx.wait();
    log(`KYC removido: ${w} (tx ${tx.hash})`);
  }
}

// ─── Receita ────────────────────────────────────────────────────────────────────────────────

export async function distributeRevenue(
  hre: HardhatRuntimeEnvironment,
  a: Addresses,
  opts: { plant?: string; amount: string; period: string; allowDuplicate?: boolean; log?: (m: string) => void },
) {
  const log = opts.log ?? console.log;
  const p = plantOf(a, opts.plant);
  const [signer] = await hre.ethers.getSigners();
  const token = await hre.ethers.getContractAt("UFVPlantToken", p.token);
  const pay = await hre.ethers.getContractAt("MockUSDT", a.paymentToken); // interface ERC-20
  const amount = parseUnits(opts.amount, a.paymentDecimals);
  const periodRef = toBytes32(opts.period);

  if (!(await token.hasRole(await token.DISTRIBUTOR_ROLE(), signer.address))) {
    throw new Error(`${signer.address} não tem DISTRIBUTOR_ROLE (se o distribuidor é uma Safe, use o Transaction Builder)`);
  }
  const already = await token.revenueByPeriod(periodRef);
  if (already > 0n && !opts.allowDuplicate) {
    throw new Error(
      `período "${opts.period}" já recebeu ${formatUnits(already, a.paymentDecimals)}; use ALLOW_DUPLICATE_PERIOD=true se for intencional`,
    );
  }
  const allowance = await pay.allowance(signer.address, p.token);
  if (allowance < amount) {
    const tx = await pay.approve(p.token, amount);
    await tx.wait();
    log(`approve ${opts.amount} (tx ${tx.hash})`);
  }
  const tx = await token.distribute(amount, periodRef);
  await tx.wait();
  log(`distribuído ${opts.amount} em ${opts.plant} período ${opts.period} (tx ${tx.hash})`);
  return tx.hash;
}

// ─── Documentos ─────────────────────────────────────────────────────────────────────────────

export async function publishDocument(
  hre: HardhatRuntimeEnvironment,
  a: Addresses,
  opts: { plant?: string; name: string; uri: string; file?: string; hash?: string; signer?: Signer; log?: (m: string) => void },
) {
  const log = opts.log ?? console.log;
  const p = plantOf(a, opts.plant);
  if (!opts.uri) throw new Error("defina URI");
  const signer = opts.signer ?? (await hre.ethers.getSigners())[0];
  const documentHash = opts.file ? sha256File(opts.file) : opts.hash ? toBytes32(opts.hash) : ZeroHash;
  if (opts.file && opts.hash && toBytes32(opts.hash) !== documentHash) {
    throw new Error(`HASH informado difere do SHA-256 do arquivo (${documentHash})`);
  }
  const token = (await hre.ethers.getContractAt("UFVPlantToken", p.token)).connect(signer);
  const who = await signer.getAddress();
  if (!(await token.hasRole(await token.DOCUMENT_ROLE(), who))) {
    throw new Error(
      `${who} não tem DOCUMENT_ROLE no token (os documentos são da Safe do admin: gere ` +
        `setDocument(name, uri, hash) no Transaction Builder; sha256=${documentHash})`,
    );
  }
  const tx = await token.setDocument(toBytes32(opts.name), opts.uri, documentHash);
  await tx.wait();
  log(`documento "${opts.name}" publicado em ${opts.plant}: ${opts.uri} sha256=${documentHash} (tx ${tx.hash})`);
  return documentHash;
}

// ─── Encerramento da oferta ─────────────────────────────────────────────────────────────────

export async function finalizeAndSettle(
  hre: HardhatRuntimeEnvironment,
  a: Addresses,
  opts: { plant?: string; batch?: number; log?: (m: string) => void },
) {
  const log = opts.log ?? console.log;
  const p = plantOf(a, opts.plant);
  const offering = await hre.ethers.getContractAt("UFVOffering", p.offering);
  let state = Number(await offering.state());
  if (STATES[state] === "Succeeded") {
    const closesAt = await offering.withdrawalsCloseAt();
    const latest = await hre.ethers.provider.getBlock("latest");
    if (BigInt(latest!.timestamp) <= closesAt) {
      throw new Error(`janela de desistência aberta até ${new Date(Number(closesAt) * 1000).toISOString()}`);
    }
    const tx = await offering.finalize();
    await tx.wait();
    log(`oferta finalizada: ${formatUnits(await offering.totalRaised(), a.paymentDecimals)} enviados à tesouraria (tx ${tx.hash})`);
    state = Number(await offering.state());
  }
  if (STATES[state] !== "Finalized") throw new Error(`oferta em estado ${STATES[state]}; nada a liquidar`);
  const batch = opts.batch ?? 100;
  while (!(await offering.settlementCompleted())) {
    const tx = await offering.settle(batch);
    await tx.wait();
    log(`settle: cursor ${await offering.settleCursor()}/${await offering.investorsLength()} (tx ${tx.hash})`);
  }
  log(`liquidação concluída: ${await offering.cotasDelivered()} cotas entregues; emissão do token encerrada`);
}

// ─── Admin: aceitar a transferência (lote para a Safe) ──────────────────────────────────────

/** JSON para importar no Safe{Wallet} → Transaction Builder (aceita o admin em todos os contratos). */
export async function buildAcceptAdminBatch(hre: HardhatRuntimeEnvironment, a: Addresses) {
  const iface = (await hre.ethers.getContractFactory("IdentityRegistry")).interface;
  const data = iface.encodeFunctionData("acceptDefaultAdminTransfer");
  const pending = [];
  for (const t of a.pendingAdminTransfers) {
    const c = await hre.ethers.getContractAt("IdentityRegistry", t.address); // ABI de admin é a mesma
    const [newAdmin, schedule] = await c.pendingDefaultAdmin();
    if (newAdmin === t.newAdmin) pending.push({ ...t, acceptAfter: Number(schedule) });
  }
  const safe = pending[0]?.newAdmin ?? "";
  return {
    pending,
    batch: {
      version: "1.0",
      chainId: String(a.chainId),
      createdAt: Date.now(),
      meta: {
        name: "UFV Invest — aceitar administração",
        description: `acceptDefaultAdminTransfer() em ${pending.length} contratos. Executar após ${
          pending.length ? new Date(Math.max(...pending.map((p) => p.acceptAfter)) * 1000).toISOString() : "-"
        }.`,
        txBuilderVersion: "1.17.1",
        createdFromSafeAddress: safe,
        createdFromOwnerAddress: "",
      },
      transactions: pending.map((p) => ({
        to: p.address,
        value: "0",
        data,
        contractMethod: null,
        contractInputsValues: null,
      })),
    },
  };
}

// ─── Status ─────────────────────────────────────────────────────────────────────────────────

export async function plantStatus(hre: HardhatRuntimeEnvironment, a: Addresses) {
  const out = [];
  for (const [slug, p] of Object.entries(a.plants)) {
    const token = await hre.ethers.getContractAt("UFVPlantToken", p.token);
    const offering = await hre.ethers.getContractAt("UFVOffering", p.offering);
    const fmt = (v: bigint) => formatUnits(v, a.paymentDecimals);
    out.push({
      slug,
      symbol: await token.symbol(),
      state: STATES[Number(await offering.state())],
      cotasSold: `${await offering.cotasSold()} / ${await offering.hardCapCotas()} (soft ${await offering.softCapCotas()})`,
      totalRaised: fmt(await offering.totalRaised()),
      investors: Number(await offering.investorCount()),
      start: new Date(Number(await offering.startTime()) * 1000).toISOString(),
      end: new Date(Number(await offering.endTime()) * 1000).toISOString(),
      supply: `${await token.totalSupply()} / ${await token.maxSupply()}`,
      mintingFinished: await token.mintingFinished(),
      distributed: fmt(await token.totalDistributed()),
      claimed: fmt(await token.totalClaimed()),
      paused: { token: await token.paused(), offering: await offering.paused() },
      admin: await token.defaultAdmin(),
    });
  }
  return out;
}
