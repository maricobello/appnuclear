"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui";

/** Só caminhos internos (o mesmo filtro de safeNext em lib/access, que é só do servidor). */
const internal = (next: string | null) => (next && /^\/(?![/\\])[^\s]*$/.test(next) && !next.startsWith("/entrar") ? next : "/");

export function LoginForm() {
  const params = useSearchParams();
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErro(null);
    try {
      const res = await fetch("/api/acesso", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codigo }) });
      if (res.ok) {
        window.location.href = internal(params.get("next"));
        return;
      }
      const d = (await res.json().catch(() => ({}))) as { erro?: string };
      setErro(d.erro ?? "não foi possível entrar");
    } catch {
      setErro("sem conexão com o servidor");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
      <label htmlFor="codigo" className="text-[13px] font-medium text-ink">
        Código de acesso
      </label>
      <input
        id="codigo"
        type="password"
        autoComplete="current-password"
        value={codigo}
        onChange={(e) => setCodigo(e.target.value)}
        className="min-h-11 rounded-xl bg-surface-2 px-3 text-[15px] text-ink outline-none focus:ring-2 focus:ring-accent"
        required
      />
      {erro ? (
        <p role="alert" className="text-[13px] text-critical">
          {erro}
        </p>
      ) : null}
      <Button type="submit" variant="primary" disabled={busy || !codigo.trim()}>
        {busy ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
