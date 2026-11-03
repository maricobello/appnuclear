import { rateGuard } from "@/lib/assistant/guard";
import { parseFatura } from "@/lib/gd/parse";
import { PdfError, pdfText } from "@/lib/gd/pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const noStore = { "Cache-Control": "no-store" };
const MAX_FILES = 8;
const MAX_FILE = 3 * 1024 * 1024;
const MAX_TEXT = 80_000;

/**
 * Leitura de faturas de energia (PDF com texto ou texto colado) — determinística, sem IA
 * e sem custo de token. Devolve os campos lidos e a trilha (linha usada em cada campo);
 * o PDF e o texto não são guardados.
 */
export async function POST(req: Request) {
  const blocked = await rateGuard(req, "gd");
  if (blocked) return blocked;
  const t0 = Date.now();
  const type = req.headers.get("content-type") ?? "";
  const jobs: { nome: string; texto?: string; pdf?: Uint8Array }[] = [];
  if (type.includes("application/json")) {
    const j = (await req.json().catch(() => null)) as { texto?: unknown; nome?: unknown } | null;
    if (!j || typeof j.texto !== "string" || !j.texto.trim()) return Response.json({ error: "envie { texto } ou arquivos PDF", code: "bad_request" }, { status: 400, headers: noStore });
    jobs.push({ nome: typeof j.nome === "string" ? j.nome.slice(0, 120) : "texto colado", texto: j.texto.slice(0, MAX_TEXT) });
  } else {
    const form = await req.formData().catch(() => null);
    const files = (form?.getAll("arquivo") ?? []).filter((f): f is File => f instanceof File);
    if (!files.length) return Response.json({ error: "nenhum arquivo enviado (campo 'arquivo')", code: "bad_request" }, { status: 400, headers: noStore });
    if (files.length > MAX_FILES) return Response.json({ error: `no máximo ${MAX_FILES} arquivos por envio`, code: "too_many" }, { status: 413, headers: noStore });
    for (const f of files) {
      if (f.size > MAX_FILE) {
        jobs.push({ nome: f.name, texto: "" });
        continue;
      }
      const buf = new Uint8Array(await f.arrayBuffer());
      const isPdf = buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
      if (isPdf) jobs.push({ nome: f.name, pdf: buf });
      else jobs.push({ nome: f.name, texto: new TextDecoder().decode(buf).slice(0, MAX_TEXT) });
    }
  }
  const out = [];
  for (const j of jobs) {
    try {
      if (j.pdf) {
        const { text, pages } = await pdfText(j.pdf);
        out.push({ nome: j.nome, paginas: pages, ...parseFatura(text, j.nome) });
      } else if (j.texto) out.push({ nome: j.nome, ...parseFatura(j.texto, j.nome) });
      else out.push({ nome: j.nome, erro: "arquivo grande demais (máx. 3 MB) ou vazio" });
    } catch (e) {
      out.push({ nome: j.nome, erro: e instanceof PdfError ? e.message : `falha ao ler: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}` });
    }
  }
  return Response.json({ faturas: out, ms: Date.now() - t0 }, { headers: noStore });
}
