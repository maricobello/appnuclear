import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runAssistant, systemPrompt } from "../src/lib/assistant/agent";
import { GroqError, makeGroqChat, type ChatFn, type ChatRequest } from "../src/lib/assistant/groq";
import { executeTool, SIM_REFUSAL, sourceLabel, type AssetCtx, type AssistantDeps } from "../src/lib/assistant/tools";
import { speakable, splitSentences } from "../src/lib/assistant/speech";
import type { RenewablesReport } from "../src/lib/market/renewables-report";
import { brtToUtc } from "../src/lib/sources/time";
import { SUBS, type SourceResult, type SubPanel } from "../src/lib/sources/types";

const ASSET: AssetCtx = { name: "BESS teste", sub: "SE", pow: 100, cap: 400, rte: 88, deg: 0.5, lcos: 312.45, wacc: 10, life: 20, opex: 2, ref: 1, maxc: 1, days: 365 };
// 2026-09-27 15:30 BRT
const NOW = brtToUtc(2026, 9, 27, 15, 30);

function panel(days: string[], f: (h: number, sub: number) => number): SubPanel {
  const ts: number[] = [];
  const values = Object.fromEntries(SUBS.map((s) => [s, [] as number[]])) as Record<(typeof SUBS)[number], number[]>;
  for (const d of days) {
    const [y, m, dd] = d.split("-").map(Number);
    for (let h = 0; h < 24; h++) {
      ts.push(brtToUtc(y, m, dd, h));
      SUBS.forEach((s, k) => values[s].push(f(h, k)));
    }
  }
  return { ts, values, unit: "R$/MWh" };
}

const src = <T,>(data: T, extra: Partial<SourceResult<T>> = {}): SourceResult<T> => ({
  id: "ccee_pld",
  ok: true,
  data,
  probes: [],
  quality: { latestTs: null, points: 0, duplicates: 0, invalid: 0, schemaIssues: [] },
  simulated: false,
  fetchedAt: NOW,
  ...extra,
});

function deps(pld: SourceResult<SubPanel>): AssistantDeps {
  const daily = { dates: ["2026-09-26"], values: { SE: [55], S: [70], NE: [40], N: [60] }, unit: "%" };
  return {
    brazil: async () => ({ pld, ear: src(daily, { id: "ons_ear" }), ena: src(daily, { id: "ons_ena" }), load: src(pld.data!, { id: "ons_carga" }) }),
    forecast: async () => {
      throw new Error("não usado");
    },
    bess: async () => {
      throw new Error("não usado");
    },
    latestAudit: async () => null,
    trust: async () => ({ totalRevisions30d: 2, windowDays: 10, seals: [{ source: "ons_carga", name: "Carga", monitored: true, level: "média", revisions30d: 2, reasons: ["2 dia(s) republicado(s)"] }] }),
    renewables: async (days) => RENEW(days),
    dataMode: () => "live",
  };
}

const meta = (ok: boolean, error: string | null = null) => ({ id: "ons_curtailment", ok, simulated: false, fallback: null, note: null, error, latestTs: NOW, fetchedAt: NOW });
let renewDays = 0;
const RENEW = (days: number) => {
  renewDays = days;
  return {
    meta: { curtailment: meta(true), balanco: meta(true), pld: meta(true) },
    pldOfficial: false,
    reasonLabel: { REL: "confiabilidade elétrica", CNF: "atendimento a requisitos da rede", ENE: "razão energética (sobra de energia)" },
    curtailment: {
      from: "2026-09-13",
      to: "2026-09-26",
      days: 14,
      totals: { eolicaMWh: 1_353_764.4, solarMWh: 600_318, cappedMWh: 1_849_340.5, byReason: { REL: 144_381.3, CNF: 352_138.2, ENE: 1_457_562.8 }, bySub: { SE: 258_360.5, S: 121_181.9, NE: 1_565_782.6, N: 8_757.4 } },
      curtailedSharePct: { eolica: 21.9, solar: 26.4 },
    },
    vsPld: [{ sub: "NE", hours: 200, atFloor: 150, sharePct: 75, mwhPriced: 1000, avgPld: 70, valueBRL: 70_000 }],
    netLoad: { eveningRampMW: 28_452, minHour: 11, renewableSharePct: 35.3 },
    notes: ["nota"],
  } as unknown as RenewablesReport;
};

// hoje: 100 de madrugada, 400 às 19h no SE; amanhã publicado
const PLD = panel(["2026-09-26", "2026-09-27", "2026-09-28"], (h, k) => (h === 19 ? 400 : 100) + k);

