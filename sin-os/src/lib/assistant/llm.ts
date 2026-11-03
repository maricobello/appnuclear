import "server-only";
import { cached } from "../cache";
import { recordProbe } from "../sources/http";
import { chatModels, GroqError, groqStatus, type ChatFn, type ChatMessage, type ChatRequest, type ChatResult, type ToolDef } from "./groq";

/**
 * Cliente de chat multi-provedor (todos com API compatível com OpenAI): Groq, Gemini
 * (AI Studio), DeepSeek, OpenRouter, Moonshot (Kimi) ou um endpoint próprio. A cadeia é
 * percorrida em ordem: limite de taxa (429), pedido grande demais para a cota por minuto
 * (413), modelo fora do catálogo ou tool call malformada ⇒ próximo modelo; chave inválida,
 * rede fora ou erro de esquema ⇒ próximo provedor. Modelo em 429 fica de "molho" até o
 * Retry-After, para as próximas perguntas não perderem tempo com ele. Chaves só no servidor.
 */
export type ProviderId = "groq" | "gemini" | "deepseek" | "openrouter" | "moonshot" | "custom";

interface Preset {
  label: string;
  base: () => string;
  keyEnv: string;
  models: () => string[];
}

const uniq = (xs: (string | undefined)[]) => [...new Set(xs.map((x) => x?.trim()).filter((x): x is string => !!x))];
const envList = (name: string) => (process.env[name] ?? "").split(",");

export const PRESETS: Record<ProviderId, Preset> = {
  groq: { label: "Groq", base: () => process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", models: () => uniq([...envList("IARA_MODELS_GROQ"), ...chatModels()]) },
  gemini: { label: "Gemini", base: () => "https://generativelanguage.googleapis.com/v1beta/openai", keyEnv: "GEMINI_API_KEY", models: () => uniq([...envList("IARA_MODELS_GEMINI"), "gemini-flash-latest", "gemini-flash-lite-latest"]) },
  deepseek: { label: "DeepSeek", base: () => "https://api.deepseek.com/v1", keyEnv: "DEEPSEEK_API_KEY", models: () => uniq([...envList("IARA_MODELS_DEEPSEEK"), "deepseek-chat"]) },
  openrouter: { label: "OpenRouter", base: () => "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY", models: () => uniq([...envList("IARA_MODELS_OPENROUTER"), "moonshotai/kimi-k2:free", "deepseek/deepseek-chat-v3-0324:free"]) },
  moonshot: { label: "Moonshot", base: () => "https://api.moonshot.ai/v1", keyEnv: "MOONSHOT_API_KEY", models: () => uniq([...envList("IARA_MODELS_MOONSHOT"), "kimi-k2-0905-preview"]) },
  custom: { label: "Personalizado", base: () => process.env.IARA_BASE_URL ?? "", keyEnv: "IARA_API_KEY", models: () => uniq(envList("IARA_MODELS_CUSTOM")) },
};
const ORDER: ProviderId[] = ["groq", "gemini", "deepseek", "openrouter", "moonshot", "custom"];

const configured = (id: ProviderId) => !!process.env[PRESETS[id].keyEnv] && !!PRESETS[id].base() && PRESETS[id].models().length > 0;

/** Provedores na ordem de uso: IARA_PROVIDERS="groq,gemini" ou todos com chave. */
export function providerChain(): ProviderId[] {
  const wanted = envList("IARA_PROVIDERS")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ProviderId => (ORDER as string[]).includes(s));
  return (wanted.length ? wanted : ORDER).filter(configured);
}
export const llmConfigured = () => providerChain().length > 0;

const cooling = new Map<string, number>();
export const resetCooling = () => cooling.clear();

/** Gemini não aceita "additionalProperties" no esquema das funções. */
function stripSchema(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripSchema);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => k !== "additionalProperties").map(([k, x]) => [k, stripSchema(x)]));
  return v;
}

export function requestBody(p: ProviderId, model: string, req: ChatRequest): Record<string, unknown> {
  const messages: ChatMessage[] = p === "gemini" ? req.messages.map((m) => (m.content === null ? { ...m, content: "" } : m)) : req.messages;
  const b: Record<string, unknown> = { model, messages, temperature: req.temperature ?? 0.3 };
  if (req.tools?.length) {
    b.tools = p === "gemini" ? (req.tools.map(stripSchema) as ToolDef[]) : req.tools;
    b.tool_choice = "auto";
  }
  if (p === "groq") {
    b.max_completion_tokens = req.maxTokens ?? 900;
    if (model.startsWith("openai/gpt-oss")) b.reasoning_effort = "low";
  } else b.max_tokens = req.maxTokens ?? 900;
  // raciocínio curto: menos tokens e menos latência (o Flash-Lite já vem sem raciocínio)
  if (p === "gemini" && !/lite/.test(model)) b.reasoning_effort = "low";
  return b;
}

