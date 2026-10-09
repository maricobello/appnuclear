import { barChart } from "../charts";
import type { ReportContext } from "../context";
import { fmtBRL, fmtBRLCompact, fmtMultiple, fmtNum, fmtPct, fmtYears } from "../format";
import { cdiNetPct } from "../insights";
import type { Cell } from "../layout";
import { C } from "../theme";

export function renderEconomics(ctx: ReportContext): void {
  const { l, a } = ctx;
  const f = a.finance;
  const p = a.plant;
  l.sectionTitle(5, "Análise econômica", {
    minSpace: 210,
    lead: "Fluxo de caixa nominal da SPE no cenário P50, do ponto de vista do cotista: captação no ano 0 e receita líquida distribuída depois.",
  });

  // ── premissas (duas colunas de pares) ──
  const asm = f.assumptions ?? [];
  if (asm.length) {
    l.subTitle("Premissas", { minSpace: 120 });
    const half = Math.ceil(asm.length / 2);
    const rows: Cell[][] = [];
    for (let i = 0; i < half; i++) {
      const left = asm[i];
      const right = asm[i + half];
      rows.push([
        { text: left.label, color: C.muted },
        { text: left.value, font: "semibold" },
        { text: right?.label ?? "", color: C.muted },
        { text: right?.value ?? "", font: "semibold" },
      ]);
    }
    l.table({
      columns: [
        { header: "Premissa", width: 2.05 },
        { header: "Valor", width: 1.75 },
        { header: "Premissa", width: 2.05 },
        { header: "Valor", width: 1.75 },
      ],
      rows,
      size: 7.3,
      padY: 2.9,
      after: 10,
    });
  }

  // ── indicadores ──
  l.subTitle("Indicadores de retorno (cenário P50)", { minSpace: 120 });
  const cdiNet = cdiNetPct(a);
  l.tiles(
    [
      { label: "TIR nominal", value: `${fmtPct(f.irrNominalPct)} a.a.`, sub: `CDI líquido: ${fmtPct(cdiNet)} a.a.`, valueColor: f.irrNominalPct >= cdiNet ? C.green : C.redStrong },
      { label: "TIR real", value: `${fmtPct(f.irrRealPct)} a.a.`, sub: `Deflator: IPCA ${fmtPct(a.market.ipcaLongTermPct)} a.a.` },
      { label: `VPL @ ${fmtPct(f.discountRatePct)}`, value: fmtBRLCompact(f.npvBRL), sub: "Valor presente líquido", valueColor: f.npvBRL >= 0 ? C.navy : C.redStrong },
      { label: "Payback simples", value: fmtYears(f.paybackYears), sub: "Fluxo acumulado nominal" },
      { label: "Payback descontado", value: fmtYears(f.discountedPaybackYears), sub: `Taxa ${fmtPct(f.discountRatePct)} a.a.` },
      { label: "LCOE", value: `${fmtBRL(f.lcoeBRLPerMWh, 0)}/MWh`, sub: "Custo nivelado da energia", accent: C.navy },
      { label: "ROI total", value: fmtPct(f.roiTotalPct, 0), sub: `Em ${p.finance.horizonYears} anos (nominal)`, accent: C.navy },
      { label: "MOIC", value: fmtMultiple(f.moic), sub: "Distribuições / aporte", accent: C.navy },
      { label: "Yield ano 1", value: fmtPct(f.firstYearYieldPct), sub: "Distribuição / aporte", accent: C.navy },
      { label: "Yield médio", value: `${fmtPct(f.avgYieldPct)} a.a.`, sub: "Média simples no horizonte", accent: C.navy },
    ],
    { cols: 5, height: 44, gap: 5, after: 8, valueSize: 12 },
  );

  // ── gráfico de fluxo de caixa ──
  const cfs = [...(f.cashFlows ?? [])].sort((x, y) => x.year - y.year);
  if (cfs.length > 1) {
    l.subTitle("Fluxo de caixa anual e acumulado", { minSpace: 180, right: "R$ milhões (nominal)" });
    l.ensure(152);
    barChart(l, { x: l.x0, y: l.y, w: l.width, h: 148 }, {
      categories: cfs.map((c) => String(c.year)),
      series: [
        {
          name: "Fluxo líquido do ano",
          values: cfs.map((c) => c.netCashFlowBRL / 1e6),
          color: C.green,
          colorFn: (v, i) => (v < 0 ? C.redStrong : cfs[i].capexBRL > 0 && cfs[i].year > 0 ? C.amberDark : C.green),
        },
      ],
      lines: [{ name: "Acumulado", values: cfs.map((c) => c.cumulativeBRL / 1e6), color: C.navy, dots: true, width: 1.3 }],
      yFormat: (v) => fmtNum(v, Math.abs(v) < 10 && v % 1 !== 0 ? 1 : 0),
      legend: true,
      labelEvery: cfs.length > 16 ? 2 : 1,
      barRatio: 0.66,
      maxTicks: 7,
    });
    l.y += 152;
    const inv = cfs.find((c) => c.year > 0 && c.capexBRL > 0);
    l.caption(
      `Ano 0: captação de ${fmtBRL(f.investmentBRL, 0)} (CAPEX ${fmtBRL(f.capexBRL, 0)} + estruturação). ` +
        (inv ? `Barra âmbar: ano ${inv.year} com reposição de inversores (${fmtBRL(inv.capexBRL, 0)}). ` : "") +
        "Linha: saldo acumulado; o cruzamento com zero indica o payback.",
      { after: 8 },
    );

    // ── tabela condensada ──
    const N = cfs[cfs.length - 1].year;
    const wanted = new Set([0, 1, 2, 3, 4, 5, 10, 15, 20, N]);
    cfs.filter((c) => c.year > 0 && c.capexBRL > 0).forEach((c) => wanted.add(c.year));
    const sel = cfs.filter((c) => wanted.has(c.year));
    const k = (v: number) => fmtNum(v / 1000, 0);
    const neg = (v: number) => (v < 0 ? C.redStrong : C.text);
    const rows: Cell[][] = sel.map((c) => [
      { text: String(c.year), font: "semibold" },
      String(c.calendarYear),
      c.year === 0 ? "—" : fmtNum(c.energyMWh, 0),
      c.year === 0 ? "—" : fmtNum(c.priceBRLPerKWh, 3),
      c.year === 0 ? "—" : `${fmtNum(c.fioBChargedPct, 0)} %`,
      k(c.revenueBRL),
      c.taxesBRL ? `-${k(c.taxesBRL)}` : "0",
      c.opexBRL ? `-${k(c.opexBRL)}` : "0",
      { text: c.capexBRL ? `-${k(c.capexBRL)}` : "0", color: c.capexBRL ? C.red : C.text },
      { text: k(c.netCashFlowBRL), font: "semibold", color: neg(c.netCashFlowBRL) },
      { text: k(c.cumulativeBRL), color: neg(c.cumulativeBRL) },
    ]);
    const sum = (fn: (c: (typeof cfs)[number]) => number) => cfs.reduce((s, c) => s + fn(c), 0);
    const totals: Cell[] = [
      { text: "Total" },
      `${cfs[0].calendarYear}–${cfs[cfs.length - 1].calendarYear}`,
      fmtNum(sum((c) => c.energyMWh), 0),
      "",
      "",
      k(sum((c) => c.revenueBRL)),
      `-${k(sum((c) => c.taxesBRL))}`,
      `-${k(sum((c) => c.opexBRL))}`,
      { text: `-${k(sum((c) => c.capexBRL))}`, color: C.red },
      { text: k(sum((c) => c.netCashFlowBRL)), color: neg(sum((c) => c.netCashFlowBRL)) },
      "",
    ];
    l.subTitle("Fluxo de caixa condensado", { minSpace: 200, right: "R$ mil (nominal), salvo indicação" });
    l.table({
      columns: [
        { header: "Ano", width: 0.6, align: "right" },
        { header: "Calend.", width: 0.95, align: "right" },
        { header: "Energia (MWh)", width: 1.05, align: "right" },
        { header: "R$/kWh líquido", width: 1.05, align: "right" },
        { header: "Fio B cobrado", width: 0.9, align: "right" },
        { header: "Receita", width: 1.0, align: "right" },
        { header: "Tributos", width: 0.95, align: "right" },
        { header: "Opex", width: 0.95, align: "right" },
        { header: "Capex", width: 1.0, align: "right" },
        { header: "Fluxo líquido", width: 1.05, align: "right" },
        { header: "Acumulado", width: 1.05, align: "right" },
      ],
      rows,
      footerRows: [totals],
      size: 7.2,
      padX: 3.5,
      after: 4,
    });
    l.caption(
      "R$/kWh líquido: receita efetiva por kWh gerado, após desconto ao assinante, Fio B e perdas de faturamento. Opex inclui O&M, seguro, arrendamento, demanda e taxa de gestão.",
      { after: 8 },
    );
  }

  // ── por cota ──
  const pc = f.perCota;
  const minC = p.token.minCotas;
  const scale = (n: number): Cell[] => [
    { text: fmtBRL(pc.priceBRL * n), font: "semibold" },
    fmtBRL(pc.firstYearIncomeBRL * n),
    fmtBRL((pc.firstYearIncomeBRL * n) / 12),
    { text: fmtBRL(pc.avgMonthlyIncomeBRL * n), font: "semibold", color: C.green },
    fmtBRL(pc.totalIncomeBRL * n),
    fmtMultiple(pc.priceBRL > 0 ? pc.totalIncomeBRL / pc.priceBRL : NaN),
  ];
  const tenK = pc.priceBRL > 0 ? Math.max(1, Math.round(10000 / pc.priceBRL)) : 100;
  l.subTitle("Retorno por cota", { minSpace: 90, right: `${p.token.symbol} · horizonte de ${p.finance.horizonYears} anos` });
  l.table({
    columns: [
      { header: "Posição", width: 2.1, font: "semibold" },
      { header: "Aporte", width: 1.1, align: "right" },
      { header: "Renda ano 1", width: 1.1, align: "right" },
      { header: "Renda mensal (ano 1)", width: 1.25, align: "right" },
      { header: "Renda mensal média", width: 1.25, align: "right" },
      { header: "Renda total", width: 1.15, align: "right" },
      { header: "Múltiplo", width: 0.8, align: "right" },
    ],
    rows: [
      ["1 cota", ...scale(1)],
      [`Mínimo (${fmtNum(minC, 0)} cotas)`, ...scale(minC)],
      [`${fmtNum(tenK, 0)} cotas`, ...scale(tenK)],
    ],
    size: 7.4,
    after: 4,
  });
  l.caption(
    "Rendas brutas de tributação do investidor, no cenário P50 e em reais nominais; distribuídas on-chain em USDT pela cotação do dia da distribuição. Projeção, não garantia.",
    { after: 4 },
  );
}
