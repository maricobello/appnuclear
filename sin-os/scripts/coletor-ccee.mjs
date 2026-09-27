#!/usr/bin/env node
/**
 * Coletor do PLD oficial — CCEE Dados Abertos → SIN OS.
 *
 * Roda no SEU computador (ou num Raspberry Pi em casa): a CCEE bloqueia servidores de
 * nuvem, não quem usa o portal de dados abertos numa conexão comum. O coletor usa só a
 * API pública do portal (CKAN), se identifica honestamente e faz poucas requisições; não
 * se passa por navegador nem tenta contornar bloqueio. Se a CCEE bloquear esta conexão
 * também, ele para e avisa.
 *
 * Requer Node 18+ (https://nodejs.org). Uso:
 *
 *   Windows (PowerShell):
 *     $env:SIN_OS_URL="https://sinos-iota.vercel.app"; $env:PLD_INGEST_KEY="sua-chave"
 *     node coletor-ccee.mjs              # uma vez
 *     node coletor-ccee.mjs --loop 60    # a cada 60 min (mínimo 30), deixe a janela aberta
 *
 *   macOS/Linux:
 *     SIN_OS_URL=https://sinos-iota.vercel.app PLD_INGEST_KEY=sua-chave node coletor-ccee.mjs --loop 60
 *
 * Opções: --dias N (padrão 10, máx. 60) · --loop MIN
 */
const CKAN = "https://dadosabertos.ccee.org.br/api/3/action";
const UA = "SIN-OS-coletor/1.0 (+https://github.com/maricobello/sinos)";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const APP = (process.env.SIN_OS_URL ?? "https://sinos-iota.vercel.app").replace(/\/+$/, "");
const KEY = process.env.PLD_INGEST_KEY;
const DAYS = Math.min(60, Math.max(1, Number(arg("dias", 10)) || 10));
const LOOP = arg("loop", null);

if (!KEY) {
  console.error("Defina PLD_INGEST_KEY (a mesma chave cadastrada na Vercel).");
  process.exit(1);
}

async function ckan(path) {
  const res = await fetch(`${CKAN}/${path}`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
  if (res.status === 403) {
    throw new Error("a CCEE bloqueou esta conexão também (HTTP 403). O coletor não tenta disfarçar o acesso: use a Plataforma de Integração ou peça liberação à CCEE.");
  }
  if (!res.ok) throw new Error(`CCEE respondeu HTTP ${res.status} em ${path.split("?")[0]}`);
  const j = await res.json();
  if (!j.success) throw new Error(`CKAN retornou erro em ${path.split("?")[0]}`);
  return j.result;
}

const yearOf = (r) => Number((`${r.name ?? ""} ${r.url ?? ""}`.match(/20\d\d/g) ?? []).pop() ?? NaN);

async function collect() {
  const pkg = await ckan("package_show?id=pld_horario");
  const resources = pkg.resources
    .filter((r) => r.datastore_active !== false && Number.isFinite(yearOf(r)))
    .sort((a, b) => yearOf(b) - yearOf(a));
  if (!resources.length) throw new Error("nenhum recurso anual com datastore em pld_horario");
  const need = (DAYS + 2) * 24 * 4;
  const records = [];
  for (const r of resources.slice(0, 2)) {
    const res = await ckan(`datastore_search?resource_id=${r.id}&limit=${need - records.length}&sort=${encodeURIComponent("_id desc")}`);
    records.push(...res.records);
    if (records.length >= need) break;
  }
  if (!records.length) throw new Error("a CCEE não retornou registros");

  const res = await fetch(`${APP}/api/pld/coletor`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-coletor-key": KEY, "User-Agent": UA },
    body: JSON.stringify({ records, origem: "coletor-ccee" }),
    signal: AbortSignal.timeout(60_000),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`SIN OS respondeu HTTP ${res.status}: ${out.error ?? "erro"}`);
  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  console.log(`[${now}] ${out.recebidos} registros · dias oficiais aceitos: ${out.dias_aceitos.join(", ") || "nenhum"} · novos gravados: ${out.gravados_agora}`);
  for (const r of out.dias_rejeitados ?? []) console.log(`   ignorado ${r.date}: ${r.motivo}`);
}

/** "ok", "erro" (tenta de novo no próximo ciclo) ou "parar" (a CCEE bloqueou esta conexão). */
async function once() {
  try {
    await collect();
    return "ok";
  } catch (e) {
    console.error(`[erro] ${e.message}`);
    return /bloqueou/.test(e.message) ? "parar" : "erro";
  }
}

if (LOOP) {
  const min = Math.max(30, Number(LOOP) || 60);
  console.log(`Coletando a cada ${min} min — Ctrl+C para parar.`);
  if ((await once()) !== "parar") {
    const timer = setInterval(async () => {
      if ((await once()) === "parar") clearInterval(timer);
    }, min * 60_000);
  }
} else {
  process.exit((await once()) === "ok" ? 0 : 1);
}
