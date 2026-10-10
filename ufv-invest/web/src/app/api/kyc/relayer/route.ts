import { NextResponse } from "next/server";
import { relayerInfo } from "@/lib/web3/relayer";

/**
 * Dados públicos do relayer de KYC da testnet (endereço, se tem COMPLIANCE_ROLE e saldo para gás).
 * Usado no deploy dos contratos (para dar o papel ao relayer) e no monitoramento. Nunca expõe a chave.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await relayerInfo(), { headers: { "Cache-Control": "no-store" } });
}
