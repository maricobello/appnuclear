import fs from "node:fs";
import path from "node:path";

/** Caminho padrão do arquivo consumido pelo front (web/src/data/deployments.json). */
export const DEFAULT_WEB_DEPLOYMENTS_FILE = path.resolve(__dirname, "../../../web/src/data/deployments.json");
/** Pasta com o registro detalhado por rede (argumentos de construtor, txs) — usado por verify/admin. */
export const DEPLOYMENTS_DIR = path.resolve(__dirname, "../../deployments");

export const BSC_USDT_MAINNET = "0x55d398326f99059fF775485246999027B3197955";

export interface ContractRecord {
  address: string;
  /** argumentos de construtor (bigints como string decimal) — para verificação no BscScan */
  args: unknown[];
  txHash?: string;
  blockNumber?: number;
}

export interface PlantRecord {
  token: ContractRecord;
  offering: ContractRecord;
  params: Record<string, string>;
}

export interface NetworkRecord {
  chainId: number;
  network: string;
  deployer: string;
  admin: string;
  distributor: string;
  compliance: string;
  updatedAt: string;
  identityRegistry?: ContractRecord;
  paymentToken?: ContractRecord & { decimals: number; symbol: string; mock: boolean };
  plants: Record<string, PlantRecord>;
  /** transferências de admin iniciadas que a Safe ainda precisa aceitar */
  pendingAdminTransfers: { contract: string; address: string; newAdmin: string; acceptAfter: number }[];
}

/** Formato do web/src/data/deployments.json (contrato com o front). */
export interface WebNetworkDeployment {
  identityRegistry?: string;
  paymentToken?: string;
  paymentTokenDecimals?: number;
  plants?: Record<string, { token?: string; offering?: string }>;
}
export type WebDeployments = Record<string, WebNetworkDeployment>;

export function recordPath(chainId: number, dir = DEPLOYMENTS_DIR): string {
  return path.join(dir, `${chainId}.json`);
}

export function readRecord(file: string): NetworkRecord | undefined {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")) as NetworkRecord;
}

export function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, bigintReplacer, 2) + "\n");
  fs.renameSync(tmp, file); // escrita atômica: nunca deixa o JSON pela metade
}

export function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

/**
 * Mescla os endereços de uma rede no deployments.json do front, preservando as outras redes e
 * as outras usinas já registradas.
 */
export function mergeWebDeployments(file: string, chainId: number, update: WebNetworkDeployment): WebDeployments {
  const current: WebDeployments = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8") || "{}") : {};
  const key = String(chainId);
  const prev = current[key] ?? {};
  current[key] = {
    ...prev,
    ...(update.identityRegistry ? { identityRegistry: update.identityRegistry } : {}),
    ...(update.paymentToken ? { paymentToken: update.paymentToken } : {}),
    ...(update.paymentTokenDecimals !== undefined ? { paymentTokenDecimals: update.paymentTokenDecimals } : {}),
    plants: { ...(prev.plants ?? {}), ...(update.plants ?? {}) },
  };
  writeJson(file, current);
  return current;
}

/** Projeção do registro detalhado para o formato do front. */
export function toWebDeployment(record: NetworkRecord): WebNetworkDeployment {
  return {
    identityRegistry: record.identityRegistry?.address,
    paymentToken: record.paymentToken?.address,
    paymentTokenDecimals: record.paymentToken?.decimals,
    plants: Object.fromEntries(
      Object.entries(record.plants).map(([slug, p]) => [slug, { token: p.token.address, offering: p.offering.address }]),
    ),
  };
}
