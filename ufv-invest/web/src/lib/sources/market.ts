/**
 * Taxas de mercado para o modelo financeiro: Selic, CDI, IPCA 12 m, IPCA de longo prazo (Focus),
 * juro real (constante documentada), dólar PTAX e cotações cripto. Cada valor tem procedência
 * própria; falhas caem nos valores de `defaults.ts` (status "fallback"), nunca lançam exceção.
 */
import type { MarketRates, Provenance } from "@/lib/types";
import { fetchFocusLongTermIpca, fetchSgs, sgsUrl, SGS_SERIES, type SourcedValue } from "./bcb";
import { getCryptoRates } from "./crypto";
import { CDI_SELIC_SPREAD_PP, DEFAULTS_REVIEWED_AT, MARKET_DEFAULTS, type ReferenceValue } from "./defaults";
import { provenance, warnSource, type SourceOptions } from "./http";
import { round } from "./units";

function fallbackProv(id: string, ref: ReferenceValue, reason: string, nowIso: string, extra?: string): Provenance {
  return provenance(
    id,
    `${ref.source} — valor de referência (${ref.asOf})`,
    ref.url,
    "fallback",
    `${reason}; usando ${ref.value} (referência ${ref.asOf}, revisada em ${DEFAULTS_REVIEWED_AT})${extra ? `; ${extra}` : ""}`,
    nowIso,
  );
}

type Resolved = { value: number; provenance: Provenance };

function resolve(r: SourcedValue, id: string, ref: ReferenceValue, label: string, nowIso: string): Resolved {
  if (r.ok) return { value: r.value, provenance: r.provenance };
  warnSource(`${label}: ${r.reason}`);
  return { value: ref.value, provenance: fallbackProv(id, ref, `${label} indisponível (${r.reason}) em ${r.url}`, nowIso) };
}

export async function getMarketRates(opts: SourceOptions = {}): Promise<MarketRates> {
  const nowIso = (opts.now ? opts.now() : new Date()).toISOString();
  const D = MARKET_DEFAULTS;

  const [selicR, cdiR, ipcaR, usdR, focusR, crypto] = await Promise.all([
    fetchSgs("selic", opts),
    fetchSgs("cdi", opts),
    fetchSgs("ipca12m", opts),
    fetchSgs("usdBrl", opts),
    fetchFocusLongTermIpca(opts),
    getCryptoRates(opts).catch(() => ({ failures: { usdt: "erro inesperado", bnb: "erro inesperado" } }) as Awaited<ReturnType<typeof getCryptoRates>>),
  ]);

  // Selic e CDI andam juntos (CDI ≈ Selic meta − 0,10 p.p.): se só uma série responder, deriva a outra.
  let selic: Resolved;
  let cdi: Resolved;
  const selicId = `bcb-sgs-${SGS_SERIES.selic.code}`;
  const cdiId = `bcb-sgs-${SGS_SERIES.cdi.code}`;
  if (selicR.ok && !cdiR.ok) {
    selic = { value: selicR.value, provenance: selicR.provenance };
    const value = round(selicR.value - CDI_SELIC_SPREAD_PP, 2);
    cdi = {
      value,
      provenance: provenance(
        cdiId,
        `${SGS_SERIES.cdi.name} — estimado`,
        sgsUrl(SGS_SERIES.cdi.code),
        "fallback",
        `SGS 4389 indisponível (${cdiR.reason}); estimado como Selic meta (${selicR.value}) − ${CDI_SELIC_SPREAD_PP} p.p.`,
        nowIso,
      ),
    };
  } else if (!selicR.ok && cdiR.ok) {
    cdi = { value: cdiR.value, provenance: cdiR.provenance };
    const value = round(cdiR.value + CDI_SELIC_SPREAD_PP, 2);
    selic = {
      value,
      provenance: provenance(
        selicId,
        `${SGS_SERIES.selic.name} — estimada`,
        sgsUrl(SGS_SERIES.selic.code),
        "fallback",
        `SGS 432 indisponível (${selicR.reason}); estimada como CDI (${cdiR.value}) + ${CDI_SELIC_SPREAD_PP} p.p.`,
        nowIso,
      ),
    };
  } else {
    selic = resolve(selicR, selicId, D.selicPct, "SGS 432 (Selic)", nowIso);
    cdi = resolve(cdiR, cdiId, D.cdiPct, "SGS 4389 (CDI)", nowIso);
  }

  const ipca12m = resolve(ipcaR, `bcb-sgs-${SGS_SERIES.ipca12m.code}`, D.ipca12mPct, "SGS 13522 (IPCA 12 m)", nowIso);
  const ipcaLong = resolve(focusR, "bcb-focus-ipca", D.ipcaLongTermPct, "Focus (IPCA longo prazo)", nowIso);
  const usd = resolve(usdR, `bcb-sgs-${SGS_SERIES.usdBrl.code}`, D.usdBrl, "SGS 1 (dólar PTAX)", nowIso);

  // Juro real: sem API aberta estável — sempre a constante documentada.
  const realRate: Resolved = {
    value: D.realRatePct.value,
    provenance: fallbackProv(
      "tesouro-ipca-longo",
      D.realRatePct,
      "sem API aberta estável para a taxa da NTN-B longa",
      nowIso,
      "atualizar em src/lib/sources/defaults.ts",
    ),
  };

  // USDT: Binance → CoinGecko → paridade com o dólar PTAX.
  const usdt: Resolved = crypto.usdt ?? {
    value: usd.value,
    provenance: provenance(
      "crypto-usdt-brl",
      "Paridade USDT ≈ US$ (dólar PTAX)",
      usd.provenance.url,
      "fallback",
      `cotação cripto indisponível (${crypto.failures.usdt ?? "sem resposta"}); USDT/BRL = dólar ${usd.value}`,
      nowIso,
    ),
  };
  if (!crypto.usdt) warnSource(`USDT/BRL: ${crypto.failures.usdt}`);

  const provenanceList: Provenance[] = [
    selic.provenance,
    cdi.provenance,
    ipca12m.provenance,
    ipcaLong.provenance,
    realRate.provenance,
    usd.provenance,
    usdt.provenance,
    crypto.bnb?.provenance ??
      provenance(
        "crypto-bnb-brl",
        "BNB/BRL",
        "https://api.binance.com/api/v3/ticker/price?symbol=BNBBRL",
        "error",
        `cotação indisponível (${crypto.failures.bnb ?? "sem resposta"}); campo bnbBrl omitido`,
        nowIso,
      ),
  ];

  return {
    selicPct: selic.value,
    cdiPct: cdi.value,
    ipca12mPct: ipca12m.value,
    ipcaLongTermPct: ipcaLong.value,
    realRatePct: realRate.value,
    usdBrl: usd.value,
    usdtBrl: usdt.value,
    ...(crypto.bnb ? { bnbBrl: crypto.bnb.value } : {}),
    provenance: provenanceList,
  };
}
