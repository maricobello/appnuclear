import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPlant } from "@/data/plants";
import { rateLimit } from "@/lib/rateLimit";
import { LOCALES } from "@/i18n/config";

/**
 * "Demonstrar interesse" / "Fale conosco": registra o contato e, se LEADS_WEBHOOK_URL estiver
 * configurado, encaminha ao CRM/back-office. Não cria obrigação nem reserva de cotas — a compra
 * só acontece pela carteira, no contrato da oferta. Dados mínimos (LGPD) e consentimento explícito.
 */
const Body = z.object({
  tipo: z.enum(["interesse", "suporte"]).default("interesse"),
  nome: z.string().trim().min(3).max(120),
  email: z.email().max(160),
  telefone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[\d\s()+-]*$/)
    .optional()
    .or(z.literal("")),
  usina: z.string().max(80).optional().or(z.literal("")),
  cotas: z.number().int().min(1).max(1_000_000).optional(),
  mensagem: z.string().trim().max(1000).optional().or(z.literal("")),
  aceite: z.literal(true),
  /** idioma da interface, para a equipe responder na língua do investidor */
  idioma: z.enum(LOCALES).optional(),
});

type Lead = z.infer<typeof Body> & { protocolo: string; at: string };
const store: Lead[] = [];

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "interesse", 5, 60_000);
  if (limited) return limited;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Confira os campos destacados.", issues: parsed.error.issues.map((i) => i.path.join(".")) }, { status: 400 });
  const b = parsed.data;
  const plant = b.usina ? getPlant(b.usina) : undefined;
  if (b.usina && !plant) return NextResponse.json({ error: "usina inválida", issues: ["usina"] }, { status: 400 });
  if (plant && b.cotas && b.cotas > plant.token.totalCotas) return NextResponse.json({ error: "quantidade acima do total de cotas", issues: ["cotas"] }, { status: 400 });

  const lead: Lead = { ...b, protocolo: `AF-${randomBytes(4).toString("hex").toUpperCase()}`, at: new Date().toISOString() };
  store.push(lead);
  if (store.length > 5000) store.shift();

  const hook = process.env.LEADS_WEBHOOK_URL;
  if (hook) {
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.LEADS_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.LEADS_WEBHOOK_TOKEN}` } : {}) },
      body: JSON.stringify(lead),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});
  }
  return NextResponse.json({ protocolo: lead.protocolo, at: lead.at });
}
