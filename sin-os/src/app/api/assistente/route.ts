import { z } from "zod";
import { runAssistant } from "@/lib/assistant/agent";
import { groqConfigured, GroqError } from "@/lib/assistant/groq";
import { llmConfigured, llmStatus, makeChat } from "@/lib/assistant/llm";
import { TTS_LABEL, ttsProvider } from "@/lib/assistant/tts";
import { CARTEIRA_GD } from "@/lib/gd/types";
import { addDailyCounter, readDailyCounter } from "@/lib/store";
import { buildRenewablesReport } from "@/lib/market/renewables-report";
import { buildTrustReport } from "@/lib/audit/trust-report";
import { accessCodeRequired, dailyLimit, guard, simpleCodeEnabled } from "@/lib/assistant/guard";
import type { AssistantDeps } from "@/lib/assistant/tools";
import { dataMode, getBrazilBundle } from "@/lib/data";
import { getBessStudy, getForecast } from "@/lib/services";
import { publicForecast } from "@/lib/market/forecast";
import { SUBS } from "@/lib/sources/types";
import { listAuditRuns } from "@/lib/store";
import { planAgeDays } from "@/lib/planning/report";
import { loadPlanReport } from "@/lib/planning/store";
import { snapshotAgeDays } from "@/lib/grid/snapshot";
import { loadGridSnapshot } from "@/lib/grid/store";
import { brtDate } from "@/lib/sources/time";
import { bandeiraVigente, componentes, distribuidoras, tarifaVigente, ufDistribuidoras } from "@/lib/sources/aneel";

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
  renewables: (days) => buildRenewablesReport(days),
  plan: async () => {
    const { report } = await loadPlanReport();
    return { report, ageDays: report ? planAgeDays(report) : null };
  },
  grid: async () => {
    const { snapshot } = await loadGridSnapshot();
    return { snapshot, ageDays: snapshot ? snapshotAgeDays(snapshot.date, brtDate(Date.now())) : null };
  },
  dataMode,
  tarifas: { agentes: distribuidoras, vigente: (a, s) => tarifaVigente(a, s), componentes, bandeira: bandeiraVigente, uf: ufDistribuidoras },
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
  gd: CARTEIRA_GD.optional(),
});

/** Teto diário de tokens (todas as perguntas somadas): protege a cota gratuita do provedor. */
const DAILY_TOKENS = () => Number(process.env.IARA_DAILY_TOKENS) || 600_000;

/** Estado da Iara: provedores configurados, o primeiro no ar (sonda cacheada 5 min), voz e tokens do dia. */
export async function GET() {
  const [s, tokensHoje] = await Promise.all([llmStatus(), readDailyCounter("iara_tokens").catch(() => 0)]);
  const tts = ttsProvider();
  return Response.json(
    {
      ...s,
      sttModel: groqConfigured() ? "whisper" : null,
      voz: groqConfigured(),
      tts: tts ? TTS_LABEL[tts] : null,
      accessCodeRequired: accessCodeRequired(),
      senhaSimples: simpleCodeEnabled(),
      dailyLimit: dailyLimit("chat"),
      tokensHoje,
      tokensLimite: DAILY_TOKENS(),
    },
    { headers: noStore },
  );
}

export async function POST(req: Request) {
  if (!llmConfigured()) return Response.json({ error: "IA desligada: nenhuma chave (GROQ_API_KEY, GEMINI_API_KEY…) configurada no servidor", code: "not_configured" }, { status: 503, headers: noStore });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "pedido inválido", code: "bad_request" }, { status: 400, headers: noStore });
  const blocked = await guard(req, "chat");
  if (blocked) return blocked;
  const used = await readDailyCounter("iara_tokens").catch(() => 0);
  if (used >= DAILY_TOKENS())
    return Response.json({ error: `orçamento diário de tokens da Iara atingido (${used.toLocaleString("pt-BR")}). As telas e a conferência de faturas seguem funcionando sem IA.`, code: "token_budget" }, { status: 429, headers: noStore });
  const t0 = Date.now();
  try {
    const out = await runAssistant(parsed.data, deps, makeChat());
    const spent = out.usage.prompt + out.usage.completion;
    if (spent) await addDailyCounter("iara_tokens", spent).catch(() => undefined);
    console.log(JSON.stringify({ iara: 1, provider: out.provider, model: out.model, rounds: out.usage.rounds, prompt: out.usage.prompt, completion: out.usage.completion, cached: out.usage.cached, cache: !!out.cache, dominios: out.dominios, tools: out.tools.map((t) => t.name), ms: Date.now() - t0 }));
    return Response.json(out, { headers: noStore });
  } catch (e) {
    if (e instanceof GroqError) {
      const msg = e.status === 401 ? "a chave do provedor de IA foi recusada (inválida ou revogada)" : e.status === 429 ? "limite de uso dos provedores de IA atingido — tente em instantes" : `IA: ${e.message}`;
      return Response.json({ error: msg, code: e.code ?? "llm" }, { status: e.status === 429 ? 429 : 502, headers: noStore });
    }
    return Response.json({ error: e instanceof Error ? e.message : String(e), code: "internal" }, { status: 500, headers: noStore });
  }
}
