"use client";

import { useMemo, useState } from "react";
import { brl, num, pct, usdt, years } from "@/lib/fmt";
import type { CashFlowYear } from "@/lib/types";

/**
 * Simulador de cotas: a renda é proporcional à participação (cotas / total) no fluxo líquido
 * projetado da SPE (cenário P50). Mesma regra de `projectCotas` do modelo financeiro.
 */
export function Simulator({
  cashFlows,
  totalCotas,
  cotaPriceBRL,
  cotaPriceUSDT,
  minCotas,
  cdiNetFinalOf1000,
}: {
  cashFlows: CashFlowYear[];
  totalCotas: number;
  cotaPriceBRL: number;
  cotaPriceUSDT: number;
  minCotas: number;
  cdiNetFinalOf1000?: number;
}) {
  const [cotas, setCotas] = useState(Math.max(minCotas, 50));
  const r = useMemo(() => {
    const share = cotas / totalCotas;
    const ops = cashFlows.filter((c) => c.year > 0);
    const incomes = ops.map((c) => c.netCashFlowBRL * share);
    const invested = cotas * cotaPriceBRL;
    let cum = -invested;
    let payback: number | null = null;
    for (let i = 0; i < incomes.length; i++) {
      const before = cum;
      cum += incomes[i];
      if (payback === null && before < 0 && cum >= 0) payback = i + (-before / incomes[i]);
    }
    const total = incomes.reduce((a, b) => a + b, 0);
    return {
      invested,
      firstYear: incomes[0] ?? 0,
      avgMonthly: total / Math.max(1, incomes.length * 12),
      total,
      payback,
      cdiFinal: cdiNetFinalOf1000 ? (cdiNetFinalOf1000 / 1000) * invested : undefined,
    };
  }, [cotas, totalCotas, cashFlows, cotaPriceBRL, cdiNetFinalOf1000]);

  const max = Math.min(totalCotas, 20000);
  return (
    <div>
      <label htmlFor="sim-cotas" className="flex items-baseline justify-between text-[14px] text-ink-2">
        <span>Quantidade de cotas</span>
        <span className="tnum text-[13px] text-muted">mínimo {num(minCotas)}</span>
      </label>
      <div className="mt-2 flex items-center gap-3">
        <input
          id="sim-cotas"
          type="range"
          min={minCotas}
          max={max}
          step={minCotas}
          value={cotas}
          onChange={(e) => setCotas(Number(e.target.value))}
          className="h-2 flex-1 cursor-pointer accent-[var(--brand)]"
        />
        <input
          type="number"
          min={minCotas}
          max={totalCotas}
          value={cotas}
          onChange={(e) => setCotas(Math.max(minCotas, Math.min(totalCotas, Math.floor(Number(e.target.value) || minCotas))))}
          className="w-28 rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-right tnum text-ink"
          aria-label="Quantidade de cotas (número)"
        />
      </div>
      <div className="mt-1 text-[13px] text-muted">
        Investimento: <b className="text-ink">{brl(r.invested)}</b> ≈ {usdt(cotas * cotaPriceUSDT)} · participação {pct((cotas / totalCotas) * 100, 3)}
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <dt className="text-[12px] text-muted">Renda média por mês</dt>
          <dd className="mt-1 text-[20px] font-semibold text-brand tnum">{brl(r.avgMonthly)}</dd>
        </div>
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <dt className="text-[12px] text-muted">Renda no 1º ano</dt>
          <dd className="mt-1 text-[20px] font-semibold text-ink tnum">{brl(r.firstYear)}</dd>
        </div>
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <dt className="text-[12px] text-muted">Total em {cashFlows.length - 1} anos</dt>
          <dd className="mt-1 text-[20px] font-semibold text-ink tnum">{brl(r.total, 0)}</dd>
        </div>
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <dt className="text-[12px] text-muted">Retorno do capital</dt>
          <dd className="mt-1 text-[16px] font-semibold text-ink">{years(r.payback)}</dd>
        </div>
      </dl>
      {r.cdiFinal !== undefined && (
        <p className="mt-3 text-[13px] text-muted">
          Para comparação: o mesmo valor no CDI (líquido de IR) chegaria a <b className="text-ink-2">{brl(r.cdiFinal, 0)}</b> no mesmo prazo.
        </p>
      )}
      <p className="mt-2 text-[12px] text-muted">Projeção P50 em reais nominais, antes de impostos do investidor. Não é garantia de rendimento.</p>
    </div>
  );
}