describe("ferramentas da Iara", () => {
  it("pld_agora: estatísticas do dia com horas, amanhã publicado e fonte", async () => {
    const out = await executeTool("pld_agora", { sub: "SE" }, { now: NOW, asset: ASSET }, deps(src(PLD, { note: "PLD oficial da CCEE" })));
    const r = out.result as { fonte: string; submercados: { sub: string; hoje: { max: { valor: number; hora: string } }; amanha: { media: number } | null; pld_ultima_hora: { hora_brt: string } }[] };
    expect(r.fonte).toBe("PLD oficial da CCEE");
    expect(r.submercados).toHaveLength(1);
    expect(r.submercados[0].hoje.max).toEqual({ valor: 400, hora: "19h" });
    expect(r.submercados[0].amanha?.media).toBeCloseTo(112.5, 5);
    expect(r.submercados[0].pld_ultima_hora.hora_brt).toBe("2026-09-27 15:00");
  });

  it("nunca repassa dado simulado", async () => {
    const out = await executeTool("pld_agora", {}, { now: NOW, asset: ASSET }, deps(src(PLD, { simulated: true })));
    expect(out.result).toEqual({ erro: SIM_REFUSAL });
    expect(sourceLabel({ ok: true, simulated: true })).toBe("SIMULADO");
  });

  it("oportunidades usa o PLD publicado de amanhã e compara com o custo nivelado", async () => {
    const out = await executeTool("oportunidades", {}, { now: NOW, asset: ASSET }, deps(src(PLD)));
    const r = out.result as { dia: { rotulo: string }; linhas: { estrategia: string; cobre_custo: boolean | null }[] };
    expect(r.dia.rotulo).toBe("amanhã");
    expect(r.linhas.some((l) => l.estrategia === "BESS intraday")).toBe(true);
  });

  it("navegar e configurar_ativo devolvem ações validadas", async () => {
    const ctx = { now: NOW, asset: ASSET };
    const nav = await executeTool("navegar", { rota: "/bess", sub: "NE" }, ctx, deps(src(PLD)));
    expect(nav.actions).toEqual([{ type: "navigate", href: "/bess?sub=NE", label: "BESS" }]);
    const bad = await executeTool("navegar", { rota: "/admin" }, ctx, deps(src(PLD)));
    expect(bad.actions).toBeUndefined();
    const cfg = await executeTool("configurar_ativo", { pow: 50, cap: 200, pow_extra: 1, abrir_bess: true }, ctx, deps(src(PLD)));
    expect(cfg.actions?.[0]).toMatchObject({ type: "asset", patch: { pow: 50, cap: 200, name: "BESS 50 MW / 200 MWh" } });
    expect(cfg.actions?.[1]).toMatchObject({ type: "navigate", href: "/bess?sub=SE" });
    const out = await executeTool("configurar_ativo", { pow: 99999 }, ctx, deps(src(PLD)));
    expect(out.result).toEqual({ erro: "pow fora da faixa" });
  });

  it("confianca_dados repassa selos e revisões e lembra que o selo não diz qual versão é a certa", async () => {
    const out = await executeTool("confianca_dados", {}, { now: NOW, asset: ASSET }, deps(src(PLD)));
    const r = out.result as { revisoes_retroativas_30d: number; fontes: { fonte: string; selo: string }[]; nota: string };
    expect(r.revisoes_retroativas_30d).toBe(2);
    expect(r.fontes[0]).toMatchObject({ fonte: "Carga", selo: "média" });
    expect(r.nota).toContain("não diz qual versão");
  });

  it("renovaveis_corte: GWh, faixa oficial × piso, razões nomeadas e janela limitada", async () => {
    const out = await executeTool("renovaveis_corte", { dias: 90 }, { now: NOW, asset: ASSET }, deps(src(PLD)));
    expect(renewDays).toBe(31);
    const r = out.result as Record<string, unknown>;
    expect(r.eolica_cortada_gwh).toBe(1353.8);
    expect(r.faixa_gwh).toEqual({ piso_limitado_a_disponibilidade: 1849.3, oficial_ons: 1954.1 });
    expect(r.por_razao_gwh).toMatchObject({ "razão energética (sobra de energia)": 1457.6 });
    expect(r.pld_oficial).toBe(false);
  });

  it("ferramenta desconhecida vira erro, não exceção", async () => {
    const out = await executeTool("apagar_tudo", {}, { now: NOW, asset: ASSET }, deps(src(PLD)));
    expect(out.result).toEqual({ erro: "ferramenta desconhecida: apagar_tudo" });
  });
});

