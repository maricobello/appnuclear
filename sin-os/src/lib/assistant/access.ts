/**
 * Senhas simples da Iara — TEMPORÁRIAS e de propósito no front (vão no bundle do
 * navegador, qualquer um pode ler): servem para liberar o teste rápido da parte de GD sem
 * depender do código cadastrado na Vercel. Trocar: edite a lista abaixo ou defina
 * NEXT_PUBLIC_IARA_SENHA na Vercel (uma ou várias, separadas por vírgula; exige novo
 * deploy). A estrutura antiga continua no servidor: ASSISTANT_ACCESS_CODE segue valendo
 * e, com ASSISTANT_SIMPLE_CODE=off, volta a ser a única senha aceita.
 */
export const IARA_SENHAS = (process.env.NEXT_PUBLIC_IARA_SENHA || "senha1234,iara2026")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const IARA_SENHA = IARA_SENHAS[0];

export const senhaConfere = (s: string | null | undefined) => !!s && IARA_SENHAS.some((p) => p.toLowerCase() === s.trim().toLowerCase());
