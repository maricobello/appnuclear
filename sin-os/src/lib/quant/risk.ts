import { mean, quantile, std } from "./stats";

/**
 * Métricas de risco sobre amostras de P&L (Monte Carlo).
 * CVaR/Expected Shortfall: Rockafellar & Uryasev (2000), J. Risk 2(3):21–41 —
 * medida coerente (Artzner et al., 1999), preferida ao VaR em Basileia III (FRTB).
 */
export interface RiskMetrics {
  mean: number;
  sd: number;
  var95: number; // perda (positiva) no quantil 5%
  cvar95: number; // perda média na cauda 5%
  probLoss: number;
  p05: number;
  p50: number;
  p95: number;
  omega: number; // Omega ratio (Keating & Shadwick, 2002) com limiar 0
}

export function riskMetrics(pnl: number[], level = 0.95): RiskMetrics {
  const q = quantile(pnl, 1 - level);
  const tail = pnl.filter((v) => v <= q);
  const gains = pnl.reduce((s, v) => s + Math.max(0, v), 0);
  const losses = pnl.reduce((s, v) => s + Math.max(0, -v), 0);
  return {
    mean: mean(pnl),
    sd: std(pnl),
    var95: -q,
    cvar95: -mean(tail.length ? tail : [q]),
    probLoss: pnl.filter((v) => v < 0).length / pnl.length,
    p05: q,
    p50: quantile(pnl, 0.5),
    p95: quantile(pnl, 0.95),
    omega: losses > 0 ? gains / losses : Infinity,
  };
}
