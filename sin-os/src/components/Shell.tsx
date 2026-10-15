"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  BatteryCharging,
  BookOpen,
  CloudSun,
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
  Wind,
  X,
  Zap,
} from "lucide-react";
import type { AuditoriaLite } from "@/lib/apiTypes";
import { setAppearance, useAppearance, type Appearance } from "@/lib/theme";
import { useApi } from "@/lib/useApi";
import { IaraButton, IaraPanel } from "./assistant/Iara";
import { MotionRoot } from "./motion";

const NAV: { group: string; items: { href: string; label: string; Icon: typeof Gauge }[] }[] = [
  {
    group: "Mercado",
    items: [
      { href: "/", label: "Sala de Comando", Icon: Gauge },
      { href: "/sin", label: "SIN · Brasil", Icon: Zap },
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

/** Saúde das fontes em uma linha (o detalhe fica no Agente auditor). */
function SystemStatus({ onNavigate }: { onNavigate?: () => void }) {
  // a auditoria roda 1x por dia (e quando alguém pede): consultar a cada 5 min basta
  const { data } = useApi<AuditoriaLite>("/api/auditoria?lite=1", 300_000);
  const l = data?.latest;
  // sem execução para mostrar porque o banco recusou a leitura: dizer isso, não "sem auditoria"
  const dbError = !l ? (data?.storageError ?? null) : null;
  const quota = !!dbError && /RESOURCE_EXHAUSTED|quota/i.test(dbError);
  const tone = !l ? (dbError ? "bg-warning" : "bg-muted") : l.overallScore >= 85 ? "bg-good" : l.overallScore >= 60 ? "bg-warning" : "bg-critical";
  const text = !l
    ? quota
      ? "Firebase sem cota hoje"
      : dbError
        ? "Firebase indisponível"
        : "Sem auditoria ainda"
    : l.counts.down
      ? `${l.counts.down} fonte${l.counts.down > 1 ? "s" : ""} fora do ar`
      : l.counts.degraded
        ? `${l.counts.degraded} fonte${l.counts.degraded > 1 ? "s" : ""} com atenção`
        : "Todas as fontes OK";
  const title = quota
    ? "O histórico do auditor fica no Firebase, que recusou a leitura: a cota diária do plano gratuito acabou. Os dados de mercado seguem ao vivo; o histórico volta quando a cota renovar (por volta das 4h–5h de Brasília)."
    : dbError
      ? `O histórico do auditor fica no Firebase, que não respondeu: ${dbError}`
      : "Score do agente auditor das APIs públicas";
  return (
    <Link href="/auditoria" onClick={onNavigate} className="flex min-h-11 sm:min-h-9 items-center gap-2 rounded-[10px] px-3 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-ink" title={title}>
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${tone}`} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {l ? <span className="tnum font-medium text-ink-2">{l.overallScore}</span> : null}
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
  return (
    <div role="radiogroup" aria-label="Aparência" className="flex rounded-[10px] bg-surface-2 p-[3px]">
      {APPEARANCES.map(({ value, label, Icon }) => {
        const active = current === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
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

function NavList({ current, onNavigate }: { current?: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-5 px-3 py-2" aria-label="Navegação principal">
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="px-3 pb-1 text-[12px] font-medium text-muted">{g.group}</div>
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
        <span className="text-[17px] font-semibold tracking-[-0.01em] text-ink">SIN OS</span>
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
        <AppearanceSwitch />
      </div>
    </div>
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
        <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 lg:block" aria-label="Menu">
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
          <main className="mx-auto flex w-full max-w-[1440px] min-w-0 flex-1 flex-col px-4 pb-10 pt-5 sm:px-6 lg:px-10 lg:pt-9">{children}</main>
        </div>
      </div>
      <IaraPanel open={iara} onClose={() => setIara(false)} onToggle={toggleIara} />
    </MotionRoot>
  );
}
