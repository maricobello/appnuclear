import type { jsPDF as JsPDF } from "jspdf";
import type { AnoReforma, Decomposicao, Efetiva } from "./calc";
import type { EntradaUsina, FaturaUsina, TarifaUsina, conferirUsina } from "./usina";

/**
 * Laudo de auditoria tarifária em PDF, preto e branco, no estilo de prontuário: cabeçalho com
 * identificação e código de verificação, seções numeradas em caixas, campos "rótulo: valor",
 * tabelas com grade fina, ressalvas e campo de assinatura. Gerado no navegador (jsPDF).
 */
export interface DadosLaudo {
  geradoEm: Date;
  distribuidora: string;
  uf: string | null;
  subgrupo: string;
  modalidade: string;
  linha: { subclasse: string; detalhe: string; posto: string; unidade: string; te: number; tusd: number };
  reh: string;
  vigencia: { inicio: string; fim: string };
  proxima: { inicio: string; reh: string } | null;
  geracaoAneel: string | null;
  decomposicao: Decomposicao | null;
  bandeira: { nome: string; adicionalMwh: number };
  tributos: { icms: number; pis: number; cofins: number; origem: { icms: string; pis: string; cofins: string } };
  efetiva: Efetiva | null;
  fatura: { precoKwh: number; consumoKwh: number } | null;
  reforma: AnoReforma[];
  premissasReforma: { cbsRef: number; ibsRef: number; icmsNaBase: boolean };
}

const brl = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const dataBr = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "-");
/** A fonte padrão do PDF (WinAnsi) não tem alguns símbolos: troca por equivalentes. */
const t = (s: string) => s.replace(/[≤]/g, "<=").replace(/[≥]/g, ">=").replace(/[→]/g, "->").replace(/[×]/g, "x").replace(/[−]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\xFF–—•]/g, "");

/** Código de verificação: FNV-1a dos dados do laudo (muda se qualquer número mudar). */
export function codigoVerificacao(d: DadosLaudo): string {
  const s = JSON.stringify({ ...d, geradoEm: d.geradoEm.toISOString() });
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).toUpperCase().padStart(8, "0").replace(/(.{4})(.{4})/, "$1-$2");
}

export function nomeArquivo(d: DadosLaudo): string {
  const slug = d.distribuidora.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `laudo-tarifa-${slug}-${d.subgrupo}-${d.geradoEm.toISOString().slice(0, 10)}.pdf`;
}

const M = 14; // margem (mm)
const W = 210 - 2 * M;

export interface MetaDoc {
  titulo: string;
  subtitulo: string;
  codigo: string;
  quando: string;
  baseAneel: string | null;
  rodape: string;
}

