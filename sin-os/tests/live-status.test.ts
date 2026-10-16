import { describe, expect, it } from "vitest";
import { liveSource, liveStatus, shortNote } from "../src/lib/audit/live";
import { SOURCES } from "../src/lib/sources/registry";
import type { SourceResult } from "../src/lib/sources/types";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const res = (over: Partial<SourceResult<unknown>> = {}): SourceResult<unknown> => ({
  id: "ons_cmo",
  ok: true,
  data: [],
  probes: [{ url: "https://x", ok: true, status: 200, latencyMs: 321, bytes: 10, at: NOW }],
  quality: { latestTs: NOW - 3600_000, points: 10, duplicates: 0, invalid: 0, schemaIssues: [] },
  simulated: false,
  fetchedAt: NOW,
  ...over,
});

describe("estado ao vivo das fontes", () => {
  it("dado recente da fonte primária é 'ao vivo', com latência e última observação", () => {
    const s = liveSource(SOURCES.ons_cmo, res(), NOW);
    expect(s.state).toBe("live");
    expect(s.latencyMs).toBe(321);
    expect(s.latestTs).toBe(NOW - 3600_000);
  });

  it("caminho alternativo é 'alternativa' com o motivo curto", () => {
    const s = liveSource(SOURCES.ccee_pld, res({ id: "ccee_pld", fallback: "PLD estimado pelo CMO/DESSEM do ONS — CCEE indisponível: HTTP 403" }), NOW);
    expect(s.state).toBe("alt");
    expect(s.note).toBe("PLD estimado pelo CMO/DESSEM do ONS");
  });

  it("última observação além do prazo da fonte é 'atrasada'", () => {
    const sla = SOURCES.ons_cmo.freshnessSlaHours;
    const s = liveSource(SOURCES.ons_cmo, res({ quality: { latestTs: NOW - (sla + 5) * 3600_000, points: 1, duplicates: 0, invalid: 0, schemaIssues: [] } }), NOW);
    expect(s.state).toBe("stale");
  });

  it("falha ou dado simulado é 'fora do ar'; chave ausente é 'desativada'", () => {
    expect(liveSource(SOURCES.ons_cmo, res({ ok: false, error: "HTTP 500" }), NOW).state).toBe("down");
    expect(liveSource(SOURCES.ons_cmo, res({ simulated: true, fallback: "simulação" }), NOW).state).toBe("down");
    expect(liveSource(SOURCES.eia, res({ id: "eia", ok: false, error: "EIA_API_KEY não configurada (opcional)" }), NOW).state).toBe("off");
    expect(liveSource(SOURCES.ons_cmo, null, NOW).state).toBe("pending");
  });

  it("conta os estados de todas as fontes do registro", () => {
    const st = liveStatus(Object.values(SOURCES), { ons_cmo: res(), ons_ear: res({ ok: false, error: "x" }) }, null, NOW);
    expect(st.sources).toHaveLength(Object.keys(SOURCES).length);
    expect(st.counts.live).toBe(1);
    expect(st.counts.down).toBe(1);
    expect(st.counts.pending).toBe(Object.keys(SOURCES).length - 2);
  });

  it("encurta mensagens longas", () => {
    expect(shortNote("a — b")).toBe("a");
    expect(shortNote("x".repeat(200))!.length).toBe(140);
    expect(shortNote(null)).toBeNull();
  });
});
