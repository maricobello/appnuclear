import { groqConfigured, GroqError, groqTranscribe } from "@/lib/assistant/groq";
import { guard } from "@/lib/assistant/guard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "Cache-Control": "no-store" };
const MAX_BYTES = 4 * 1024 * 1024;
const EXT: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "mp4", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a" };

/** Transcrição (Whisper na Groq) do áudio gravado no navegador; o áudio não é guardado. */
export async function POST(req: Request) {
  if (!groqConfigured()) return Response.json({ error: "IA desligada: GROQ_API_KEY não configurada no servidor", code: "not_configured" }, { status: 503, headers: noStore });
  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size < 800) return Response.json({ error: "áudio ausente ou curto demais", code: "bad_request" }, { status: 400, headers: noStore });
  if (audio.size > MAX_BYTES) return Response.json({ error: "áudio longo demais", code: "too_large" }, { status: 413, headers: noStore });
  const blocked = await guard(req, "voz");
  if (blocked) return blocked;
  const type = (audio.type || "audio/webm").split(";")[0];
  try {
    const { text, model } = await groqTranscribe(audio, `fala.${EXT[type] ?? "webm"}`);
    return Response.json({ text, model }, { headers: noStore });
  } catch (e) {
    const status = e instanceof GroqError && e.status === 429 ? 429 : 502;
    return Response.json({ error: e instanceof Error ? e.message : String(e), code: e instanceof GroqError ? (e.code ?? "groq") : "internal" }, { status, headers: noStore });
  }
}
