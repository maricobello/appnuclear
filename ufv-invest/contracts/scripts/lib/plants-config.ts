import fs from "node:fs";
import path from "node:path";
import { parseUnits } from "ethers";

/** Uma usina como está em config/plants.json. */
export interface PlantConfigRaw {
  slug: string;
  name: string;
  symbol: string;
  maxSupply: number;
  hardCapCotas?: number;
  softCapCotas: number;
  maxCotasPerInvestor?: number;
  minCotas?: number;
  pricePerCotaUSDT?: string;
  startTime: string;
  endTime: string;
  withdrawalWindowDays?: number;
  /** tesouraria específica desta SPE (senão usa TREASURY_ADDRESS) */
  treasury?: string;
}

interface PlantsFile {
  defaults: { pricePerCotaUSDT: string; minCotas: number; withdrawalWindowDays: number };
  plants: PlantConfigRaw[];
}

/** Parâmetros já resolvidos (unidades on-chain). */
export interface PlantParams {
  slug: string;
  name: string;
  symbol: string;
  maxSupply: bigint;
  hardCapCotas: bigint;
  softCapCotas: bigint;
  maxCotasPerInvestor: bigint;
  minCotas: bigint;
  pricePerCotaUSDT: string;
  pricePerCota: bigint;
  startTime: bigint;
  endTime: bigint;
  withdrawalWindow: bigint;
  treasury?: string;
}

export const DEFAULT_PLANTS_FILE = path.resolve(__dirname, "../../config/plants.json");

const RELATIVE = /^\+(\d+)([dhm])$/;

/** "2026-10-01T12:00:00Z" ou "+1d" / "+12h" / "+30m" relativo a `nowSec`. */
export function resolveTime(value: string, nowSec: bigint): bigint {
  const rel = RELATIVE.exec(value.trim());
  if (rel) {
    const n = BigInt(rel[1]);
    const unit = rel[2] === "d" ? 86_400n : rel[2] === "h" ? 3_600n : 60n;
    return nowSec + n * unit;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`data inválida em plants.json: "${value}"`);
  return BigInt(Math.floor(ms / 1000));
}

export function loadPlants(opts: {
  nowSec: bigint;
  paymentDecimals: number;
  file?: string;
  only?: string[];
}): PlantParams[] {
  const file = JSON.parse(fs.readFileSync(opts.file ?? DEFAULT_PLANTS_FILE, "utf8")) as PlantsFile;
  const selected = opts.only?.length ? file.plants.filter((p) => opts.only!.includes(p.slug)) : file.plants;
  if (opts.only?.length) {
    const missing = opts.only.filter((s) => !file.plants.some((p) => p.slug === s));
    if (missing.length) throw new Error(`usinas não encontradas em plants.json: ${missing.join(", ")}`);
  }

  const seen = new Set<string>();
  return selected.map((p) => {
    if (seen.has(p.slug)) throw new Error(`slug duplicado: ${p.slug}`);
    seen.add(p.slug);
    const price = p.pricePerCotaUSDT ?? file.defaults.pricePerCotaUSDT;
    const maxSupply = BigInt(p.maxSupply);
    const params: PlantParams = {
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      maxSupply,
      hardCapCotas: BigInt(p.hardCapCotas ?? p.maxSupply),
      softCapCotas: BigInt(p.softCapCotas),
      maxCotasPerInvestor: BigInt(p.maxCotasPerInvestor ?? Math.floor(p.maxSupply / 10)),
      minCotas: BigInt(p.minCotas ?? file.defaults.minCotas),
      pricePerCotaUSDT: price,
      pricePerCota: parseUnits(price, opts.paymentDecimals),
      startTime: resolveTime(p.startTime, opts.nowSec),
      endTime: resolveTime(p.endTime, opts.nowSec),
      withdrawalWindow: BigInt(Math.round((p.withdrawalWindowDays ?? file.defaults.withdrawalWindowDays) * 86_400)),
      treasury: p.treasury,
    };
    validate(params, opts.nowSec);
    return params;
  });
}

function validate(p: PlantParams, nowSec: bigint) {
  const fail = (m: string) => {
    throw new Error(`plants.json [${p.slug}]: ${m}`);
  };
  if (!/^[a-z0-9-]+$/.test(p.slug)) fail("slug deve ser kebab-case");
  if (p.maxSupply <= 0n) fail("maxSupply deve ser > 0");
  if (p.hardCapCotas > p.maxSupply) fail("hardCapCotas > maxSupply");
  if (p.softCapCotas <= 0n || p.softCapCotas > p.hardCapCotas) fail("softCapCotas fora de (0, hardCap]");
  if (p.minCotas <= 0n || p.minCotas > p.maxCotasPerInvestor) fail("minCotas fora de (0, maxCotasPerInvestor]");
  if (p.maxCotasPerInvestor > p.hardCapCotas) fail("maxCotasPerInvestor > hardCap");
  if (p.pricePerCota <= 0n) fail("preço deve ser > 0");
  if (p.startTime >= p.endTime) fail("startTime >= endTime");
  if (p.endTime <= nowSec) fail(`endTime já passou (${new Date(Number(p.endTime) * 1000).toISOString()})`);
  if (p.withdrawalWindow > 30n * 86_400n) fail("janela de desistência > 30 dias");
}
