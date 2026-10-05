import type { ReportContext } from "../context";
import { OFFERING_STATE_LABEL, addressUrl, chainLabel } from "../context";
import { fmtBRL, fmtBRLCompact, fmtDate, fmtDateTime, fmtNum, fmtPct, truncateMiddle } from "../format";
import type { Cell } from "../layout";
import { Layout } from "../layout";
import { C } from "../theme";

/** Casas decimais do USDT BEP-20 na BNB Smart Chain */
export const USDT_DECIMALS = 18;

export function fromUnits(v: bigint, decimals: number): number {
  const base = BigInt(10) ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  return Number(whole) + Number(frac) / Number(base);
}

/** Cotas a partir de um saldo do token (decimals() == 0; tolera 18 casas por segurança). */
export function toCotas(v: bigint, totalCotas: number): number {
  if (totalCotas > 0 && v > BigInt(totalCotas) * BigInt(1000)) return fromUnits(v, 18);
  return Number(v);
}

export function renderTokenization(ctx: ReportContext): void {
  const { l, a } = ctx;
  const t = a.plant.token;
  const oc = ctx.onChain;
  const chainId = oc?.chainId ?? t.chainId;
  const tokenAddr = oc?.tokenAddress ?? t.tokenAddress;
  const offeringAddr = oc?.offeringAddress ?? t.offeringAddress;
  l.sectionTitle(7, "Tokenização e transparência on-chain", {
    minSpace: 300,
    lead: "Cada cota é um token indivisível emitido na BNB Smart Chain; a oferta, a emissão, a distribuição de receita e o registro de documentos ficam publicamente verificáveis.",
  });

  const fx = a.market.usdtBrl;
  l.definitionGrid(
    [
      { label: "Token", value: `${t.name} (${t.symbol})` },
      { label: "Rede", value: chainLabel(chainId) },
      { label: "Padrão", value: "ERC-20 (BEP-20), 0 casas decimais: 1 token = 1 cota" },
      { label: "Total de cotas", value: `${fmtNum(t.totalCotas, 0)} cotas` },
      { label: "Preço da cota", value: `${fmtBRL(t.cotaPriceBRL)} · ${fmtNum(t.cotaPriceUSDT, 2)} USDT` },
      { label: "Captação alvo", value: `${fmtBRLCompact(t.totalCotas * t.cotaPriceBRL)} · ${fmtNum(t.totalCotas * t.cotaPriceUSDT, 0)} USDT` },
      { label: "Investimento mínimo", value: `${fmtNum(t.minCotas, 0)} cotas (${fmtBRL(t.minCotas * t.cotaPriceBRL)})` },
      { label: "Soft cap", value: `${fmtNum(t.softCapCotas, 0)} cotas (${fmtPct((t.softCapCotas / t.totalCotas) * 100, 0)} da oferta)` },
      { label: "Custo de estruturação", value: `${fmtPct(t.structuringFeePct)} da captação` },
      { label: "Período da oferta", value: t.offeringStart || t.offeringEnd ? `${fmtDate(t.offeringStart)} a ${fmtDate(t.offeringEnd)}` : "A definir" },
      { label: "Pagamento", value: "USDT (BEP-20) com escrow no contrato da oferta" },
      { label: "USDT/BRL na emissão", value: Number.isFinite(fx) ? fmtNum(fx, 4) : "—" },
    ],
    { cols: 3, after: 8 },
  );

  // ── contratos ──
  l.subTitle("Contratos inteligentes", { minSpace: 80 });
  const contractRow = (label: string, addr: string | undefined, role: string): Cell[] => {
    const url = addr ? addressUrl(chainId, addr) : null;
    return [
      { text: label, font: "semibold" },
      addr ? { text: addr, font: "mono", size: 7 } : { text: "A definir (contrato ainda não implantado)", color: C.muted },
      url ? { text: "BscScan ↗", color: C.sky, link: url, font: "semibold" } : { text: "—", color: C.muted },
      { text: role, color: C.muted },
    ];
  };
  l.table({
    columns: [
      { header: "Contrato", width: 1.05 },
      { header: "Endereço", width: 3.0 },
      { header: "Explorador", width: 0.8 },
      { header: "Função", width: 2.25 },
    ],
    rows: [
      contractRow("Token da cota", tokenAddr, "Emissão, transferência com KYC, distribuição de receita (ERC-2222) e documentos (ERC-1643)."),
      contractRow("Oferta", offeringAddr, "Recebe USDT em escrow, aplica soft cap e mínimos, libera cotas ou reembolso."),
    ],
    size: 7.3,
    after: 8,
  });

  // ── estado on-chain ──
  if (oc) {
    const sold = toCotas(oc.cotasSold, t.totalCotas);
    const supply = toCotas(oc.totalSupply, t.totalCotas);
    const max = toCotas(oc.maxSupply, t.totalCotas) || t.totalCotas;
    const raised = fromUnits(oc.raisedUSDT, USDT_DECIMALS);
    const progress = max > 0 ? sold / max : 0;
    const soft = t.softCapCotas;
    l.subTitle("Estado da oferta on-chain", { minSpace: 120, right: `Leitura em ${fmtDateTime(ctx.now, true)}` });
    l.tiles(
      [
        { label: "Situação da oferta", value: OFFERING_STATE_LABEL[oc.offeringState] ?? oc.offeringState, accent: C.navy, valueColor: oc.offeringState === "failed" || oc.offeringState === "cancelled" ? C.redStrong : C.navy },
        { label: "Cotas vendidas", value: `${fmtNum(sold, 0)}`, sub: `${fmtPct(progress * 100)} de ${fmtNum(max, 0)} cotas`, accent: C.amber },
        { label: "Captado", value: `${fmtNum(raised, 0)} USDT`, sub: Number.isFinite(fx) ? `≈ ${fmtBRLCompact(raised * fx)} a ${fmtNum(fx, 2)} BRL/USDT` : undefined, accent: C.green },
        { label: "Cotas emitidas (supply)", value: fmtNum(supply, 0), sub: `Máximo: ${fmtNum(max, 0)}`, accent: C.navy },
      ],
      { cols: 4, height: 44, after: 6, valueSize: 12 },
    );
    // barra de progresso com soft cap
    l.ensure(26);
    const bx = l.x0;
    const bw = l.width;
    const by = l.y + 4;
    l.roundRect(bx, by, bw, 8, 4, { fill: C.panel });
    if (progress > 0) l.roundRect(bx, by, Math.max(8, bw * Math.min(1, progress)), 8, 4, { fill: C.amber });
    if (max > 0) {
      const sx = bx + bw * Math.min(1, soft / max);
      l.line(sx, by - 3, sx, by + 11, { color: C.navy, width: 1.2 });
      l.text(`Soft cap ${fmtNum(soft, 0)}`, sx - 60, by + 19, { font: "semibold", size: 6.4, color: C.navy, align: "center", width: 120 });
    }
    l.y = by + 26;

    if (oc.documents.length) {
      l.subTitle("Documentos registrados no contrato (ERC-1643)", { minSpace: 70 });
      const hash = (a.dataHash || "").toLowerCase();
      l.table({
        columns: [
          { header: "Documento", width: 2.3 },
          { header: "Hash (SHA-256)", width: 2.5 },
          { header: "Registro", width: 1.0 },
          { header: "URI", width: 1.6 },
        ],
        rows: oc.documents.map((d) => {
          const isThis = d.hash.replace(/^0x/, "").toLowerCase() === hash;
          return [
            { text: d.name + (isThis ? " — este relatório" : ""), font: isThis ? "semibold" : "regular", color: isThis ? C.green : C.text },
            { text: truncateMiddle(d.hash, 34), font: "mono", size: 6.8 },
            fmtDateTime(d.timestamp * 1000),
            { text: truncateMiddle(d.uri.replace(/^https?:\/\//, ""), 34), color: C.sky, link: /^https?:/.test(d.uri) ? d.uri : undefined, size: 6.8 },
          ];
        }),
        size: 7.2,
        after: 8,
      });
    }
  } else {
    l.callout(
      [
        tokenAddr
          ? "Estado on-chain não consultado nesta emissão. Consulte o contrato na BscScan pelos links acima ou a página da usina para os valores atualizados de cotas vendidas e captação."
          : "Os contratos desta usina ainda não foram implantados. Após o deploy, o estado da oferta (cotas vendidas, captação, documentos registrados) passa a constar deste relatório.",
      ],
      { accent: C.subtle, size: 8, after: 8 },
    );
  }

  // ── fluxo de distribuição ──
  l.subTitle("Como a receita chega ao investidor", { minSpace: 110 });
  const steps = [
    ["Geração", "A usina injeta energia na rede da distribuidora."],
    ["Créditos", "Créditos de energia cedidos aos assinantes com desconto."],
    ["Receita da SPE", "Assinantes pagam; a SPE quita tributos, O&M e taxas."],
    ["Conversão", "Receita líquida convertida de BRL para USDT."],
    ["Distribuição", "Depósito no contrato, pro-rata por cota (ERC-2222)."],
    ["Claim", "O investidor saca seu USDT quando quiser."],
  ];
  const n = steps.length;
  const gap = 8;
  const bwid = (l.width - gap * (n - 1)) / n;
  const boxH = 54;
  l.ensure(boxH + 8);
  const top = l.y;
  steps.forEach(([title, desc], i) => {
    const x = l.x0 + i * (bwid + gap);
    l.rect(x, top, bwid, boxH, { fill: i === n - 1 ? C.amberSoft : C.panel });
    l.rect(x, top, bwid, 2, { fill: i === n - 1 ? C.amber : C.navy });
    l.text(`${i + 1}`, x + 6, top + 13, { font: "bold", size: 8, color: C.amberDark });
    l.text(title, x + 15, top + 13, { font: "semibold", size: 7.4, color: C.navy, width: bwid - 18, truncate: true });
    const lines = l.wrapRuns([{ text: desc }], 6.6, bwid - 12);
    lines.slice(0, 4).forEach((ln, j) => l.drawLine(ln, x + 6, Layout.baseline(top + 19 + j * 8.6, 8.6, 6.6), 6.6, C.muted));
    if (i < n - 1) {
      const ax = x + bwid + 1.5;
      const ay = top + boxH / 2;
      l.polygon(
        [
          [ax, ay - 3],
          [ax + 5, ay],
          [ax, ay + 3],
        ],
        { fill: C.subtle },
      );
    }
  });
  l.y = top + boxH + 8;
  l.bullets(
    [
      "Transferências e saques de receita exigem carteira com KYC válido no IdentityRegistry; a receita acumulada antes de uma transferência permanece com quem transferiu.",
      `Se o soft cap de ${fmtNum(t.softCapCotas, 0)} cotas não for atingido até o fim da oferta, os investidores recuperam o USDT depositado em escrow.`,
      "Papéis administrativos (emissão, distribuição, pausa, recuperação de carteira) devem ser exercidos por multisig; o contrato é imutável (sem proxy).",
      "O hash SHA-256 deste relatório é publicado no registro de documentos do token, permitindo a qualquer pessoa conferir a autenticidade do PDF.",
    ],
    { size: 7.8, gap: 1.2, after: 4 },
  );
}
