import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runAssistant } from "../src/lib/assistant/agent";
import { codeOk } from "../src/lib/assistant/guard";
import type { ChatFn, ChatRequest } from "../src/lib/assistant/groq";
import { cacheClear, compact, compactHistory, DOMAIN_LIST, routeDomains, toolsFor } from "../src/lib/assistant/harness";
import { classify, makeChat, providerChain, requestBody, resetCooling } from "../src/lib/assistant/llm";
import type { AssetCtx, AssistantDeps } from "../src/lib/assistant/tools";
import { pcmToWav, ttsProvider, ttsRequest } from "../src/lib/assistant/tts";
import { pickVoice } from "../src/lib/assistant/speech";
import { speechChunks } from "../src/lib/assistant/voice";
import { IARA_SENHA } from "../src/lib/assistant/access";
import type { CarteiraGD } from "../src/lib/gd/types";
import { GroqError } from "../src/lib/assistant/groq";

const ASSET: AssetCtx = { name: "BESS", sub: "SE", pow: 100, cap: 400, rte: 88, deg: 0.5, lcos: 312.45, wacc: 10, life: 20, opex: 2, ref: 1, maxc: 1, days: 365 };
const NOW = Date.UTC(2026, 10, 3, 15, 0);
const deps = { dataMode: () => "live" } as unknown as AssistantDeps;
const CARTEIRA: CarteiraGD = {
  usinas: [],
  ucs: [],
  faturas: [
    { id: "a", uc: "77", ref: "2026-08", enquadramento: "GD II", ligacao: "bi", consumoKwh: 420, compensadaKwh: 300, injetadaKwh: 380, saldoKwh: 150, energiaRs: 370, totalRs: 160, confianca: 1, faltando: [] },
    { id: "b", uc: "77", ref: "2026-09", enquadramento: "GD II", ligacao: "bi", consumoKwh: 400, compensadaKwh: 350, injetadaKwh: 390, saldoAnteriorKwh: 150, saldoKwh: 190, totalRs: 150, confianca: 1, faltando: [] },
  ],
};
const tokens = (r: ChatRequest) => JSON.stringify(r.tools ?? []).length;

const ENV_KEYS = ["GROQ_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY", "MOONSHOT_API_KEY", "IARA_API_KEY", "IARA_PROVIDERS", "GROQ_MODEL", "TTS_PROVIDER", "TTS_BASE_URL", "TTS_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION", "ASSISTANT_ACCESS_CODE", "ASSISTANT_SIMPLE_CODE"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  cacheClear();
  resetCooling();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("roteamento de ferramentas (economia de tokens)", () => {
  it("cada assunto carrega só as suas ferramentas, com a meta-ferramenta para abrir outras", () => {
    expect(routeDomains(["qual o PLD agora?"])).toContain("mercado");
    expect(routeDomains(["qual o PLD agora?"])).not.toContain("gd");
    expect(routeDomains(["confere minhas faturas de energia"])).toEqual(["gd"]);
    expect(routeDomains(["oi"], "/gd")).toContain("gd");
    expect(routeDomains(["te explico o PLD de hoje"])).not.toContain("gd"); // "te" é pronome, não tarifa
    expect(routeDomains(["a fonte solar paga fio b?"])).toEqual(["gd"]);
    expect(routeDomains(["qual a economia assegurada da UC 77?"])).toEqual(["gd"]);
    expect(routeDomains(["bom dia"])).toEqual(["mercado", "hidro", "dados", "regulatorio"]);
    const gd = toolsFor(["gd"]).map((t) => t.function.name);
    expect(gd).toEqual(expect.arrayContaining(["gd_conferir_faturas", "navegar", "carregar_ferramentas"]));
    expect(gd).not.toContain("pld_agora");
    const all = JSON.stringify(toolsFor(DOMAIN_LIST)).length;
    expect(JSON.stringify(toolsFor(["mercado"])).length).toBeLessThan(all * 0.4);
    expect(toolsFor(DOMAIN_LIST).map((t) => t.function.name)).not.toContain("carregar_ferramentas");
  });

  it("compacta resultados: arredonda, tira nulos, corta listas e respeita o teto", () => {
    const s = compact({ a: 1.23456, b: null, c: [], d: Array.from({ length: 100 }, (_, i) => i + 0.123456), e: "x".repeat(1000), f: { g: undefined, h: 12345.678 } }, 600);
    const o = JSON.parse(s.replace(/…\(cortado\)$/, ""));
    expect(o.a).toBe(1.23);
    expect(o).not.toHaveProperty("b");
    expect(o).not.toHaveProperty("c");
    expect(o.f.h).toBe(12346);
    expect(s.length).toBeLessThanOrEqual(600);
    expect(o.d.at(-1)).toMatch(/^…\+\d+$/);
  });

  it("histórico enxuto: turnos antigos resumidos, no máximo 10", () => {
    const msgs = Array.from({ length: 14 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `${i} ${"y".repeat(900)}` }));
    const h = compactHistory(msgs);
    expect(h).toHaveLength(10);
    expect(h[0].content!.length).toBeLessThanOrEqual(301);
    expect(h[9].content!.length).toBeGreaterThan(800);
  });
});