/** Folha de prontuário: cabeçalho, seções numeradas, caixas, tabelas, assinatura e rodapé. */
export function documento(JsPDFCtor: typeof JsPDF, meta: MetaDoc) {
  const doc = new JsPDFCtor({ unit: "mm", format: "a4" });
  const { codigo, quando } = meta;
  let y = M;
  let secao = 0;

  doc.setTextColor(0);
  doc.setDrawColor(0);
  doc.setLineWidth(0.25);

  const cabecalho = () => {
    doc.setLineWidth(0.6);
    doc.rect(M, M, W, 20);
    doc.setLineWidth(0.25);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(t(meta.titulo), M + 3, M + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text((doc.splitTextToSize(t(meta.subtitulo), W - 58) as string[])[0], M + 3, M + 12);
    doc.text((doc.splitTextToSize(t("Fonte: ANEEL - Dados Abertos (tarifas homologadas, componentes tarifários e bandeiras)"), W - 58) as string[])[0], M + 3, M + 16.5);
    doc.line(M + W - 52, M, M + W - 52, M + 20);
    doc.setFont("courier", "bold");
    doc.setFontSize(9);
    doc.text(t(`Nº ${codigo}`), M + W - 49, M + 7);
    doc.setFont("courier", "normal");
    doc.setFontSize(8);
    doc.text(t(`Emitido: ${quando}`), M + W - 49, M + 12);
    doc.text(t(`Base ANEEL: ${dataBr(meta.baseAneel)}`), M + W - 49, M + 16.5);
    y = M + 25;
  };

  const novaPagina = () => {
    doc.addPage();
    cabecalho();
  };
  const espaco = (h: number) => {
    if (y + h > 297 - M - 10) novaPagina();
  };

  const titulo = (s: string) => {
    espaco(14);
    secao++;
    doc.setFillColor(0, 0, 0);
    doc.rect(M, y, W, 6, "F");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(t(`${secao}. ${s.toUpperCase()}`), M + 2, y + 4.2);
    doc.setTextColor(0);
    y += 8;
  };

  /** Grade de campos "RÓTULO / valor" em caixas, n colunas. */
  const campos = (pares: [string, string][], cols = 3) => {
    const cw = W / cols;
    const linhas = Math.ceil(pares.length / cols);
    for (let r = 0; r < linhas; r++) {
      const fatia = pares.slice(r * cols, r * cols + cols);
      const larg = fatia.length === 1 ? W : cw;
      // rótulo e valor quebram dentro da caixa; a linha inteira cresce com a maior caixa
      doc.setFontSize(6.5);
      const rots = fatia.map(([k]) => doc.splitTextToSize(t(k.toUpperCase()), larg - 4) as string[]);
      doc.setFontSize(9);
      const vals = fatia.map(([, v]) => doc.splitTextToSize(t(v), larg - 4) as string[]);
      const hRot = Math.max(1, ...rots.map((r) => r.length)) * 2.6;
      const h = 3.4 + hRot + Math.max(1, ...vals.map((v) => v.length)) * 3.8;
      espaco(h);
      fatia.forEach((_, i) => {
        const x = M + i * cw;
        doc.rect(x, y, larg, h);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.text(rots[i], x + 2, y + 3.2);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text(vals[i], x + 2, y + 3.2 + hRot + 1.4);
      });
      y += h;
    }
    y += 3;
  };

  /** Tabela com grade fina; colunas com largura relativa e alinhamento. */
  const tabela = (head: string[], rows: string[][], pesos: number[], alinhar: ("l" | "r")[] = []) => {
    const soma = pesos.reduce((a, b) => a + b, 0);
    const ws = pesos.map((p) => (p / soma) * W);
    const linha = (cells: string[], bold: boolean) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(bold ? 7 : 7.5);
      const quebras = cells.map((c, i) => doc.splitTextToSize(t(c), ws[i] - 3) as string[]);
      const h = 2.6 + Math.max(...quebras.map((q) => q.length)) * 3.3;
      if (y + h > 297 - M - 10) {
        novaPagina();
        if (!bold) linha(head, true);
      }
      // o cabeçalho repetido na página nova troca a fonte: volta a desta linha
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(bold ? 7 : 7.5);
      let x = M;
      quebras.forEach((q, i) => {
        if (bold) {
          doc.setFillColor(225, 225, 225);
          doc.rect(x, y, ws[i], h, "FD");
        } else doc.rect(x, y, ws[i], h);
        const right = alinhar[i] === "r";
        doc.text(q, right ? x + ws[i] - 1.5 : x + 1.5, y + 3.6, { align: right ? "right" : "left" });
        x += ws[i];
      });
      y += h;
    };
    linha(head, true);
    rows.forEach((r) => linha(r, false));
    y += 3;
  };

  const paragrafo = (s: string, size = 7.5) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    const ls = doc.splitTextToSize(t(s), W) as string[];
    espaco(ls.length * 3.4 + 2);
    doc.text(ls, M, y + 3);
    y += ls.length * 3.4 + 3;
  };

  const assinaturaEFinal = () => {
    espaco(28);
    y += 4;
    const ass = (x: number, w: number, rot: string) => {
      doc.line(x, y + 14, x + w, y + 14);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text(t(rot), x, y + 18);
    };
    doc.rect(M, y, W, 22);
    doc.setFontSize(6.5);
    doc.text(t("RESPONSÁVEL PELA CONFERÊNCIA"), M + 2, y + 3.2);
    ass(M + 4, 70, "Nome / registro profissional");
    ass(M + 82, 40, "Data");
    ass(M + 130, 50, "Assinatura");
    y += 26;

    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setLineWidth(0.25);
      doc.line(M, 297 - M - 4, M + W, 297 - M - 4);
      doc.setFont("courier", "normal");
      doc.setFontSize(7);
      doc.text(t(`Laudo ${codigo} · ${meta.rodape} · emitido ${quando}`), M, 297 - M);
      doc.text(`Página ${i}/${n}`, M + W, 297 - M, { align: "right" });
    }
    return doc;
  };
  cabecalho();
  return { doc, titulo, campos, tabela, paragrafo, fechar: assinaturaEFinal };
}

