"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { setVeilVisible, useBusy, useVeilVisible } from "@/lib/busy";

/**
 * Véu de carregamento sobre a área de conteúdo (o menu fica livre): branco translúcido com
 * leve desfoque e um anel animado. Só aparece se o trabalho passar de 160 ms (resposta
 * rápida não pisca) e fica ao menos 320 ms (não some num relance). Não bloqueia cliques.
 */
export function LoadingVeil() {
  const { busy, label } = useBusy();
  const reduce = useReducedMotion();
  const [show, setShow] = useState(false);
  const [since, setSince] = useState(0);

  useEffect(() => {
    if (busy) {
      const t = setTimeout(() => {
        setShow(true);
        setSince(Date.now());
      }, 160);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setShow(false), Math.max(0, 320 - (Date.now() - since)));
    return () => clearTimeout(t);
  }, [busy, since]);

  useEffect(() => setVeilVisible(show), [show]);

  return (
    <AnimatePresence onExitComplete={() => setVeilVisible(false)}>
      {show ? (
        <motion.div
          key="veu"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="loading-veil pointer-events-none fixed inset-0 z-30 grid place-items-center lg:left-[248px]"
          role="status"
          aria-live="polite"
        >
          <motion.div
            initial={{ scale: reduce ? 1 : 0.94, y: reduce ? 0 : 6 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: reduce ? 1 : 0.97, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-3 rounded-full border border-line bg-surface/90 py-2.5 pl-3 pr-4 shadow-[0_8px_30px_rgba(0,0,0,0.12)] backdrop-blur-md"
          >
            <span className="loading-ring" aria-hidden />
            <span className="text-[13px] font-medium text-ink">{label ?? "Atualizando…"}</span>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** O mesmo véu, só sobre um painel (consulta secundária e lenta). O pai precisa de `relative`. */
export function PanelVeil({ show, label = "Carregando…" }: { show: boolean; label?: string }) {
  const reduce = useReducedMotion();
  // com trabalho da página em andamento (ou o véu dela na tela), o do painel espera: nunca dois véus
  const { busy } = useBusy();
  const pagina = useVeilVisible();
  const quer = show && !busy && !pagina;
  const [visivel, setVisivel] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisivel(quer), quer ? 300 : 0);
    return () => clearTimeout(t);
  }, [quer]);
  return (
    <AnimatePresence>
      {visivel && quer ? (
        <motion.div
          key="veu-painel"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="loading-veil absolute inset-0 z-10 grid place-items-center rounded-[inherit]"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-3 rounded-full border border-line bg-surface/90 py-2 pl-3 pr-4 shadow-[0_8px_30px_rgba(0,0,0,0.12)] backdrop-blur-md">
            <span className="loading-ring" aria-hidden />
            <span className="text-[13px] font-medium text-ink">{label}</span>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