describe("harness da Iara", () => {
  it("GD: só ferramentas de GD no pedido, conferência em lote compacta, tokens somados e cache de resposta", async () => {
    const seen: ChatRequest[] = [];
    const chat: ChatFn = async (req) => {
      seen.push(structuredClone(req));
      if (seen.length === 1) return { model: "m", provider: "groq", usage: { prompt_tokens: 900, completion_tokens: 20, cached_tokens: 0 }, message: { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "gd_conferir_faturas", arguments: "{}" } }] } };
      return { model: "m", provider: "groq", usage: { prompt_tokens: 1300, completion_tokens: 80, cached_tokens: 800 }, message: { role: "assistant", content: "Há 1 indício alto." } };
    };
    const req = { messages: [{ role: "user" as const, content: "confere minhas faturas" }], asset: ASSET, gd: CARTEIRA };
    const out = await runAssistant(req, deps, chat, NOW);
    expect(out.reply).toBe("Há 1 indício alto.");
    expect(out.dominios).toEqual(["gd"]);
    expect(out.usage).toEqual({ prompt: 2200, completion: 100, cached: 800, rounds: 2 });
    expect(seen[0].tools!.map((t) => t.function.name)).not.toContain("pld_agora");
    expect(seen[0].messages[0].content).toContain("Carteira GD do usuário: 2 fatura(s) de 1 UC(s)");
    const tool = JSON.parse(seen[1].messages.find((m) => m.role === "tool")!.content!);
    expect(tool.faturas).toBe(2);
    expect(tool.principais[0]).toHaveProperty("msg");
    // mesma pergunta em seguida: zero token
    const again = await runAssistant(req, deps, chat, NOW + 1000);
    expect(again.cache).toBe(true);
    expect(again.usage.prompt).toBe(0);
    expect(seen).toHaveLength(2);
  });

  it("carregar_ferramentas abre outro assunto na rodada seguinte", async () => {
    const seen: ChatRequest[] = [];
    const chat: ChatFn = async (req) => {
      seen.push(structuredClone(req));
      if (seen.length === 1) return { model: "m", usage: null, message: { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "carregar_ferramentas", arguments: '{"dominio":"rede"}' } }] } };
      return { model: "m", usage: null, message: { role: "assistant", content: "ok" } };
    };
    const out = await runAssistant({ messages: [{ role: "user", content: "bom dia" }], asset: ASSET }, deps, chat, NOW, { noCache: true });
    expect(seen[0].tools!.map((t) => t.function.name)).not.toContain("forca_da_rede");
    expect(seen[1].tools!.map((t) => t.function.name)).toContain("forca_da_rede");
    expect(out.dominios).toContain("rede");
    expect(tokens(seen[0])).toBeLessThan(tokens(seen[1]));
  });

  it("estourou o orçamento da pergunta ⇒ próxima rodada responde sem ferramentas", async () => {
    let n = 0;
    const chat: ChatFn = async (req) => {
      n++;
      if (!req.tools) return { model: "m", usage: { prompt_tokens: 10 }, message: { role: "assistant", content: "final" } };
      return { model: "m", usage: { prompt_tokens: 5000 }, message: { role: "assistant", content: null, tool_calls: [{ id: String(n), type: "function", function: { name: "gd_regras", arguments: '{"tema":"fio_b"}' } }] } };
    };
    const out = await runAssistant({ messages: [{ role: "user", content: "o que é fio b?" }], asset: ASSET }, deps, chat, NOW, { noCache: true, tokenBudget: 4000 });
    expect(out.reply).toBe("final");
    expect(n).toBe(2);
  });

  it("gd_registrar_uc pede confirmação (ação gd_uc), não grava sozinha", async () => {
    let n = 0;
    const chat: ChatFn = async () =>
      ++n === 1
        ? { model: "m", usage: null, message: { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "gd_registrar_uc", arguments: '{"uc":"77","contrato_tipo":"assinatura","desconto_pct":18}' } }] } }
        : { model: "m", usage: null, message: { role: "assistant", content: "Confirme no painel." } };
    const out = await runAssistant({ messages: [{ role: "user", content: "a UC 77 tem assinatura com 18% de desconto" }], asset: ASSET }, deps, chat, NOW, { noCache: true });
    expect(out.actions).toEqual([{ type: "gd_uc", confirm: true, label: "UC 77: contrato", patch: { uc: "77", contrato: { tipo: "assinatura", descontoPct: 18 } } }]);
  });
});

