/**
 * Cotações cripto em BRL para a oferta on-chain (USDT BEP-20) e taxas de gás (BNB).
 *
 * Ordem: Binance (ticker público) → CoinGecko (simple/price) → sem cotação (o chamador aplica a
 * paridade USDT ≈ USD PTAX). A Binance responde 451 em algumas regiões; em gru1 (São Paulo) costuma
 * funcionar. Defina `COINGECKO_DEMO_API_KEY` para enviar a chave demo do CoinGecko (opcional).
 */
import { z } from "zod";
import type { Provenance } from "@/lib/types";
import { describeError, fetchJson, joinNotes, provenanceFromResult, type FetchJsonResult, type SourceOptions } from "./http";
import { parseDecimal } from "./units";

export const CRYPTO_REVALIDATE_SEC = 60;
const CRYPTO_TIMEOUT_MS = 5_000;

export function binanceUrl(symbol: "USDTBRL" | "BNBBRL"): string {
  return `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
}
export const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=tether,binancecoin&vs_currencies=brl";

const positivePrice = z
  .union([z.number(), z.string()])
  .transform((v) => parseDecimal(v))
  .pipe(z.number().positive());

export const binanceTickerSchema = z.looseObject({ symbol: z.string(), price: positivePrice });

const cgCoin = z.looseObject({ brl: positivePrice }).optional().catch(undefined);
export const coingeckoSchema = z.looseObject({ tether: cgCoin, binancecoin: cgCoin });

export interface CryptoQuote {
  value: number;
  provenance: Provenance;
}
export interface CryptoRates {
  usdt?: CryptoQuote;
  bnb?: CryptoQuote;
  /** motivos das falhas, para a nota do fallback */
  failures: { usdt?: string; bnb?: string };
}

async function binance(symbol: "USDTBRL" | "BNBBRL", opts: SourceOptions) {
  return fetchJson(binanceUrl(symbol), binanceTickerSchema, {
    timeoutMs: CRYPTO_TIMEOUT_MS,
    revalidateSec: CRYPTO_REVALIDATE_SEC,
    ...opts,
  });
}

export async function getCryptoRates(opts: SourceOptions = {}): Promise<CryptoRates> {
  const [usdtR, bnbR] = await Promise.allSettled([binance("USDTBRL", opts), binance("BNBBRL", opts)]);
  const out: CryptoRates = { failures: {} };

  if (usdtR.status === "fulfilled") {
    out.usdt = {
      value: usdtR.value.data.price,
      provenance: provenanceFromResult("crypto-usdt-brl", "Binance — USDT/BRL (último preço)", usdtR.value),
    };
  }
  if (bnbR.status === "fulfilled") {
    out.bnb = {
      value: bnbR.value.data.price,
      provenance: provenanceFromResult("crypto-bnb-brl", "Binance — BNB/BRL (último preço)", bnbR.value),
    };
  }
  if (out.usdt && out.bnb) return out;

  const binanceWhy = {
    usdt: usdtR.status === "rejected" ? describeError(usdtR.reason) : undefined,
    bnb: bnbR.status === "rejected" ? describeError(bnbR.reason) : undefined,
  };
  const key = process.env.COINGECKO_DEMO_API_KEY;
  let cg: FetchJsonResult<z.infer<typeof coingeckoSchema>> | undefined;
  let cgWhy: string | undefined;
  try {
    cg = await fetchJson(COINGECKO_URL, coingeckoSchema, {
      timeoutMs: CRYPTO_TIMEOUT_MS,
      revalidateSec: CRYPTO_REVALIDATE_SEC,
      ...(key ? { headers: { "x-cg-demo-api-key": key } } : {}),
      ...opts,
    });
  } catch (e) {
    cgWhy = describeError(e);
  }

  if (!out.usdt) {
    const v = cg?.data.tether?.brl;
    if (cg && v !== undefined) {
      out.usdt = {
        value: v,
        provenance: provenanceFromResult("crypto-usdt-brl", "CoinGecko — tether/BRL", cg, `Binance indisponível (${binanceWhy.usdt})`),
      };
    } else {
      out.failures.usdt = joinNotes(`Binance: ${binanceWhy.usdt}`, `CoinGecko: ${cgWhy ?? "sem cotação de tether"}`);
    }
  }
  if (!out.bnb) {
    const v = cg?.data.binancecoin?.brl;
    if (cg && v !== undefined) {
      out.bnb = {
        value: v,
        provenance: provenanceFromResult("crypto-bnb-brl", "CoinGecko — binancecoin/BRL", cg, `Binance indisponível (${binanceWhy.bnb})`),
      };
    } else {
      out.failures.bnb = joinNotes(`Binance: ${binanceWhy.bnb}`, `CoinGecko: ${cgWhy ?? "sem cotação de binancecoin"}`);
    }
  }
  return out;
}
