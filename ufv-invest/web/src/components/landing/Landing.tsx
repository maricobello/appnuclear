"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { ArrowRight } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { useT } from "@/i18n/client";
import { LangSwitcher } from "@/components/i18n/LangSwitcher";

const ease = [0.22, 1, 0.36, 1] as const;

/** Partículas de luz (posições fixas: o mesmo HTML no servidor e no cliente) */
const MOTES = [
  [8, 78, 2, 0, 19],
  [17, 64, 3, 6, 23],
  [26, 88, 2, 11, 17],
  [34, 72, 2, 3, 21],
  [43, 92, 3, 14, 25],
  [51, 68, 2, 8, 18],
  [59, 84, 2, 1, 22],
  [66, 74, 3, 12, 20],
  [73, 90, 2, 5, 24],
  [81, 70, 2, 16, 19],
  [88, 82, 3, 9, 23],
  [94, 76, 2, 2, 21],
] as const;

/**
 * Landing de tela única: foto de usina com zoom lento, luz em movimento e um botão.
 * Toda a animação contínua é CSS em transform/opacity (camada de GPU, sem repintura) e
 * para com "reduzir movimento". O clique expande um círculo a partir do botão e leva à vitrine.
 */
export function Landing() {
  const router = useRouter();
  const { d } = useT();
  const reduce = useReducedMotion();
  const btn = useRef<HTMLButtonElement>(null);
  const [leaving, setLeaving] = useState<{ x: number; y: number } | null>(null);

  // paralaxe sutil acompanhando o cursor (só transform)
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 40, damping: 20 });
  const sy = useSpring(my, { stiffness: 40, damping: 20 });
  const bgX = useTransform(sx, (v) => v * -16);
  const bgY = useTransform(sy, (v) => v * -10);

  useEffect(() => {
    router.prefetch("/usinas");
  }, [router]);

  const go = () => {
    const r = btn.current?.getBoundingClientRect();
    if (reduce || !r) return router.push("/usinas");
    setLeaving({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    setTimeout(() => router.push("/usinas"), 650);
  };

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-[#06090e] text-white"
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        mx.set(e.clientX / window.innerWidth - 0.5);
        my.set(e.clientY / window.innerHeight - 0.5);
      }}
    >
      {/* foto da usina: entra em fade e segue com zoom lento (Ken Burns) */}
      <motion.div className="absolute -inset-8 will-change-transform" style={{ x: bgX, y: bgY }}>
        <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.6, ease }}>
          <div className="lp-kenburns absolute inset-0">
            <Image src="/images/lp/usina.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
          </div>
        </motion.div>
      </motion.div>

      {/* luz: brilho do sol, reflexo varrendo os painéis e partículas no ar */}
      <div aria-hidden className="pointer-events-none absolute inset-0 motion-reduce:hidden">
        <div className="lp-glow absolute -right-[15%] -top-[35%] size-[80vmax] rounded-full bg-[radial-gradient(circle,rgba(255,190,90,0.38)_0%,rgba(255,170,60,0.12)_35%,transparent_62%)]" />
        <div className="absolute inset-x-0 bottom-0 h-[55%] overflow-hidden [mask-image:linear-gradient(to_top,transparent,black_30%,black_70%,transparent)]">
          <div className="lp-sweep absolute -inset-y-1/2 left-0 w-[38%] bg-[linear-gradient(100deg,transparent_0%,rgba(255,214,150,0.16)_45%,rgba(255,236,200,0.28)_50%,rgba(255,214,150,0.16)_55%,transparent_100%)]" />
        </div>
        {MOTES.map(([left, top, size, delay, dur], i) => (
          <span
            key={i}
            className="lp-mote absolute rounded-full bg-[#ffe2b0]"
            style={{ left: `${left}%`, top: `${top}%`, width: size, height: size, animationDelay: `${delay}s`, animationDuration: `${dur}s` }}
          />
        ))}
      </div>

      {/* leitura: escurecimento nas bordas, vinheta e grão (estáticos) */}
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,9,14,0.7)_0%,rgba(6,9,14,0.12)_38%,rgba(6,9,14,0.2)_60%,rgba(6,9,14,0.92)_100%)]" />
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(0,0,0,0.6)_100%)]" />
      <div aria-hidden className="grain absolute inset-0 opacity-[0.05]" />

      {/* topo */}
      <motion.header
        className="absolute inset-x-0 top-0 flex items-center justify-between px-6 py-6 sm:px-10"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.8, ease }}
      >
        <span className="flex items-center gap-2">
          <LogoMark className="size-8" />
          <span className="text-[17px] font-semibold tracking-tight">
            Aferi <span className="font-normal text-white/65">Capital</span>
          </span>
        </span>
        <div className="flex items-center gap-2">
          <LangSwitcher tone="overlay" />
          <button onClick={go} className="rounded-full px-4 py-2 text-[14px] text-white/80 ring-1 ring-white/20 backdrop-blur-md transition hover:bg-white/10 hover:text-white">
            {d.lp.enter}
          </button>
        </div>
      </motion.header>

      {/* conteúdo */}
      <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
        <motion.p
          className="flex items-center gap-3 whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.2em] text-white/70 sm:text-[12px] sm:tracking-[0.32em]"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.9, ease }}
        >
          <span className="hidden h-px w-8 bg-gradient-to-r from-transparent to-white/50 sm:block" aria-hidden />
          {d.lp.eyebrow}
          <span className="hidden h-px w-8 bg-gradient-to-l from-transparent to-white/50 sm:block" aria-hidden />
        </motion.p>
        <motion.h1
          className="mt-6 max-w-5xl bg-gradient-to-b from-white from-40% to-white/75 bg-clip-text pb-2 text-[52px] font-semibold leading-[1] tracking-[-0.04em] text-transparent sm:text-[104px]"
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 1.1, ease }}
        >
          {d.lp.h1}
        </motion.h1>
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.95, duration: 0.9, ease }} className="mt-12">
          <button
            ref={btn}
            onClick={go}
            className="group relative inline-flex items-center gap-3 overflow-hidden rounded-full bg-white py-3.5 pl-8 pr-3.5 text-[16px] font-semibold text-[#06090e] shadow-[0_0_60px_-12px_rgba(245,181,68,0.7)] transition-shadow duration-500 hover:shadow-[0_0_80px_-8px_rgba(245,181,68,0.9)]"
          >
            <span className="relative z-10">{d.lp.cta}</span>
            <span className="relative z-10 flex size-9 items-center justify-center rounded-full bg-[#06090e] text-white transition-transform duration-300 group-hover:translate-x-0.5">
              <ArrowRight className="size-4" />
            </span>
            <span aria-hidden className="absolute inset-0 -translate-x-full bg-[linear-gradient(110deg,transparent_30%,rgba(245,181,68,0.3)_50%,transparent_70%)] transition-transform duration-700 group-hover:translate-x-full" />
          </button>
        </motion.div>
      </div>

      <motion.p
        className="absolute inset-x-0 bottom-5 px-6 text-center text-[11px] text-white/45"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 1 }}
      >
        {d.lp.disclaimer}
      </motion.p>

      {/* transição: círculo escuro expandindo a partir do botão */}
      <AnimatePresence>
        {leaving && (
          <motion.div
            aria-hidden
            className="pointer-events-none fixed z-50 rounded-full bg-[#06090e] shadow-[0_0_120px_40px_rgba(61,220,132,0.25)]"
            style={{ left: leaving.x, top: leaving.y, width: 40, height: 40, marginLeft: -20, marginTop: -20 }}
            initial={{ scale: 0 }}
            animate={{ scale: 120 }}
            transition={{ duration: 0.7, ease: [0.65, 0, 0.35, 1] }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