describe("laço do agente", () => {
  it("executa as ferramentas pedidas, devolve os resultados ao modelo e junta as ações", async () => {
    const seen: ChatRequest[] = [];
    const chat: ChatFn = async (req) => {
      seen.push(structuredClone(req));
      if (seen.length === 1)
        return {
          model: "m",
          usage: null,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "a", type: "function", function: { name: "pld_agora", arguments: '{"sub":"SE"}' } },
              { id: "b", type: "function", function: { name: "navegar", arguments: '{"rota":"/sin"}' } },
            ],
          },
        };
      return { model: "m", usage: null, message: { role: "assistant", content: "O PLD do Sudeste às 19h foi R$ 400." } };
    };
    const out = await runAssistant({ messages: [{ role: "user", content: "qual o pld agora?" }], asset: ASSET, voice: true }, deps(src(PLD)), chat, NOW);
    expect(out.reply).toBe("O PLD do Sudeste às 19h foi R$ 400.");
    expect(out.actions).toEqual([{ type: "navigate", href: "/sin", label: "SIN · Brasil" }]);
    expect(out.tools.map((t) => t.name)).toEqual(["pld_agora", "navegar"]);
    const second = seen[1].messages;
    expect(second[0].role).toBe("system");
    const toolMsgs = second.filter((m) => m.role === "tool");
    expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(["a", "b"]);
    expect(JSON.parse(toolMsgs[0].content!).submercados[0].hoje.max.valor).toBe(400);
  });

  it("modo voz pede resposta curta e sem markdown; o prompt carrega hora, tela e ativo", () => {
    const p = systemPrompt({ now: NOW, page: "/bess", asset: ASSET, voice: true, dataMode: "live" });
    expect(p).toContain("2026-09-27 15:30");
    expect(p).toContain("Tela aberta: BESS");
    expect(p).toContain("100 MW / 400 MWh");
    expect(p).toContain("Modo VOZ");
    expect(p).toContain("nunca invente");
  });

  it("para depois do limite de rodadas e força a resposta final sem ferramentas", async () => {
    let calls = 0;
    const chat: ChatFn = async (req) => {
      calls++;
      if (!req.tools) return { model: "m", usage: null, message: { role: "assistant", content: "final" } };
      return { model: "m", usage: null, message: { role: "assistant", content: null, tool_calls: [{ id: String(calls), type: "function", function: { name: "saude_dados", arguments: "{}" } }] } };
    };
    const out = await runAssistant({ messages: [{ role: "user", content: "x" }], asset: ASSET }, deps(src(PLD)), chat, NOW);
    expect(out.reply).toBe("final");
    expect(calls).toBe(6);
  });
});

describe("cliente Groq", () => {
  it("troca de modelo quando o configurado foi descontinuado", async () => {
    process.env.GROQ_API_KEY = "teste";
    process.env.GROQ_MODEL = "velho";
    const models: string[] = [];
    const fake = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      models.push(body.model);
      if (body.model === "velho") return new Response(JSON.stringify({ error: { message: "The model `velho` has been decommissioned", code: "model_decommissioned" } }), { status: 400 });
      return new Response(JSON.stringify({ model: body.model, choices: [{ message: { role: "assistant", content: "ok" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await makeGroqChat(fake)({ messages: [{ role: "user", content: "oi" }] });
    expect(out.message.content).toBe("ok");
    expect(models).toEqual(["velho", "openai/gpt-oss-120b"]);
    delete process.env.GROQ_MODEL;
  });

  it("erro de autenticação não tenta outros modelos", async () => {
    process.env.GROQ_API_KEY = "teste";
    let n = 0;
    const fake = (async () => {
      n++;
      return new Response(JSON.stringify({ error: { message: "Invalid API Key", code: "invalid_api_key" } }), { status: 401 });
    }) as unknown as typeof fetch;
    await expect(makeGroqChat(fake)({ messages: [{ role: "user", content: "oi" }] })).rejects.toBeInstanceOf(GroqError);
    expect(n).toBe(1);
  });
});

describe("fala", () => {
  it("normaliza unidades e siglas para a síntese de voz", () => {
    expect(speakable("**PLD SE**: R$ 312,45/MWh às 19h")).toBe("PLD Sudeste: R$ 312,45 por megawatt-hora às 19 horas");
    expect(speakable("bateria de 100 MW / 400 MWh, TIR 3,9% e 2 p.p.")).toBe("bateria de 100 megawatts por 400 megawatts-hora, TIR 3,9% e 2 pontos percentuais");
    expect(speakable("- item um\n- item dois")).toBe("item um. item dois");
  });
  it("divide em frases curtas para o sintetizador não cortar", () => {
    expect(splitSentences("Primeira frase. Segunda frase! Terceira?")).toEqual(["Primeira frase.", "Segunda frase!", "Terceira?"]);
  });
});
