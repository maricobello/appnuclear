"use client";

import { useQuery } from "@tanstack/react-query";
import { Cloud, Sun, Thermometer, Zap } from "lucide-react";
import { num, pct } from "@/lib/fmt";
import type { LiveConditions } from "@/lib/types";
import { SourceDot } from "@/components/ui";
import { ForecastChart } from "./Charts";

export function LivePanel({ slug, initial, acKW, municipio }: { slug: string; initial: LiveConditions | null; acKW: number; municipio: string }) {
  const { data } = useQuery({
    queryKey: ["live", slug],
    queryFn: async () => {
      const r = await fetch(`/api/usinas/${slug}/ao-vivo`);
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as LiveConditions | null;
    },
    initialData: initial,
    refetchInterval: 10 * 60_000,
    staleTime: 5 * 60_000,
  });

  if (!data) {
    return <p className="text-[14px] text-muted">Condições ao vivo indisponíveis no momento (Open-Meteo não respondeu). A análise usa dados históricos.</p>;
  }
  const load = (data.estimatedPowerKW / acKW) * 100;
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(data.time));
  return (
    <div>
      <div className="flex items-center justify-between text-[13px] text-muted">
        <span>
          {municipio} · {time} (Brasília)
        </span>
        <SourceDot status={data.provenance.status} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <div className="flex items-center gap-1.5 text-[12px] text-muted">
            <Zap className="size-3.5 text-brand" /> Potência estimada
          </div>
          <div className="mt-1 text-[20px] font-semibold tnum">{num(data.estimatedPowerKW)} kW</div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, Math.max(0, load))}%` }} />
          </div>
          <div className="mt-1 text-[12px] text-muted">{pct(load, 0)} da capacidade AC</div>
        </div>
        <div className="space-y-1.5 rounded-xl border border-line bg-surface-2 p-3 text-[13px] text-ink-2">
          <div className="flex items-center gap-1.5">
            <Sun className="size-3.5 text-brand" /> {num(data.ghiWm2)} W/m² <span className="text-muted">(GHI)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Sun className="size-3.5 text-series-2" /> {num(data.poaWm2)} W/m² <span className="text-muted">(no painel)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Thermometer className="size-3.5" /> {num(data.tempC, 1)} °C
          </div>
          <div className="flex items-center gap-1.5">
            <Cloud className="size-3.5" /> {num(data.cloudCoverPct)}% nuvens
          </div>
        </div>
      </div>
      {data.forecast.length > 0 && (
        <div className="mt-4">
          <div className="text-[13px] font-medium text-ink-2">Previsão de geração — próximos {data.forecast.length} dias</div>
          <ForecastChart forecast={data.forecast} />
        </div>
      )}
      <p className="mt-1 text-[12px] text-muted">Estimativa pelo modelo da usina a partir da previsão horária do Open-Meteo (não é medição do inversor).</p>
    </div>
  );
}
