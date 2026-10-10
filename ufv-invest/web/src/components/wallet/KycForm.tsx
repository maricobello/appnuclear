"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useSiwe } from "./useSiwe";
import { buttonClass, cx, Notice } from "@/components/ui";
import { useT } from "@/i18n/client";
import { KYC_COUNTRY_CODES } from "@/lib/countries";
import { explorerUrl, TARGET_CHAIN_ID } from "@/lib/web3/chains";
import { shortAddr } from "@/lib/fmt";

type KycStatus = { status: "nenhum" | "pendente" | "aprovado"; at?: string; nome?: string; docTipo?: "cpf" | "passaporte"; doc?: string; txHash?: string };

/**
 * Formulário de KYC. Na testnet o site aprova na hora (relayer) e chama `onApproved` para a tela
 * reler o registro on-chain; na rede principal o pedido fica pendente para a equipe de compliance.
 */
export function KycForm({ verifiedOnChain, onApproved }: { verifiedOnChain: boolean | undefined; onApproved?: () => void }) {
  const siwe = useSiwe();
  const { d, t, f, locale } = useT();
  const k = d.kyc;
  const [fetched, setStatus] = useState<KycStatus | null>(null);
  const [form, setForm] = useState({ nome: "", pais: locale === "pt" ? "BR" : "", cpf: "", passaporte: "", email: "", aceite: false });
  const isBr = form.pais === "BR";
  const names = (() => {
    try {
      return new Intl.DisplayNames([f.tag], { type: "region" });
    } catch {
      return null;
    }
  })();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!siwe.isSignedIn) return;
    fetch("/api/kyc", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => setStatus(r))
      .catch(() => setStatus(null));
  }, [siwe.isSignedIn]);

  const status = siwe.isSignedIn ? fetched : null;

  if (verifiedOnChain) {
    return (
      <Notice tone="good" title={k.verified}>
        {k.verifiedText}
      </Notice>
    );
  }

  if (!siwe.isSignedIn) {
    return (
      <div className="space-y-3 text-[14px] text-ink-2">
        <p>{k.signFirst}</p>
        <button className={buttonClass.primary} onClick={() => siwe.signIn()} disabled={siwe.status === "signing"}>
          {siwe.status === "signing" ? k.confirming : k.signIn}
        </button>
        {siwe.error && <p className="text-[13px] text-critical">{siwe.error}</p>}
      </div>
    );
  }

  if (status?.status === "aprovado") {
    return (
      <Notice tone="good" title={k.approved}>
        {k.approvedText}
        {status.txHash && (
          <a href={explorerUrl("tx", status.txHash)} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-1 underline-offset-2 hover:underline">
            {t(d.ip.viewTx, { h: shortAddr(status.txHash, 6) })} <ExternalLink className="size-3" />
          </a>
        )}
      </Notice>
    );
  }

  if (status?.status === "pendente") {
    return (
      <Notice tone="info" title={k.pending}>
        {t(k.pendingText, { d: f.date(status.at, true), name: status.nome ?? "", doc: `${status.docTipo === "passaporte" ? k.passportLbl : "CPF"} ${status.doc ?? ""}` })}
        {/* testnet: a aprovação é automática; se a rede falhou no envio, dá para tentar de novo */}
        {TARGET_CHAIN_ID === 97 && (
          <button type="button" className="ml-1 font-medium underline-offset-2 hover:underline" onClick={() => setStatus({ status: "nenhum" })}>
            {k.retry}
          </button>
        )}
      </Notice>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const body = { nome: form.nome, email: form.email, aceite: form.aceite, pais: form.pais, ...(isBr ? { cpf: form.cpf } : { passaporte: form.passaporte }) };
      const r = await fetch("/api/kyc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const res = (await r.json()) as { status?: KycStatus["status"]; at?: string; txHash?: string; error?: string; issues?: string[] };
      if (!r.ok) throw new Error(res.issues?.includes("cpf") ? k.badCpf : locale === "pt" && res.error ? res.error : k.failed);
      const approved = res.status === "aprovado";
      setStatus({ status: approved ? "aprovado" : "pendente", at: res.at, nome: form.nome, docTipo: isBr ? "cpf" : "passaporte", doc: "***", txHash: res.txHash });
      if (approved) onApproved?.();
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
        <label htmlFor="kyc-nome" className="text-[13px] text-ink-2">
          {k.name}
        </label>
        <input id="kyc-nome" required minLength={5} autoComplete="name" className={input} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
      </div>
      <div>
        <label htmlFor="kyc-pais" className="text-[13px] text-ink-2">
          {k.country}
        </label>
        <select id="kyc-pais" required className={input} value={form.pais} onChange={(e) => setForm({ ...form, pais: e.target.value })}>
          <option value="" disabled>
            —
          </option>
          {KYC_COUNTRY_CODES.map((c) => (
            <option key={c} value={c}>
              {names?.of(c) ?? c}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          {isBr ? (
            <>
              <label htmlFor="kyc-doc" className="text-[13px] text-ink-2">
                {k.cpf}
              </label>
              <input id="kyc-doc" required inputMode="numeric" placeholder="000.000.000-00" className={input} value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} />
            </>
          ) : (
            <>
              <label htmlFor="kyc-doc" className="text-[13px] text-ink-2">
                {k.passport}
              </label>
              <input id="kyc-doc" required minLength={5} maxLength={20} pattern="[A-Za-z0-9-]+" autoComplete="off" className={input} value={form.passaporte} onChange={(e) => setForm({ ...form, passaporte: e.target.value })} />
            </>
          )}
        </div>
        <div>
          <label htmlFor="kyc-email" className="text-[13px] text-ink-2">
            {k.email}
          </label>
          <input id="kyc-email" required type="email" autoComplete="email" className={input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
      </div>
      <label className="flex items-start gap-2 text-[13px] text-ink-2">
        <input type="checkbox" required className="mt-1 accent-[var(--brand)]" checked={form.aceite} onChange={(e) => setForm({ ...form, aceite: e.target.checked })} />
        <span>{k.consent}</span>
      </label>
      {error && <p className="text-[13px] text-critical" role="alert">{error}</p>}
      <button type="submit" className={cx(buttonClass.primary, "w-full")} disabled={sending}>
        {sending ? (TARGET_CHAIN_ID === 97 ? k.approving : k.sending) : k.submit}
      </button>
      {TARGET_CHAIN_ID === 97 && <p className="text-[12px] text-muted">{k.testnetAuto}</p>}
      {form.pais && !isBr && <p className="text-[12px] text-muted">{k.foreignNote}</p>}
      <p className="text-[12px] text-muted">{k.prodNote}</p>
    </form>
  );
}
