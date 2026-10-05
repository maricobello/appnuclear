import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { ZeroHash, id, type BaseContract, type ContractTransactionResponse } from "ethers";
import { loadPlants, type PlantParams } from "./plants-config";
import {
  BSC_USDT_MAINNET,
  DEFAULT_WEB_DEPLOYMENTS_FILE,
  mergeWebDeployments,
  readRecord,
  recordPath,
  toWebDeployment,
  writeJson,
  type ContractRecord,
  type NetworkRecord,
} from "./deployments";

/** hash do papel (OpenZeppelin AccessControl: keccak256 do nome; DEFAULT_ADMIN_ROLE = 0x00) */
export const ROLE = (name: string) => (name === "DEFAULT_ADMIN_ROLE" ? ZeroHash : id(name));

export interface DeployOptions {
  /** admin final (recomendado: Safe). Padrão: deployer. */
  admin?: string;
  /** DISTRIBUTOR_ROLE nos tokens. Padrão: admin. */
  distributor?: string;
  /** COMPLIANCE_ROLE no registro e nos tokens. Padrão: admin. */
  compliance?: string;
  /** tesouraria que recebe a captação (obrigatória na mainnet). Padrão em testes: admin. */
  treasury?: string;
  /** endereço do token de pagamento (senão: MockUSDT em testnet/local, USDT oficial na mainnet) */
  paymentToken?: string;
  /** só estas usinas */
  only?: string[];
  /** ignora o registro existente e implanta tudo de novo */
  forceRedeploy?: boolean;
  /** permite admin EOA (sem código) na mainnet — NÃO recomendado */
  allowEoaAdminOnMainnet?: boolean;
  plantsFile?: string;
  /** registro detalhado da rede; `null` = não grava */
  recordFile?: string | null;
  /** deployments.json do front; `null` = não grava */
  webFile?: string | null;
  confirmations?: number;
  log?: (msg: string) => void;
}

export interface DeployResult {
  record: NetworkRecord;
  recordFile?: string;
  webFile?: string;
}

