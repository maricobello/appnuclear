import { SUBS, type Sub } from "../sources/types";
import type { HealthMessage } from "./health";

/**
 * Aviso de PUBLICAÇÃO do PLD: quando um dia completo (24 h) de hoje ou de amanhã aparece
 * pela primeira vez, manda um resumo por submercado — média, mínimo, máximo e a hora do
 * pico. É o "PLD de amanhã saiu" que o operador espera no fim da tarde (com a Plataforma de
 * Integração da CCEE) ou o PLD do dia estimado pelo CMO do ONS (sem ela).
 */
export interface PublishedDay {
  date: string;
  values: Record<Sub, number[]>;
  official: boolean;
}

const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function pldPublishedMessage(day: PublishedDay, today: string, baseUrl: string, above?: number): HealthMessage {
  const when = day.date > today ? "amanhã" : "hoje";
  const [, m, d] = day.date.split("-");
  const lines = SUBS.map((s) => {
    const v = day.values[s];
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const max = Math.max(...v);
    const h = v.indexOf(max);
    const flag = above !== undefined && max > above ? " ⚠" : "";
    return `${s}: média ${brl(mean)} · mín ${brl(Math.min(...v))} · máx ${brl(max)} às ${h}h${flag}`;
  });
  const src = day.official ? "oficial CCEE" : "estimado pelo CMO/ONS";
  return {
    kind: "pld",
    title: `PLD de ${when} (${d}/${m}) publicado - ${src}`,
    text: `⚡ PLD de ${when} (${d}/${m}) — ${src}\n${lines.join("\n")}${above !== undefined ? `\n(⚠ = máximo acima de ${brl(above)})` : ""}\n${baseUrl}/sin`,
  };
}
