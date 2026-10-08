import { z } from "zod";
import { runAssistant } from "@/lib/assistant/agent";
import { groqConfigured, groqStatus, GroqError, makeGroqChat } from "@/lib/assistant/groq";
import { buildTrustReport } from "@/lib/audit/trust-report";
import { accessCodeRequired, dailyLimit, guard } from "@/lib/assistant/guard";
import type { AssistantDeps } from "@/lib/assistant/tools";
import { dataMode, getBrazilBundle } from "@/lib/data";
import { getBessStudy, getForecast } from "@/lib/services";
import { publicForecast } from "@/lib/market/forecast";
import { SUBS } from "@/lib/sources/types";
import { listAuditRuns } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };

const deps: AssistantDeps = {
  brazil: async () => {
    const b = await getBrazilBundle();
    return { pld: b.pld, ear: b.ear, ena: b.ena, load: b.load };
  },
  forecast: async (sub) => {
    const { fc, simulated, fallback } = await getForecast(sub);
    return { fc: publicForecast(fc), simulated, fallback };
  },
  bess: (p) => getBessStudy(p),
  latestAudit: async () => (await listAuditRuns(1))[0] ?? null,
  trust: () => buildTrustReport(),
  dataMode,
};

const Asset = z.object({
  name: z.string().max(60).default("BESS"),
  sub: z.enum(SUBS).default("SE"),
  pow: z.number().min(1).max(2000).default(100),
  cap: z.number().min(1).max(8000).default(400),
  rte: z.number().min(50).max(99).default(88),
  deg: z.number().min(0).max(10).default(0.5),
  lcos: z.number().min(0).max(5000).default(312.45),
  wacc: z.number().min(0).max(30).default(10),
  life: z.number().min(5).max(40).default(20),
  opex: z.number().min(0).max(10).default(2),
  ref: z.number().min(0.25).max(3).default(1),
  maxc: z.number().min(0.25).max(3).default(1),
  days: z.number().int().min(30).max(365).default(365),
});

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(24)
    .refine((m) => m[m.length - 1].role === "user", "a última mensagem deve ser do usuário"),
  page: z.string().max(80).optional(),
  asset: Asset.default(Asset.parse({})),
  voice: z.boolean().optional(),
});

/** Estado da Iara: chave configurada, API da Groq no ar (sonda cacheada 5 min), modelos. */
export async function GET() {
  const s = await groqStatus();
  return Response.json({ ...s, provider: "groq", accessCodeRequired: accessCodeRequired(), dailyLimit: dailyLimit("chat") }, { headers: noStore });
}

export async function POST(req: Request) {
  if (!groqConfigured()) return Response.json({ error: "IA desligada: GROQ_API_KEY não configurada no servidor", code: "not_configured" }, { status: 503, headers: noStore });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "pedido inválido", code: "bad_request" }, { status: 400, headers: noStore });
  const blocked = await guard(req, "chat");
  if (blocked) return blocked;
  try {
    const out = await runAssistant(parsed.data, deps, makeGroqChat());
    return Response.json(out, { headers: noStore });
  } catch (e) {
    if (e instanceof GroqError) {
      const msg = e.status === 401 ? "a chave da Groq foi recusada (inválida ou revogada)" : e.status === 429 ? "limite de uso da Groq atingido — tente em instantes" : `Groq: ${e.message}`;
      return Response.json({ error: msg, code: e.code ?? "groq" }, { status: e.status === 429 ? 429 : 502, headers: noStore });
    }
    return Response.json({ error: e instanceof Error ? e.message : String(e), code: "internal" }, { status: 500, headers: noStore });
  }
}
