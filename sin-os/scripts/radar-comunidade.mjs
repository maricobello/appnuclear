#!/usr/bin/env node
/**
 * Radar semanal da comunidade — exportação do WhatsApp → resumo anônimo em Markdown.
 *
 * Lê o .zip (ou o _chat.txt) exportado pelo WhatsApp e gera um resumo da semana com temas, links
 * e perguntas em aberto, SEM nomes, telefones, e-mails ou menções. É o insumo para decidir o que
 * vale virar funcionalidade no SIN OS; nada aqui é enviado para fora do seu computador.
 *
 * Uso:
 *   node scripts/radar-comunidade.mjs "WhatsApp Chat - Comunidade.zip"
 *   node scripts/radar-comunidade.mjs _chat.txt --desde 2026-10-01 --saida radar
 *
 * Opções: --desde AAAA-MM-DD (padrão: 7 dias antes da última mensagem) · --saida PASTA (padrão
 * docs/radar; os .md dessa pasta ficam fora do git porque o repositório é público).
 * Links já citados em radares anteriores da mesma pasta aparecem sem a marca "novo".
 */
import { inflateRawSync } from "node:zlib";
import { pathToFileURL } from "node:url";

/** Extrai o primeiro .txt de um zip (leitor mínimo: diretório central + deflate/store). */
export function txtFromZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("arquivo .zip inválido");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50)
      throw new Error("diretório do .zip corrompido");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    if (/\.txt$/i.test(name)) {
      const start =
        local +
        30 +
        buf.readUInt16LE(local + 26) +
        buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return data.toString("utf8");
      if (method === 8) return inflateRawSync(data).toString("utf8");
      throw new Error(`compressão ${method} não suportada`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("nenhum .txt dentro do .zip");
}

// iOS: "[29/09/2026, 08:58:14] Nome: texto" · Android: "29/09/2026 08:58 - Nome: texto"
const LINE =
  /^[‎‏]?\[?(\d{2})\/(\d{2})\/(\d{2,4}),? (\d{2}):(\d{2})(?::\d{2})?\]?(?: -)? ([^:]{1,80}?): ([\s\S]*)$/;

/** Mensagens {date: "AAAA-MM-DD", author, text}; linhas sem cabeçalho continuam a mensagem anterior. */
export function parseChat(text) {
  const out = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const m = LINE.exec(raw);
    if (m) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      out.push({
        date: `${y}-${m[2]}-${m[1]}`,
        author: m[6].replace(/^[‎~\s]+/, "").trim(),
        text: m[7],
      });
    } else if (out.length) out[out.length - 1].text += `\n${raw}`;
  }
  return out;
}

const SYSTEM =
  /(criou este grupo|entrou usando|adicionou|saiu$|removeu|mudou o (nome|assunto|ícone|ícone)|mensagens e (as )?ligações são protegidas|^‎?(imagem|vídeo|áudio|figurinha|documento|gif) ocultad[oa]|<mídia oculta>|mensagem apagada|esta mensagem foi apagada)/i;
const clean = (t) =>
  t
    .replace(/[‎‏]/g, "")
    .replace(/<Mensagem editada>/gi, "")
    .trim();

// palavras que aparecem em nomes de exibição mas também no assunto do grupo (não mascarar)
const COMMON = new Set([
  "energia",
  "energy",
  "solar",
  "eólica",
  "dados",
  "data",
  "grupo",
  "comunidade",
  "brasil",
  "são",
  "paulo",
  "rio",
  "janeiro",
  "engenharia",
  "elétrica",
  "consultoria",
  "power",
  "grid",
  "the",
  "dos",
  "das",
  "de",
  "da",
  "do",
]);

/** Remove o que identifica pessoas: nomes dos autores, telefones, e-mails e menções. */
export function anonymize(text, authors) {
  let t = text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[e-mail]")
    .replace(/@[⁨]?[^\s⁩]*[⁩]?/g, "@[membro]")
    .replace(
      /\+?\d{2}[\s.-]?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}/g,
      "[telefone]",
    );
  const esc = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // nome completo: em qualquer caixa; partes do nome: só com inicial maiúscula e fora das palavras comuns
  for (const a of [...new Set(authors)]
    .filter((n) => n && !/^\+?\d/.test(n))
    .sort((x, y) => y.length - x.length))
    t = t.replace(
      new RegExp(`(?<![\\p{L}])${esc(a)}(?![\\p{L}])`, "giu"),
      "[membro]",
    );
  const parts = [...new Set(authors.flatMap((a) => a.split(/\s+/)))].filter(
    (w) => w.length >= 3 && /^\p{Lu}/u.test(w) && !COMMON.has(w.toLowerCase()),
  );
  for (const w of parts)
    t = t.replace(
      new RegExp(`(?<![\\p{L}])${esc(w)}(?![\\p{L}])`, "gu"),
      "[membro]",
    );
  return t;
}

