import { subOf } from "./ckan";
import { brtToUtc } from "./time";
import type { Sub } from "./types";

/**
 * Parte pura do cliente da Plataforma de Integração da CCEE (serviço PLDBSv1, operação
 * `listarPLD`): monta o envelope SOAP e interpreta a resposta. Sem rede nem segredos —
 * testável com o exemplo oficial da collection Postman da CCEE (devccee/postman-collections).
 */
export interface PiCredentials {
  username: string;
  password: string;
  /** Código do perfil do agente na CCEE (messageHeader/codigoPerfilAgente). */
  perfil: string;
}

export interface PiPldItem {
  /** Início da hora (epoch ms). */
  ts: number;
  sub: Sub;
  value: number;
}

export interface PiPage {
  items: PiPldItem[];
  page: number;
  totalPages: number;
  totalItems: number | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Data local (BRT) no formato aceito pela CCEE: AAAA-MM-DDThh:mm:ss (sem fuso). */
export const piDate = (isoDay: string, time = "00:00:00") => `${isoDay}T${time}`;

export function listarPldEnvelope(
  cred: PiCredentials,
  opts: { inicio: string; fim: string; tipo?: "HORARIO" | "SEMANAL"; page?: number; pageSize?: number },
): string {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:mh="http://xmlns.energia.org.br/MH/v1" xmlns:oas="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:bm="http://xmlns.energia.org.br/BM/v1" xmlns:bo="http://xmlns.energia.org.br/BO/v1">
  <soapenv:Header>
    <mh:messageHeader><mh:codigoPerfilAgente>${esc(cred.perfil)}</mh:codigoPerfilAgente></mh:messageHeader>
    <oas:Security><oas:UsernameToken><oas:Username>${esc(cred.username)}</oas:Username><oas:Password>${esc(cred.password)}</oas:Password></oas:UsernameToken></oas:Security>
    <mh:paginacao><mh:numero>${opts.page ?? 1}</mh:numero><mh:quantidadeItens>${opts.pageSize ?? 200}</mh:quantidadeItens></mh:paginacao>
  </soapenv:Header>
  <soapenv:Body>
    <bm:listarPLDRequest><bm:plds><bm:pld>
      <bo:vigencia><bo:inicio>${esc(opts.inicio)}</bo:inicio><bo:fim>${esc(opts.fim)}</bo:fim></bo:vigencia>
      <bo:valores><bo:valor><bo:tipo>${opts.tipo ?? "HORARIO"}</bo:tipo></bo:valor></bo:valores>
    </bm:pld></bm:plds></bm:listarPLDRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/** Remove prefixos de namespace (bm:, bo:, ns2:, soapenv: …) — a CCEE pode variar os prefixos. */
const stripNs = (xml: string) => xml.replace(/<(\/?)[A-Za-z_][\w.-]*:/g, "<$1").replace(/\s+xmlns(:\w+)?="[^"]*"/g, "");

const tag = (xml: string, name: string) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml)?.[1]?.trim();

/** Instante da CCEE: com fuso (-03:00) é absoluto; sem fuso, é hora local de Brasília. */
export function piTimestamp(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return NaN;
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s.trim())) return Date.parse(s.trim());
  return brtToUtc(+m[1], +m[2], +m[3], +m[4]) + +m[5] * 60_000;
}

export class PiSoapFault extends Error {}

/** Códigos de submercado da CCEE (1 Sudeste/CO, 2 Sul, 3 Nordeste, 4 Norte). */
const CODE_SUB: Record<string, Sub> = { "1": "SE", "2": "S", "3": "NE", "4": "N" };

/** Interpreta a resposta de `listarPLD` (HORARIO). Lança PiSoapFault com a mensagem da CCEE. */
export function parseListarPld(xml: string): PiPage {
  const x = stripNs(xml);
  if (/<Fault>/.test(x)) {
    const msg = tag(x, "faultstring") ?? tag(x, "Text") ?? tag(x, "descricao") ?? "SOAP Fault";
    throw new PiSoapFault(`CCEE: ${msg.replace(/\s+/g, " ").slice(0, 300)}`);
  }
  if (!/<listarPLDResponse/.test(x)) throw new Error("resposta sem listarPLDResponse");
  const pag = tag(x, "paginacao") ?? "";
  const page = Number(tag(pag, "numero") ?? 1);
  const totalPages = Number(tag(pag, "totalPaginas") ?? 1);
  const totalItemsRaw = tag(pag, "quantidadeTotalItens");
  const items: PiPldItem[] = [];
  const pldRe = /<pld>([\s\S]*?)<\/pld>/g;
  for (const m of x.matchAll(pldRe)) {
    const block = m[1];
    const inicio = tag(tag(block, "vigencia") ?? "", "inicio");
    if (!inicio) continue;
    const ts = piTimestamp(inicio);
    // cada valor: <submercado>…<nome>SUDESTE</nome>…</submercado> … <valor><codigo>BRL</codigo><valor>39.68</valor></valor>
    const valRe = /<submercado>([\s\S]*?)<\/submercado>([\s\S]*?)<codigo>[A-Z]{3}<\/codigo>\s*<valor>\s*([-\d.,]+)\s*<\/valor>/g;
    for (const v of block.matchAll(valRe)) {
      if (/<tipo>\s*SEMANAL\s*<\/tipo>/.test(v[2])) continue;
      const sub = subOf(tag(v[1], "nome")) ?? CODE_SUB[tag(v[1], "codigo") ?? ""] ?? null;
      const value = Number(v[3].replace(",", "."));
      if (sub && Number.isFinite(ts) && Number.isFinite(value)) items.push({ ts, sub, value });
    }
  }
  return {
    items,
    page: Number.isFinite(page) ? page : 1,
    totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1,
    totalItems: totalItemsRaw !== undefined && Number.isFinite(Number(totalItemsRaw)) ? Number(totalItemsRaw) : null,
  };
}
