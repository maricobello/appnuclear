import { describe, expect, it } from "vitest";
import { addDays, dayType, easter, equivalentDay, nationalHolidays } from "@/lib/market/calendar";
import {
  avgLoadMw,
  buildStats,
  clampShape,
  contractCalendar,
  costHistogram,
  counterpartyExposure,
  evaluate,
  fairPrices,
  fillMonth,
  impliedRho,
  loadShape,
  lognormal,
  monthlyLevels,
  monthTable,
  objective,
  optimizeContract,
  quantile,
  risk,
  rng,
  searcher,
  shocks,
  spreadRatio,
  topMean,
  typicalLoad,
  type Contract,
  type MonthBand,
  type Side,
  type StatsInput,
  unitCost,
} from "@/lib/market/contracting";
import { contractLoad, curveStats, parseLoadCsv, parseNumber } from "@/lib/market/loadcurve";
import { BANDEIRAS_RS_MWH, MIGRACAO, RADAR, radarSorted } from "@/lib/market/radar";

const LIM = { min: 57.31, maxHourly: 1611.04 };
const MONTHS = ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10"];
const cal = contractCalendar(MONTHS);
const bands = (p50: (m: number) => number, p90: (m: number) => number): MonthBand[] => MONTHS.map((mes, m) => ({ mes, p10: LIM.min, p50: p50(m), p90: p90(m) }));
/** Desvio típico de 2026: meio-dia barato (solar), fim de tarde caro, fim de semana mais barato. */
const DEV = Float64Array.from({ length: cal.total }, (_, i) => {
  const h = i % 24;
  const t = dayType(cal.days[Math.floor(i / 24)].date);
  return (h >= 10 && h <= 15 ? -80 : h >= 18 && h <= 21 ? 120 : 0) + (t === "util" ? 10 : -25);
});
const side = (b: MonthBand[], rho = 0.7, dev: ArrayLike<number> = DEV): Side => ({ bands: b, lims: MONTHS.map(() => LIM), dev, rho });
const flatLoad = (mw: number) => new Float64Array(cal.total).fill(mw);
const input = (load: ArrayLike<number>, over: Partial<StatsInput> = {}): StatsInput => ({
  cal,
  load,
  loadSide: side(bands(() => 150, () => 320)),
  contractSide: null,
  crossRho: 0.9,
  uncertainty: { annual: 0, monthly: 0 },
  n: 400,
  ...over,
});
const contract = (volumes: number[], over: Partial<Contract> = {}): Contract => ({ price: 150, volumes, flex: 0, flexRule: "carga", modulation: "flat", losses: 0, ...over });
const sd = (x: Float64Array) => {
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / x.length);
};

describe("calendário do contrato", () => {
  it("Páscoa, feriados nacionais, tipo de dia e dia equivalente do histórico", () => {
    expect(easter(2026)).toBe("2026-04-05");
    expect(easter(2027)).toBe("2027-03-28");
    const h27 = nationalHolidays(2027);
    for (const d of ["2027-02-08", "2027-02-09", "2027-03-26", "2027-05-27", "2027-11-20", "2027-12-25"]) expect(h27.has(d)).toBe(true);
    expect(dayType("2026-11-20")).toBe("dom"); // sexta, feriado
    expect(dayType("2026-11-21")).toBe("sab");
    expect(dayType("2026-11-23")).toBe("util");
    expect(cal.total).toBe(365 * 24);
    // segunda-feira ↔ a segunda-feira de 52 semanas antes; feriado ↔ feriado do mesmo mês
    expect(equivalentDay("2026-11-23", () => true)).toBe("2025-11-24");
    expect(equivalentDay("2026-11-20", () => true)).toBe("2025-11-20");
    expect(equivalentDay("2026-11-23", (d) => d !== "2025-11-24")).toBe("2025-11-25"); // outro dia útil, o mais perto
    expect(equivalentDay("2026-11-23", () => false)).toBeNull();
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });
});