export function montarLaudo(JsPDFCtor: typeof JsPDF, d: DadosLaudo): JsPDF {
  const codigo = codigoVerificacao(d);
  const quando = `${d.geradoEm.toLocaleDateString("pt-BR")} ${d.geradoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  const { titulo, campos, tabela, paragrafo, fechar } = documento(JsPDFCtor, {
    titulo: "LAUDO DE AUDITORIA TARIFÁRIA",
    subtitulo: "SIN OS · tarifa de energia elétrica, componentes, tributos e reforma tributária",
    codigo,
    quando,
    baseAneel: d.geracaoAneel,
    rodape: `${d.distribuidora} ${d.subgrupo}`,
  });

  titulo("Identificação");
  campos([
    ["Distribuidora", d.distribuidora],
    ["UF (área de concessão)", d.uf ?? "não identificada"],
    ["Subgrupo / modalidade", `${d.subgrupo} · ${d.modalidade}`],
    ["Classe / subclasse", d.linha.subclasse],
    ["Detalhe / posto", `${d.linha.detalhe} · ${d.linha.posto}`],
    ["Unidade", `R$/${d.linha.unidade}`],
  ]);

  titulo("Tarifa homologada vigente (sem tributos)");
  campos(
    [
      ["Resolução homologatória", d.reh],
      ["Vigência", `${dataBr(d.vigencia.inicio)} a ${dataBr(d.vigencia.fim)}`],
      ["Próxima resolução", d.proxima ? `${dataBr(d.proxima.inicio)} · ${d.proxima.reh}` : "nenhuma publicada"],
    ],
    3,
  );
  campos([
    [`TUSD (R$/${d.linha.unidade})`, brl(d.linha.tusd)],
    [`TE (R$/${d.linha.unidade})`, brl(d.linha.te)],
    [`TE + TUSD (R$/${d.linha.unidade})`, brl(d.linha.te + d.linha.tusd)],
  ]);

  titulo("Componentes tarifários");
  const dec = d.decomposicao;
  if (dec?.itens.length) {
    tabela(
      ["Grupo", "TE", "TUSD", "Total", "%"],
      dec.grupos.map((g) => [g.grupo, brl(g.te), brl(g.tusd), brl(g.total), `${brl(g.pct, 1)}%`]),
      [5, 2, 2, 2, 1.4],
      ["l", "r", "r", "r", "r"],
    );
    tabela(
      ["Componente", "Código ANEEL", "Grupo", "Parcela", `R$/${d.linha.unidade}`],
      dec.itens.map((i) => [i.rotulo, i.codigo, i.grupo, i.parcela, brl(i.valorMwh)]),
      [5, 3.2, 3.6, 1.4, 2],
      ["l", "l", "l", "l", "r"],
    );
    const fecha = dec.residuo !== null && Math.abs(dec.residuo) <= 1;
    campos([
      ["Soma dos componentes − (TE + TUSD)", dec.residuo === null ? "sem referência" : `R$ ${brl(dec.residuo, 4)}/${d.linha.unidade}`],
      ["Conferência", fecha ? "CONFORME (|resíduo| <= R$ 1)" : "NÃO CONFORME - verificar"],
    ], 2);
  } else paragrafo("A ANEEL não publicou componentes para esta combinação nesta vigência.");

  titulo("Tributos e tarifa efetiva");
  campos([
    ["ICMS", `${brl(d.tributos.icms, 2)}% (${d.tributos.origem.icms})`],
    ["PIS", `${brl(d.tributos.pis, 2)}% (${d.tributos.origem.pis})`],
    ["Cofins", `${brl(d.tributos.cofins, 2)}% (${d.tributos.origem.cofins})`],
    ["Bandeira", `${d.bandeira.nome} (+R$ ${brl(d.bandeira.adicionalMwh)}/MWh)`],
    ["Método", "por dentro: base / (1 - ICMS - PIS - Cofins)"],
    ["Carga tributária", d.efetiva ? `+${brl(d.efetiva.cargaPct, 1)}% sobre a base` : "-"],
  ]);
  if (d.efetiva) {
    const e = d.efetiva;
    tabela(
      ["Item", "R$/kWh"],
      [
        ["Tarifa sem tributos (TE + TUSD + bandeira)", brl(e.semTributosKwh, 4)],
        ["ICMS", brl(e.icmsKwh, 4)],
        ["PIS", brl(e.pisKwh, 4)],
        ["Cofins", brl(e.cofinsKwh, 4)],
        ["TARIFA EFETIVA (com tributos)", brl(e.comTributosKwh, 4)],
      ],
      [6, 2],
      ["l", "r"],
    );
  } else paragrafo("Linha de demanda (R$/kW): tarifa efetiva por kWh não se aplica.");

  titulo("Conferência de fatura");
  if (d.fatura && d.efetiva && d.fatura.precoKwh > 0) {
    const dif = d.fatura.precoKwh - d.efetiva.comTributosKwh;
    const pct = (d.fatura.precoKwh / d.efetiva.comTributosKwh - 1) * 100;
    const status = Math.abs(pct) <= 1 ? "CONFORME (até 1%)" : Math.abs(pct) <= 3 ? "ATENÇÃO (1% a 3%)" : "DIVERGENTE (acima de 3%)";
    campos([
      ["Preço cobrado (R$/kWh)", brl(d.fatura.precoKwh, 4)],
      ["Tarifa calculada (R$/kWh)", brl(d.efetiva.comTributosKwh, 4)],
      ["Diferença", `${dif >= 0 ? "+" : ""}${brl(dif, 4)} R$/kWh (${pct >= 0 ? "+" : ""}${brl(pct, 2)}%)`],
      ["Consumo do mês", `${brl(d.fatura.consumoKwh, 0)} kWh`],
      ["Efeito no mês", `R$ ${brl(Math.abs(dif * d.fatura.consumoKwh))} ${dif >= 0 ? "a mais" : "a menos"}`],
      ["Resultado", status],
    ]);
  } else paragrafo("Nenhum preço de fatura informado para conferência.");

  titulo("Reforma tributária - CBS e IBS (simulação 2026-2033)");
  campos([
    ["CBS de referência", `${brl(d.premissasReforma.cbsRef * 100, 2)}% (estimativa)`],
    ["IBS de referência", `${brl(d.premissasReforma.ibsRef * 100, 2)}% (estimativa)`],
    ["ICMS na base do IBS/CBS", d.premissasReforma.icmsNaBase ? "sim (cenário conservador)" : "não (LC 214/2025)"],
  ]);
  if (d.reforma.length) {
    const base = d.reforma[0].totalKwh;
    tabela(
      ["Ano", "ICMS", "PIS/Cofins", "CBS", "IBS", "Consumidor", "vs. 2026", "Empresa (líq.)"],
      d.reforma.map((r) => [String(r.ano), brl(r.icmsKwh, 4), brl(r.pisCofinsKwh, 4), r.ano === 2026 ? `(${brl(r.destaqueTesteKwh, 4)})` : brl(r.cbsKwh, 4), brl(r.ibsKwh, 4), brl(r.totalKwh, 4), `${r.totalKwh >= base ? "+" : ""}${brl((r.totalKwh / base - 1) * 100, 1)}%`, brl(r.liquidoEmpresaKwh, 4)]),
      [1, 1.4, 1.5, 1.4, 1.4, 1.6, 1.3, 1.7],
      ["l", "r", "r", "r", "r", "r", "r", "r"],
    );
    paragrafo("Valores em R$/kWh. 2026: CBS 0,9% e IBS 0,1% destacados e compensados (entre parênteses, sem custo). 2027: fim do PIS/Cofins. 2029 a 2032: ICMS a 90/80/70/60% e IBS a 10/20/30/40%. 2033: só IBS e CBS. Empresa no regime regular: crédito integral de IBS/CBS.");
  }

  titulo("Premissas, ressalvas e responsabilidade");
  [
    "Tarifas e componentes: dados abertos da ANEEL, consulta no momento da emissão; a vigente é a resolução que cobre a data de emissão.",
    "ICMS automático = alíquota modal de referência da UF da distribuidora; não considera isenções, faixas de consumo nem regimes específicos da classe. PIS/Cofins de referência variam mensalmente por distribuidora: confira com a fatura.",
    "Reforma tributária: alíquotas de referência são estimativas; conferir resolução do Senado, alíquotas de IBS por estado e município, cashback de baixa renda e tratamento da energia compensada na GD.",
    "Este laudo é uma conferência técnica automatizada e não substitui parecer jurídico ou contábil.",
  ].forEach((s) => paragrafo(`• ${s}`));

  return fechar();
}

/* --------------------------------------------------------- laudo da fatura da usina */

export interface DadosLaudoUsina {
  geradoEm: Date;
  distribuidora: string;
  uf: string | null;
  subgrupo: string;
  reh: string;
  vigencia: { inicio: string; fim: string };
  geracaoAneel: string | null;
  bandeira: string;
  tarifa: TarifaUsina;
  entrada: EntradaUsina;
  fatura: FaturaUsina;
  conferencia: ReturnType<typeof conferirUsina> | null;
  origemTributos: string;
}

const kwh = (v: number) => `${brl(v, 0)} kWh`;
const kw = (v: number | undefined) => (v ? `${brl(v, 1)} kW` : "-");

export function codigoVerificacaoUsina(d: DadosLaudoUsina): string {
  return codigoVerificacao({ ...(d as unknown as DadosLaudo), geradoEm: d.geradoEm });
}

export function nomeArquivoUsina(d: DadosLaudoUsina): string {
  const slug = d.distribuidora.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `laudo-usina-${slug}-${d.subgrupo}-${d.geradoEm.toISOString().slice(0, 10)}.pdf`;
}

export function montarLaudoUsina(JsPDFCtor: typeof JsPDF, d: DadosLaudoUsina): JsPDF {
  const codigo = codigoVerificacaoUsina(d);
  const quando = `${d.geradoEm.toLocaleDateString("pt-BR")} ${d.geradoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  const { titulo, campos, tabela, paragrafo, fechar } = documento(JsPDFCtor, {
    titulo: "LAUDO DE AUDITORIA - FATURA DA USINA",
    subtitulo: "SIN OS · unidade geradora: compensação, Fio B, demanda de consumo e de geração (TUSDg), tributos",
    codigo,
    quando,
    baseAneel: d.geracaoAneel,
    rodape: `${d.distribuidora} ${d.subgrupo} usina`,
  });
  const e = d.entrada;
  const tf = d.tarifa;
  const f = d.fatura;
  const c = f.compensacao;

  titulo("Identificação");
  campos([
    ["Distribuidora", d.distribuidora],
    ["UF", d.uf ?? "não identificada"],
    ["Subgrupo / modalidade", `${d.subgrupo} · ${tf.modalidade}`],
    ["Regime", e.regime === "SCEE" ? "SCEE (mini/microgeração distribuída)" : "Central geradora fora do SCEE"],
    ["Enquadramento / ano", e.regime === "SCEE" ? `${e.enquadramento} · ${e.ano}` : "-"],
    ["Resolução vigente", `${d.reh} (${dataBr(d.vigencia.inicio)} a ${dataBr(d.vigencia.fim)})`],
  ]);

  titulo("Tarifas aplicadas (ANEEL, sem tributos)");
  tabela(
    ["Item", "Ponta", "Fora ponta", "Unidade"],
    [
      ["TE (energia)", brl(tf.energia.ponta.te), brl(tf.energia.fora.te), "R$/MWh"],
      ["TUSD (energia)", brl(tf.energia.ponta.tusd), brl(tf.energia.fora.tusd), "R$/MWh"],
      ["Fio B na energia (componente)", tf.fio ? brl(tf.fio.ponta.fioB) : "-", tf.fio ? brl(tf.fio.fora.fioB) : "-", "R$/MWh"],
      ["Fio A na energia (RB+CCT+FR+CUSD)", tf.fio ? brl(tf.fio.ponta.fioA) : "-", tf.fio ? brl(tf.fio.fora.fioA) : "-", "R$/MWh"],
      ["TUSD demanda de consumo", tf.demanda.unica !== undefined ? brl(tf.demanda.unica) : brl(tf.demanda.ponta ?? 0), tf.demanda.unica !== undefined ? "(única)" : brl(tf.demanda.fora ?? 0), "R$/kW"],
      ["TUSDg (demanda de geração)", tf.tusdg === null ? "não publicada" : brl(tf.tusdg), "-", "R$/kW"],
    ],
    [5, 2, 2, 1.5],
    ["l", "r", "r", "l"],
  );

  titulo("Medição e contrato informados");
  campos([
    ["Consumo ponta / fora ponta", `${kwh(e.consumo.ponta)} / ${kwh(e.consumo.fora)}`],
    ["Injeção ponta / fora ponta", `${kwh(e.injecao.ponta)} / ${kwh(e.injecao.fora)}`],
    ["Crédito anterior usado / alocado a outras UCs", `${kwh(c.creditoUsadoKwh)} / ${kwh(e.alocadoOutrasKwh)}`],
    ["Demanda contratada / medida (consumo)", tf.modalidade === "Verde" ? `${kw(e.demandaContratada.unica)} / ${kw(e.demandaMedida.unica)}` : `P ${kw(e.demandaContratada.ponta)} · FP ${kw(e.demandaContratada.fora)} / P ${kw(e.demandaMedida.ponta)} · FP ${kw(e.demandaMedida.fora)}`],
    ["Demanda de geração contratada / injeção medida", `${kw(e.demandaGerContratada)} / ${kw(e.demandaInjMedida)}`],
    ["Base da TUSDg", e.regime === "fora" ? "MUSD contratado" : e.modoDemandaGeracao === "excedente" ? "excedente da injeção sobre a demanda de consumo" : "toda a demanda de injeção"],
    ["Tributos", d.origemTributos],
    ["ICMS na energia compensada", e.icmsIsentaCompensada ? "isento (Convênio ICMS 16/2015)" : "tributado"],
    ["Bandeira", d.bandeira],
  ]);

  if (e.regime === "SCEE") {
    titulo("Compensação de energia (SCEE)");
    campos([
      ["Compensado ponta / fora ponta", `${kwh(c.compensado.ponta)} / ${kwh(c.compensado.fora)}`],
      ["Faturado ponta / fora ponta", `${kwh(c.faturado.ponta)} / ${kwh(c.faturado.fora)}`],
      ["Fator entre postos (TE fp / TE p)", brl(c.fatorPontaFora, 4)],
      ["Fora ponta usado na ponta / ponta usada no fora ponta", `${kwh(c.transferencias.foraParaPonta)} / ${kwh(c.transferencias.pontaParaFora)}`],
      ["Excedente (equiv. fora ponta)", kwh(c.excedenteKwh)],
      ["Saldo após o rateio", kwh(c.novoSaldoKwh)],
    ]);
  }

  titulo("Fatura esperada");
  tabela(
    ["Item", "Qtd.", "Tarifa", "Sem trib.", "ICMS", "PIS/Cof.", "Total"],
    [
      ...f.linhas.map((l) => [l.descricao, `${brl(l.quantidade, l.unidade === "kW" ? 1 : 0)} ${l.unidade}`, l.tarifa === null ? "-" : brl(l.tarifa, 4), brl(l.liquido), brl(l.icms), brl(l.pisCofins), brl(l.total)]),
      ["TOTAL", "", "", brl(f.totalLiquido), "", brl(f.totalTributos), brl(f.total)],
    ],
    [5.2, 1.8, 1.3, 1.5, 1.2, 1.2, 1.5],
    ["l", "r", "r", "r", "r", "r", "r"],
  );

  titulo("Conferência com a fatura real");
  const conf = d.conferencia;
  const com = conf?.itens.filter((i) => i.real !== null) ?? [];
  if (conf && (com.length || conf.total)) {
    tabela(
      ["Item", "Esperado", "Fatura", "Diferença", "Resultado"],
      [
        ...com.map((i) => [i.descricao, brl(i.esperado), brl(i.real ?? 0), `${(i.dif ?? 0) >= 0 ? "+" : ""}${brl(i.dif ?? 0)}${i.pct === null ? "" : ` (${i.pct >= 0 ? "+" : ""}${brl(i.pct, 1)}%)`}`, i.status.toUpperCase()]),
        ...(conf.total ? [["TOTAL DA FATURA", brl(f.total), brl(conf.total.real), `${conf.total.dif >= 0 ? "+" : ""}${brl(conf.total.dif)}${conf.total.pct === null ? "" : ` (${conf.total.pct >= 0 ? "+" : ""}${brl(conf.total.pct, 1)}%)`}`, conf.total.status.toUpperCase()]] : []),
      ],
      [5, 1.6, 1.6, 2.2, 1.6],
      ["l", "r", "r", "r", "l"],
    );
  } else paragrafo("Nenhum valor da fatura real informado para conferência.");

  if (f.alertas.length) {
    titulo("Alertas");
    f.alertas.forEach((a) => paragrafo(`• [${a.nivel === "alta" ? "ALTA" : a.nivel === "media" ? "MÉDIA" : "INFO"}] ${a.texto}`));
  }

  titulo("Premissas, pontos a conferir e responsabilidade");
  [
    "Tarifas, TUSDg e componentes: dados abertos da ANEEL (resolução vigente na emissão). Fio B e Fio A da energia vêm dos componentes publicados; no grupo A o Fio B fica quase todo na demanda.",
    "Compensação: primeiro no mesmo posto; o excedente de um posto cobre o outro pela razão das TE (FAQ ANEEL; conferir se a REN 1.059 usa TE+TUSD). Créditos valem 60 meses.",
    "Parcela não compensada: GD II = % do Fio B do ano (2026 = 60%); GD III = 100% Fio B + 40% Fio A + P&D/TFSEE até 2028; a partir de 2029 vale o art. 17 da Lei 14.300 (valoração da ANEEL a confirmar).",
    "Demanda de geração: TUSDg sobre a injeção que excede a demanda de consumo ou sobre toda a injeção, conforme a opção escolhida (conferir o §7º do art. 655-J da REN 1.000). Ultrapassagem: 2x acima de 105% da contratada.",
    "Tributos por dentro, item a item. ICMS: Convênio ICMS 16/2015 isenta a energia compensada (não isenta demanda, TUSDg, reativo, custo de disponibilidade); confira o RICMS do estado, inclusive sobre o Fio B. PIS/Cofins zero na energia compensada (Lei 13.169/2015, art. 8º).",
    "Reativo, CIP e outros itens foram lançados como constam na fatura. Este laudo é uma conferência técnica automatizada e não substitui parecer jurídico ou contábil.",
  ].forEach((s) => paragrafo(`• ${s}`));

  return fechar();
}
