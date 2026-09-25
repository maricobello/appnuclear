"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowLeftRight, Atom, BookOpen, CloudSun, Gauge, Globe, Menu, ShieldCheck, TrendingUp, X, Zap } from "lucide-react";
import { useApi } from "@/lib/useApi";
import { Badge } from "./ui";

const NAV = [
  { href: "/", label: "Sala de Comando", Icon: Gauge },
  { href: "/sin", label: "SIN · Brasil", Icon: Zap },
  { href: "/previsao", label: "Previsão", Icon: TrendingUp },
  { href: "/arbitragem", label: "Arbitragem", Icon: ArrowLeftRight },
  { href: "/global", label: "Mercados globais", Icon: Globe },
  { href: "/clima", label: "Clima & hidrologia", Icon: CloudSun },
  { href: "/auditoria", label: "Agente auditor", Icon: ShieldCheck },
  { href: "/modelos", label: "Modelos & APIs", Icon: BookOpen },
];

const subscribeSecond = (cb: () => void) => {
  const id = setInterval(cb, 1000);
  return () => clearInterval(id);
};

function Clock() {
  const sec = useSyncExternalStore(subscribeSecond, () => Math.floor(Date.now() / 1000), () => 0);
  if (!sec) return <span className="tnum text-xs text-muted">--:--:--</span>;
  const now = new Date(sec * 1000);
  const brt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
  const utc = now.toISOString().slice(11, 16);
  return (
    <span className="tnum text-xs text-ink-2">
      {brt} <span className="text-muted">BRT</span> · {utc} <span className="text-muted">UTC</span>
    </span>
  );
}

interface Lite {
  latest: { overallScore: number; startedAt: number; counts: { ok: number; degraded: number; down: number } } | null;
  dataMode: string;
}

function AuditPill() {
  const { data } = useApi<Lite>("/api/auditoria?lite=1", 30_000);
  const l = data?.latest;
  const mode = data?.dataMode;
  return (
    <div className="flex items-center gap-2">
      {mode && mode !== "auto" ? <Badge level={mode === "demo" ? "warning" : "neutral"}>modo {mode}</Badge> : null}
      <Link href="/auditoria" className="hover:opacity-80">
        {l ? (
          <Badge level={l.overallScore >= 85 ? "good" : l.overallScore >= 60 ? "warning" : "critical"} title="Score do agente auditor">
            APIs {l.overallScore}/100 · {l.counts.ok} ok{l.counts.degraded ? ` · ${l.counts.degraded} degr.` : ""}
            {l.counts.down ? ` · ${l.counts.down} fora` : ""}
          </Badge>
        ) : (
          <Badge level="neutral">APIs sem auditoria</Badge>
        )}
      </Link>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const current = NAV.find((n) => (n.href === "/" ? path === "/" : path.startsWith(n.href)));

  return (
    <div className="flex min-h-screen">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 shrink-0 border-r border-line bg-surface transition-transform lg:static lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-line px-4">
          <Atom size={20} className="text-accent" aria-hidden />
          <div>
            <div className="text-sm font-semibold tracking-wider text-ink">SIN OS</div>
            <div className="text-[10px] uppercase tracking-widest text-muted">energy arbitrage terminal</div>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu">
            <X size={18} />
          </button>
        </div>
        <nav className="flex flex-col gap-0.5 p-2">
          {NAV.map(({ href, label, Icon }) => {
            const active = current?.href === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors ${active ? "bg-surface-3 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink-2"}`}
              >
                <Icon size={16} className={active ? "text-accent" : ""} aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 border-t border-line p-3 text-[10px] leading-relaxed text-muted">
          Dados públicos: CCEE · ONS · Energy-Charts · Elexon · NESO · Open-Meteo · BCB · EIA. Não é recomendação de investimento.
        </div>
      </aside>
      {open ? <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} aria-hidden /> : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-page/90 px-4 backdrop-blur">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu">
            <Menu size={20} />
          </button>
          <span className="truncate text-sm text-ink-2">{current?.label ?? "SIN OS"}</span>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden sm:inline">
              <Clock />
            </span>
            <AuditPill />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] flex-1 p-4">{children}</main>
      </div>
    </div>
  );
}
