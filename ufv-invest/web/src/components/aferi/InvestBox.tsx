"use client";

import Link from "next/link";
import { useState } from "react";
import { brl } from "@/lib/fmt";
import { buttonClass, cx } from "@/components/ui";
import { Stepper } from "./Stepper";
import { InterestButton } from "./InterestDialog";
import { SoldBar } from "./Sold";

/** Caixa lateral: escolha a quantidade, veja quanto investe e quanto recebe, invista. */
export function InvestBox(p: {
  slug: string;
  name: string;
  status: "operacao" | "implantacao" | "encerrada";
  cotaPriceBRL: number;
  monthlyPerCotaBRL: number;
  minCotas: number;
  totalCotas: number;
  demoSold: number;
}) {
  const [n, setN] = useState(Math.max(p.minCotas, 10));
  if (p.status === "encerrada") {
    return (
      <div className="glass rounded-2xl p-6">
        <div className="text-[17px] font-semibold text-ink">Oferta encerrada</div>
        <p className="mt-1 text-[14px] text-ink-2">Todas as cotas foram vendidas.</p>
        <Link href="/usinas" className={cx(buttonClass.primary, "mt-5 w-full")}>
          Ver outras usinas
        </Link>
      </div>
    );
  }
  return (
    <div className="glass relative rounded-2xl p-6 shadow-[0_30px_80px_-30px_rgba(61,220,132,0.25)]">
      <Stepper id="ib-cotas" label="Quantas cotas?" value={n} onChange={setN} min={p.minCotas} max={p.totalCotas} />
      <dl className="mt-5 space-y-3">
        <div className="flex items-baseline justify-between">
          <dt className="text-[14px] text-ink-2">Você investe</dt>
          <dd className="text-[20px] font-bold text-ink tnum">{brl(n * p.cotaPriceBRL, 0)}</dd>
        </div>
        <div className="flex items-baseline justify-between">
          <dt className="text-[14px] text-ink-2">Recebe por mês*</dt>
          <dd className="text-[20px] font-bold text-good tnum">{brl(n * p.monthlyPerCotaBRL)}</dd>
        </div>
      </dl>
      <Link href={`/usinas/${p.slug}/investir`} className={cx(buttonClass.primary, "mt-5 w-full py-3 text-[15px]")}>
        Investir
      </Link>
      <InterestButton usina={{ slug: p.slug, name: p.name }} cotas={n} label="Falar com a equipe" className={cx(buttonClass.ghost, "mt-1 w-full")} />
      <SoldBar slug={p.slug} total={p.totalCotas} demoSold={p.demoSold} status={p.status} className="mt-4" />
      <p className="mt-3 text-[11px] text-muted">*Média estimada, antes de impostos. Não é garantia.</p>
    </div>
  );
}
