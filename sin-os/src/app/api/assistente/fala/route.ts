import { guard } from "@/lib/assistant/guard";
import { speakable } from "@/lib/assistant/speech";
import { synthesize, TtsError, ttsProvider } from "@/lib/assistant/tts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };

/** Texto → áudio com a voz natural configurada (OpenVoice, ElevenLabs ou Azure). O navegador pede frase a frase. */
export async function POST(req: Request) {
  if (!ttsProvider()) return Response.json({ error: "voz natural não configurada no servidor", code: "not_configured" }, { status: 503, headers: noStore });
  const j = (await req.json().catch(() => null)) as { texto?: unknown } | null;
  const texto = typeof j?.texto === "string" ? speakable(j.texto).slice(0, 700) : "";
  if (!texto.trim()) return Response.json({ error: "texto vazio", code: "bad_request" }, { status: 400, headers: noStore });
  const blocked = await guard(req, "fala");
  if (blocked) return blocked;
  try {
    const { audio, type, provider } = await synthesize(texto);
    return new Response(audio, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600", "X-Tts-Provider": provider } });
  } catch (e) {
    const status = e instanceof TtsError ? e.status : 500;
    return Response.json({ error: e instanceof Error ? e.message : String(e), code: "tts" }, { status, headers: noStore });
  }
}
