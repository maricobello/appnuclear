import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { IdentityRegistry, MockUSDT, UFVOffering, UFVPlantToken } from "../typechain-types";

export const DAY = 86_400n;
export const COUNTRY_BR = 76;
export const USDT = (v: string | number) => ethers.parseUnits(String(v), 18);

export const ROLES = {
  DEFAULT_ADMIN: ethers.ZeroHash,
  COMPLIANCE: ethers.id("COMPLIANCE_ROLE"),
  MINTER: ethers.id("MINTER_ROLE"),
  DISTRIBUTOR: ethers.id("DISTRIBUTOR_ROLE"),
  PAUSER: ethers.id("PAUSER_ROLE"),
} as const;

/** Estados do enum `UFVOffering.State`. */
export const State = {
  Pending: 0n,
  Active: 1n,
  Succeeded: 2n,
  Failed: 3n,
  Finalized: 4n,
  Cancelled: 5n,
} as const;

export async function now(): Promise<bigint> {
  return BigInt(await time.latest());
}

export async function kyc(
  registry: IdentityRegistry,
  compliance: HardhatEthersSigner,
  wallets: { address: string }[],
  validForSeconds: bigint = 365n * DAY,
): Promise<bigint> {
  const expiresAt = (await now()) + validForSeconds;
  await registry.connect(compliance).setInvestors(
    wallets.map((w) => w.address),
    wallets.map(() => COUNTRY_BR),
    wallets.map(() => expiresAt),
  );
  return expiresAt;
}

/** Registro + MockUSDT + papéis básicos. */
export async function deployBase() {
  const signers = await ethers.getSigners();
  const [admin, compliance, distributor, pauser, treasury, outsider, alice, bob, carol, dave, erin, frank] = signers;
  const investors = [alice, bob, carol, dave, erin, frank];

  const registry = (await ethers.deployContract("IdentityRegistry", [admin.address])) as unknown as IdentityRegistry;
  await registry.connect(admin).grantRole(ROLES.COMPLIANCE, compliance.address);

  const usdt = (await ethers.deployContract("MockUSDT", [admin.address])) as unknown as MockUSDT;

  return { signers, admin, compliance, distributor, pauser, treasury, outsider, alice, bob, carol, dave, erin, frank, investors, registry, usdt };
}

/**
 * Token de uma usina com `admin` também como MINTER (para testar o token isoladamente, sem a
 * oferta). Investidores com KYC válido por 1 ano e o distribuidor com USDT aprovado.
 */
export async function deployTokenFixture() {
  const base = await deployBase();
  const { admin, compliance, distributor, pauser, registry, usdt, investors } = base;

  const token = (await ethers.deployContract("UFVPlantToken", [
    "Cota UFV Teste",
    "UFVTST",
    1_000_000n,
    await registry.getAddress(),
    await usdt.getAddress(),
    admin.address,
  ])) as unknown as UFVPlantToken;

  await token.connect(admin).grantRole(ROLES.MINTER, admin.address);
  await token.connect(admin).grantRole(ROLES.DISTRIBUTOR, distributor.address);
  await token.connect(admin).grantRole(ROLES.PAUSER, pauser.address);
  await token.connect(admin).grantRole(ROLES.COMPLIANCE, compliance.address);

  await kyc(registry, compliance, investors);

  await usdt.connect(admin).mint(distributor.address, USDT(10_000_000));
  await usdt.connect(distributor).approve(await token.getAddress(), ethers.MaxUint256);

  return { ...base, token };
}

export const OFFERING_DEFAULTS = {
  maxSupply: 10_000n,
  price: USDT("18.2"),
  minCotas: 10n,
  maxCotasPerInvestor: 3_000n,
  softCapCotas: 4_000n,
  hardCapCotas: 10_000n,
  startDelay: 1n * DAY,
  duration: 30n * DAY,
  withdrawalWindow: 5n * DAY,
};

export type OfferingParams = typeof OFFERING_DEFAULTS;

/**
 * Oferta completa: token (admin) + oferta (MINTER no token). Investidores com KYC e USDT aprovado.
 * Começa em `startDelay` a partir de agora (estado Pending).
 */
export async function deployOffering(overrides: Partial<OfferingParams> = {}, paymentTokenAddress?: string) {
  const base = await deployBase();
  const { admin, compliance, distributor, pauser, treasury, registry, usdt, investors } = base;
  const p = { ...OFFERING_DEFAULTS, ...overrides };

  const paymentToken = paymentTokenAddress ?? (await usdt.getAddress());

  const token = (await ethers.deployContract("UFVPlantToken", [
    "Cota UFV Teste",
    "UFVTST",
    p.maxSupply,
    await registry.getAddress(),
    await usdt.getAddress(),
    admin.address,
  ])) as unknown as UFVPlantToken;

  const t0 = await now();
  const startTime = t0 + p.startDelay;
  const endTime = startTime + p.duration;
  const config = {
    token: await token.getAddress(),
    paymentToken,
    treasury: treasury.address,
    pricePerCota: p.price,
    minCotas: p.minCotas,
    maxCotasPerInvestor: p.maxCotasPerInvestor,
    softCapCotas: p.softCapCotas,
    hardCapCotas: p.hardCapCotas,
    startTime,
    endTime,
    withdrawalWindow: p.withdrawalWindow,
    admin: admin.address,
  };
  const offering = (await ethers.deployContract("UFVOffering", [config])) as unknown as UFVOffering;
  const offeringAddress = await offering.getAddress();

  await token.connect(admin).grantRole(ROLES.MINTER, offeringAddress);
  await token.connect(admin).grantRole(ROLES.DISTRIBUTOR, distributor.address);
  await token.connect(admin).grantRole(ROLES.PAUSER, pauser.address);
  await offering.connect(admin).grantRole(ROLES.PAUSER, pauser.address);

  await kyc(registry, compliance, investors);
  for (const inv of investors) {
    await usdt.connect(admin).mint(inv.address, USDT(1_000_000));
    await usdt.connect(inv).approve(offeringAddress, ethers.MaxUint256);
  }
  await usdt.connect(admin).mint(distributor.address, USDT(10_000_000));
  await usdt.connect(distributor).approve(await token.getAddress(), ethers.MaxUint256);

  return { ...base, token, offering, config, params: p, startTime, endTime };
}

export async function deployOfferingFixture() {
  return deployOffering();
}

/** Mesma oferta, mas já no estado Active. */
export async function activeOfferingFixture() {
  const f = await deployOffering();
  await time.increaseTo(f.startTime);
  return f;
}

/** Deterministic PRNG (mulberry32) para os testes "fuzz". */
export function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    big: (min: bigint, max: bigint) => min + (BigInt(Math.floor(next() * 2 ** 52)) * (max - min + 1n)) / 2n ** 52n,
    pick: <T>(arr: T[]) => arr[Math.floor(next() * arr.length)],
  };
}
