import { describe, expect, it } from "vitest";
import { christoffersen, dieboldMariano, kupiecBlocks } from "../src/lib/quant/metrics";
import { calibrateMRJDSegments, calibrateTwoFactor, correctNickell, nickellBias, simulateTwoFactor } from "../src/lib/quant/ou";
import { mean, mulberry32, randn, std } from "../src/lib/quant/stats";

/** Painel sintético: nível diário AR(1) + OU intradiário (+ saltos opcionais). */
function panel(days: number, b: number, sdU: number, sdDay: number, phi: number, seed: number, jump = { p: 0, sd: 0 }) {
  const rng = mulberry32(seed);
  const segs: number[][] = [];
  let lvl = sdDay * randn(rng);
  let u = (sdU / Math.sqrt(1 - b * b)) * randn(rng);
  for (let d = 0; d < days; d++) {
    if (d > 0) lvl = phi * lvl + sdDay * Math.sqrt(1 - phi * phi) * randn(rng);
    const row: number[] = [];
    for (let h = 0; h < 24; h++) {
      u = b * u + sdU * randn(rng);
      if (jump.p > 0 && rng() < jump.p) u += jump.sd * randn(rng);
      row.push(lvl + u);
    }
    segs.push(row);
  }
  return segs;
}

describe("MRJD de dois fatores (nível diário + intradiário)", () => {
  it("Nickell: viés negativo e a inversão recupera b", () => {
    expect(nickellBias(0.7, 24)).toBeLessThan(0);
    for (const b of [0.3, 0.6, 0.85]) expect(correctNickell(b + nickellBias(b, 24), 24)).toBeCloseTo(b, 4);
  });

  it("recupera κ e a variância do nível diário onde o AR(1) agrupado falha", () => {
    const b = Math.exp(-0.3); // κ = 0,3/h (meia-vida ≈ 2,3 h)
    const sdU = 0.1;
    const vU = sdU ** 2 / (1 - b * b);
    const segs = panel(400, b, sdU, Math.sqrt(vU), 0.4, 11); // variância entre dias = intradiária
    const tf = calibrateTwoFactor(segs);
    const pooled = calibrateMRJDSegments(segs);
    expect(tf.kappa).toBeGreaterThan(0.24);
    expect(tf.kappa).toBeLessThan(0.38);
    expect(pooled.kappa).toBeLessThan(0.2); // o método antigo subestima κ
    expect(tf.dayVar / vU).toBeGreaterThan(0.6);
    expect(tf.dayVar / vU).toBeLessThan(1.5);
    expect(tf.dayPhi).toBeGreaterThan(0.2);
    expect(tf.dayPhi).toBeLessThan(0.6);
    // o simulado reproduz a dispersão da MÉDIA DIÁRIA observada
    const sim = simulateTwoFactor(tf, 24, 4000, mulberry32(5));
    const sdSimDay = std(sim.map((p) => mean(p)));
    const sdObsDay = std(segs.map((s) => mean(s)));
    expect(sdSimDay / sdObsDay).toBeGreaterThan(0.8);
    expect(sdSimDay / sdObsDay).toBeLessThan(1.25);
  });
});

describe("dois fatores com saltos (resíduos reais têm caudas pesadas)", () => {
  it("filtro robusto não confunde o nível do dia com saltos: κ e dayVar sobrevivem", () => {
    const b = Math.exp(-0.3);
    const sdU = 0.1;
    const vU = sdU ** 2 / (1 - b * b);
    const segs = panel(200, b, sdU, Math.sqrt(vU), 0.4, 17, { p: 0.04, sd: 0.6 });
    const tf = calibrateTwoFactor(segs);
    expect(tf.kappa).toBeGreaterThan(0.2);
    expect(tf.kappa).toBeLessThan(0.42);
    expect(tf.dayVar / vU).toBeGreaterThan(0.4);
    expect(tf.lambda * 24).toBeLessThan(2); // ~1 salto/dia simulado, não 2–2,5 espúrios
  });
});

describe("testes de cobertura e DM com dependência", () => {
  it("Kupiec por blocos não rejeita cobertura correta com violações agrupadas no dia", () => {
    const rng = mulberry32(21);
    const hits: number[] = [];
    for (let d = 0; d < 60; d++) {
      const bad = rng() < 0.1; // 10% dos dias inteiros violam (taxa média 10%, ICC alto)
      for (let h = 0; h < 24; h++) hits.push(bad ? (rng() < 0.9 ? 1 : 0) : rng() < 0.012 ? 1 : 0);
    }
    const k = kupiecBlocks(hits, 24, 0.1);
    expect(k.deff).toBeGreaterThan(3);
    expect(k.pValue).toBeGreaterThan(0.01);
    const c = christoffersen(hits, 1);
    expect(c.pi11).toBeGreaterThan(c.pi01); // violação puxa violação
    expect(c.pValue).toBeLessThan(0.001);
  });

  it("DM com HAC de Bartlett: variância ≥ 0 e estatística menor sob autocorrelação", () => {
    const rng = mulberry32(8);
    let e = 0;
    const d = Array.from({ length: 200 }, () => (e = 0.6 * e + randn(rng)) + 0.25);
    const a = d.map((x) => x + 5);
    const bb = d.map(() => 5);
    const iid = dieboldMariano(bb, a, 1, 0);
    const hac = dieboldMariano(bb, a, 1);
    expect(Math.abs(hac.statistic)).toBeLessThan(Math.abs(iid.statistic));
    expect(Number.isFinite(hac.statistic)).toBe(true);
  });
});
