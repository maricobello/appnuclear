"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import {
  ArrowLeftRight,
  BatteryCharging,
  BookOpen,
  CloudSun,
  Gauge,
  Globe,
  Menu,
  ShieldCheck,
  TrendingUp,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import type { BrasilResp } from "@/lib/apiTypes";
import { useAsset } from "@/lib/asset";
import { SUB_COLOR } from "@/lib/chart";
import { useApi } from "@/lib/useApi";
import { IaraButton, IaraPanel } from "./assistant/Iara";
import { MotionRoot } from "./motion";
import { Delta, sourceState, StatusTag } from "./ui";

const NAV: { group: string; items: { href: string; label: string; Icon: typeof Gauge }[] }[] = [
  {
    group: "Mercado",
    items: [
      { href: "/", label: "Sala de Comando", Icon: Gauge },
      { href: "/sin", label: "SIN · Brasil", Icon: Zap },
      { href: "/previsao", label: "Previsão", Icon: TrendingUp },
      { href: "/arbitragem", label: "Arbitragem", Icon: ArrowLeftRight },
    ],
  },
  {
    group: "Ativos",
    items: [
      { href: "/bess", label: "BESS", Icon: BatteryCharging },
      { href: "/carteira", label: "Carteira", Icon: Wallet },
    ],
  },
  {
    group: "Contexto",
    items: [
      { href: "/global", label: "Mercados globais", Icon: Globe },
      { href: "/clima", label: "Clima & hidrologia", Icon: CloudSun },
    ],
  },
  {
    group: "Sistema",
    items: [
      { href: "/auditoria", label: "Agente auditor", Icon: ShieldCheck },
      { href: "/modelos", label: "Modelos & APIs", Icon: BookOpen },
    ],
  },
];
const ALL = NAV.flatMap((g) => g.items);

const subscribeSecond = (cb: () => void) => {
  const id = setInterval(cb, 1000);
  return () => clearInterval(id);
};

function Clock() {
  const sec = useSyncExternalStore(subscribeSecond, () => Math.floor(Date.now() / 1000), () => 0);
  if (!sec) return <span className="tnum font-mono text-[11.5px] text-muted">--:--:-- BRT</span>;
  const f = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(sec * 1000));
  const g = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  return (
    <span className="tnum whitespace-nowrap font-mono text-[11.5px] text-ink-2" title="Horário de Brasília">
      <span className="hidden text-muted 2xl:inline">{`${g("day")}/${g("month")}/${g("year")} `}</span>
      {`${g("hour")}:${g("minute")}:${g("second")}`} <span className="text-muted">BRT</span>
    </span>
  );
}

interface Lite {
  latest: { overallScore: number; startedAt: number; counts: { ok: number; degraded: number; down: number } } | null;
  dataMode: string;
}

const useLite = () => useApi<Lite>("/api/auditoria?lite=1", 60_000);

function ApiPill() {
  const { data } = useLite();
  const l = data?.latest;
  const tone = !l ? "text-muted border-line" : l.overallScore >= 85 ? "text-good border-good/30" : l.overallScore >= 60 ? "text-warning border-warning/35" : "text-critical border-critical/40";
  return (
    <Link href="/auditoria" className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[4px] border px-1.5 py-0.5 text-[11px] hover:bg-surface-2 ${tone}`} title="Score do agente auditor das APIs públicas">
      <ShieldCheck size={12} aria-hidden />
      <span className="font-mono font-semibold">APIs {l ? l.overallScore : "—"}</span>
      {l ? (
        <span className="hidden text-muted xl:inline">
          {l.counts.ok} ok{l.counts.degraded ? ` · ${l.counts.degraded} degr.` : ""}
          {l.counts.down ? ` · ${l.counts.down} fora` : ""}
        </span>
      ) : null}
      {data?.dataMode && data.dataMode !== "auto" ? <span className="text-warning">· {data.dataMode}</span> : null}
    </Link>
  );
}

/** Ticker do PLD: preço da hora por submercado e variação vs. mesma hora de ontem. */
function Ticker() {
  const { data } = useApi<BrasilResp>("/api/brasil", 60_000);
  const state = sourceState(data?.meta.pld, 2 * 3600_000);
  return (
    <div className="hidden min-w-0 items-center gap-3 lg:flex">
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted">
        Mercado
        <StatusTag state={state} at={data?.meta.pld.latestTs} compact detail={data?.meta.pld.fallback ?? data?.meta.pld.error} />
      </span>
      <div className="scrollbar-thin flex min-w-0 items-center gap-3 overflow-x-auto">
        {(data?.kpis ?? []).map((k) => (
          <span key={k.sub} className="inline-flex shrink-0 items-baseline gap-1.5 text-[11.5px]">
            <span className="inline-block h-1.5 w-1.5 self-center rounded-[1px]" style={{ background: SUB_COLOR[k.sub] }} aria-hidden />
            <span className="font-semibold text-ink-2">{k.sub}</span>
            <span className="tnum font-mono text-ink">{k.now === null ? "—" : new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(k.now)}</span>
            <span className="text-[10.5px]">
              <Delta value={k.now !== null && k.dayAgo ? (100 * (k.now - k.dayAgo)) / k.dayAgo : null} title="vs. mesma hora de ontem" />
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function AssetChip() {
  const a = useAsset();
  return (
    <Link
      href="/bess"
      className="hidden items-center gap-1.5 whitespace-nowrap rounded-[4px] border border-line px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-surface-2 md:inline-flex"
      title={`Ativo selecionado: ${a.name}`}
    >
      <BatteryCharging size={12} className="text-accent" aria-hidden />
      <span className="font-mono">
        {a.pow} MW / {a.cap} MWh
      </span>
      <span className="text-muted">· {a.sub}</span>
    </Link>
  );
}

function SystemStatus() {
  const { data } = useLite();
  const l = data?.latest;
  const ok = l ? l.overallScore >= 70 : null;
  return (
    <div className="flex items-center gap-1.5 text-[10.5px] text-muted">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${ok === null ? "bg-muted" : ok ? "live-dot bg-good" : "bg-warning"}`} aria-hidden />
      {ok === null ? "Sem auditoria" : ok ? "Sistema operacional" : "Sistema degradado"}
    </div>
  );
}

