"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  ArrowLeftRight,
  BatteryCharging,
  BookOpen,
  CloudSun,
  Flame,
  Gauge,
  Globe,
  Menu,
  Monitor,
  Moon,
  ScrollText,
  ShieldCheck,
  Sun,
  TrendingUp,
  Wallet,
  Waypoints,
  Wind,
  X,
  Zap,
} from "lucide-react";
import type { BrasilResp } from "@/lib/apiTypes";
import { useAsset } from "@/lib/asset";
import { setAppearance, setUiMode, useAppearance, useUiMode, type Appearance, type UiMode } from "@/lib/theme";
import { useApi } from "@/lib/useApi";
import { IaraButton, IaraPanel } from "./assistant/Iara";
import { MotionRoot } from "./motion";
import { LIVE_STYLE, SourcesPill, sourceTally, useLiveSources } from "./Sources";
import { Delta, sourceState, StatusTag } from "./ui";

const NAV: { group: string; items: { href: string; label: string; Icon: typeof Gauge }[] }[] = [
  {
    group: "Mercado",
    items: [
      { href: "/", label: "Sala de Comando", Icon: Gauge },
      { href: "/sin", label: "SIN · Brasil", Icon: Zap },
      { href: "/rede", label: "Rede elétrica", Icon: Waypoints },
      { href: "/termicas", label: "Térmicas & encargos", Icon: Flame },
      { href: "/renovaveis", label: "Renováveis & corte", Icon: Wind },
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
      { href: "/metodologia", label: "Metodologia", Icon: ScrollText },
    ],
  },
];
const ALL = NAV.flatMap((g) => g.items);

