import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Entrar — SIN OS", robots: { index: false, follow: false } };

export default function EntrarPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px] rounded-3xl bg-surface p-7 shadow-sm">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">SIN OS</h1>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
          Terminal de inteligência do mercado de energia: PLD, previsão, planejamento da operação, baterias e carteira.
        </p>
        <p className="mt-4 text-[13px] text-muted">Acesso restrito a usuários convidados.</p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