/** @type {[string, RegExp][]} */
export const THEMES = [
  [
    "PLD, CMO e formação de preço",
    /\b(pld|cmo|dessem|newave|decomp|pre[çc]o)/i,
  ],
  [
    "Corte de renováveis (curtailment)",
    /(curtailment|constrained|restri[çc][ãa]o|\bcorte)/i,
  ],
  ["Armazenamento e baterias", /(\bbess\b|bateria|armazenamento)/i],
  [
    "Dados abertos, APIs e ferramentas",
    /(\bapi\b|dados abertos|dataset|parquet|\bcsv\b|python|power ?bi|dashboard|scrap|github)/i,
  ],
  [
    "Regulação (ANEEL, MME, leis)",
    /(aneel|\bmme\b|resolu[çc][ãa]o|consulta p[úu]blica|regula|\blei\b|\bmp\b)/i,
  ],
  ["Mercado livre e CCEE", /(ccee|mercado livre|\bacl\b|migra|comercializ)/i],
  ["Operação do sistema (ONS)", /(\bons\b|despacho|carga|opera[çc][ãa]o)/i],
  ["Geração distribuída (MMGD)", /(mmgd|gera[çc][ãa]o distribu|\bgd\b)/i],
  [
    "Tarifas e distribuidoras",
    /(tarifa|distribuidora|\btusd\b|consumo dos clientes)/i,
  ],
  [
    "Hidrologia e clima",
    /(reservat|\bena\b|\bear\b|chuva|hidrolog|el ni[ñn]o)/i,
  ],
  ["Eventos, cursos e vagas", /(evento|webinar|congresso|curso|vaga|feira)/i],
];

// links que identificam pessoas ou convidam para grupos não entram no radar
const PRIVATE_LINK =
  /(linkedin\.com|lnkd\.in|instagram\.com|facebook\.com|wa\.me|whatsapp\.com|meet\.google\.com|zoom\.us|teams\.microsoft\.com)/i;
// apresentações pessoais não são perguntas em aberto (e carregam nome e currículo)
const INTRO =
  /(meu nome [ée]|me chamo|\beu sou\b|meu linkedin|me (add|adiciona)|\bsou (o |a )?(dr|dra|eng|engenheir|formad|especialista|diretor|diretora|s[óo]ci|mestre|doutor|doutora|economista|analista|consultor|consultora|gerente|coordenador|coordenadora|pesquisador|pesquisadora|estudante)|^\s*(ol[áa]|oi|bom dia|boa tarde|boa noite)[^.?!]{0,40}[,.!]?\s*sou (o |a )?\p{Lu})/iu;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

