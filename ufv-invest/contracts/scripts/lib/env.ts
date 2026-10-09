/** Leitura de variáveis de ambiente (os scripts `hardhat run` não recebem argumentos de CLI). */
export function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function requireEnv(name: string, hint?: string): string {
  const v = env(name);
  if (!v) throw new Error(`defina ${name}${hint ? ` (${hint})` : ""}`);
  return v;
}

export function envFlag(name: string): boolean {
  return /^(1|true|yes|sim)$/i.test(env(name) ?? "");
}

export function envList(name: string): string[] {
  return (env(name) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
