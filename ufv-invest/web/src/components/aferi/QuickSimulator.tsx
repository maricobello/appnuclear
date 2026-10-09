"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { brl } from "@/lib/fmt";
import { buttonClass, cx } from "@/components/ui";
import { Stepper } from "./Stepper";

/** Simulador de investimento compacto (página da usina) → abre o simulador completo */
export function QuickSimulator({ slug, cotaPriceBRL, monthlyPerCotaBRL, maxCotas, minCotas }: { slug: string; cotaPriceBRL: number; monthlyPerCotaBRL: number; maxCotas: number; minCotas: number }) {
  const router = useRouter();
  const [n, setN] = useState(Math.max(minCotas, 10));
  return (
    <div>
      <h3 className="text-[15px] font-semibold text-ink">Simulador de investimento</h3>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stepper id="qs-cotas" label="Quantidade de cotas" value={n} onChange={setN} min={minCotas} max={maxCotas} />
        <div>
          <div className="text-[12px] font-medium text-muted">Valor por cota</div>
          <div className="mt-1 flex h-11 items-center rounded-lg border border-line bg-surface-2 px-3 text-[15px] font-semibold text-ink tnum">{brl(cotaPriceBRL, 0)}</div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4">
        <div>
          <div className="text-[12px] text-muted">Investimento total</div>
          <div className="text-[18px] font-bold text-ink tnum">{brl(n * cotaPriceBRL, 0)}</div>
        </div>
        <div>
          <div className="text-[12px] text-muted">Distribuição mensal estimada</div>
          <div className="text-[18px] font-bold text-good tnum">{brl(n * monthlyPerCotaBRL)}</div>
        </div>
      </div>
      <button className={cx(buttonClass.primary, "mt-4 w-full py-3")} onClick={() => router.push(`/simulador?usina=${slug}&cotas=${n}`)}>
        Simular
      </button>
      <p className="mt-2 text-[11px] text-muted">Média mensal no cenário P50, antes de impostos do investidor.</p>
    </div>
  );
}
