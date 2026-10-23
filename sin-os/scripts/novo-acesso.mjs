#!/usr/bin/env node
/**
 * Gera o código de acesso de uma pessoa.
 *
 *   node scripts/novo-acesso.mjs maria
 *
 * Mostra o código (entregue só para a pessoa, por um canal privado) e a entrada para
 * ACCESS_CODES na Vercel. A Vercel guarda só o hash: quem lê as variáveis não vê o código.
 * Para tirar o acesso, apague a entrada da pessoa em ACCESS_CODES e faça um redeploy.
 */
import { createHash, randomBytes } from "node:crypto";

const name = (process.argv[2] ?? "").toLowerCase();
if (!/^[a-z0-9._-]{1,40}$/.test(name) || name === "admin") {
  console.error("uso: node scripts/novo-acesso.mjs <nome>  (letras minúsculas, números, . _ -; não pode ser admin)");
  process.exit(1);
}
const code = `sinos-${randomBytes(24).toString("base64url")}`;
const hash = createHash("sha256").update(code).digest("hex");
console.log(`Código de ${name} (entregue só para a pessoa):\n  ${code}\n`);
console.log(`Acrescente em ACCESS_CODES na Vercel (separe pessoas com vírgula):\n  ${name}:${hash}`);
