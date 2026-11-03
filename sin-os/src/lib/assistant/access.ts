/**
 * Senha simples da Iara — TEMPORÁRIA e de propósito no front (vai no bundle do navegador,
 * qualquer um pode ler): serve para liberar o teste rápido da parte de GD sem depender do
 * código cadastrado na Vercel. Trocar: edite o valor abaixo ou defina
 * NEXT_PUBLIC_IARA_SENHA na Vercel (exige novo deploy). A estrutura antiga continua no
 * servidor: ASSISTANT_ACCESS_CODE segue valendo e, com ASSISTANT_SIMPLE_CODE=off, volta a
 * ser a única senha aceita.
 */
export const IARA_SENHA = (process.env.NEXT_PUBLIC_IARA_SENHA || "iara2026").trim();

export const senhaConfere = (s: string | null | undefined) => !!s && s.trim().toLowerCase() === IARA_SENHA.toLowerCase();
