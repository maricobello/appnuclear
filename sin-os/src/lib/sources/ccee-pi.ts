import "server-only";
import { Agent, request } from "node:https";
import { PLD_LIMITS } from "../market/brazil";
import { listarPldEnvelope, parseListarPld, piDate, PiSoapFault, type PiCredentials, type PiPldItem } from "./ccee-pi-xml";
import { errMsg, recordProbe } from "./http";
import { addDays, brtDate } from "./time";
import { emptyQuality, SUBS, type Probe, type SourceResult, type Sub, type SubPanel } from "./types";

/**
 * CCEE — Plataforma de Integração (serviço oficial para agentes), operação `listarPLD`
 * do PLDBSv1: PLD horário por submercado direto da CCEE, incluindo o D+1 assim que
 * publicado. Documentação: devccee/postman-collections (GitHub) e
 * https://www.ccee.org.br/web/guest/documentos/plataforma-de-integracao.
 *
 * Acesso restrito a agentes da CCEE (ou consultorias com representação total), com:
 *   - usuário/senha da Plataforma de Integração (WS-Security UsernameToken);
 *   - código do perfil do agente;
 *   - certificado digital ICP-Brasil (.pfx/.p12) cadastrado na CCEE — autenticação SSL mútua.
 * Tudo por variáveis de ambiente (nunca no código): CCEE_PI_USERNAME, CCEE_PI_PASSWORD,
 * CCEE_PI_PERFIL, CCEE_PI_CERT_PFX (base64 do .pfx) e CCEE_PI_CERT_PASSPHRASE.
 * Sem elas, o adaptador fica desativado e o app segue com o PLD calculado pelo CMO.
 */
const HOST = () => process.env.CCEE_PI_HOST ?? "https://servicos.ccee.org.br:443";
const PATH = "/ws/prec/PLDBSv1";
const PAGE_SIZE = () => Math.min(1000, Math.max(24, Number(process.env.CCEE_PI_PAGE_SIZE ?? 240)));
const MAX_PAGES = 40;

export function ccePiConfigured(): boolean {
  return !!(process.env.CCEE_PI_USERNAME && process.env.CCEE_PI_PASSWORD && process.env.CCEE_PI_PERFIL && process.env.CCEE_PI_CERT_PFX);
}

const g = globalThis as typeof globalThis & { __sinPiAgent?: Agent };
function agent(): Agent {
  g.__sinPiAgent ??= new Agent({
    pfx: Buffer.from(process.env.CCEE_PI_CERT_PFX ?? "", "base64"),
    passphrase: process.env.CCEE_PI_CERT_PASSPHRASE,
    keepAlive: true,
    maxSockets: 4,
  });
  return g.__sinPiAgent;
}

function post(body: string, timeoutMs = 25_000): Promise<{ status: number; text: string; probe: Probe }> {
  const url = new URL(PATH, HOST());
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        agent: agent(),
        headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "listarPLD", "Content-Length": Buffer.byteLength(body) },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          // SOAP Fault chega como 500: o corpo traz a mensagem da CCEE
          const probe: Probe = { url: `${url.host}${PATH}`, ok: status >= 200 && status < 300, status, latencyMs: Date.now() - t0, bytes: text.length, at: t0, ...(status >= 300 ? { error: `HTTP ${status}` } : {}) };
          recordProbe(probe);
          resolve({ status, text, probe });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`timeout ${timeoutMs} ms`)));
    req.on("error", (e) => {
      const probe: Probe = { url: `${url.host}${PATH}`, ok: false, status: null, latencyMs: Date.now() - t0, bytes: 0, at: t0, error: e.message };
      recordProbe(probe);
      reject(Object.assign(new Error(`Plataforma de Integração: ${e.message}`), { probes: [probe] }));
    });
    req.end(body);
  });
}

/** PLD horário oficial dos últimos `daysBack` dias até D+1 (o que já estiver publicado). */
export async function fetchPldPI(daysBack = 14, now = Date.now()): Promise<SourceResult<SubPanel>> {
  const probes: Probe[] = [];
  const quality = emptyQuality();
  if (!ccePiConfigured()) {
    return { id: "ccee_pi", ok: false, data: null, error: "Plataforma de Integração não configurada (CCEE_PI_*)", probes, quality, simulated: false, fetchedAt: now };
  }
  const cred: PiCredentials = { username: process.env.CCEE_PI_USERNAME!, password: process.env.CCEE_PI_PASSWORD!, perfil: process.env.CCEE_PI_PERFIL! };
  const today = brtDate(now);
  const range = { inicio: piDate(addDays(today, -daysBack)), fim: piDate(addDays(today, 2)), tipo: "HORARIO" as const, pageSize: PAGE_SIZE() };
  try {
    const items: PiPldItem[] = [];
    const getPage = async (page: number) => {
      const r = await post(listarPldEnvelope(cred, { ...range, page }));
      probes.push(r.probe);
      const parsed = parseListarPld(r.text); // lança PiSoapFault com a mensagem da CCEE
      if (r.status >= 300) throw new Error(`HTTP ${r.status}`);
      return parsed;
    };
    const first = await getPage(1);
    items.push(...first.items);
    const pages = Math.min(first.totalPages, MAX_PAGES);
    for (let p = 2; p <= pages; p += 4) {
      const batch = await Promise.all(Array.from({ length: Math.min(4, pages - p + 1) }, (_, k) => getPage(p + k)));
      batch.forEach((b) => items.push(...b.items));
    }
    if (!items.length) throw new Error("listarPLD retornou 0 valores no período");

    const map = new Map<number, Partial<Record<Sub, number>>>();
    for (const it of items) {
      const row = map.get(it.ts) ?? {};
      if (row[it.sub] !== undefined) quality.duplicates++;
      row[it.sub] = it.value;
      map.set(it.ts, row);
    }
    const ts = [...map.keys()].sort((a, b) => a - b);
    const panel: SubPanel = {
      ts,
      values: Object.fromEntries(SUBS.map((s) => [s, ts.map((t) => map.get(t)?.[s] ?? null)])) as SubPanel["values"],
      unit: "R$/MWh",
    };
    quality.points = items.length;
    quality.expectedPoints = (Math.round((ts[ts.length - 1] - ts[0]) / 3600_000) + 1) * 4;
    quality.latestTs = ts[ts.length - 1];
    quality.values = SUBS.flatMap((s) => panel.values[s].slice(-168)).filter((v): v is number => v !== null);
    quality.range = [PLD_LIMITS.min - 0.5, PLD_LIMITS.maxHourly + 0.5];
    return { id: "ccee_pi", ok: true, data: panel, probes, quality, simulated: false, fetchedAt: now };
  } catch (e) {
    const p = (e as { probes?: Probe[] }).probes;
    if (p) probes.push(...p.filter((x) => !probes.includes(x)));
    const msg = e instanceof PiSoapFault ? e.message : errMsg(e);
    return { id: "ccee_pi", ok: false, data: null, error: msg, probes, quality, simulated: false, fetchedAt: now };
  }
}
