"use client";

import { Minus, Plus } from "lucide-react";

/** Campo numérico com − / + (quantidade de cotas) */
export function Stepper({ value, onChange, min = 1, max, id, label }: { value: number; onChange: (n: number) => void; min?: number; max: number; id: string; label: string }) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.floor(Number.isFinite(n) ? n : min)));
  return (
    <div>
      <label htmlFor={id} className="text-[12px] font-medium text-muted">
        {label}
      </label>
      <div className="mt-1 flex h-11 items-center rounded-lg border border-line-strong bg-surface-2 focus-within:border-brand">
        <button type="button" className="flex h-full w-10 items-center justify-center text-ink-2 hover:text-good disabled:opacity-30" onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label="Diminuir">
          <Minus className="size-4" />
        </button>
        <input
          id={id}
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value.replace(/\D/g, "")) || min))}
          className="h-full w-full min-w-0 bg-transparent text-center text-[15px] font-semibold text-ink outline-none tnum"
        />
        <button type="button" className="flex h-full w-10 items-center justify-center text-ink-2 hover:text-good disabled:opacity-30" onClick={() => onChange(clamp(value + 1))} disabled={value >= max} aria-label="Aumentar">
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}