export function normalizeUrl(u) {
  try {
    const x = new URL(u.replace(/[.,;:!?]+$/, ""));
    for (const k of [...x.searchParams.keys()])
      if (/^(utm_|fbclid|gclid|si$|igsh)/i.test(k)) x.searchParams.delete(k);
    x.hash = "";
    return x.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** Resumo do período: temas, links e perguntas, já anônimos. */
export function buildRadar(
  messages,
  { since, until, knownLinks = new Set() } = {},
) {
  const authors = [...new Set(messages.map((m) => m.author))];
  const last =
    messages
      .map((m) => m.date)
      .sort()
      .pop() ?? null;
  const from =
    since ??
    (last
      ? new Date(Date.parse(`${last}T12:00:00Z`) - 7 * 86400_000)
          .toISOString()
          .slice(0, 10)
      : null);
  const to = until ?? last;
  const inWin = messages
    .filter((m) => (!from || m.date >= from) && (!to || m.date <= to))
    .map((m) => ({ ...m, text: clean(m.text) }))
    .filter((m) => m.text && !SYSTEM.test(m.text));

  const themes = THEMES.map(([name, re]) => ({
    name,
    count: inWin.filter((m) => re.test(m.text)).length,
  }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);

  const links = new Map();
  for (const m of inWin) {
    if (INTRO.test(m.text)) continue; // site de quem se apresentou identifica a pessoa
    for (const raw of m.text.match(URL_RE) ?? []) {
      const url = normalizeUrl(raw);
      if (!url || PRIVATE_LINK.test(url)) continue;
      const ctx = anonymize(
        m.text.replace(URL_RE, "").replace(/\s+/g, " ").trim(),
        authors,
      ).slice(0, 140);
      const prev = links.get(url);
      links.set(url, {
        url,
        domain: new URL(url).hostname.replace(/^www\./, ""),
        mentions: (prev?.mentions ?? 0) + 1,
        context: prev?.context || ctx,
        isNew: !knownLinks.has(url),
      });
    }
  }

  const questions = inWin
    .filter((m) => {
      const t = m.text.replace(URL_RE, "");
      return t.includes("?") && t.length >= 25 && !INTRO.test(m.text);
    })
    .map((m) =>
      anonymize(
        m.text.replace(URL_RE, "[link]").replace(/\s+/g, " ").trim(),
        authors,
      ),
    )
    .map((t) => (t.length > 280 ? `${t.slice(0, 277)}…` : t));

  return {
    from,
    to,
    messages: inWin.length,
    participants: new Set(inWin.map((m) => m.author)).size,
    themes,
    links: [...links.values()].sort(
      (a, b) =>
        Number(b.isNew) - Number(a.isNew) ||
        b.mentions - a.mentions ||
        a.domain.localeCompare(b.domain),
    ),
    questions: [...new Set(questions)],
  };
}

export function renderMarkdown(r) {
  const lines = [
    `# Radar da comunidade — ${r.from} a ${r.to}`,
    "",
    `${r.messages} mensagens de ${r.participants} participantes. Resumo anônimo: sem nomes, telefones, e-mails ou menções.`,
    "",
    "## Temas da semana",
    "",
    ...(r.themes.length
      ? r.themes.map((t) => `- **${t.name}** — ${t.count} mensagem(ns)`)
      : ["- nenhum tema reconhecido"]),
    "",
    "## Links compartilhados",
    "",
    ...(r.links.length
      ? r.links.map(
          (l) =>
            `- ${l.isNew ? "🆕 " : ""}[${l.domain}](${l.url})${l.mentions > 1 ? ` (${l.mentions}×)` : ""}${l.context ? ` — ${l.context}` : ""}`,
        )
      : ["- nenhum"]),
    "",
    "## Perguntas em aberto",
    "",
    ...(r.questions.length ? r.questions.map((q) => `- ${q}`) : ["- nenhuma"]),
    "",
    "## Para decidir",
    "",
    "- Algum tema acima vira funcionalidade? Antes de implementar: o que muda para quem usa o app, e por que é diferente do que já existe.",
    "- Achados de membros específicos: dar crédito ou pedir autorização antes de citar.",
    "",
  ];
  return lines.join("\n");
}

async function main() {
  const { readFile, readdir, mkdir, writeFile } =
    await import("node:fs/promises");
  const path = await import("node:path");
  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.error(
      'Uso: node scripts/radar-comunidade.mjs "exportação.zip" [--desde AAAA-MM-DD] [--saida PASTA]',
    );
    process.exit(1);
  }
  const arg = (n) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const outDir = arg("saida") ?? "docs/radar";
  const buf = await readFile(file);
  const text = /\.zip$/i.test(file) ? txtFromZip(buf) : buf.toString("utf8");
  const known = new Set();
  for (const f of await readdir(outDir).catch(() => [])) {
    if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(f)) continue;
    for (const u of (await readFile(path.join(outDir, f), "utf8")).match(
      /\]\((https?:\/\/[^)]+)\)/g,
    ) ?? [])
      known.add(u.slice(2, -1));
  }
  const r = buildRadar(parseChat(text), {
    since: arg("desde"),
    knownLinks: known,
  });
  await mkdir(outDir, { recursive: true });
  const out = path.join(outDir, `${r.to}.md`);
  await writeFile(out, renderMarkdown(r));
  console.log(
    `Radar gravado em ${out}: ${r.messages} mensagens, ${r.themes.length} temas, ${r.links.length} links (${r.links.filter((l) => l.isNew).length} novos), ${r.questions.length} perguntas.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