describe("cenários de preço", () => {
  it("nível: mediana no P50, P90 no P90, piso respeitado, correlação controla a largura da média anual", () => {
    const b = bands(() => 150, () => 300);
    const sh = shocks(4000, 12, 1);
    const ind = monthlyLevels(b, 0, sh, b.map(() => LIM.min));
    const col = ind.map((x) => x[0]);
    expect(quantile(col, 0.5)).toBeCloseTo(150, -1);
    expect(quantile(col, 0.9)).toBeCloseTo(300, -1);
    expect(Math.min(...col)).toBeGreaterThanOrEqual(LIM.min);
    expect(spreadRatio(monthlyLevels(b, 0.95, sh, b.map(() => LIM.min)))).toBeGreaterThan(spreadRatio(ind) + 0.3);
    const target = spreadRatio(monthlyLevels(b, 0.6, shocks(4000, 12, 9), b.map(() => LIM.min)));
    expect(impliedRho(b, target, b.map(() => LIM.min), 4000)).toBeCloseTo(0.6, 1);
    expect(lognormal({ mes: "x", p10: null, p50: null, p90: null }, LIM.min).mu).toBeCloseTo(Math.log(LIM.min));
  });

  it("horas do mês: média igual ao nível, entre piso e teto", () => {
    const out = new Float64Array(cal.total);
    const [a, b] = [cal.offset[0], cal.offset[0] + cal.hours[0]];
    for (const level of [70, 90, 150, 600]) {
      fillMonth(level, DEV, a, b, LIM, out);
      const seg = out.subarray(a, b);
      expect(seg.reduce((x, y) => x + y, 0) / seg.length).toBeCloseTo(level, 5);
      expect(Math.min(...seg)).toBeGreaterThanOrEqual(LIM.min - 1e-9);
      expect(Math.max(...seg)).toBeLessThanOrEqual(LIM.maxHourly + 1e-9);
    }
    fillMonth(40, DEV, a, b, LIM, out);
    expect(out[a]).toBe(LIM.min);
  });
});