describe("cliente multi-provedor", () => {
  const okBody = (model: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ model, choices: [{ message: { role: "assistant", content: "ok" } }], ...extra }), { status: 200 });

  it("cadeia só com provedores configurados, na ordem pedida", () => {
    expect(providerChain()).toEqual([]);
    process.env.GEMINI_API_KEY = "g";
    process.env.GROQ_API_KEY = "q";
    expect(providerChain()).toEqual(["groq", "gemini"]);
    process.env.IARA_PROVIDERS = "gemini,groq";
    expect(providerChain()).toEqual(["gemini", "groq"]);
  });

  it("429 na Groq ⇒ próximo modelo (e o modelo fica de molho); 401 ⇒ próximo provedor", async () => {
    process.env.GROQ_API_KEY = "q";
    process.env.GEMINI_API_KEY = "g";
    const calls: string[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      calls.push(`${url.includes("groq") ? "groq" : "gemini"}:${b.model}`);
      if (b.model === "openai/gpt-oss-120b") return new Response(JSON.stringify({ error: { message: "Rate limit reached", code: "rate_limit_exceeded" } }), { status: 429, headers: { "retry-after": "30" } });
      if (url.includes("groq")) return new Response(JSON.stringify({ error: { message: "Invalid API Key", code: "invalid_api_key" } }), { status: 401 });
      return okBody(b.model, { usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 6 } } });
    }) as unknown as typeof fetch;
    const t = 1_000_000;
    const chat = makeChat({ fetchImpl: fake, now: () => t });
    const r = await chat({ messages: [{ role: "user", content: "oi" }] });
    expect(r.provider).toBe("gemini");
    expect(r.usage?.cached_tokens).toBe(6);
    expect(calls).toEqual(["groq:openai/gpt-oss-120b", "groq:llama-3.3-70b-versatile", "gemini:gemini-flash-latest"]);
    calls.length = 0;
    await chat({ messages: [{ role: "user", content: "oi" }] });
    expect(calls[0]).toBe("groq:llama-3.3-70b-versatile"); // gpt-oss-120b ainda no molho
  });

  it("Gemini: sem additionalProperties, max_tokens e raciocínio curto; Groq: max_completion_tokens", () => {
    const tools = toolsFor(["gd"]);
    const g = requestBody("gemini", "gemini-flash-latest", { messages: [{ role: "assistant", content: null }], tools, maxTokens: 300 });
    expect(JSON.stringify(g.tools)).not.toContain("additionalProperties");
    expect(g).toMatchObject({ max_tokens: 300, reasoning_effort: "low" });
    expect((g.messages as { content: string }[])[0].content).toBe("");
    expect(requestBody("gemini", "gemini-flash-lite-latest", { messages: [] })).not.toHaveProperty("reasoning_effort");
    expect(requestBody("groq", "openai/gpt-oss-120b", { messages: [], maxTokens: 300 })).toMatchObject({ max_completion_tokens: 300, reasoning_effort: "low" });
  });

  it("classifica erros: limite e modelo ⇒ próximo modelo; chave e rede ⇒ próximo provedor", () => {
    expect(classify(new GroqError("x", 429))).toBe("model");
    expect(classify(new GroqError("Request too large", 413))).toBe("model");
    expect(classify(new GroqError("x", 400, "tool_use_failed"))).toBe("model");
    expect(classify(new GroqError("x", 401))).toBe("provider");
    expect(classify(new GroqError("x", 504, "network"))).toBe("model");
    expect(classify(new GroqError("x", 418))).toBe("stop");
  });

  it("sem nenhum provedor ⇒ erro claro", async () => {
    await expect(makeChat()({ messages: [] })).rejects.toThrow(/nenhum provedor/);
  });
});

