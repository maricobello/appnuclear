import "server-only";
import { cached } from "../cache";
import { recordProbe } from "../sources/http";

/**
 * Cliente mínimo da Groq (API compatível com OpenAI): chat com tool calling e
 * transcrição Whisper. A chave fica só no servidor (GROQ_API_KEY, variável Sensitive na
 * Vercel) — nunca no navegador nem no repositório. Modelos com fallback: se o configurado
 * for descontinuado (a Groq troca o catálogo com frequência), tenta o próximo da lista.
 */
export const GROQ_BASE = (process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/+$/, "");
export const groqConfigured = () => !!process.env.GROQ_API_KEY;

const CHAT_DEFAULTS = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b"];
const STT_DEFAULTS = ["whisper-large-v3-turbo", "whisper-large-v3"];
const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
export const chatModels = () => uniq([process.env.GROQ_MODEL, ...CHAT_DEFAULTS]);
export const sttModels = () => uniq([process.env.GROQ_STT_MODEL, ...STT_DEFAULTS]);

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxTokens?: number;
  temperature?: number;
}
export interface ChatResult {
  message: ChatMessage;
  model: string;
  usage: { prompt_tokens?: number; completion_tokens?: number } | null;
}
export type ChatFn = (req: ChatRequest) => Promise<ChatResult>;

export class GroqError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string | null = null,
    public retryAfterS: number | null = null,
  ) {
    super(message);
  }
}

/** Erros que dependem do modelo (descontinuado, inexistente, tool call malformada) ⇒ tenta o próximo. */
export const modelProblem = (e: GroqError) =>
  e.status === 404 || e.code === "model_not_found" || e.code === "model_decommissioned" || e.code === "tool_use_failed" || /model.*(decommission|not found|does not exist)/i.test(e.message);

async function groqError(res: Response): Promise<GroqError> {
  let msg = `HTTP ${res.status}`;
  let code: string | null = null;
  try {
    const j = (await res.json()) as { error?: { message?: string; code?: string; type?: string } };
    msg = j.error?.message ?? msg;
    code = j.error?.code ?? j.error?.type ?? null;
  } catch {
    /* corpo não-JSON */
  }
  const ra = Number(res.headers.get("retry-after"));
  return new GroqError(msg.slice(0, 300), res.status, code, Number.isFinite(ra) && ra > 0 ? ra : null);
}

async function groqFetch(path: string, init: RequestInit, timeoutMs: number, fetchImpl: typeof fetch): Promise<Response> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new GroqError("GROQ_API_KEY não configurada", 503, "not_configured");
  const url = `${GROQ_BASE}${path}`;
  const t0 = Date.now();
  try {
    const res = await fetchImpl(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(timeoutMs) });
    recordProbe({ url, status: res.status, ok: res.ok, latencyMs: Date.now() - t0, bytes: 0, at: t0 });
    return res;
  } catch (e) {
    recordProbe({ url, status: null, ok: false, latencyMs: Date.now() - t0, bytes: 0, at: t0, error: e instanceof Error ? e.message : String(e) });
    throw new GroqError(`Groq inacessível: ${e instanceof Error ? e.message : String(e)}`, 504, "network");
  }
}

export function makeGroqChat(fetchImpl: typeof fetch = fetch): ChatFn {
  return async ({ messages, tools, maxTokens = 900, temperature = 0.3 }) => {
    let last: GroqError | null = null;
    for (const model of chatModels()) {
      const body = {
        model,
        messages,
        ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
        temperature,
        max_completion_tokens: maxTokens,
        // raciocínio curto: respostas de voz precisam de baixa latência
        ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
      };
      const res = await groqFetch("/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, 30_000, fetchImpl);
      if (res.ok) {
        const j = (await res.json()) as { model?: string; choices?: { message?: ChatMessage }[]; usage?: ChatResult["usage"] };
        const message = j.choices?.[0]?.message;
        if (!message) throw new GroqError("resposta sem choices", 502, "bad_response");
        return { message: { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls }, model: j.model ?? model, usage: j.usage ?? null };
      }
      last = await groqError(res);
      if (!modelProblem(last)) throw last;
    }
    throw last ?? new GroqError("nenhum modelo disponível", 502, "no_model");
  };
}

/** Vocabulário do domínio: melhora a transcrição de siglas e termos técnicos. */
const STT_PROMPT = "PLD, CMO, CCEE, ONS, DESSEM, submercado Sudeste, Sul, Nordeste, Norte, BESS, bateria, megawatt, megawatt-hora, R$/MWh, EAR, ENA, reservatórios, TIR, payback, LCOS, spread, arbitragem.";

export async function groqTranscribe(audio: Blob, filename: string, fetchImpl: typeof fetch = fetch): Promise<{ text: string; model: string }> {
  let last: GroqError | null = null;
  for (const model of sttModels()) {
    const form = new FormData();
    form.append("file", audio, filename);
    form.append("model", model);
    form.append("language", "pt");
    form.append("response_format", "json");
    form.append("temperature", "0");
    form.append("prompt", STT_PROMPT);
    const res = await groqFetch("/audio/transcriptions", { method: "POST", body: form }, 30_000, fetchImpl);
    if (res.ok) {
      const j = (await res.json()) as { text?: string };
      return { text: (j.text ?? "").trim(), model };
    }
    last = await groqError(res);
    if (!modelProblem(last)) throw last;
  }
  throw last ?? new GroqError("nenhum modelo de transcrição disponível", 502, "no_model");
}

export interface GroqStatus {
  configured: boolean;
  online: boolean;
  latencyMs: number | null;
  /** Primeiro modelo de chat da lista que a conta enxerga. */
  model: string | null;
  sttModel: string | null;
  error: string | null;
  checkedAt: number;
}

/** Sonda leve (lista de modelos), cacheada 5 min: confirma chave válida e API no ar. */
export async function groqStatus(fetchImpl: typeof fetch = fetch): Promise<GroqStatus> {
  if (!groqConfigured()) return { configured: false, online: false, latencyMs: null, model: null, sttModel: null, error: "GROQ_API_KEY não configurada", checkedAt: Date.now() };
  const { value } = await cached("groq:status", 5 * 60_000, async (): Promise<GroqStatus> => {
    const t0 = Date.now();
    try {
      const res = await groqFetch("/models", { method: "GET" }, 10_000, fetchImpl);
      if (!res.ok) {
        const e = await groqError(res);
        return { configured: true, online: false, latencyMs: Date.now() - t0, model: null, sttModel: null, error: res.status === 401 ? "chave inválida ou revogada (401)" : e.message, checkedAt: Date.now() };
      }
      const ids = new Set(((await res.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? []);
      return {
        configured: true,
        online: true,
        latencyMs: Date.now() - t0,
        model: chatModels().find((m) => ids.has(m)) ?? null,
        sttModel: sttModels().find((m) => ids.has(m)) ?? null,
        error: null,
        checkedAt: Date.now(),
      };
    } catch (e) {
      return { configured: true, online: false, latencyMs: null, model: null, sttModel: null, error: e instanceof Error ? e.message : String(e), checkedAt: Date.now() };
    }
  });
  return value;
}
