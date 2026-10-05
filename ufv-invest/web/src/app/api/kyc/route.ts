import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { keyedHash } from "@/lib/auth/token";
import { isValidCpf, maskCpf } from "@/lib/cpf";
import { rateLimit } from "@/lib/rateLimit";

/**
 * Solicitação de KYC vinculada à carteira autenticada por SIWE.
 *
 * Demonstração: guarda o pedido em memória (dados mínimos, CPF mascarado + hash com sal) e,
 * se KYC_WEBHOOK_URL estiver configurado, encaminha ao back-office/provedor de KYC (ex.: idwall,
 * unico, Sumsub) — que valida documentos e biometria. A aprovação é registrada on-chain pelo
 * papel COMPLIANCE no IdentityRegistry (script contracts/scripts/admin). LGPD: nada de CPF
 * em claro em log; a base legal e o aviso de privacidade devem acompanhar o formulário.
 */
const Body = z.object({
  nome: z.string().trim().min(5).max(120),
  cpf: z.string().trim().min(11).max(14),
  email: z.email().max(160),
  pais: z.string().length(2).default("BR"),
  aceite: z.literal(true),
});

type KycRequest = { address: string; nome: string; cpfMasked: string; cpfHash: string; email: string; pais: string; at: string; status: "pendente" };
const store = new Map<string, KycRequest>();

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "faça login com a carteira (SIWE)" }, { status: 401 });
  const r = store.get(s.address.toLowerCase());
  return NextResponse.json(r ? { status: r.status, at: r.at, nome: r.nome, cpf: r.cpfMasked } : { status: "nenhum" }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "kyc", 5, 60_000);
  if (limited) return limited;
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "faça login com a carteira (SIWE)" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "dados inválidos", issues: parsed.error.issues.map((i) => i.path.join(".")) }, { status: 400 });
  const b = parsed.data;
  if (!isValidCpf(b.cpf)) return NextResponse.json({ error: "CPF inválido" }, { status: 400 });

  const record: KycRequest = {
    address: s.address,
    nome: b.nome,
    cpfMasked: maskCpf(b.cpf),
    cpfHash: keyedHash("cpf", b.cpf.replace(/\D/g, "")),
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
      body: JSON.stringify({ ...record, cpf: b.cpf.replace(/\D/g, "") }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});
  }
  return NextResponse.json({ status: record.status, at: record.at });
}
