import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { extractText, getDocumentProxy } from "unpdf";
import fixture from "./fixtures/aneel-componentes-copel-b1.json";
import { decompor, efetiva, PREMISSAS_PADRAO, simularReforma } from "../src/lib/tarifa/calc";
import { codigoVerificacao, montarLaudo, nomeArquivo, type DadosLaudo } from "../src/lib/tarifa/laudo";

const dec = decompor(fixture as { DscComponenteTarifario: string; VlrComponenteTarifario: string }[]);
const ef = efetiva(310.85, 457.17, 0, { icms: 0.195, pis: 0.0105, cofins: 0.0484 });
const dados: DadosLaudo = {
  geradoEm: new Date("2026-11-05T15:00:00-03:00"),
  distribuidora: "COPEL-DIS",
  uf: "PR",
  subgrupo: "B1",
  modalidade: "Convencional",
  linha: { subclasse: "Residencial", detalhe: "Não se aplica", posto: "Não se aplica", unidade: "MWh", te: 310.85, tusd: 457.17 },
  reh: "RESOLUÇÃO HOMOLOGATÓRIA Nº 3.592, DE 23 DE JUNHO DE 2026",
  vigencia: { inicio: "2026-06-24", fim: "2027-06-23" },
  proxima: null,
  geracaoAneel: "2026-11-05",
  decomposicao: dec,
  bandeira: { nome: "Verde", adicionalMwh: 0 },
  tributos: { icms: 19.5, pis: 1.05, cofins: 4.84, origem: { icms: "referência PR", pis: "referência", cofins: "referência" } },
  efetiva: ef,
  fatura: { precoKwh: 1.05, consumoKwh: 300 },
  reforma: simularReforma(768.02, { ...PREMISSAS_PADRAO, icms: 0.195 }),
  premissasReforma: { cbsRef: 0.088, ibsRef: 0.177, icmsNaBase: false },
};

describe("laudo de auditoria em PDF", () => {
  it("gera um PDF com as seções e os números da auditoria", async () => {
    const doc = montarLaudo(jsPDF, dados);
    const bytes = new Uint8Array(doc.output("arraybuffer"));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    if (process.env.LAUDO_OUT) (await import("node:fs")).writeFileSync(process.env.LAUDO_OUT, bytes.slice());
    const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
    for (const s of ["LAUDO DE AUDITORIA TARIFÁRIA", "COPEL-DIS", "IDENTIFICAÇÃO", "COMPONENTES TARIFÁRIOS", "TARIFA EFETIVA", "CONFERÊNCIA DE FATURA", "REFORMA TRIBUTÁRIA", "CONFORME", "457,17", "310,85", codigoVerificacao(dados), "Assinatura"]) {
      expect(text).toContain(s);
    }
    expect(text).toContain("ATENÇÃO"); // 1,05 cobrado contra 1,0294 calculado = +2,0%
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
  });
  it("o código de verificação muda quando um número muda", () => {
    expect(codigoVerificacao(dados)).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(codigoVerificacao({ ...dados, tributos: { ...dados.tributos, icms: 18 } })).not.toBe(codigoVerificacao(dados));
  });
  it("nome de arquivo sem acento nem espaço", () => {
    expect(nomeArquivo({ ...dados, distribuidora: "Ceraçá" })).toBe("laudo-tarifa-Ceraca-B1-2026-11-05.pdf");
  });
});
