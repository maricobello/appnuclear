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
export type TtsProvider = "openai" | "elevenlabs" | "azure";

export function ttsProvider(): TtsProvider | null {
  const want = (process.env.TTS_PROVIDER ?? "").toLowerCase();
  const ok: Record<TtsProvider, boolean> = {
    openai: !!process.env.TTS_BASE_URL,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY && !!process.env.ELEVENLABS_VOICE_ID,
    azure: !!process.env.AZURE_SPEECH_KEY && !!process.env.AZURE_SPEECH_REGION,
  };
  if (want in ok) return ok[want as TtsProvider] ? (want as TtsProvider) : null;
  return (["openai", "elevenlabs", "azure"] as TtsProvider[]).find((p) => ok[p]) ?? null;
}

export const TTS_LABEL: Record<TtsProvider, string> = { openai: "OpenVoice/servidor próprio", elevenlabs: "ElevenLabs", azure: "Azure Neural" };

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
    return { url, init: { method: "POST", headers, body: JSON.stringify({ model: process.env.TTS_MODEL || "openvoice", voice: process.env.TTS_VOICE || "iara", input: text, response_format: "mp3", speed: Number(process.env.TTS_SPEED) || 1.0 }) } };
  }
  if (p === "elevenlabs") {
    const voice = encodeURIComponent(process.env.ELEVENLABS_VOICE_ID!);
    return {
      url: `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": process.env.ELEVENLABS_API_KEY! },
        body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5", language_code: "pt", voice_settings: { stability: 0.45, similarity_boost: 0.8 } }),
      },
    };
  }
  const region = process.env.AZURE_SPEECH_REGION!;
  const voice = process.env.AZURE_TTS_VOICE || "pt-BR-FranciscaNeural";
  const ssml = `<speak version="1.0" xml:lang="pt-BR"><voice name="${xml(voice)}"><prosody rate="+4%">${xml(text)}</prosody></voice></speak>`;
  return {
    url: `https://${encodeURIComponent(region)}.tts.speech.microsoft.com/cognitiveservices/v1`,
    init: { method: "POST", headers: { "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY!, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3", "User-Agent": "sinos-iara" }, body: ssml },
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
  const audio = await res.arrayBuffer();
  if (audio.byteLength < 200) throw new TtsError("voz devolveu áudio vazio", 502);
  return { audio, type: res.headers.get("content-type")?.split(";")[0] || "audio/mpeg", provider: p };
}
