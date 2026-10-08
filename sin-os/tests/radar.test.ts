import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { anonymize, buildRadar, normalizeUrl, parseChat, renderMarkdown, txtFromZip } from "../scripts/radar-comunidade.mjs";

const CHAT = [
  "[24/07/2026, 14:13:57] ~ Ana Souza: ‎~ Ana Souza criou este grupo",
  "[06/10/2026, 09:00:00] ~ Ana Souza: Bom dia! Alguém sabe se o corte de eólica do ONS reflete as contestações?",
  "[06/10/2026, 09:05:00] Bruno Lima: Não reflete. Dá uma olhada https://dados.ons.org.br/dataset/x?utm_source=wa e fala com o Bruno ou com a Ana",
  "continuação da mensagem do Bruno, liga +55 11 98765-4321 ou bruno@exemplo.com",
  "[06/10/2026, 09:06:00] Carla: Olá, pessoal! Meu nome é Carla Dias, sou engenheira. Alguém indica vagas? https://www.linkedin.com/in/carla",
  "[07/10/2026, 10:00:00] Bruno Lima: ‎imagem ocultada",
  "[07/10/2026, 10:01:00] Bruno Lima: @⁨Ana Souza⁩ viu o PLD no piso de novo? Energia sobrando em São Paulo?",
  "08/10/2026 11:00 - Davi: formato Android https://dados.ons.org.br/dataset/x",
].join("\n");

describe("radar da comunidade", () => {
  const msgs = parseChat(CHAT);

  it("lê os formatos do iPhone e do Android e junta linhas de continuação", () => {
    expect(msgs).toHaveLength(7);
    expect(msgs[2].author).toBe("Bruno Lima");
    expect(msgs[2].text).toContain("continuação");
    expect(msgs[6]).toMatchObject({ date: "2026-10-08", author: "Davi" });
  });

  it("anonimiza nomes, telefones, e-mails e menções, sem mascarar palavras comuns", () => {
    const authors = msgs.map((m: { author: string }) => m.author);
    const t = anonymize(msgs[2].text, authors);
    expect(t).not.toMatch(/Bruno|Ana|98765|bruno@/);
    expect(t).toContain("[telefone]");
    expect(t).toContain("[e-mail]");
    const u = anonymize(msgs[5].text, authors);
    expect(u).toContain("@[membro]");
    expect(u).toContain("Energia sobrando em São Paulo");
  });

  it("monta o resumo da semana sem apresentações, sem redes sociais e com links normalizados", () => {
    const r = buildRadar(msgs, { knownLinks: new Set() });
    expect(r.from).toBe("2026-10-01");
    expect(r.messages).toBe(5); // sem criação do grupo e sem mídia ocultada
    expect(r.links).toHaveLength(1);
    expect(r.links[0]).toMatchObject({ url: "https://dados.ons.org.br/dataset/x", mentions: 2, isNew: true });
    expect(r.questions.some((q: string) => q.includes("Carla"))).toBe(false); // apresentação pessoal fica de fora
    expect(r.questions).toHaveLength(2);
    expect(r.themes.map((t: { name: string }) => t.name)).toContain("Corte de renováveis (curtailment)");
    const md = renderMarkdown(r);
    expect(md).not.toMatch(/Ana|Bruno|Carla|Davi|linkedin/);
    const again = buildRadar(msgs, { knownLinks: new Set(["https://dados.ons.org.br/dataset/x"]) });
    expect(again.links[0].isNew).toBe(false);
  });

  it("normaliza URL tirando rastreadores", () => {
    expect(normalizeUrl("https://x.com/a/?utm_source=wa&id=3#top.")).toBe("https://x.com/a/?id=3");
  });

  it("extrai o _chat.txt de um .zip (deflate)", () => {
    const name = Buffer.from("_chat.txt");
    const data = Buffer.from(CHAT, "utf8");
    const comp = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);
    const cdOffset = local.length + name.length + comp.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length + name.length, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    const zip = Buffer.concat([local, name, comp, central, name, eocd]);
    expect(txtFromZip(zip)).toBe(CHAT);
  });
});
