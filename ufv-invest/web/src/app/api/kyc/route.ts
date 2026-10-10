import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { keyedHash } from "@/lib/auth/token";
import { isValidCpf, maskCpf } from "@/lib/cpf";
import { rateLimit } from "@/lib/rateLimit";
import { isKycCountry, KYC_COUNTRIES } from "@/lib/countries";
import { approveInvestorOnChain } from "@/lib/web3/relayer";

// a aprovação on-chain da testnet espera 1 confirmação (alguns segundos)
export const maxDuration = 30;

/**
 * Solicitação de KYC vinculada à carteira autenticada por SIWE.
 *
 * Demonstração: guarda o pedido em memória (dados mínimos, CPF mascarado + hash com sal) e,
 * se KYC_WEBHOOK_URL estiver configurado, encaminha ao back-office/provedor de KYC (ex.: idwall,
 * unico, Sumsub) — que valida documentos e biometria. A aprovação é registrada on-chain pelo
 * papel COMPLIANCE no IdentityRegistry (script contracts/scripts/admin). LGPD: nada de CPF
 * em claro em log; a base legal e o aviso de privacidade devem acompanhar o formulário.
 *
 * Testnet: o relayer do site (lib/web3/relayer) aprova na hora, para o fluxo de investimento de
 * demonstração funcionar de ponta a ponta. Na rede principal o relayer não existe.
 */
const Body = z
  .object({
    nome: z.string().trim().min(5).max(120),
    /** residentes no Brasil: CPF; demais países: passaporte */
    cpf: z.string().trim().min(11).max(14).optional(),
    passaporte: z
      .string()
      .trim()
      .min(5)
      .max(20)
      .regex(/^[A-Za-z0-9-]+$/)
      .optional(),
    email: z.email().max(160),
    pais: z.string().refine(isKycCountry).default("BR"),
    aceite: z.literal(true),
  })
  .refine((b) => (b.pais === "BR" ? Boolean(b.cpf) : Boolean(b.passaporte)), { path: ["documento"] });

type KycRequest = {
  address: string;
  nome: string;
  docTipo: "cpf" | "passaporte";
  docMasked: string;
  docHash: string;
  email: string;
  pais: string;
  at: string;
  status: "pendente" | "aprovado";
  txHash?: string;
};

function maskPassport(v: string) {
  const c = v.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return c.length > 4 ? `${"*".repeat(c.length - 3)}${c.slice(-3)}` : "***";
}
const store = new Map<string, KycRequest>();

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "faça login com a carteira (SIWE)" }, { status: 401 });
  const r = store.get(s.address.toLowerCase());
  return NextResponse.json(r ? { status: r.status, at: r.at, nome: r.nome, docTipo: r.docTipo, doc: r.docMasked, txHash: r.txHash } : { status: "nenhum" }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "kyc", 5, 60_000);
  if (limited) return limited;
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "faça login com a carteira (SIWE)" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "dados inválidos", issues: parsed.error.issues.map((i) => i.path.join(".")) }, { status: 400 });
  const b = parsed.data;
  const isBr = b.pais === "BR";
  if (isBr && !isValidCpf(b.cpf ?? "")) return NextResponse.json({ error: "CPF inválido", issues: ["cpf"] }, { status: 400 });
  const docRaw = isBr ? (b.cpf ?? "").replace(/\D/g, "") : (b.passaporte ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

  const record: KycRequest = {
    address: s.address,
    nome: b.nome,
    docTipo: isBr ? "cpf" : "passaporte",
    docMasked: isBr ? maskCpf(docRaw) : maskPassport(docRaw),
    docHash: keyedHash(isBr ? "cpf" : `passaporte:${b.pais}`, docRaw),
    email: b.email,
    pais: b.pais,
    at: new Date().toISOString(),
    status: "pendente",
  };
  store.set(s.address.toLowerCase(), record);

  const hook = process.env.KYC_WEBHOOK_URL;
  if (hook) {
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.KYC_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.KYC_WEBHOOK_TOKEN}` } : {}) },
      body: JSON.stringify({ ...record, documento: docRaw }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});
  }

  // testnet: aprovação imediata on-chain pelo relayer do site (na rede principal fica "pendente")
  const onchain = await approveInvestorOnChain(s.address, KYC_COUNTRIES[b.pais as keyof typeof KYC_COUNTRIES]);
  if (onchain.status !== "unavailable") {
    record.status = "aprovado";
    if (onchain.status === "approved") record.txHash = onchain.txHash;
    store.set(s.address.toLowerCase(), record);
  }
  return NextResponse.json({ status: record.status, at: record.at, txHash: record.txHash, onchain: onchain.status, reason: onchain.status === "unavailable" ? onchain.reason : undefined });
}
