"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { Sub } from "./sources/types";

/**
 * Ativo BESS selecionado (parâmetros da tela BESS), compartilhado pelo cabeçalho, pela
 * Sala de Comando e pela tela BESS. Fica no navegador (localStorage), sem conta.
 */
export interface BessAsset {
  name: string;
  sub: Sub;
  pow: number;
  cap: number;
  /** % */
  rte: number;
  /** %/ano */
  deg: number;
  /** R$/MWh */
  lcos: number;
  wacc: number;
  life: number;
  opex: number;
  ref: number;
  maxc: number;
  days: number;
}

export const ASSET_PRESETS: { id: string; asset: BessAsset }[] = [
  {
    id: "megapack",
    asset: { name: "BESS - Tesla Megapack", sub: "SE", pow: 100, cap: 400, rte: 88, deg: 0.5, lcos: 312.45, wacc: 10, life: 20, opex: 2, ref: 1, maxc: 1, days: 365 },
  },
  {
    id: "custom",
    asset: { name: "Personalizado", sub: "SE", pow: 50, cap: 200, rte: 87, deg: 1.5, lcos: 350, wacc: 10, life: 15, opex: 2, ref: 1, maxc: 1, days: 365 },
  },
];

export const DEFAULT_ASSET = ASSET_PRESETS[0].asset;
const KEY = "sinos.bess.asset.v1";
let listeners: (() => void)[] = [];

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveAsset(a: BessAsset) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* modo privado: vale só nesta sessão */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.push(cb);
  const onStorage = (e: StorageEvent) => e.key === KEY && cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function parseAsset(raw: string): BessAsset {
  try {
    const o = JSON.parse(raw) as Partial<BessAsset>;
    const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
    const sub = o.sub === "S" || o.sub === "NE" || o.sub === "N" || o.sub === "SE" ? o.sub : DEFAULT_ASSET.sub;
    return {
      name: typeof o.name === "string" && o.name ? o.name.slice(0, 60) : DEFAULT_ASSET.name,
      sub,
      pow: n(o.pow, DEFAULT_ASSET.pow),
      cap: n(o.cap, DEFAULT_ASSET.cap),
      rte: n(o.rte, DEFAULT_ASSET.rte),
      deg: n(o.deg, DEFAULT_ASSET.deg),
      lcos: n(o.lcos, DEFAULT_ASSET.lcos),
      wacc: n(o.wacc, DEFAULT_ASSET.wacc),
      life: n(o.life, DEFAULT_ASSET.life),
      opex: n(o.opex, DEFAULT_ASSET.opex),
      ref: n(o.ref, DEFAULT_ASSET.ref),
      maxc: n(o.maxc, DEFAULT_ASSET.maxc),
      days: n(o.days, DEFAULT_ASSET.days),
    };
  } catch {
    return DEFAULT_ASSET;
  }
}

export function useAsset(): BessAsset {
  const raw = useSyncExternalStore(subscribe, read, () => "");
  return useMemo(() => (raw ? parseAsset(raw) : DEFAULT_ASSET), [raw]);
}

export const assetQuery = (a: BessAsset, override: Partial<BessAsset> = {}) => {
  const x = { ...a, ...override };
  return `sub=${x.sub}&pow=${x.pow}&cap=${x.cap}&rte=${x.rte}&deg=${x.deg}&lcos=${x.lcos}&wacc=${x.wacc}&life=${x.life}&opex=${x.opex}&ref=${x.ref}&maxc=${x.maxc}&days=${x.days}`;
};