describe("senha simples e voz natural", () => {
  it("aceita o código da Vercel e, no modo de teste, a senha simples do front", () => {
    const req = (code?: string) => new Request("http://x", { headers: code ? { "x-assistente-code": code } : {} });
    expect(codeOk(req())).toBe(true); // sem ASSISTANT_ACCESS_CODE, servidor aberto (cotas seguem valendo)
    process.env.ASSISTANT_ACCESS_CODE = "codigo-longo-da-vercel";
    expect(codeOk(req())).toBe(false);
    expect(codeOk(req("codigo-longo-da-vercel"))).toBe(true);
    expect(codeOk(req(IARA_SENHA))).toBe(true);
    expect(IARA_SENHA).toBe("senha1234");
    expect(codeOk(req("senha1234"))).toBe(true);
    expect(codeOk(req("iara2026"))).toBe(false); // padronizada: só senha1234
    expect(codeOk(req("outra"))).toBe(false);
    process.env.ASSISTANT_SIMPLE_CODE = "off";
    expect(codeOk(req(IARA_SENHA))).toBe(false);
    expect(codeOk(req("codigo-longo-da-vercel"))).toBe(true);
  });

  it("escolhe o provedor de voz e monta o pedido (OpenVoice compatível com OpenAI, ElevenLabs, Azure)", () => {
    expect(ttsProvider()).toBeNull();
    process.env.TTS_BASE_URL = "https://voz.exemplo.hf.space";
    process.env.TTS_API_KEY = "k";
    expect(ttsProvider()).toBe("openai");
    const o = ttsRequest("openai", "Olá");
    expect(o.url).toBe("https://voz.exemplo.hf.space/v1/audio/speech");
    expect(JSON.parse(String(o.init.body))).toMatchObject({ input: "Olá", response_format: "mp3", model: "openvoice" });
    process.env.TTS_BASE_URL = "https://x/v1/";
    expect(ttsRequest("openai", "a").url).toBe("https://x/v1/audio/speech");
    process.env.AZURE_SPEECH_KEY = "a";
    process.env.AZURE_SPEECH_REGION = "brazilsouth";
    const az = ttsRequest("azure", "R$ 5 < 6 & mais");
    expect(az.url).toBe("https://brazilsouth.tts.speech.microsoft.com/cognitiveservices/v1");
    expect(String(az.init.body)).toContain("&lt; 6 &amp; mais");
    process.env.TTS_PROVIDER = "azure";
    expect(ttsProvider()).toBe("azure");
  });

  it("fala em blocos: o primeiro curto para começar logo, os seguintes juntam frases", () => {
    const c = speechChunks("O PLD do Sudeste está em 312 reais. A previsão para amanhã é de alta. O motivo é a afluência baixa no período seco. Quer que eu abra a tela?");
    expect(c[0]).toBe("O PLD do Sudeste está em 312 reais.");
    expect(c.length).toBeLessThan(4);
    expect(c.join(" ")).toContain("Quer que eu abra a tela?");
  });
});

describe("qualidade da voz", () => {
  it("escolhe a voz neural do sistema antes das compactas", () => {
    const v = (name: string) => ({ name, lang: "pt-BR", voiceURI: name });
    const voices = [v("Luciana"), v("Microsoft Daniel - Portuguese (Brazil)"), v("Google português do Brasil"), v("Microsoft Francisca Online (Natural) - Portuguese (Brazil)")];
    expect(pickVoice(voices)?.name).toContain("Natural");
    expect(pickVoice(voices.slice(0, 3))?.name).toBe("Google português do Brasil");
  });

  it("Gemini TTS: pedido com voz e estilo, resposta PCM vira WAV; ElevenLabs no modelo multilíngue", () => {
    process.env.GEMINI_API_KEY = "g";
    expect(ttsProvider()).toBe("gemini");
    const g = ttsRequest("gemini", "Olá");
    expect(g.url).toContain(":generateContent");
    const b = JSON.parse(String(g.init.body));
    expect(b.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(b.contents[0].parts[0].text).toContain("Olá");
    const wav = new Uint8Array(pcmToWav(new Uint8Array(480), 24000));
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(wav.length).toBe(524);
    process.env.TTS_PROVIDER = "off";
    expect(ttsProvider()).toBeNull();
    delete process.env.TTS_PROVIDER;
    process.env.ELEVENLABS_API_KEY = "e";
    process.env.ELEVENLABS_VOICE_ID = "v";
    expect(JSON.parse(String(ttsRequest("elevenlabs", "a").init.body)).model_id).toBe("eleven_multilingual_v2");
  });
});
