/**
 * Emite o Prontuário Econômico-Financeiro da plataforma no terminal: `npm run prontuario`.
 * Usa os mesmos módulos do site (via jiti, sem build) e grava em prontuarios/ (ignorada pelo git).
 * Variáveis de ambiente opcionais: as mesmas do site (NEXT_PUBLIC_CHAIN_ID, RPCs, SESSION_SECRET…).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root); // as fontes do PDF são lidas a partir de process.cwd()
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(root, "src"), "server-only": path.join(root, "scripts/stubs/server-only.mjs") },
});

const { getAllAnalyses } = await jiti.import("@/lib/analysis");
const { revisaoAmbiente } = await jiti.import("@/lib/prontuario/ambiente");
const { gerarProntuario, nomeArquivo } = await jiti.import("@/lib/prontuario");
const { siteUrl } = await jiti.import("@/lib/web3/chains");

const [analyses, amb] = await Promise.all([getAllAnalyses(), revisaoAmbiente()]);
const { data, pdf } = await gerarProntuario(analyses, amb, { siteUrl });
const dir = path.join(root, "prontuarios");
mkdirSync(dir, { recursive: true });
const file = path.join(dir, nomeArquivo(data));
writeFileSync(file, pdf);
console.log(`Prontuário ${data.id} → ${path.relative(root, file)} (${Math.round(pdf.length / 1024)} KB)`);
console.log(data.diagnosis.map((d, i) => `  ${i + 1}. ${d}`).join("\n"));