async function parseError(res: Response): Promise<GroqError> {
  let msg = `HTTP ${res.status}`;
  let code: string | null = null;
  try {
    const raw = await res.json();
    const j = (Array.isArray(raw) ? raw[0] : raw) as { error?: { message?: string; code?: string | number; type?: string; status?: string } };
    msg = j.error?.message ?? msg;
    code = (j.error?.code ?? j.error?.type ?? j.error?.status ?? null) as string | null;
    if (code !== null) code = String(code);
  } catch {
    /* corpo não-JSON */
  }
  const ra = Number(res.headers.get("retry-after"));
  return new GroqError(msg.slice(0, 300), res.status, code, Number.isFinite(ra) && ra > 0 ? ra : null);
}

type Next = "model" | "provider" | "stop";
export function classify(e: GroqError): Next {
  if (e.status === 429 || e.status === 413 || e.status >= 500) return "model";
  if (e.status === 404 || e.code === "model_not_found" || e.code === "model_decommissioned" || e.code === "tool_use_failed" || /model.*(decommission|not found|does not exist|not supported)/i.test(e.message)) return "model";
  if (e.status === 401 || e.status === 403 || e.status === 402 || e.code === "network") return "provider";
  if (e.status === 400) return "provider"; // esquema/parâmetro que outro provedor aceita
  return "stop";
}

export interface MultiChatOpts {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

export function makeChat(opts: MultiChatOpts = {}): ChatFn {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  return async (req: ChatRequest): Promise<ChatResult> => {
    const chain = providerChain();
    if (!chain.length) throw new GroqError("nenhum provedor de IA configurado (GROQ_API_KEY, GEMINI_API_KEY…)", 503, "not_configured");
    let first: GroqError | null = null;
    for (const p of chain) {
      const preset = PRESETS[p];
      const key = process.env[preset.keyEnv]!;
      const base = preset.base().replace(/\/+$/, "");
      for (const model of preset.models()) {
        const ck = `${p}:${model}`;
        if ((cooling.get(ck) ?? 0) > now()) continue;
        const url = `${base}/chat/completions`;
        const t0 = now();
        let res: Response;
        try {
          res = await fetchImpl(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify(requestBody(p, model, req)),
            signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
          });
          recordProbe({ url, status: res.status, ok: res.ok, latencyMs: now() - t0, bytes: 0, at: t0 });
        } catch (e) {
          recordProbe({ url, status: null, ok: false, latencyMs: now() - t0, bytes: 0, at: t0, error: e instanceof Error ? e.message : String(e) });
          first ??= new GroqError(`${preset.label} inacessível: ${e instanceof Error ? e.message : String(e)}`, 504, "network");
          break; // rede fora: o provedor inteiro
        }
        if (res.ok) {
          const j = (await res.json()) as {
            model?: string;
            choices?: { message?: ChatMessage }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; prompt_cache_hit_tokens?: number };
          };
          const message = j.choices?.[0]?.message;
          if (!message) {
            first ??= new GroqError("resposta sem choices", 502, "bad_response");
            continue;
          }
          const u = j.usage;
          return {
            message: { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls?.length ? message.tool_calls : undefined },
            model: j.model ?? model,
            provider: p,
            usage: u ? { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, cached_tokens: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens } : null,
          };
        }
        const err = await parseError(res);
        first ??= err;
        if (err.status === 429) cooling.set(ck, now() + (err.retryAfterS ?? 60) * 1000);
        const next = classify(err);
        if (next === "stop") throw err;
        if (next === "provider") break;
      }
    }
    throw first ?? new GroqError("nenhum modelo disponível agora (todos em limite de taxa)", 429, "rate_limit");
  };
}

export interface LlmStatus {
  configured: boolean;
  online: boolean;
  provider: string | null;
  providers: string[];
  model: string | null;
  latencyMs: number | null;
  error: string | null;
}

/** Sonda leve do primeiro provedor da cadeia (lista de modelos), cacheada 5 min. */
export async function llmStatus(fetchImpl: typeof fetch = fetch): Promise<LlmStatus> {
  const chain = providerChain();
  const providers = chain.map((p) => PRESETS[p].label);
  if (!chain.length) return { configured: false, online: false, provider: null, providers, model: null, latencyMs: null, error: "nenhuma chave de IA configurada no servidor", };
  const p = chain[0];
  if (p === "groq") {
    const g = await groqStatus(fetchImpl);
    return { configured: true, online: g.online, provider: "Groq", providers, model: g.model, latencyMs: g.latencyMs, error: g.error };
  }
  const { value } = await cached(`llm:status:${p}`, 5 * 60_000, async (): Promise<LlmStatus> => {
    const t0 = Date.now();
    try {
      const res = await fetchImpl(`${PRESETS[p].base().replace(/\/+$/, "")}/models`, { headers: { Authorization: `Bearer ${process.env[PRESETS[p].keyEnv]}` }, signal: AbortSignal.timeout(10_000) });
      const ok = res.ok;
      return { configured: true, online: ok, provider: PRESETS[p].label, providers, model: PRESETS[p].models()[0] ?? null, latencyMs: Date.now() - t0, error: ok ? null : res.status === 401 ? "chave inválida (401)" : `HTTP ${res.status}` };
    } catch (e) {
      return { configured: true, online: false, provider: PRESETS[p].label, providers, model: null, latencyMs: null, error: e instanceof Error ? e.message : String(e) };
    }
  });
  return value;
}
