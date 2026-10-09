"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { ArrowRight } from "lucide-react";
import { LogoMark } from "@/components/Logo";

const ease = [0.22, 1, 0.36, 1] as const;

/**
 * Landing de tela única: foto de usina desfocada, luz em movimento e um botão.
 * O clique expande um círculo a partir do botão e leva direto à vitrine.
 */
export function Landing() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const btn = useRef<HTMLButtonElement>(null);
  const [leaving, setLeaving] = useState<{ x: number; y: number } | null>(null);

  // paralaxe sutil acompanhando o cursor
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 40, damping: 20 });
  const sy = useSpring(my, { stiffness: 40, damping: 20 });
  const bgX = useTransform(sx, (v) => v * -18);
  const bgY = useTransform(sy, (v) => v * -12);

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
        mx.set(e.clientX / window.innerWidth - 0.5);
        my.set(e.clientY / window.innerHeight - 0.5);
      }}
    >
      {/* foto da usina, desfocada, com zoom lento */}
      <motion.div className="absolute -inset-10" style={{ x: bgX, y: bgY }}>
        <motion.div
          className="absolute inset-0"
          initial={{ scale: 1.18, opacity: 0, filter: "blur(18px)" }}
          animate={{ scale: reduce ? 1.06 : [1.12, 1.06], opacity: 1, filter: "blur(3px)" }}
          transition={{ duration: reduce ? 0.4 : 2.4, ease }}
        >
          <Image src="/images/lp/usina.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
        </motion.div>
      </motion.div>

      {/* luz dourada/verde em movimento */}
      {/* sempre renderizado (evita divergência de hidratação); some com movimento reduzido */}
      <div className="motion-reduce:hidden">
          <motion.div
            aria-hidden
            className="absolute -right-[20%] -top-[30%] size-[70vmax] rounded-full bg-[radial-gradient(circle,rgba(245,165,36,0.45),transparent_60%)] mix-blend-screen blur-3xl"
            animate={{ x: [0, -60, 0], y: [0, 40, 0], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            aria-hidden
            className="absolute -bottom-[35%] -left-[20%] size-[70vmax] rounded-full bg-[radial-gradient(circle,rgba(34,181,115,0.35),transparent_60%)] mix-blend-screen blur-3xl"
            animate={{ x: [0, 80, 0], y: [0, -30, 0] }}
            transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
          />
      </div>

      {/* escurecimento para leitura + vinheta + grão */}
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,9,14,0.55)_0%,rgba(6,9,14,0.15)_40%,rgba(6,9,14,0.85)_100%)]" />
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.55)_100%)]" />
      <div aria-hidden className="grain absolute inset-0 opacity-[0.12] mix-blend-overlay" />

      {/* topo */}
      <motion.header
        className="absolute inset-x-0 top-0 flex items-center justify-between px-6 py-6 sm:px-10"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.8, ease }}
      >
        <span className="flex items-center gap-2">
          <LogoMark className="size-8" />
          <span className="text-[17px] font-semibold tracking-tight">
            Aferi <span className="font-normal text-white/70">Capital</span>
          </span>
        </span>
        <button onClick={go} className="rounded-full px-4 py-2 text-[14px] text-white/80 ring-1 ring-white/20 backdrop-blur-md transition hover:bg-white/10 hover:text-white">
          Entrar
        </button>
      </motion.header>

      {/* conteúdo */}
      <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
        <motion.p
          className="rounded-full bg-white/10 px-4 py-1.5 text-[12px] font-medium uppercase tracking-[0.22em] text-white/80 ring-1 ring-white/15 backdrop-blur-md"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.9, ease }}
        >
          Usinas solares<span className="hidden sm:inline"> · acesso exclusivo</span>
        </motion.p>
        <motion.h1
          className="mt-7 max-w-4xl bg-gradient-to-b from-white to-white/70 bg-clip-text text-[52px] font-semibold leading-[0.98] tracking-[-0.03em] text-transparent sm:text-[96px]"
          initial={{ opacity: 0, y: 30, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ delay: 0.7, duration: 1.1, ease }}
        >
          Invista no sol.
        </motion.h1>
        <motion.p
          className="mt-6 max-w-md text-[17px] text-white/75 sm:text-[19px]"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1, duration: 0.9, ease }}
        >
          Cotas de usinas fotovoltaicas. Renda todo mês.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 20, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 1.25, duration: 0.9, ease }} className="mt-10">
          <button
            ref={btn}
            onClick={go}
            className="group relative inline-flex items-center gap-3 overflow-hidden rounded-full bg-white px-8 py-4 text-[16px] font-semibold text-[#06090e] shadow-[0_0_60px_-10px_rgba(245,165,36,0.75)] transition hover:shadow-[0_0_80px_-6px_rgba(245,165,36,0.95)] focus-visible:outline-white"
          >
            <span className="relative z-10">Invest now</span>
            <span className="relative z-10 flex size-8 items-center justify-center rounded-full bg-[#06090e] text-white transition group-hover:translate-x-1">
              <ArrowRight className="size-4" />
            </span>
            <span aria-hidden className="absolute inset-0 -translate-x-full bg-[linear-gradient(110deg,transparent_30%,rgba(245,165,36,0.35)_50%,transparent_70%)] transition duration-700 group-hover:translate-x-full" />
          </button>
        </motion.div>
        <motion.p className="mt-5 text-[13px] text-white/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6, duration: 1 }}>
          A partir de R$ 1.000 · BNB Chain
        </motion.p>
      </div>

      <motion.p
        className="absolute inset-x-0 bottom-5 px-6 text-center text-[11px] text-white/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.8, duration: 1 }}
      >
        Rentabilidade é projeção, não garantia. Demonstração em rede de testes.
      </motion.p>

      {/* transição: círculo expandindo a partir do botão */}
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
