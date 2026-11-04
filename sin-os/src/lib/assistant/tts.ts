import "server-only";
import { recordProbe } from "../sources/http";

/**
 * Voz natural da Iara (texto → áudio no servidor). Provedores:
 *  - "openai": qualquer servidor compatível com POST /v1/audio/speech — o servidor
 *    OpenVoice deste repositório (voz-server/), Kokoro-FastAPI, Chatterbox etc.
 *    (TTS_BASE_URL, TTS_API_KEY, TTS_MODEL, TTS_VOICE);
 *  - "elevenlabs": ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID;
 *  - "azure": AZURE_SPEECH_KEY + AZURE_SPEECH_REGION (vozes neurais pt-BR).
 * Sem nenhum configurado, o navegador segue com a voz do sistema. Chaves só no servidor.
 */
export type TtsProvider = "openai" | "elevenlabs" | "azure" | "gemini";

export function ttsProvider(): TtsProvider | null {
  const want = (process.env.TTS_PROVIDER ?? "").toLowerCase();
  const ok: Record<TtsProvider, boolean> = {
    openai: !!process.env.TTS_BASE_URL,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY && !!process.env.ELEVENLABS_VOICE_ID,
    azure: !!process.env.AZURE_SPEECH_KEY && !!process.env.AZURE_SPEECH_REGION,
    // Gemini TTS: a mesma chave do AI Studio usada como reserva do chat (TTS_PROVIDER=off desliga)
    gemini: !!process.env.GEMINI_API_KEY,
  };
  if (want === "off") return null;
  if (want in ok) return ok[want as TtsProvider] ? (want as TtsProvider) : null;
  return (["openai", "elevenlabs", "azure", "gemini"] as TtsProvider[]).find((p) => ok[p]) ?? null;
}

export const TTS_LABEL: Record<TtsProvider, string> = { openai: "OpenVoice/servidor próprio", elevenlabs: "ElevenLabs", azure: "Azure Neural", gemini: "Gemini TTS" };

/** Modelos de voz do Gemini, do melhor para o reserva (TTS_GEMINI_MODEL na frente). */
export const geminiTtsModels = () => [...new Set([process.env.TTS_GEMINI_MODEL, "gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"].filter((x): x is string => !!x))];

/** PCM 16 bits mono → WAV (o Gemini devolve áudio cru em base64). */
export function pcmToWav(pcm: Uint8Array, rate = 24000): ArrayBuffer {
  const buf = new ArrayBuffer(44 + pcm.length);
  const v = new DataView(buf);
  const w = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, pcm.length, true);
  new Uint8Array(buf, 44).set(pcm);
  return buf;
}

export class TtsError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function ttsRequest(p: TtsProvider, text: string): { url: string; init: RequestInit } {
  if (p === "openai") {
    const base = process.env.TTS_BASE_URL!.replace(/\/+$/, "");
    const url = /\/v1$/.test(base) ? `${base}/audio/speech` : `${base}/v1/audio/speech`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.TTS_API_KEY) headers.Authorization = `Bearer ${process.env.TTS_API_KEY}`;
    const model = process.env.TTS_MODEL || "openvoice";
    const body: Record<string, unknown> = { model, voice: process.env.TTS_VOICE || "iara", input: text, response_format: "mp3", speed: Number(process.env.TTS_SPEED) || 1.0 };
    // modelos com direção de voz (ex.: gpt-4o-mini-tts): sotaque e tom pedidos por texto
    if (/gpt-4o|tts-2/.test(model)) body.instructions = process.env.TTS_INSTRUCOES || "Fale em português do Brasil, com sotaque brasileiro, tom caloroso e natural, ritmo de conversa.";
    return { url, init: { method: "POST", headers, body: JSON.stringify(body) } };
  }
  if (p === "gemini") {
    const model = geminiTtsModels()[0];
    const estilo = process.env.TTS_INSTRUCOES || "Diga em português do Brasil, com voz natural, calorosa e ritmo de conversa:";
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
        body: JSON.stringify({ contents: [{ parts: [{ text: `${estilo} ${text}` }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.TTS_VOICE || "Kore" } } } } }),
      },
    };
  }
  if (p === "elevenlabs") {
    const voice = encodeURIComponent(process.env.ELEVENLABS_VOICE_ID!);
    return {
      url: `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": process.env.ELEVENLABS_API_KEY! },
        body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } }),
      },
    };
  }
  const region = process.env.AZURE_SPEECH_REGION!;
  const voice = process.env.AZURE_TTS_VOICE || "pt-BR-ThalitaMultilingualNeural";
  const ssml = `<speak version="1.0" xml:lang="pt-BR"><voice name="${xml(voice)}"><prosody rate="+4%">${xml(text)}</prosody></voice></speak>`;
  return {
    url: `https://${encodeURIComponent(region)}.tts.speech.microsoft.com/cognitiveservices/v1`,
    init: { method: "POST", headers: { "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY!, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-48khz-192kbitrate-mono-mp3", "User-Agent": "sinos-iara" }, body: ssml },
  };
}

export async function synthesize(text: string, fetchImpl: typeof fetch = fetch): Promise<{ audio: ArrayBuffer; type: string; provider: TtsProvider }> {
  const p = ttsProvider();
  if (!p) throw new TtsError("voz natural não configurada no servidor", 503);
  const { url, init } = ttsRequest(p, text);
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(p === "openai" ? 45_000 : 20_000) });
  } catch (e) {
    recordProbe({ url, status: null, ok: false, latencyMs: Date.now() - t0, bytes: 0, at: t0, error: e instanceof Error ? e.message : String(e) });
    throw new TtsError(`servidor de voz inacessível: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200), 504);
  }
  recordProbe({ url, status: res.status, ok: res.ok, latencyMs: Date.now() - t0, bytes: 0, at: t0 });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 200);
    throw new TtsError(`voz (${TTS_LABEL[p]}) respondeu HTTP ${res.status}${body ? `: ${body}` : ""}`, res.status === 429 ? 429 : 502);
  }
  if (p === "gemini") {
    const j = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] } | null;
    const part = j?.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data)?.inlineData;
    if (!part?.data) throw new TtsError("Gemini TTS sem áudio na resposta", 502);
    const rate = Number(/rate=(\d+)/.exec(part.mimeType ?? "")?.[1]) || 24000;
    return { audio: pcmToWav(new Uint8Array(Buffer.from(part.data, "base64")), rate), type: "audio/wav", provider: p };
  }
  const audio = await res.arrayBuffer();
  if (audio.byteLength < 200) throw new TtsError("voz devolveu áudio vazio", 502);
  return { audio, type: res.headers.get("content-type")?.split(";")[0] || "audio/mpeg", provider: p };
}
