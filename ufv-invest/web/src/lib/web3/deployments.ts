import { getAddress, isAddress, type Address } from "viem";
import raw from "@/data/deployments.json";
import { TARGET_CHAIN_ID } from "./chains";

/**
 * Endereços dos contratos implantados (gerado pelo script de deploy em contracts/).
 * É a ÚNICA fonte de endereços que o app usa para transações — nunca endereços vindos de
 * parâmetros de URL, API ou entrada do usuário (allowlist contra phishing/troca de contrato).
 */
type NetworkDeployment = {
  identityRegistry?: string;
  paymentToken?: string;
  paymentTokenDecimals?: number;
  plants?: Record<string, { token?: string; offering?: string }>;
};

const all = raw as Record<string, NetworkDeployment>;

function addr(a?: string): Address | undefined {
  return a && isAddress(a) ? getAddress(a) : undefined;
}

export interface PlantContracts {
  chainId: 56 | 97;
  token: Address;
  offering?: Address;
  identityRegistry?: Address;
  paymentToken?: Address;
  paymentTokenDecimals: number;
}

export function networkDeployment(chainId: number = TARGET_CHAIN_ID) {
  const n = all[String(chainId)];
  return {
    identityRegistry: addr(n?.identityRegistry),
    paymentToken: addr(n?.paymentToken),
    paymentTokenDecimals: n?.paymentTokenDecimals ?? 18,
  };
}

export function plantContracts(slug: string, chainId: number = TARGET_CHAIN_ID): PlantContracts | null {
  const n = all[String(chainId)];
  const p = n?.plants?.[slug];
  const token = addr(p?.token);
  if (!n || !token) return null;
  return {
    chainId: chainId as 56 | 97,
    token,
    offering: addr(p?.offering),
    identityRegistry: addr(n.identityRegistry),
    paymentToken: addr(n.paymentToken),
    paymentTokenDecimals: n.paymentTokenDecimals ?? 18,
  };
}

export function deployedSlugs(chainId: number = TARGET_CHAIN_ID): string[] {
  return Object.entries(all[String(chainId)]?.plants ?? {})
    .filter(([, v]) => addr(v.token))
    .map(([k]) => k);
}
