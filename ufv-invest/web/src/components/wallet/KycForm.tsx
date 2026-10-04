"use client";

import { useEffect, useState } from "react";
import { useSiwe } from "./useSiwe";
import { buttonClass, cx, Notice } from "@/components/ui";
import { dateBR } from "@/lib/fmt";

type KycStatus = { status: "nenhum" | "pendente"; at?: string; nome?: string; cpf?: string };

export function KycForm({ verifiedOnChain }: { verifiedOnChain: boolean | undefined }) {
  const siwe = useSiwe();
  const [fetched, setStatus] = useState<KycStatus | null>(null);
  const [form, setForm] = useState({ nome: "", cpf: "", email: "", aceite: false });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!siwe.isSignedIn) return;
    fetch("/api/kyc", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStatus(d))
      .catch(() => setStatus(null));
  }, [siwe.isSignedIn]);

  const status = siwe.isSignedIn ? fetched : null;

  if (verifiedOnChain) {
    return <Notice tone="good" title="Identidade verificada">Sua carteira está habilitada no registro de investidores do contrato (IdentityRegistry).</Notice>;
  }

  if (!siwe.isSignedIn) {
    return (
      <div className="space-y-3 text-[14px] text-ink-2">
        <p>Para enviar seus dados de KYC, primeiro prove que esta carteira é sua assinando uma mensagem (gratuito, sem transação).</p>
        <button className={buttonClass.primary} onClick={() => siwe.signIn()} disabled={siwe.status === "signing"}>
          {siwe.status === "signing" ? "Confirme na carteira…" : "Entrar com assinatura"}
        </button>
        {siwe.error && <p className="text-[13px] text-critical">{siwe.error}</p>}
      </div>
    );
  }

  if (status?.status === "pendente") {
    return (
      <Notice tone="info" title="KYC em análise">
        Pedido enviado em {dateBR(status.at, true)} ({status.nome}, CPF {status.cpf}). Após aprovação, sua carteira é registrada on-chain e esta tela muda sozinha.
      </Notice>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const r = await fetch("/api/kyc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, pais: "BR" }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "falha ao enviar");
      setStatus({ status: "pendente", at: d.at, nome: form.nome, cpf: "***" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const input = "mt-1 w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-[14px] text-ink placeholder:text-muted";
  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label htmlFor="kyc-nome" className="text-[13px] text-ink-2">Nome completo</label>
        <input id="kyc-nome" required minLength={5} autoComplete="name" className={input} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="kyc-cpf" className="text-[13px] text-ink-2">CPF</label>
          <input id="kyc-cpf" required inputMode="numeric" placeholder="000.000.000-00" className={input} value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} />
        </div>
        <div>
          <label htmlFor="kyc-email" className="text-[13px] text-ink-2">E-mail</label>
          <input id="kyc-email" required type="email" autoComplete="email" className={input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
      </div>
      <label className="flex items-start gap-2 text-[13px] text-ink-2">
        <input type="checkbox" required className="mt-1 accent-[var(--brand)]" checked={form.aceite} onChange={(e) => setForm({ ...form, aceite: e.target.checked })} />
        <span>
          Autorizo o tratamento dos meus dados para verificação de identidade e prevenção à lavagem de dinheiro (LGPD, art. 7º, II e Lei 9.613/98) e declaro ciência dos
          riscos do investimento.
        </span>
      </label>
      {error && <p className="text-[13px] text-critical" role="alert">{error}</p>}
      <button type="submit" className={cx(buttonClass.primary, "w-full")} disabled={sending}>
        {sending ? "Enviando…" : "Enviar para verificação"}
      </button>
      <p className="text-[12px] text-muted">Na versão de produção, esta etapa inclui validação de documento e prova de vida por um provedor de KYC.</p>
    </form>
  );
}