export async function deployAll(hre: HardhatRuntimeEnvironment, opts: DeployOptions = {}): Promise<DeployResult> {
  const { ethers } = hre;
  const log = opts.log ?? ((m: string) => console.log(m));
  const confirmations = opts.confirmations ?? 1;

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("nenhuma conta para deploy: defina DEPLOYER_PRIVATE_KEY no .env");
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const isMainnet = chainId === 56;
  const isLocal = chainId === 31337;

  const norm = (a: string | undefined, label: string): string | undefined => {
    if (!a) return undefined;
    if (!ethers.isAddress(a)) throw new Error(`${label} inválido: ${a}`);
    return ethers.getAddress(a);
  };
  const admin = norm(opts.admin, "ADMIN_ADDRESS") ?? deployer.address;
  const distributor = norm(opts.distributor, "DISTRIBUTOR_ADDRESS") ?? admin;
  const compliance = norm(opts.compliance, "COMPLIANCE_ADDRESS") ?? admin;
  const treasuryDefault = norm(opts.treasury, "TREASURY_ADDRESS");

  if (isMainnet) {
    if (!opts.admin) throw new Error("mainnet: defina ADMIN_ADDRESS (Safe multisig)");
    if (!treasuryDefault) throw new Error("mainnet: defina TREASURY_ADDRESS");
    const code = await ethers.provider.getCode(admin);
    if (code === "0x" && !opts.allowEoaAdminOnMainnet) {
      throw new Error(`mainnet: ADMIN_ADDRESS ${admin} não é um contrato (Safe). Use uma Safe multisig.`);
    }
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  log(`rede ${hre.network.name} (chainId ${chainId}) · deployer ${deployer.address} · saldo ${ethers.formatEther(balance)} BNB`);
  log(`admin ${admin} · distribuidor ${distributor} · compliance ${compliance}`);

  const recordFile = opts.recordFile === null ? undefined : (opts.recordFile ?? recordPath(chainId));
  const previous = !opts.forceRedeploy && recordFile ? readRecord(recordFile) : undefined;
  const record: NetworkRecord = {
    chainId,
    network: hre.network.name,
    deployer: deployer.address,
    admin,
    distributor,
    compliance,
    updatedAt: new Date().toISOString(),
    identityRegistry: previous?.identityRegistry,
    paymentToken: previous?.paymentToken,
    plants: { ...(previous?.plants ?? {}) },
    pendingAdminTransfers: [...(previous?.pendingAdminTransfers ?? [])],
  };
  const save = () => {
    record.updatedAt = new Date().toISOString();
    if (recordFile) writeJson(recordFile, record);
  };

  const hasCode = async (a?: string) => !!a && (await ethers.provider.getCode(a)) !== "0x";
  const wait = async (tx: Promise<ContractTransactionResponse>, what: string) => {
    const sent = await tx;
    const rc = await sent.wait(confirmations);
    log(`  ✓ ${what} (tx ${sent.hash}${rc ? `, bloco ${rc.blockNumber}` : ""})`);
    return rc;
  };
  const deploy = async (name: string, args: unknown[]): Promise<{ contract: BaseContract; rec: ContractRecord }> => {
    const contract = await ethers.deployContract(name, args);
    await contract.waitForDeployment();
    const tx = contract.deploymentTransaction();
    const rc = tx ? await tx.wait(confirmations) : null;
    const address = await contract.getAddress();
    log(`  ✓ ${name} em ${address}`);
    return {
      contract,
      rec: { address, args: JSON.parse(JSON.stringify(args, (_k, v) => (typeof v === "bigint" ? v.toString() : v))), txHash: tx?.hash, blockNumber: rc?.blockNumber },
    };
  };
  const grant = async (c: BaseContract, label: string, role: string, account: string) => {
    const ac = c as unknown as {
      hasRole(r: string, a: string): Promise<boolean>;
      grantRole(r: string, a: string): Promise<ContractTransactionResponse>;
    };
    if (await ac.hasRole(ROLE(role), account)) return;
    await wait(ac.grantRole(ROLE(role), account), `${label}: ${role} → ${account}`);
  };
  const handOff = async (c: BaseContract, label: string) => {
    if (admin === deployer.address) return;
    const ac = c as unknown as {
      defaultAdmin(): Promise<string>;
      pendingDefaultAdmin(): Promise<[string, bigint]>;
      beginDefaultAdminTransfer(a: string): Promise<ContractTransactionResponse>;
    };
    if ((await ac.defaultAdmin()) !== deployer.address) return; // já transferido
    const [pending] = await ac.pendingDefaultAdmin();
    if (pending !== admin) await wait(ac.beginDefaultAdminTransfer(admin), `${label}: transferência de admin → ${admin} iniciada`);
    const [, schedule] = await ac.pendingDefaultAdmin();
    const address = await c.getAddress();
    record.pendingAdminTransfers = record.pendingAdminTransfers.filter((p) => p.address !== address);
    record.pendingAdminTransfers.push({ contract: label, address, newAdmin: admin, acceptAfter: Number(schedule) });
  };

  // ─── IdentityRegistry ─────────────────────────────────────────────────────────────────────
  log("IdentityRegistry");
  let registry: BaseContract;
  if (record.identityRegistry && (await hasCode(record.identityRegistry.address))) {
    registry = await ethers.getContractAt("IdentityRegistry", record.identityRegistry.address);
    log(`  = reaproveitado ${record.identityRegistry.address}`);
  } else {
    const d = await deploy("IdentityRegistry", [deployer.address]);
    registry = d.contract;
    record.identityRegistry = d.rec;
    // usinas antigas apontam para o registro antigo: não dá para misturar
    record.plants = {};
    save();
  }
  const registryAddress = await registry.getAddress();
  if ((await (registry as unknown as { defaultAdmin(): Promise<string> }).defaultAdmin()) === deployer.address) {
    await grant(registry, "IdentityRegistry", "COMPLIANCE_ROLE", compliance);
  }

  // ─── Token de pagamento ───────────────────────────────────────────────────────────────────
  log("Token de pagamento");
  let paymentAddress: string;
  let mock = false;
  const explicitPayment = norm(opts.paymentToken, "PAYMENT_TOKEN_ADDRESS");
  if (explicitPayment) {
    paymentAddress = explicitPayment;
  } else if (isMainnet) {
    paymentAddress = BSC_USDT_MAINNET;
  } else if (record.paymentToken?.mock && (await hasCode(record.paymentToken.address))) {
    paymentAddress = record.paymentToken.address;
    mock = true;
    log(`  = MockUSDT reaproveitado ${paymentAddress}`);
  } else {
    const d = await deploy("MockUSDT", [deployer.address]);
    paymentAddress = d.rec.address;
    mock = true;
    record.paymentToken = { ...d.rec, decimals: 18, symbol: "tUSDT", mock: true };
  }
  if (!mock) {
    if (!(await hasCode(paymentAddress))) throw new Error(`token de pagamento ${paymentAddress} sem código nesta rede`);
    const erc20 = await ethers.getContractAt("MockUSDT", paymentAddress); // só usa decimals/symbol (ERC-20)
    const [decimals, symbol] = await Promise.all([erc20.decimals(), erc20.symbol()]);
    if (isMainnet && (Number(decimals) !== 18 || symbol !== "USDT")) {
      throw new Error(`token de pagamento inesperado na mainnet: ${symbol} (${decimals} casas)`);
    }
    if (record.paymentToken?.address !== paymentAddress) record.plants = {}; // ofertas antigas usam outro token
    record.paymentToken = { address: paymentAddress, args: [], decimals: Number(decimals), symbol, mock: false };
  }
  const paymentDecimals = record.paymentToken!.decimals;
  log(`  ${record.paymentToken!.symbol} ${paymentAddress} (${paymentDecimals} casas)`);
  save();

  // ─── Usinas ───────────────────────────────────────────────────────────────────────────────
  const latest = await ethers.provider.getBlock("latest");
  const nowSec = BigInt(latest!.timestamp);
  const plants: PlantParams[] = loadPlants({ nowSec, paymentDecimals, file: opts.plantsFile, only: opts.only });

  for (const p of plants) {
    log(`Usina ${p.slug} (${p.symbol})`);
    const existing = record.plants[p.slug];
    if (existing && (await hasCode(existing.token.address)) && (await hasCode(existing.offering.address))) {
      log(`  = já implantada (token ${existing.token.address}, oferta ${existing.offering.address}); use FORCE_REDEPLOY=true para refazer`);
      // retomada: uma execução anterior pode ter caído entre o registro da usina e o hand-off (ou
      // rodado sem ADMIN_ADDRESS). handOff é idempotente — sem isso o deployer ficaria admin para sempre.
      await handOff(await ethers.getContractAt("UFVPlantToken", existing.token.address), `${p.symbol} (token)`);
      await handOff(await ethers.getContractAt("UFVOffering", existing.offering.address), `${p.symbol} (oferta)`);
      save();
      continue;
    }
    const treasury = norm(p.treasury, `treasury de ${p.slug}`) ?? treasuryDefault ?? admin;

    const tokenD = await deploy("UFVPlantToken", [p.name, p.symbol, p.maxSupply, registryAddress, paymentAddress, deployer.address]);
    const tokenAddress = tokenD.rec.address;
    const config = {
      token: tokenAddress,
      paymentToken: paymentAddress,
      treasury,
      pricePerCota: p.pricePerCota,
      minCotas: p.minCotas,
      maxCotasPerInvestor: p.maxCotasPerInvestor,
      softCapCotas: p.softCapCotas,
      hardCapCotas: p.hardCapCotas,
      startTime: p.startTime,
      endTime: p.endTime,
      withdrawalWindow: p.withdrawalWindow,
      admin: deployer.address,
    };
    const offeringD = await deploy("UFVOffering", [config]);

    await grant(tokenD.contract, `${p.symbol}`, "MINTER_ROLE", offeringD.rec.address);
    await grant(tokenD.contract, `${p.symbol}`, "DISTRIBUTOR_ROLE", distributor);
    await grant(tokenD.contract, `${p.symbol}`, "PAUSER_ROLE", admin);
    await grant(tokenD.contract, `${p.symbol}`, "COMPLIANCE_ROLE", compliance);
    await grant(offeringD.contract, `Oferta ${p.symbol}`, "PAUSER_ROLE", admin);

    record.plants[p.slug] = {
      token: tokenD.rec,
      offering: offeringD.rec,
      params: {
        name: p.name,
        symbol: p.symbol,
        maxSupply: p.maxSupply.toString(),
        pricePerCotaUSDT: p.pricePerCotaUSDT,
        pricePerCota: p.pricePerCota.toString(),
        minCotas: p.minCotas.toString(),
        maxCotasPerInvestor: p.maxCotasPerInvestor.toString(),
        softCapCotas: p.softCapCotas.toString(),
        hardCapCotas: p.hardCapCotas.toString(),
        startTime: new Date(Number(p.startTime) * 1000).toISOString(),
        endTime: new Date(Number(p.endTime) * 1000).toISOString(),
        withdrawalWindowSeconds: p.withdrawalWindow.toString(),
        treasury,
      },
    };
    save();

    await handOff(tokenD.contract, `${p.symbol} (token)`);
    await handOff(offeringD.contract, `${p.symbol} (oferta)`);
    save();
  }

  await handOff(registry, "IdentityRegistry");
  save();

  // ─── deployments.json do front ────────────────────────────────────────────────────────────
  let webFile: string | undefined;
  if (opts.webFile !== null) {
    webFile = opts.webFile ?? DEFAULT_WEB_DEPLOYMENTS_FILE;
    mergeWebDeployments(webFile, chainId, toWebDeployment(record));
    log(`front: ${webFile} atualizado (chainId ${chainId})`);
  } else if (isLocal) {
    log("front: deployments.json NÃO atualizado (rede local; use WRITE_WEB_DEPLOYMENTS=true para forçar)");
  }

  if (record.pendingAdminTransfers.length) {
    const when = Math.max(...record.pendingAdminTransfers.map((p) => p.acceptAfter));
    log(
      `\n⚠ A Safe ${admin} precisa chamar acceptDefaultAdminTransfer() em ${record.pendingAdminTransfers.length} contratos ` +
        `a partir de ${new Date(when * 1000).toISOString()} (npm run admin:accept gera o lote para o Transaction Builder). ` +
        `Até lá o deployer continua admin: guarde a chave com cuidado.`,
    );
  }
  return { record, recordFile, webFile };
}
