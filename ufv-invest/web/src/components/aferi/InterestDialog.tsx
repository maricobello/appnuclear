"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { buttonClass, cx } from "@/components/ui";
import { useT } from "@/i18n/client";

type Props = {
  open: boolean;
  onClose: () => void;
  tipo?: "interesse" | "suporte";
  usina?: { slug: string; name: string };
  cotas?: number;
};

const field = "mt-1 h-11 w-full rounded-lg border bg-surface-2 px-3 text-ink text-[14px] outline-none transition focus:border-brand";

/** Formulário de "Demonstrar interesse" / "Fale conosco" (sem compromisso de compra). */
export function InterestDialog({ open, onClose, tipo = "interesse", usina, cotas }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const { d: dict, t, locale } = useT();
  const L = dict.int;
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [bad, setBad] = useState<string[]>([]);
  const [protocolo, setProtocolo] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  async function submit(form: HTMLFormElement) {
    const fd = new FormData(form);
    setState("sending");
    setError(null);
    setBad([]);
    const body = {
      tipo,
      nome: String(fd.get("nome") ?? ""),
      email: String(fd.get("email") ?? ""),
      telefone: String(fd.get("telefone") ?? ""),
      usina: usina?.slug ?? "",
      cotas: fd.get("cotas") ? Number(fd.get("cotas")) : undefined,
      mensagem: String(fd.get("mensagem") ?? ""),
      aceite: fd.get("aceite") === "on" ? true : false,
      idioma: locale,
    };
    try {
      const r = await fetch("/api/interesse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json()) as { protocolo?: string; error?: string; issues?: string[] };
      if (!r.ok || !d.protocolo) {
        setBad(d.issues ?? []);
        throw new Error(r.status === 429 ? L.tooMany : locale === "pt" ? (d.error ?? L.failed) : L.failed);
      }
      setProtocolo(d.protocolo);
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  const close = () => {
    onClose();
    setTimeout(() => {
      setState("idle");
      setProtocolo(null);
    }, 200);
  };
  const err = (k: string) => (bad.includes(k) ? "border-critical" : "border-line-strong");
  const title = tipo === "suporte" ? L.titleSupport : L.titleInterest;

  return (
    <dialog ref={ref} onClose={close} className="m-auto w-[min(480px,94vw)] rounded-2xl border border-line-strong bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm" aria-labelledby="interesse-titulo">
      <div className="flex items-start justify-between border-b border-line px-6 py-4">
        <div>
          <h2 id="interesse-titulo" className="text-[17px] font-semibold text-ink">
            {title}
          </h2>
          {usina && <p className="text-[13px] text-muted">{usina.name}</p>}
        </div>
        <button onClick={close} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label={dict.common.close}>
          <X className="size-5" />
        </button>
      </div>
      {state === "done" ? (
        <div className="px-6 py-8 text-center">
          <CheckCircle2 className="mx-auto size-12 text-good" />
          <p className="mt-3 text-[16px] font-semibold text-ink">{L.received}</p>
          <p className="mt-1 text-[14px] text-ink-2">
            {t(L.protocol, { p: protocolo ?? "" })}
          </p>
          <button className={cx(buttonClass.primary, "mt-6")} onClick={close}>
            {dict.common.close}
          </button>
        </div>
      ) : (
        <form
          className="space-y-4 px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(e.currentTarget);
          }}
        >
          <label className="block text-[13px] font-medium text-ink-2">
            {L.name}
            <input name="nome" required minLength={3} maxLength={120} autoComplete="name" className={cx(field, err("nome"))} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-[13px] font-medium text-ink-2">
              {L.email}
              <input name="email" type="email" required maxLength={160} autoComplete="email" className={cx(field, err("email"))} />
            </label>
            <label className="block text-[13px] font-medium text-ink-2">
              {L.phone} <span className="font-normal text-muted">{dict.common.optional}</span>
              <input name="telefone" type="tel" maxLength={20} autoComplete="tel" className={cx(field, err("telefone"))} />
            </label>
          </div>
          {tipo === "interesse" && (
            <label className="block text-[13px] font-medium text-ink-2">
              {L.cotas}
              <input name="cotas" type="number" min={1} defaultValue={cotas ?? 1} className={cx(field, err("cotas"))} />
            </label>
          )}
          <label className="block text-[13px] font-medium text-ink-2">
            {L.message} <span className="font-normal text-muted">{dict.common.optional}</span>
            <textarea name="mensagem" maxLength={1000} rows={3} className={cx(field, "h-auto py-2", err("mensagem"))} />
          </label>
          <label className="flex items-start gap-2 text-[12px] leading-snug text-ink-2">
            <input name="aceite" type="checkbox" required className="mt-0.5 size-4 accent-[var(--brand)]" />
            {L.consent}
          </label>
          {error && (
            <p className="rounded-lg bg-critical/5 px-3 py-2 text-[13px] text-critical" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={state === "sending"} className={cx(buttonClass.primary, "w-full py-3")}>
            {state === "sending" && <Loader2 className="size-4 animate-spin" />} {dict.common.send}
          </button>
        </form>
      )}
    </dialog>
  );
}

/** Botão que abre o formulário */
export function InterestButton({ label, className, ...p }: Omit<Props, "open" | "onClose"> & { label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const { d } = useT();
  return (
    <>
      <button className={className ?? buttonClass.primary} onClick={() => setOpen(true)}>
        {label ?? d.int.button}
      </button>
      <InterestDialog open={open} onClose={() => setOpen(false)} {...p} />
    </>
  );
}