function NavList({ current, onNavigate }: { current?: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-3 px-2 py-3" aria-label="Navegação principal">
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="eyebrow px-2 pb-1 text-[9.5px]">{g.group}</div>
          <ul className="flex flex-col gap-px">
            {g.items.map(({ href, label, Icon }) => {
              const active = current === href;
              return (
                <li key={href} className="relative">
                  {active ? (
                    <motion.span layoutId="nav-active" className="absolute inset-0 rounded-md border border-line bg-surface-3" transition={{ type: "spring", stiffness: 520, damping: 42 }}>
                      <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" />
                    </motion.span>
                  ) : null}
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex min-h-10 items-center gap-2.5 rounded-md px-2.5 text-[12.5px] transition-colors lg:min-h-8 ${active ? "text-ink" : "text-muted hover:bg-surface-2 hover:text-ink-2"}`}
                  >
                    <Icon size={15} strokeWidth={1.75} className={active ? "text-accent" : ""} aria-hidden />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-3.5">
      <Zap size={18} className="text-accent" fill="currentColor" strokeWidth={1.5} aria-hidden />
      <div className="leading-none">
        <div className="text-[14px] font-bold tracking-[0.08em] text-ink">SIN OS</div>
        <div className="mt-1 text-[8.5px] font-semibold uppercase tracking-[0.16em] text-muted">Energy Arbitrage Terminal</div>
      </div>
      {onClose ? (
        <button className="ml-auto grid h-10 w-10 place-items-center rounded-md text-muted hover:bg-surface-2 lg:hidden" onClick={onClose} aria-label="Fechar menu">
          <X size={18} />
        </button>
      ) : null}
    </div>
  );
}

function SidebarFooter() {
  return (
    <div className="shrink-0 border-t border-line px-3.5 py-2.5">
      <SystemStatus />
      <div className="mt-1 text-[10px] text-muted">
        <span className="font-mono">v3.0</span> · CCEE · ONS · Open-Meteo · BCB
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [iara, setIara] = useState(false);
  const current = ALL.find((n) => (n.href === "/" ? path === "/" : path.startsWith(n.href)));

  return (
    <MotionRoot>
      <div className="flex min-h-screen">
        {/* sidebar fixa (≥ lg) */}
        <aside className="sticky top-0 hidden h-screen w-[212px] shrink-0 flex-col border-r border-line bg-surface lg:flex">
          <Brand />
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            <NavList current={current?.href} />
          </div>
          <SidebarFooter />
        </aside>

        {/* gaveta (< lg) */}
        <AnimatePresence>
          {open ? (
            <>
              <motion.div
                key="scrim"
                className="fixed inset-0 z-30 bg-black/60 lg:hidden"
                onClick={() => setOpen(false)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                aria-hidden
              />
              <motion.aside
                key="drawer"
                className="fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col border-r border-line bg-surface lg:hidden"
                initial={{ x: -280 }}
                animate={{ x: 0 }}
                exit={{ x: -280 }}
                transition={{ type: "spring", stiffness: 420, damping: 40 }}
              >
                <Brand onClose={() => setOpen(false)} />
                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
                  <NavList current={current?.href} onNavigate={() => setOpen(false)} />
                </div>
                <SidebarFooter />
              </motion.aside>
            </>
          ) : null}
        </AnimatePresence>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-line bg-page/85 px-2 backdrop-blur-md sm:px-4">
            <button className="grid h-10 w-10 place-items-center rounded-md text-ink-2 hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu">
              <Menu size={19} />
            </button>
            <span className="shrink-0 truncate text-[13px] font-semibold text-ink">{current?.label ?? "SIN OS"}</span>
            <span className="hidden h-4 w-px bg-line-strong lg:block" aria-hidden />
            <Ticker />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <span className="hidden sm:inline">
                <Clock />
              </span>
              <ApiPill />
              <AssetChip />
              <IaraButton open={iara} onToggle={() => setIara((v) => !v)} />
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1920px] min-w-0 flex-1 p-3 sm:p-4">{children}</main>
        </div>
      </div>
      <IaraPanel open={iara} onClose={() => setIara(false)} onToggle={() => setIara((v) => !v)} />
    </MotionRoot>
  );
}
