/**
 * Gera web/src/lib/web3/abi.ts a partir dos artefatos compilados (npm run export:abi).
 *
 * - ABIs exportadas `as const` para tipagem do viem/wagmi.
 * - `offeringAbi` também inclui os erros que podem "borbulhar" de chamadas internas (token de
 *   cotas no settle/claimTokens; ERC-20 do token de pagamento no commit), para o viem conseguir
 *   decodificar o motivo do revert na simulação.
 * - Saída determinística (sem data), para não gerar diff à toa.
 */
import fs from "node:fs";
import path from "node:path";
import { id } from "ethers";

type AbiItem = { type: string; name?: string; inputs?: { type: string; components?: unknown[] }[] } & Record<
  string,
  unknown
>;

const ROOT = path.resolve(__dirname, "..");
const OUT = process.env.ABI_OUT_FILE
  ? path.resolve(process.env.ABI_OUT_FILE)
  : path.resolve(ROOT, "../web/src/lib/web3/abi.ts");

function artifact(sourcePath: string, name: string): AbiItem[] {
  const file = path.join(ROOT, "artifacts", sourcePath, `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`artefato não encontrado: ${file} (rode npm run compile)`);
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { abi: AbiItem[] }).abi;
}

function typeSig(t: { type: string; components?: unknown[] }): string {
  if (t.type.startsWith("tuple")) {
    const inner = (t.components as { type: string; components?: unknown[] }[]).map(typeSig).join(",");
    return `(${inner})${t.type.slice(5)}`;
  }
  return t.type;
}
const sig = (i: AbiItem) => `${i.type}:${i.name}(${(i.inputs ?? []).map(typeSig).join(",")})`;

/** Acrescenta a `base` os erros de `extra` que ainda não existem (por assinatura). */
function withErrorsFrom(base: AbiItem[], ...extras: AbiItem[][]): AbiItem[] {
  const seen = new Set(base.map(sig));
  const out = [...base];
  for (const extra of extras) {
    for (const item of extra) {
      if (item.type !== "error" || seen.has(sig(item))) continue;
      seen.add(sig(item));
      out.push(item);
    }
  }
  return out;
}

const registry = artifact("src/IdentityRegistry.sol", "IdentityRegistry");
const token = artifact("src/UFVPlantToken.sol", "UFVPlantToken");
const offering = artifact("src/UFVOffering.sol", "UFVOffering");
const mockUsdt = artifact("src/testnet/MockUSDT.sol", "MockUSDT");

const ERC20_FUNCTIONS = new Set(["balanceOf", "allowance", "approve", "decimals", "symbol", "transfer"]);
const erc20 = mockUsdt.filter(
  (i) =>
    (i.type === "function" && ERC20_FUNCTIONS.has(i.name!)) ||
    (i.type === "event" && (i.name === "Transfer" || i.name === "Approval")) ||
    (i.type === "error" && i.name!.startsWith("ERC20")),
);
const missing = [...ERC20_FUNCTIONS].filter((n) => !erc20.some((i) => i.type === "function" && i.name === n));
if (missing.length) throw new Error(`erc20Abi sem: ${missing.join(", ")}`);

const exportsList: [string, string, AbiItem[]][] = [
  ["identityRegistryAbi", "IdentityRegistry — KYC/AML (isVerified, investorOf, setInvestor…)", registry],
  ["plantTokenAbi", "UFVPlantToken — cotas, receita (claimable/claim) e documentos (getDocument)", withErrorsFrom(token, registry)],
  [
    "offeringAbi",
    "UFVOffering — oferta primária (commit/withdraw/refund/claimTokens/settle/finalize) + erros internos",
    withErrorsFrom(offering, token, erc20),
  ],
  ["erc20Abi", "ERC-20 mínimo para o token de pagamento (USDT BEP-20 / MockUSDT)", erc20],
  ["mockUsdtAbi", "MockUSDT — SOMENTE TESTNET (faucet, mint do owner + ERC-20)", mockUsdt],
];

const roles = Object.fromEntries(
  ["COMPLIANCE_ROLE", "MINTER_ROLE", "MINTER_ADMIN_ROLE", "DISTRIBUTOR_ROLE", "PAUSER_ROLE", "DOCUMENT_ROLE"].map((r) => [r, id(r)]),
);

const banner = `/* eslint-disable */
// ─────────────────────────────────────────────────────────────────────────────────────────────
// ARQUIVO GERADO por contracts/scripts/export-abi.ts (\`npm run export:abi\` em ufv-invest/contracts).
// NÃO EDITE À MÃO: altere os contratos e gere de novo.
// ─────────────────────────────────────────────────────────────────────────────────────────────
`;

let body = banner;
for (const [name, doc, abi] of exportsList) {
  body += `\n/** ${doc} */\nexport const ${name} = ${JSON.stringify(abi, null, 2)} as const;\n`;
}
body += `
/** Índices do enum \`UFVOffering.State\` (valor retornado por \`state()\`). */
export const offeringStates = ["Pending", "Active", "Succeeded", "Failed", "Finalized", "Cancelled"] as const;
export type OfferingState = (typeof offeringStates)[number];

/**
 * Hashes dos papéis (AccessControl). DEFAULT_ADMIN_ROLE = 0x00…00. COMPLIANCE_ROLE existe só no
 * IdentityRegistry; DOCUMENT_ROLE, MINTER_ROLE (imutável) e DISTRIBUTOR_ROLE no token; PAUSER_ROLE
 * no token e na oferta.
 */
export const roles = {
  DEFAULT_ADMIN_ROLE: "0x${"0".repeat(64)}",
${Object.entries(roles)
  .map(([k, v]) => `  ${k}: "${v}",`)
  .join("\n")}
} as const;
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body);
const count = exportsList.map(([n, , a]) => `${n}(${a.length})`).join(", ");
console.log(`ABIs exportadas para ${path.relative(process.cwd(), OUT)}: ${count}`);