/** Fontes de dados em uma linha, ao vivo (o detalhe fica em "APIs conectadas" e no Agente auditor). */
function SystemStatus({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useLiveSources();
  const t = sourceTally(data);
  const tone = !t ? "bg-muted" : t.down ? "bg-critical" : t.stale ? "bg-warning" : "bg-good";
  const text = !t
    ? "Consultando as fontes…"
    : t.down
      ? `${t.down} fonte${t.down > 1 ? "s" : ""} fora do ar`
      : t.stale
        ? `${t.stale} fonte${t.stale > 1 ? "s" : ""} atrasada${t.stale > 1 ? "s" : ""}`
        : "Fontes respondendo";
  const problems = data?.sources.filter((s) => s.state === "down" || s.state === "stale" || s.state === "alt").map((s) => `${s.name}: ${LIVE_STYLE[s.state].label.toLowerCase()}`) ?? [];
  return (
    <Link
      href="/auditoria"
      onClick={onNavigate}
      className="flex min-h-11 sm:min-h-9 items-center gap-2 rounded-[10px] px-3 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      title={problems.length ? problems.join(" · ") : "Estado das fontes de dados agora"}
    >
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${tone}`} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {t ? <span className="tnum font-medium text-ink-2">{`${t.ok}/${t.total}`}</span> : null}
    </Link>
  );
}

const APPEARANCES: { value: Appearance; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "Automático (segue o sistema)", Icon: Monitor },
  { value: "light", label: "Claro", Icon: Sun },
  { value: "dark", label: "Escuro", Icon: Moon },
];

function AppearanceSwitch() {
  const current = useAppearance();
  const ui = useUiMode();
  const locked = ui === "terminal";
  return (
    <div
      role="radiogroup"
      aria-label="Aparência"
      aria-disabled={locked || undefined}
      title={locked ? "No visual Terminal o tema é sempre escuro" : undefined}
      className={`flex rounded-[10px] bg-surface-2 p-[3px] transition-opacity ${locked ? "pointer-events-none opacity-40" : ""}`}
    >
      {APPEARANCES.map(({ value, label, Icon }) => {
        const active = current === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            tabIndex={locked ? -1 : undefined}
            onClick={() => setAppearance(value)}
            className={`relative grid h-8 flex-1 place-items-center rounded-[8px] transition-colors ${active ? "text-ink" : "text-muted hover:text-ink"}`}
          >
            {active ? <motion.span layoutId="appearance-thumb" className="absolute inset-0 rounded-[8px] bg-seg-thumb shadow-[0_1px_3px_rgba(0,0,0,0.12)]" transition={{ type: "spring", stiffness: 500, damping: 40 }} /> : null}
            <Icon size={15} className="relative" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

const VISUALS: { value: UiMode; label: string; title: string }[] = [
  { value: "modern", label: "Moderno", title: "Visual moderno: limpo, claro ou escuro" },
  { value: "terminal", label: "Terminal", title: "Visual clássico do SIN OS: escuro, denso, com faixa de cotações e relógio no topo" },
];

/** Moderno × Terminal (o visual clássico). */
function VisualSwitch() {
  const current = useUiMode();
  return (
    <div role="radiogroup" aria-label="Visual" className="flex rounded-[10px] bg-surface-2 p-[3px]">
      {VISUALS.map(({ value, label, title }) => {
        const active = current === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            title={title}
            onClick={() => setUiMode(value)}
            className={`relative flex h-8 flex-1 items-center justify-center rounded-[8px] text-[13px] font-medium transition-colors ${active ? "text-ink" : "text-muted hover:text-ink"}`}
          >
            {active ? <motion.span layoutId="visual-thumb" className="absolute inset-0 rounded-[8px] bg-seg-thumb shadow-[0_1px_3px_rgba(0,0,0,0.12)]" transition={{ type: "spring", stiffness: 500, damping: 40 }} /> : null}
            <span className="relative">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function NavList({ current, onNavigate }: { current?: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-5 px-3 py-2" aria-label="Navegação principal">
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="nav-group px-3 pb-1 text-[12px] font-medium text-muted">{g.group}</div>
          <ul className="flex flex-col gap-0.5">
            {g.items.map(({ href, label, Icon }) => {
              const active = current === href;
              return (
                <li key={href} className="relative">
                  {active ? <motion.span layoutId="nav-active" className="absolute inset-0 rounded-[10px] bg-surface-3/80" transition={{ type: "spring", stiffness: 520, damping: 42 }} /> : null}
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-[14px] transition-colors lg:min-h-9 ${active ? "font-medium text-ink" : "text-ink-2 hover:bg-surface-2"}`}
                  >
                    <Icon size={18} strokeWidth={1.75} className={active ? "text-accent" : "text-muted"} aria-hidden />
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

function Sidebar({ current, iara, onIara, onNavigate, onClose }: { current?: string; iara: boolean; onIara: () => void; onNavigate?: () => void; onClose?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-6">
        <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-accent-fill text-on-accent" aria-hidden>
          <Zap size={16} fill="currentColor" strokeWidth={1.5} />
        </span>
        <span className="leading-none">
          <span className="block text-[17px] font-semibold tracking-[-0.01em] text-ink">SIN OS</span>
          <span className="terminal-only mt-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted">Energy Arbitrage Terminal</span>
        </span>
        {onClose ? (
          <button className="ml-auto grid h-11 w-11 place-items-center rounded-full text-muted hover:bg-surface-2" onClick={onClose} aria-label="Fechar menu">
            <X size={20} />
          </button>
        ) : null}
      </div>
      <div className="px-3 pb-3">
        <IaraButton open={iara} onToggle={onIara} variant="search" />
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <NavList current={current} onNavigate={onNavigate} />
      </div>
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-4 pt-3">
        <SystemStatus onNavigate={onNavigate} />
        <VisualSwitch />
        <AppearanceSwitch />
      </div>
    </div>
  );
}

/* ------------------------------------------------ faixa do visual Terminal */

const subscribeSecond = (cb: () => void) => {
  const id = setInterval(cb, 1000);
  return () => clearInterval(id);
};
const clockFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** Relógio de Brasília (só é montado no visual Terminal). */
function Clock() {
  const sec = useSyncExternalStore(subscribeSecond, () => Math.floor(Date.now() / 1000), () => 0);
  if (!sec) return <span className="tnum text-[12px] text-muted">--:--:-- BRT</span>;
  const p = clockFmt.formatToParts(new Date(sec * 1000));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return (
    <span className="tnum whitespace-nowrap text-[12px] text-ink-2" title="Horário de Brasília">
      <span className="hidden text-muted 2xl:inline">{`${g("day")}/${g("month")} `}</span>
      {`${g("hour")}:${g("minute")}:${g("second")}`} <span className="text-muted">BRT</span>
    </span>
  );
}

const fmt2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SUB_DOT: Record<string, string> = { SE: "var(--sub-se)", S: "var(--sub-s)", NE: "var(--sub-ne)", N: "var(--sub-n)" };

/** PLD da hora por submercado e a variação contra a mesma hora de ontem. */
function Ticker() {
  const { data } = useApi<BrasilResp>("/api/brasil", 60_000);
  const meta = data?.meta.pld;
  return (
    <div className="flex min-w-0 items-center gap-4">
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-muted">
        PLD
        <StatusTag state={sourceState(meta, 2 * 3600_000)} at={meta?.latestTs} compact detail={meta?.fallback ?? meta?.error} />
      </span>
      {/* rolável no celular: precisa receber foco para rolar pelo teclado */}
      <div className="scrollbar-thin flex min-w-0 items-center gap-4 overflow-x-auto" tabIndex={0} role="region" aria-label="PLD da hora por submercado">
        {(data?.kpis ?? []).map((k) => (
          <span key={k.sub} className="inline-flex shrink-0 items-baseline gap-1.5 text-[12px]">
            <span className="inline-block h-2 w-2 self-center rounded-full" style={{ background: SUB_DOT[k.sub] }} aria-hidden />
            <span className="font-semibold text-ink-2">{k.sub}</span>
            <span className="tnum text-ink">{k.now === null ? "—" : fmt2.format(k.now)}</span>
            <Delta value={k.now !== null && k.dayAgo ? (100 * (k.now - k.dayAgo)) / k.dayAgo : null} title="vs. mesma hora de ontem" />
          </span>
        ))}
      </div>
    </div>
  );
}

function AssetChip() {
  const a = useAsset();
  return (
    <Link href="/bess" className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-[4px] border border-line px-2 text-[12px] text-ink-2 hover:bg-surface-2" title={`Ativo: ${a.name}`}>
      <BatteryCharging size={13} className="text-accent" aria-hidden />
      <span className="tnum">
        {a.pow} MW / {a.cap} MWh
      </span>
      <span className="text-muted">· {a.sub}</span>
    </Link>
  );
}

/** Faixa de cotações, APIs, ativo e relógio: o topo do SIN OS clássico (desktop) e uma versão curta no celular. */
function TerminalBar() {
  const terminal = useUiMode() === "terminal";
  return (
    <>
      <div className="terminal-bar glass sticky top-0 z-20 h-12 items-center gap-6 border-b border-line px-6 lg:px-10">
        {terminal ? (
          <>
            <Ticker />
            <div className="ml-auto flex shrink-0 items-center gap-3">
              <SourcesPill />
              <AssetChip />
              <Clock />
            </div>
          </>
        ) : null}
      </div>
      <div className="terminal-strip items-center gap-3 border-b border-line px-4 py-2">
        {terminal ? (
          <>
            <div className="min-w-0 flex-1">
              <Ticker />
            </div>
            <SourcesPill />
          </>
        ) : null}
      </div>
    </>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [iara, setIara] = useState(false);
  const current = ALL.find((n) => (n.href === "/" ? path === "/" : path.startsWith(n.href)));
  const toggleIara = () => setIara((v) => !v);
  // como no iOS: o título pequeno da barra aparece quando o título grande da página sai da tela
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 56);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <MotionRoot>
      <div className="flex min-h-screen">
        {/* barra lateral fixa (≥ lg) */}
        <aside className="sidebar-rail sticky top-0 hidden h-screen w-[248px] shrink-0 lg:block" aria-label="Menu">
          <Sidebar current={current?.href} iara={iara} onIara={toggleIara} />
        </aside>

        {/* gaveta (< lg) */}
        <AnimatePresence>
          {open ? (
            <>
              <motion.div key="scrim" className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-hidden />
              <motion.aside
                key="drawer"
                aria-label="Menu"
                className="fixed inset-y-0 left-0 z-40 w-[288px] rounded-r-[22px] bg-page shadow-2xl lg:hidden"
                initial={{ x: -300 }}
                animate={{ x: 0 }}
                exit={{ x: -300 }}
                transition={{ type: "spring", stiffness: 420, damping: 40 }}
              >
                <Sidebar
                  current={current?.href}
                  iara={iara}
                  onIara={() => {
                    setOpen(false);
                    toggleIara();
                  }}
                  onNavigate={() => setOpen(false)}
                  onClose={() => setOpen(false)}
                />
              </motion.aside>
            </>
          ) : null}
        </AnimatePresence>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* barra superior só no celular/tablet */}
          <header className="glass sticky top-0 z-20 flex h-14 items-center gap-2 px-2 lg:hidden">
            <button className="grid h-11 w-11 place-items-center rounded-full text-ink hover:bg-surface-2" onClick={() => setOpen(true)} aria-label="Abrir menu">
              <Menu size={21} />
            </button>
            <span className={`min-w-0 flex-1 truncate text-[17px] font-semibold text-ink transition-opacity duration-200 ${scrolled ? "opacity-100" : "opacity-0"}`} aria-hidden={!scrolled}>
              {current?.label ?? "SIN OS"}
            </span>
            <IaraButton open={iara} onToggle={toggleIara} />
          </header>
          <TerminalBar />
          <main className="mx-auto flex w-full max-w-[1440px] min-w-0 flex-1 flex-col px-4 pb-10 pt-5 sm:px-6 lg:px-10 lg:pt-9">{children}</main>
        </div>
      </div>
      <IaraPanel open={iara} onClose={() => setIara(false)} onToggle={toggleIara} />
    </MotionRoot>
  );
}