describe("contrato completo", () => {
  it("sem contrato paga a carga ao PLD; flat igual à carga flat sem flexibilidade trava o custo em P", () => {
    const st = buildStats(input(flatLoad(10)));
    const spot = evaluate(st, contract(new Array(12).fill(0))).total;
    let sumX = 0;
    for (let m = 0; m < 12; m++) sumX += st.X[m];
    expect(spot[0]).toBeCloseTo(sumX, 3);
    const hedged = evaluate(st, contract(new Array(12).fill(10))).total;
    for (const c of hedged) expect(c).toBeCloseTo(10 * cal.total * 150, 2);
    expect(avgLoadMw(st)).toBeCloseTo(10, 9);
  });

  it("flexibilidade pelo consumo absorve a incerteza da carga; a opção livre nunca custa mais que o ajuste ao consumo", () => {
    const st = buildStats(input(flatLoad(10), { uncertainty: { annual: 0.1, monthly: 0.05 } }));
    const v = new Array(12).fill(10);
    // o custo por MWh consumido: com a flexibilidade cobrindo o choque, fica no preço do contrato
    const rigid = unitCost(evaluate(st, contract(v)));
    const flex = unitCost(evaluate(st, contract(v, { flex: 0.3 })));
    expect(sd(flex)).toBeLessThan(sd(rigid) * 0.2);
    const livre = evaluate(st, contract(v, { flex: 0.3, flexRule: "livre" })).total;
    const carga = evaluate(st, contract(v, { flex: 0.3 })).total;
    for (let s = 0; s < st.n; s++) expect(livre[s]).toBeLessThanOrEqual(carga[s] + 1e-6);
  });

  it("modulação pela carga com flexibilidade cobrindo a carga fixa o custo por MWh no preço do contrato", () => {
    const evening = Float64Array.from({ length: cal.total }, (_, i) => (i % 24 >= 18 && i % 24 <= 21 ? 30 : 5));
    const st = buildStats(input(evening, { uncertainty: { annual: 0.08, monthly: 0.04 } }));
    const shape = loadShape(st, 0.5);
    const q = avgLoadMw(st);
    const c = contract(shape.map((u) => q * u), { flex: 0.5, modulation: "carga" });
    const ev = evaluate(st, c, true);
    for (let s = 0; s < st.n; s++) {
      let energy = 0;
      for (let m = 0; m < 12; m++) energy += (1 + st.eps[s * 12 + m]) * st.loadSum[m];
      expect(ev.total[s] / energy).toBeCloseTo(150, 6);
    }
    // e a carga de fim de tarde custa mais que o flat no PLD
    const fp = fairPrices(st);
    expect(fp.load).toBeGreaterThan(fp.flat + 30);
  });

  it("sazonalização: limites e balanço respeitados; a ótima nunca é pior que flat ou conforme a carga", () => {
    // verão mais barato (chuva), inverno-primavera mais caro; carga maior no verão
    const b = bands((m) => (m >= 2 && m <= 5 ? 90 : 220), (m) => (m >= 2 && m <= 5 ? 150 : 420));
    const seasonal = Float64Array.from({ length: cal.total }, (_, i) => (cal.days[Math.floor(i / 24)].month <= 4 ? 14 : 8));
    const st = buildStats(input(seasonal, { loadSide: side(b), uncertainty: { annual: 0.05, monthly: 0.03 } }));
    const u = clampShape([2, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], cal.hours, 0.2);
    expect(Math.max(...u)).toBeLessThanOrEqual(1.2 + 1e-12);
    expect(Math.min(...u)).toBeGreaterThanOrEqual(0.8 - 1e-12);
    expect(u.reduce((a, x, m) => a + x * cal.hours[m], 0)).toBeCloseTo(cal.total, 6);
    const terms = { price: 180, flex: 0.1, flexRule: "carga" as const, modulation: "flat" as const, losses: 0.02 };
    const best = (season: "flat" | "carga" | "otima") => optimizeContract(st, terms, { volume: null, season, seasonLimit: 0.2 }, 0.6);
    const [f, c, o] = [best("flat"), best("carga"), best("otima")];
    expect(objective(o.risk, 0.6)).toBeLessThanOrEqual(Math.min(objective(f.risk, 0.6), objective(c.risk, 0.6)) + 1e-6);
    expect(o.volumes.reduce((a, v, m) => a + v * cal.hours[m], 0)).toBeCloseTo(o.q * cal.total, 3);
    for (const v of o.volumes) {
      expect(v).toBeLessThanOrEqual(o.q * 1.2 + 1e-9);
      expect(v).toBeGreaterThanOrEqual(o.q * 0.8 - 1e-9);
    }
    // volume fixo é respeitado
    expect(optimizeContract(st, terms, { volume: 7, season: "carga", seasonLimit: 0.2 }, 0.6).q).toBe(7);
  });

  it("busca rápida: mesmo custo do avaliador completo, mês a mês incremental, cauda por seleção igual à ordenação", () => {
    const r = rng(5);
    const xs = Float64Array.from({ length: 2001 }, () => Math.round(r.normal() * 4)); // com empates
    for (const k of [1, 7, 100, 2001]) {
      const sorted = Float64Array.from(xs).sort();
      expect(topMean(Float64Array.from(xs), k)).toBeCloseTo(sorted.slice(xs.length - k).reduce((a, b) => a + b, 0) / k, 9);
    }
    const st = buildStats(input(typicalLoad("comercial", 10, cal), { uncertainty: { annual: 0.08, monthly: 0.04 } }));
    const vols = Array.from({ length: 12 }, (_, m) => 6 + m * 0.7);
    for (const flexRule of ["carga", "livre"] as const)
      for (const modulation of ["flat", "carga"] as const) {
        const terms = { price: 160, flex: 0.15, flexRule, modulation, losses: 0.03 };
        const S = searcher(st, terms, 0.6);
        const full = objective(risk(unitCost(evaluate(st, contract(vols, terms)))), 0.6);
        const acc = S.costs(vols, new Float64Array(st.n));
        expect(S.score(acc)).toBeCloseTo(full, 9);
        S.addMonth(3, vols[3], -1, acc);
        S.addMonth(3, 2, 1, acc);
        const moved = vols.map((v, m) => (m === 3 ? 2 : v));
        expect(S.score(acc)).toBeCloseTo(objective(risk(unitCost(evaluate(st, contract(moved, terms)))), 0.6), 9);
      }
    // e a otimização acha o volume de uma grade fina avaliada pelo custo completo
    const terms = { price: fairPrices(st).flat, flex: 0.15, flexRule: "carga" as const, modulation: "carga" as const, losses: 0.03 };
    const opt = optimizeContract(st, terms, { volume: null, season: "flat", seasonLimit: 0 }, 0.6);
    let grid = Infinity;
    for (let i = 0; i <= 300; i++) grid = Math.min(grid, objective(risk(unitCost(evaluate(st, contract(new Array(12).fill((15.45 * i) / 300), terms)))), 0.6));
    expect(objective(opt.risk, 0.6)).toBeLessThanOrEqual(grid + 0.05);
  });

  it("consumo correlacionado ao preço encarece o contrato rígido; a flexibilidade pelo consumo absorve", () => {
    const [a, b] = [0, 0.8].map((priceCorr) => buildStats(input(flatLoad(10), { uncertainty: { annual: 0.1, monthly: 0.05, priceCorr }, n: 1000 })));
    const pairs = Array.from({ length: b.n }, (_, s) => [b.eps[s * 12 + 6], Math.log(b.levelsLoad[s][6])]);
    const mean = (k: number) => pairs.reduce((x, p) => x + p[k], 0) / pairs.length;
    const [mx, my] = [mean(0), mean(1)];
    const cov = pairs.reduce((x, p) => x + (p[0] - mx) * (p[1] - my), 0);
    const corr = cov / Math.sqrt(pairs.reduce((x, p) => x + (p[0] - mx) ** 2, 0) * pairs.reduce((x, p) => x + (p[1] - my) ** 2, 0));
    expect(corr).toBeGreaterThan(0.6);
    const unit = (st: typeof a, c: Contract) => risk(unitCost(evaluate(st, c))).mean;
    const rigid = contract(new Array(12).fill(10));
    const flex = contract(new Array(12).fill(10), { flex: 0.3 });
    const dRigid = unit(b, rigid) - unit(a, rigid);
    expect(dRigid).toBeGreaterThan(2);
    expect(Math.abs(unit(b, flex) - unit(a, flex))).toBeLessThan(dRigid * 0.3);
  });

  it("volume: sem aversão a risco é de canto; com aversão total cobre a carga", () => {
    const st = buildStats(input(flatLoad(10)));
    const fair = fairPrices(st).flat;
    const terms = (price: number) => ({ price, flex: 0, flexRule: "carga" as const, modulation: "flat" as const, losses: 0 });
    const plan = { volume: null, season: "flat" as const, seasonLimit: 0 };
    expect(optimizeContract(st, terms(fair - 20), plan, 0).q).toBeGreaterThan(14.5);
    expect(optimizeContract(st, terms(fair + 20), plan, 0).q).toBeLessThan(0.5);
    const hedge = optimizeContract(st, terms(fair), plan, 1);
    expect(hedge.q / 10).toBeGreaterThan(0.95);
    expect(hedge.q / 10).toBeLessThan(1.05);
    expect(hedge.risk.cvar).toBeLessThan(risk(unitCost(evaluate(st, contract(new Array(12).fill(0), { price: fair })))).cvar);
  });

  it("contrato em outro submercado: correlação 1 e mesmos dados reproduzem o mesmo submercado; spread entra no custo", () => {
    const same = buildStats(input(flatLoad(10)));
    const twin = buildStats(input(flatLoad(10), { contractSide: side(bands(() => 150, () => 320)), crossRho: 1 }));
    for (let i = 0; i < 50; i++) expect(twin.T[i]).toBeCloseTo(same.T[i], 6);
    const ne = buildStats(input(flatLoad(10), { contractSide: side(bands(() => 110, () => 220)), crossRho: 0.8 }));
    const c = contract(new Array(12).fill(10));
    // contrato num submercado mais barato: liquida a carga mais cara contra o contrato mais barato
    expect(risk(evaluate(ne, c).total).mean).toBeGreaterThan(risk(evaluate(same, c).total).mean);
  });

  it("tabela mensal fecha com o custo esperado; contraparte cai até o fim e a recuperação reduz a exposição", () => {
    const st = buildStats(input(flatLoad(10), { uncertainty: { annual: 0.05, monthly: 0.03 } }));
    const c = contract(new Array(12).fill(10), { flex: 0.1, price: 140, losses: 0.02 });
    const rows = monthTable(st, c);
    let energy = 0;
    let cost = 0;
    rows.forEach((r, m) => {
      let e = 0;
      for (let s = 0; s < st.n; s++) e += (1 + st.eps[s * 12 + m]) * 1.02 * st.loadSum[m];
      energy += e / st.n;
      cost += (r.custoMwh * e) / st.n;
      expect(r.min).toBeCloseTo(9, 9);
      expect(r.max).toBeCloseTo(11, 9);
    });
    expect(cost).toBeCloseTo(risk(evaluate(st, c).total).mean, -2);
    expect(energy).toBeGreaterThan(0);
    const ex = counterpartyExposure(st, c);
    expect(ex[0].ee).toBeGreaterThan(ex[11].ee);
    for (const e of ex) expect(e.pfe).toBeGreaterThanOrEqual(e.ee * 0.999);
    expect(counterpartyExposure(st, c, 0.5)[0].ee).toBeCloseTo(ex[0].ee / 2, 6);
    const hist = costHistogram(st, [contract(new Array(12).fill(0)), c]);
    expect(hist.counts[1].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it("perfis típicos por tipo de dia na média pedida", () => {
    const l = typicalLoad("comercial", 2, cal);
    expect(l.reduce((a, b) => a + b, 0) / l.length).toBeCloseTo(2, 9);
    const sat = cal.days.findIndex((d) => dayType(d.date) === "sab");
    const mon = cal.days.findIndex((d) => dayType(d.date) === "util");
    expect(l[sat * 24 + 11]).toBeLessThan(l[mon * 24 + 11]);
  });
});

describe("curva de carga em CSV", () => {
  it("memória de massa brasileira: ; e vírgula decimal, data e hora separadas, 15 min em kWh", () => {
    const rows = ["Data;Hora;Consumo ativo (kWh)"];
    for (let d = 1; d <= 2; d++)
      for (let i = 0; i < 96; i++) {
        const h = Math.floor(i / 4);
        const m = (i % 4) * 15;
        rows.push(`0${d}/03/2026;${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")};${h >= 18 && h <= 20 ? "500,0" : "250,0"}`);
      }
    const c = parseLoadCsv(rows.join("\n"));
    expect(c.intervalMin).toBe(15);
    expect(c.unit).toBe("kWh");
    expect(c.unitGuessed).toBe(false);
    expect(c.hourly).toHaveLength(48);
    expect(c.hourly[0].mw).toBeCloseTo(1, 9); // 250 kWh a cada 15 min = 1 MW
    expect(c.hourly.find((p) => p.h === 19)!.mw).toBeCloseTo(2, 9);
    const stats = curveStats(c);
    expect(stats.peakMw).toBeCloseTo(2, 9);
    expect(stats.peakShare).toBeCloseTo((3 * 2) / (21 * 1 + 3 * 2), 9);
  });

  it("ISO com vírgula como separador e ponto decimal, horária em kW; e hora 24:00 marca o fim do intervalo", () => {
    const iso = ["timestamp,demanda kW"];
    for (let h = 0; h < 48; h++) iso.push(`2026-07-${String(1 + Math.floor(h / 24)).padStart(2, "0")}T${String(h % 24).padStart(2, "0")}:00:00,${(1500.5).toFixed(1)}`);
    const a = parseLoadCsv(iso.join("\n"));
    expect(a.unit).toBe("kW");
    expect(a.intervalMin).toBe(60);
    expect(a.hourly[0].mw).toBeCloseTo(1.5005, 9);
    const end = ["data;valor"];
    for (let h = 1; h <= 24; h++) end.push(`2026-01-10 ${String(h).padStart(2, "0")}:00;100`);
    const b = parseLoadCsv(end.join("\n"));
    expect(b.hourly[0].h).toBe(0);
    expect(b.hourly[23].h).toBe(23);
    expect(b.unitGuessed).toBe(true);
    expect(() => parseLoadCsv("a;b\n1;2\n3;4")).toThrow();
    expect(parseNumber("1.234,5", true)).toBe(1234.5);
    expect(parseNumber("12.5", false)).toBe(12.5);
    expect(parseNumber("abc", true)).toBeNull();
  });

  it("um ano de curva vira o ano do contrato dia a dia, com o tipo de dia preservado", () => {
    const rows = ["data;hora;MW"];
    for (let i = 0; i < 365; i++) {
      const d = addDays("2025-11-01", i);
      const v = dayType(d) === "util" ? "2,0" : "1,0";
      for (let h = 0; h < 24; h++) rows.push(`${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)};${String(h).padStart(2, "0")}:00;${v}`);
    }
    const curve = parseLoadCsv(rows.join("\n"));
    const { load, equivalent, fallback } = contractLoad(curve, cal);
    expect(equivalent).toBe(365);
    expect(fallback).toBe(0);
    cal.days.forEach((d, i) => expect(load[i * 24 + 12]).toBe(dayType(d.date) === "util" ? 2 : 1));
  });
});

describe("radar regulatório", () => {
  it("datas válidas, fontes https, ids únicos e ordenação do mais recente", () => {
    const ids = new Set<string>();
    for (const r of RADAR) {
      expect(r.data).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
      expect(r.fontes.length).toBeGreaterThan(0);
      for (const f of r.fontes) expect(f.url).toMatch(/^https:\/\//);
      for (const m of r.marcos ?? []) expect(m.data).toMatch(/^\d{4}(-\d{2}(-\d{2})?)?$/);
      expect(ids.has(r.id)).toBe(false);
      ids.add(r.id);
    }
    expect(radarSorted()[0].id).toBe("open-energy");
    expect(BANDEIRAS_RS_MWH.vermelha2).toBeCloseTo(78.77);
    expect(MIGRACAO.map((m) => m.desde)).toEqual(["2024-01-01", "2027-11-25", "2028-11-25"]);
  });
});
