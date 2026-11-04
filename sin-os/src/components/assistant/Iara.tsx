"use client";

import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { Check, Mic, Paperclip, Send, Settings2, Square, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { saveAsset, useAsset } from "@/lib/asset";
import { senhaConfere } from "@/lib/assistant/access";
import { saveIara, useIara } from "@/lib/assistant/settings";
import { pickVoice } from "@/lib/assistant/speech";
import type { AssistantAction } from "@/lib/assistant/tools";
import { isHallucination, primeAudio, primeSpeech, recordUtterance, speak, speakNatural, stopSpeaking, supportsRecording, supportsSpeech, type RecordControl, type SpeakControl } from "@/lib/assistant/voice";
import { conferirLote } from "@/lib/gd/bill";
import { getCarteira, lerFaturas, upsertUc } from "@/lib/gd/workspace";
import { useApi } from "@/lib/useApi";
import { Button } from "../ui";

/**
 * Iara — assistente de voz do SIN OS. Desligada até o usuário ativar; o microfone só abre
 * num toque. Fala → Whisper (Groq) → agente com ferramentas sobre os dados reais → resposta
 * falada (voz pt-BR do sistema). Pode abrir telas e configurar o ativo BESS.
 */
type Phase = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools?: { name: string; ms: number; ok: boolean }[];
  actions?: AssistantAction[];
  error?: boolean;
  /** Tokens gastos nesta resposta (0 = cache ou mensagem local, sem IA). */
  tokens?: number;
  model?: string;
  /** Gerada no navegador (leitura de faturas): não vai para a IA como histórico. */
  local?: boolean;
  /** Ações que pedem confirmação e já foram aplicadas/descartadas. */
  resolved?: number[];
}

interface IaraStatus {
  configured: boolean;
  online: boolean;
  model: string | null;
  provider?: string | null;
  providers?: string[];
  sttModel: string | null;
  latencyMs: number | null;
  error: string | null;
  accessCodeRequired: boolean;
  /** Voz natural no servidor (rótulo do provedor) ou null. */
  tts?: string | null;
  tokensHoje?: number;
  tokensLimite?: number;
}

const TOOL_LABEL: Record<string, string> = {
  pld_agora: "PLD agora",
  previsao_pld: "Previsão",
  estudo_bess: "Estudo BESS",
  oportunidades: "Oportunidades",
  reservatorios: "Reservatórios",
  saude_dados: "Saúde dos dados",
  navegar: "Navegação",
  configurar_ativo: "Ativo",
  confianca_dados: "Confiança",
  renovaveis_corte: "Corte renovável",
  radar_mercado: "Radar",
  planejamento_sddp: "SDDP",
  forca_da_rede: "Força da rede",
  carregar_ferramentas: "Mais ferramentas",
  gd_carteira: "Carteira GD",
  gd_conferir_faturas: "Conferência",
  gd_fatura_esperada: "Fatura esperada",
  gd_enquadramento: "Enquadramento",
  gd_viabilidade: "Viabilidade",
  gd_contrato_assinatura: "Assinatura",
  gd_regras: "Regras GD",
  gd_otimizar_demanda: "Demanda",
  gd_registrar_uc: "Cadastro UC",
  gd_resultados: "Resultados GD",
};
const kTok = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : String(n));

const SUGGESTIONS = [
  "Qual o PLD agora?",
  "Como fica o PLD amanhã no Sudeste?",
  "Vale rodar a bateria hoje?",
  "Confere minhas faturas de GD",
  "Protocolei em março de 2023: sou GD I ou GD II?",
  "Assinatura com 15% de desconto ainda compensa em 2028?",
];

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Toque para falar",
  listening: "Ouvindo… toque para enviar",
  transcribing: "Entendendo…",
  thinking: "Consultando os dados…",
  speaking: "Falando… toque para parar",
};

const CHAT_KEY = "sinos.iara.chat.v1";
const uid = () => Math.random().toString(36).slice(2, 10);

function loadChat(): Msg[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(sessionStorage.getItem(CHAT_KEY) ?? "[]");
    return Array.isArray(v) ? (v as Msg[]).slice(-40) : [];
  } catch {
    return [];
  }
}

function persistChat(m: Msg[]) {
  try {
    sessionStorage.setItem(CHAT_KEY, JSON.stringify(m.slice(-40)));
  } catch {
    /* sem armazenamento */
  }
}

let voiceVersion = 0;
const subscribeVoices = (cb: () => void) => {
  if (!supportsSpeech()) return () => undefined;
  const h = () => {
    voiceVersion++;
    cb();
  };
  window.speechSynthesis.addEventListener("voiceschanged", h);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", h);
};
function useVoices() {
  const v = useSyncExternalStore(subscribeVoices, () => voiceVersion, () => -1);
  return useMemo(() => (v < 0 || !supportsSpeech() ? [] : window.speechSynthesis.getVoices()), [v]);
}
const noop = () => () => undefined;
const useCanRecord = () => useSyncExternalStore(noop, supportsRecording, () => false);

/* ------------------------------------------------------------------ orb */

export function Orb({ level, phase, size = 88 }: { level: MotionValue<number>; phase: Phase | "off"; size?: number }) {
  const s = useSpring(level, { stiffness: 260, damping: 22, mass: 0.6 });
  const scale = useTransform(s, (v) => 1 + v * 0.32);
  const glow = useTransform(s, (v) => `0 0 ${10 + v * 44}px ${1 + v * 10}px rgba(34, 211, 238, ${0.16 + v * 0.34})`);
  const busy = phase === "thinking" || phase === "transcribing";
  const hot = phase === "listening" || phase === "speaking";
  return (
    <motion.div className="relative grid place-items-center rounded-full" style={{ width: size, height: size, scale, boxShadow: glow }} aria-hidden>
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background: busy
            ? "conic-gradient(from 0deg, #3b9eff, #22d3ee, rgba(59,158,255,0.15), #3b9eff)"
            : hot
              ? "radial-gradient(circle at 35% 30%, #7fe9ff 0%, #22d3ee 30%, #3b9eff 70%, #1a4f8f 100%)"
              : phase === "off"
                ? "radial-gradient(circle at 35% 30%, #56657a 0%, #2a3342 70%, #1a2029 100%)"
                : "radial-gradient(circle at 35% 30%, #6fc3ff 0%, #3b9eff 45%, #174a86 100%)",
        }}
        animate={busy ? { rotate: 360 } : { rotate: 0 }}
        transition={busy ? { repeat: Infinity, ease: "linear", duration: 1.6 } : { duration: 0.3 }}
      />
      <div className="absolute inset-[18%] rounded-full bg-white/10 blur-[6px]" />
    </motion.div>
  );
}

/* ------------------------------------------------------------ texto rico */

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>));
}

function RichText({ text }: { text: string }) {
  const lines = text.split(/\n+/).filter((l) => l.trim());
  return (
    <div className="flex flex-col gap-1">
      {lines.map((l, i) =>
        /^\s*[-*•]\s+/.test(l) ? (
          <div key={i} className="flex gap-1.5">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
            <span>{inline(l.replace(/^\s*[-*•]\s+/, ""))}</span>
          </div>
        ) : (
          <p key={i}>{inline(l)}</p>
        ),
      )}
    </div>
  );
}

/* --------------------------------------------------------------- botão */

export function IaraButton({ open, onToggle, variant = "pill" }: { open: boolean; onToggle: () => void; variant?: "pill" | "search" }) {
  const cfg = useIara();
  const { data } = useApi<IaraStatus>(cfg.enabled ? "/api/assistente" : null, 300_000);
  const problem = cfg.enabled && data && !data.online ? (data.configured ? "bg-critical" : "bg-warning") : null;
  const title = !cfg.enabled ? "Iara — assistente de voz (desligada; clique para conhecer)" : data?.online ? `Iara online · ${data.model ?? "Groq"} (⌘J)` : data?.configured ? `Iara: Groq fora do ar — ${data.error ?? ""}` : "Iara: IA não configurada no servidor";
  const orb = <span className={`h-4 w-4 shrink-0 rounded-full ${cfg.enabled ? "bg-[radial-gradient(circle_at_35%_30%,#7fe9ff,#0a84ff_55%,#0b3f80)]" : "bg-[radial-gradient(circle_at_35%_30%,#a1a1a6,#636366)]"}`} aria-hidden />;
  if (variant === "search")
    return (
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="iara-panel"
        title={title}
        className={`flex min-h-10 w-full items-center gap-2.5 rounded-[10px] px-3 text-[14px] transition-colors ${open ? "bg-accent/12 text-ink" : "bg-surface-2 text-muted hover:text-ink"}`}
      >
        {orb}
        <span className="min-w-0 flex-1 truncate text-left">Perguntar à Iara</span>
        {problem ? <span className={`h-2 w-2 rounded-full ${problem}`} aria-hidden /> : <kbd className="font-sans text-[13px] text-muted">⌘J</kbd>}
      </button>
    );
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="iara-panel"
      title={title}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-[14px] font-medium transition-colors ${open ? "bg-accent/12 text-ink" : "text-ink-2 hover:bg-surface-2"}`}
    >
      {orb}
      Iara
      {problem ? <span className={`h-2 w-2 rounded-full ${problem}`} aria-hidden /> : null}
    </button>
  );
}

/* --------------------------------------------------------------- painel */

export function IaraPanel({ open, onClose, onToggle }: { open: boolean; onClose: () => void; onToggle: () => void }) {
  const cfg = useIara();
  const asset = useAsset();
  const router = useRouter();
  const path = usePathname();
  const voices = useVoices();
  const canRecord = useCanRecord();
  const status = useApi<IaraStatus>(cfg.enabled && open ? "/api/assistente" : null, 300_000);

  const [msgs, setMsgs] = useState<Msg[]>(loadChat);
  const [phase, setPhase] = useState<Phase>("idle");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const level = useMotionValue(0);
  const statusRef = useRef<IaraStatus | undefined>(undefined);

  const msgsRef = useRef(msgs);
  const cfgRef = useRef(cfg);
  const assetRef = useRef(asset);
  const pathRef = useRef(path);
  const openRef = useRef(open);
  const recRef = useRef<RecordControl | null>(null);
  const speakRef = useRef<SpeakControl | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    cfgRef.current = cfg;
    assetRef.current = asset;
    pathRef.current = path;
    openRef.current = open;
    statusRef.current = status.data;
  });

  const voice = useMemo(() => pickVoice(voices, cfg.voiceURI), [voices, cfg.voiceURI]);
  const voiceRef = useRef(voice);
  useLayoutEffect(() => {
    voiceRef.current = voice;
  });
  const ptVoices = useMemo(() => voices.filter((v) => /^pt[-_]BR$/i.test(v.lang)), [voices]);

  const setChat = useCallback((next: Msg[]) => {
    msgsRef.current = next.slice(-40);
    setMsgs(msgsRef.current);
    persistChat(msgsRef.current);
  }, []);

  // interrompe microfone, fala e requisição; os fluxos assíncronos voltam a fase para "idle"
  const halt = useCallback(() => {
    if (recRef.current) recRef.current.cancel = true;
    if (speakRef.current) speakRef.current.stopped = true;
    abortRef.current?.abort();
    stopSpeaking();
    level.set(0);
  }, [level]);
  const stopAll = useCallback(() => {
    halt();
    setPhase("idle");
  }, [halt]);

  // rolagem para a última mensagem
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs, phase]);

  // fechar o painel encerra microfone, fala e requisição
  useEffect(() => {
    if (!open) halt();
    // foco no campo só com mouse/teclado: no celular abriria o teclado por cima da voz
    else if (cfg.enabled && window.matchMedia("(pointer: fine)").matches) setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 120);
  }, [open, cfg.enabled, halt]);

  const headers = useCallback((): Record<string, string> => (cfgRef.current.code ? { "x-assistente-code": cfgRef.current.code } : {}), []);

  const applyActions = useCallback(
    (acts: AssistantAction[]) => {
      for (const a of acts) {
        if (a.type === "asset") saveAsset({ ...assetRef.current, ...a.patch });
        if (a.type === "navigate") router.push(a.href);
        // gd_uc grava dados do usuário: só com o toque em "confirmar"
      }
    },
    [router],
  );

  const resolveAction = useCallback(
    (msgId: string, idx: number, apply: boolean) => {
      const next = msgsRef.current.map((m) => {
        if (m.id !== msgId) return m;
        const a = m.actions?.[idx];
        if (apply && a?.type === "gd_uc") upsertUc(a.patch);
        return { ...m, resolved: [...(m.resolved ?? []), idx] };
      });
      setChat(next);
    },
    [setChat],
  );

  const listenRef = useRef<() => void>(() => undefined);

  const ask = useCallback(
    async (text: string, viaVoice: boolean) => {
      const q = text.trim();
      if (!q) return;
      setNotice(null);
      const user: Msg = { id: uid(), role: "user", text: q };
      const history = [...msgsRef.current, user];
      setChat(history);
      setPhase("thinking");
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const res = await fetch("/api/assistente", {
          method: "POST",
          signal: ac.signal,
          headers: { "Content-Type": "application/json", ...headers() },
          body: JSON.stringify({
            messages: history.filter((m) => !m.error && !m.local).slice(-12).map((m) => ({ role: m.role, content: m.text.slice(0, 4000) })),
            page: pathRef.current,
            asset: assetRef.current,
            voice: viaVoice && cfgRef.current.speak,
            // carteira de GD: só números das faturas (sem nome/CPF), calculados no servidor
            ...(() => {
              const gd = getCarteira();
              return gd.faturas.length || gd.ucs.length ? { gd } : {};
            })(),
          }),
        });
        const j = (await res.json().catch(() => ({}))) as {
          reply?: string;
          actions?: AssistantAction[];
          tools?: Msg["tools"];
          error?: string;
          code?: string;
          model?: string;
          usage?: { prompt?: number; completion?: number };
        };
        if (!res.ok || !j.reply) {
          if (j.code === "access_code") setShowSettings(true);
          setChat([...msgsRef.current, { id: uid(), role: "assistant", text: j.error ?? `Falha ao consultar (HTTP ${res.status}).`, error: true }]);
          setPhase("idle");
          return;
        }
        const acts = j.actions ?? [];
        setChat([...msgsRef.current, { id: uid(), role: "assistant", text: j.reply, tools: j.tools, actions: acts, tokens: (j.usage?.prompt ?? 0) + (j.usage?.completion ?? 0), model: j.model }]);
        applyActions(acts);
        if (viaVoice && cfgRef.current.speak && openRef.current) {
          setPhase("speaking");
          const ctl: SpeakControl = { stopped: false };
          speakRef.current = ctl;
          // voz natural do servidor (OpenVoice/ElevenLabs/Azure); se falhar, a do sistema
          const how = statusRef.current?.tts && cfgRef.current.natural ? await speakNatural(j.reply, headers(), ctl, (v) => level.set(v)) : "fallback";
          if (how === "fallback" && !ctl.stopped) await speak(j.reply, voiceRef.current, ctl, (v) => level.set(v));
          if (ctl.stopped) {
            setPhase("idle");
            return;
          }
        }
        setPhase("idle");
        if (viaVoice && cfgRef.current.continuous && openRef.current) listenRef.current();
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setPhase("idle");
          return;
        }
        setChat([...msgsRef.current, { id: uid(), role: "assistant", text: "Sem conexão com o servidor.", error: true }]);
        setPhase("idle");
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [applyActions, headers, level, setChat],
  );

  const listen = useCallback(async () => {
    if (!supportsRecording()) {
      setNotice("Este navegador não grava áudio — digite a pergunta.");
      return;
    }
    setNotice(null);
    primeSpeech();
    // contexto de áudio só com voz natural: no iOS um AudioContext aberto junto do microfone deixa a voz do sistema com som de telefone
    if (statusRef.current?.tts && cfgRef.current.natural) primeAudio();
    const ctl: RecordControl = { stop: false, cancel: false };
    recRef.current = ctl;
    setPhase("listening");
    let blob: Blob | null;
    try {
      blob = await recordUtterance(ctl, (v) => level.set(v));
    } catch (e) {
      const name = (e as Error).name;
      setNotice(name === "NotAllowedError" ? "Microfone bloqueado — libere o acesso nas configurações do navegador." : name === "NotFoundError" ? "Nenhum microfone encontrado." : "Não foi possível abrir o microfone.");
      setPhase("idle");
      return;
    } finally {
      if (recRef.current === ctl) recRef.current = null;
    }
    if (!blob || ctl.cancel) {
      setPhase("idle");
      if (!ctl.cancel) setNotice("Não ouvi nada — toque e fale de novo.");
      return;
    }
    setPhase("transcribing");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const fd = new FormData();
      fd.append("audio", blob, "fala");
      const res = await fetch("/api/assistente/voz", { method: "POST", body: fd, headers: headers(), signal: ac.signal });
      const j = (await res.json().catch(() => ({}))) as { text?: string; error?: string; code?: string };
      if (!res.ok) {
        if (j.code === "access_code") setShowSettings(true);
        setNotice(j.error ?? `Falha na transcrição (HTTP ${res.status}).`);
        setPhase("idle");
        return;
      }
      if (!j.text || isHallucination(j.text)) {
        setNotice("Não entendi — pode repetir?");
        setPhase("idle");
        return;
      }
      await ask(j.text, true);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setNotice("Sem conexão com o servidor.");
      setPhase("idle");
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [ask, headers, level]);
  useLayoutEffect(() => {
    listenRef.current = () => void listen();
  });

  const onFiles = async (list: FileList | null) => {
    const files = [...(list ?? [])].slice(0, 60);
    if (fileRef.current) fileRef.current.value = "";
    if (!files.length) return;
    setNotice(null);
    setReading({ done: 0, total: files.length });
    const res = await lerFaturas(files, headers(), (done, total) => setReading({ done, total }));
    setReading(null);
    const ok = res.filter((r) => r.fatura);
    const bad = res.filter((r) => r.erro);
    const lines = [`Li ${ok.length} de ${files.length} fatura(s)${bad.length ? `; ${bad.length} com problema: ${bad.slice(0, 3).map((b) => `${b.nome} (${b.erro})`).join("; ")}` : ""}.`];
    if (ok.length) {
      const c = getCarteira();
      const ucs = new Set(ok.map((r) => r.fatura!.uc ?? "sem UC"));
      const lote = conferirLote(c.faturas.filter((f) => ucs.has(f.uc ?? "sem UC")), c.ucs);
      const rs = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      lines.push(`Conferência automática (sem IA, 0 token): **${lote.totais.alta} alerta(s) alto(s)** e ${lote.totais.media} médio(s)${lote.totais.impactoRs ? `; impacto estimado **R$ ${rs(lote.totais.impactoRs)}**` : ""}.`);
      for (const a of lote.alertas.slice(0, 3)) lines.push(`- UC ${a.uc} · ${a.ref}: ${a.msg}`);
      lines.push(`Peça "explica os alertas" ou abra a tela Geração distribuída para ver tudo.`);
    }
    setChat([...msgsRef.current, { id: uid(), role: "assistant", text: lines.join("\n"), local: true, tokens: 0 }]);
  };

  const onOrb = () => {
    if (phase === "idle") void listen();
    else if (phase === "listening" && recRef.current) recRef.current.stop = true;
    else stopAll();
  };

  // ⌘J / Ctrl+J abre e fecha; Esc interrompe e depois fecha
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        onToggle();
      } else if (e.key === "Escape" && openRef.current) {
        if (phase !== "idle") stopAll();
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onToggle, phase, stopAll]);

  const submit = () => {
    const t = draft;
    setDraft("");
    if (phase !== "idle") stopAll();
    void ask(t, false);
  };

  const st = status.data;
  const statusLine = !cfg.enabled
    ? "desligada"
    : !st
      ? "verificando…"
      : st.online
        ? `online · ${st.provider ?? "IA"} ${st.model ?? ""}${st.latencyMs ? ` · ${st.latencyMs} ms` : ""}`
        : st.configured
          ? `${st.provider ?? "IA"} fora do ar — ${st.error ?? "erro"}`
          : "IA não configurada no servidor";
  const statusTone = !cfg.enabled || !st ? "text-muted" : st.online ? "text-good" : st.configured ? "text-critical" : "text-warning";

  return (
    <AnimatePresence>
      {open ? (
        <motion.section
          id="iara-panel"
          role="dialog"
          aria-modal="false"
          aria-label="Iara — assistente"
          className="fixed inset-x-2 bottom-2 z-50 flex h-[min(640px,calc(100dvh-72px))] flex-col overflow-hidden rounded-[22px] bg-surface shadow-[0_24px_80px_-12px_rgba(0,0,0,0.45)] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[420px]"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
        >
          {/* cabeçalho */}
          <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
            <span className={`h-4 w-4 rounded-full ${cfg.enabled ? "bg-[radial-gradient(circle_at_35%_30%,#7fe9ff,#3b9eff_55%,#174a86)]" : "bg-[radial-gradient(circle_at_35%_30%,#56657a,#2a3342)]"}`} aria-hidden />
            <div className="min-w-0 leading-tight">
              <div className="text-[13px] font-semibold text-ink">Iara</div>
              <div className={`truncate text-[12px] ${statusTone}`}>{statusLine}</div>
            </div>
            <div className="ml-auto flex items-center gap-0.5">
              {cfg.enabled ? (
                <button onClick={() => setShowSettings((v) => !v)} aria-pressed={showSettings} className={`grid h-8 w-8 place-items-center rounded-md hover:bg-surface-2 ${showSettings ? "text-accent" : "text-muted"}`} aria-label="Ajustes da Iara">
                  <Settings2 size={16} />
                </button>
              ) : null}
              <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink" aria-label="Fechar">
                <X size={16} />
              </button>
            </div>
          </div>

          {!cfg.enabled ? (
            <Intro level={level} onEnable={(code) => saveIara({ enabled: true, code })} />
          ) : (
            <>
              <AnimatePresence initial={false}>
                {showSettings ? (
                  <motion.div key="settings" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="shrink-0 overflow-hidden border-b border-line bg-surface-2/60">
                    <SettingsView
                      ptVoices={ptVoices}
                      voiceURI={voice?.voiceURI ?? null}
                      tts={st?.tts ?? null}
                      tokens={st?.tokensHoje !== undefined && st?.tokensLimite ? `${kTok(st.tokensHoje)} de ${kTok(st.tokensLimite)} tokens hoje` : null}
                      needsCode={!!st?.accessCodeRequired}
                      onClear={() => setChat([])}
                      onDisable={() => {
                        stopAll();
                        saveIara({ enabled: false });
                        setShowSettings(false);
                      }}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {/* conversa */}
              <div ref={listRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-live="polite">
                {msgs.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                    <p className="max-w-[300px] text-[12.5px] leading-relaxed text-ink-2">
                      Pergunte por voz ou texto. Eu consulto o PLD, a previsão, o estudo da bateria e a saúde das fontes — só dado real.
                    </p>
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {SUGGESTIONS.map((s) => (
                        <button key={s} onClick={() => void ask(s, false)} className="rounded-full bg-surface-2 px-3 py-1.5 text-[13px] text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink">
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {msgs.map((m) => (
                      <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }} className={m.role === "user" ? "flex justify-end" : "flex flex-col gap-1.5"}>
                        {m.role === "user" ? (
                          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-surface-3 px-3 py-1.5 text-[13px] text-ink">{m.text}</div>
                        ) : (
                          <>
                            <div className={`max-w-[95%] text-[13px] leading-relaxed ${m.error ? "text-critical" : "text-ink-2"}`}>
                              <RichText text={m.text} />
                            </div>
                            {m.tools?.length || m.actions?.length || m.tokens !== undefined ? (
                              <div className="flex flex-wrap items-center gap-1">
                                {m.tools?.map((t, i) => (
                                  <span key={`t${i}`} className={`rounded-full px-2 py-px text-[11px] ${t.ok ? "border-line text-muted" : "border-critical/40 text-critical"}`} title={`${t.ms} ms`}>
                                    {TOOL_LABEL[t.name] ?? t.name}
                                  </span>
                                ))}
                                {m.actions?.map((a, i) =>
                                  a.type === "gd_uc" ? (
                                    m.resolved?.includes(i) ? (
                                      <span key={`a${i}`} className="rounded-[4px] border border-line px-1.5 py-px text-[11px] text-muted">
                                        {a.label} · resolvido
                                      </span>
                                    ) : (
                                      <span key={`a${i}`} className="inline-flex items-center gap-1 rounded-[4px] border border-accent/40 py-px pr-0.5 pl-1.5 text-[11px] text-accent">
                                        gravar {a.label}?
                                        <button onClick={() => resolveAction(m.id, i, true)} className="grid h-6 w-6 place-items-center rounded hover:bg-accent/15" aria-label={`Confirmar: ${a.label}`}>
                                          <Check size={13} />
                                        </button>
                                        <button onClick={() => resolveAction(m.id, i, false)} className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-surface-2" aria-label="Descartar">
                                          <X size={13} />
                                        </button>
                                      </span>
                                    )
                                  ) : (
                                    <span key={`a${i}`} className="rounded-[4px] border border-accent/40 px-1.5 py-px text-[11px] text-accent">
                                      {a.type === "navigate" ? `abriu ${a.label}` : `ativo → ${a.label}`}
                                    </span>
                                  ),
                                )}
                                {m.tokens !== undefined && !m.error ? (
                                  <span className="px-1 text-[11px] text-muted" title={m.model ?? undefined}>
                                    {m.tokens ? `${kTok(m.tokens)} tokens` : "0 token"}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                          </>
                        )}
                      </motion.div>
                    ))}
                    {phase === "thinking" || phase === "transcribing" ? (
                      <div className="flex items-center gap-1 py-1" aria-label={PHASE_LABEL[phase]}>
                        {[0, 1, 2].map((i) => (
                          <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-accent" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {/* voz + texto */}
              <div className="shrink-0 border-t border-line px-3 pt-3 pb-3">
                <div className="flex flex-col items-center gap-1.5">
                  <button onClick={onOrb} disabled={!canRecord && phase === "idle"} className="rounded-full outline-offset-4 disabled:opacity-40" aria-label={PHASE_LABEL[phase]} title={canRecord ? PHASE_LABEL[phase] : "Este navegador não grava áudio"}>
                    <div className="relative">
                      <Orb level={level} phase={phase} size={56} />
                      <span className="absolute inset-0 grid place-items-center text-white/90">
                        {phase === "listening" ? <Square size={16} fill="currentColor" /> : phase === "speaking" || phase === "thinking" || phase === "transcribing" ? <X size={18} /> : <Mic size={20} />}
                      </span>
                    </div>
                  </button>
                  <span className="text-[12px] text-muted" aria-live="polite">
                    {notice ?? PHASE_LABEL[phase]}
                  </span>
                </div>
                <form
                  className="mt-2 flex items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit();
                  }}
                >
                  <input ref={fileRef} type="file" accept="application/pdf,.pdf,.txt" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={!!reading}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface-2 text-muted transition-colors hover:text-ink disabled:opacity-50"
                    aria-label="Anexar faturas de energia (PDF)"
                    title="Anexar faturas (PDF) — leitura e conferência sem IA"
                  >
                    {reading ? <span className="text-[11px] tabular-nums">{reading.done}/{reading.total}</span> : <Paperclip size={16} />}
                  </button>
                  <input
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Pergunte à Iara…"
                    maxLength={1000}
                    className="h-11 min-w-0 flex-1 rounded-full bg-surface-2 px-4 text-[13px] text-ink placeholder:text-muted focus:border-accent/70 focus:outline-none"
                    aria-label="Pergunta para a Iara"
                  />
                  <button type="submit" disabled={!draft.trim()} className="grid h-11 w-11 place-items-center rounded-full bg-accent-fill text-on-accent transition-opacity disabled:opacity-30" aria-label="Enviar">
                    <Send size={15} />
                  </button>
                </form>
                <p className="mt-1.5 text-center text-[11px] text-muted">
                  <span className="hidden sm:inline">⌘J abre/fecha · Esc interrompe · </span>análise, não recomendação de investimento
                </p>
              </div>
            </>
          )}
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}

function Intro({ level, onEnable }: { level: MotionValue<number>; onEnable: (code: string) => void }) {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState(false);
  const tentar = () => {
    if (senhaConfere(senha)) onEnable(senha.trim());
    else setErro(true);
  };
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-6 text-center">
      <Orb level={level} phase="off" size={84} />
      <div>
        <h2 className="text-[16px] font-semibold text-ink">Iara, sua assistente de voz</h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
          Converse por voz ou texto com o SIN OS. A Iara consulta o PLD, a previsão, a bateria, a rede, os reservatórios e as suas faturas de geração distribuída, e responde falando. Também abre telas e configura o seu ativo.
        </p>
        <ul className="mt-3 space-y-1 text-left text-[13px] text-muted">
          <li>• Fica desligada até você ativar; o microfone só abre quando você toca.</li>
          <li>• Só usa dado real das ferramentas do app — sem número inventado.</li>
          <li>• Faturas são lidas e conferidas sem IA; a IA só recebe o resumo.</li>
        </ul>
      </div>
      <form
        className="flex w-full max-w-[280px] flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          tentar();
        }}
      >
        <input
          value={senha}
          onChange={(e) => {
            setSenha(e.target.value);
            setErro(false);
          }}
          type="password"
          placeholder="Senha da Iara"
          autoComplete="off"
          aria-label="Senha da Iara"
          aria-invalid={erro}
          className="h-10 rounded-full bg-surface-2 px-4 text-center text-[13px] text-ink placeholder:text-muted focus:outline-none"
        />
        {erro ? (
          <p className="text-[12px] text-critical" role="alert">
            Senha incorreta.{" "}
            <button type="button" className="underline" onClick={() => onEnable(senha.trim())}>
              Usar como código da Vercel
            </button>
          </p>
        ) : null}
        <Button variant="primary" type="submit" disabled={!senha.trim()}>
          Ativar Iara
        </Button>
      </form>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
      <span className="min-w-0">
        <span className="block text-[13px] text-ink">{label}</span>
        {hint ? <span className="block text-[12px] text-muted">{hint}</span> : null}
      </span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-good" : "bg-surface-3"}`}
      >
        <motion.span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow" animate={{ left: checked ? 18 : 2 }} transition={{ type: "spring", stiffness: 600, damping: 36 }} />
      </button>
    </label>
  );
}

function SettingsView({
  ptVoices,
  voiceURI,
  tts,
  tokens,
  needsCode,
  onClear,
  onDisable,
}: {
  ptVoices: SpeechSynthesisVoice[];
  voiceURI: string | null;
  tts: string | null;
  tokens: string | null;
  needsCode: boolean;
  onClear: () => void;
  onDisable: () => void;
}) {
  const cfg = useIara();
  const [code, setCode] = useState(cfg.code);
  return (
    <div className="flex flex-col gap-1 px-3 py-2.5">
      <Toggle label="Responder falando" hint="quando a pergunta vier por voz" checked={cfg.speak} onChange={(v) => saveIara({ speak: v })} />
      <Toggle label="Conversa contínua" hint="volta a ouvir depois de responder" checked={cfg.continuous} onChange={(v) => saveIara({ continuous: v })} />
      {tts ? <Toggle label="Voz natural" hint={`${tts} (desligue para usar a voz do sistema)`} checked={cfg.natural} onChange={(v) => saveIara({ natural: v })} /> : null}
      {ptVoices.length && (!tts || !cfg.natural) ? (
        <label className="flex items-center justify-between gap-3 py-1 text-[13px] text-ink">
          Voz do sistema
          <select value={voiceURI ?? ""} onChange={(e) => saveIara({ voiceURI: e.target.value || null })} className="h-7 max-w-[210px] rounded-md border border-line-strong bg-surface-2 px-1.5 text-[13px] text-ink">
            {ptVoices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <form
        className="flex items-center gap-1.5 py-1"
        onSubmit={(e) => {
          e.preventDefault();
          saveIara({ code: code.trim() });
        }}
      >
        <input value={code} onChange={(e) => setCode(e.target.value)} type="password" placeholder={needsCode ? "Código da Vercel" : "Senha da Iara"} className="h-7 min-w-0 flex-1 rounded-md border border-line-strong bg-surface-2 px-2 text-[13px] text-ink" aria-label="Senha ou código de acesso da Iara" autoComplete="off" />
        <Button type="submit" variant="secondary">
          Salvar
        </Button>
      </form>
      {tokens ? <p className="py-0.5 text-[12px] text-muted">Consumo: {tokens}</p> : null}
      <div className="mt-1 flex gap-1.5">
        <Button variant="ghost" onClick={onClear}>
          Limpar conversa
        </Button>
        <Button variant="ghost" onClick={onDisable}>
          Desativar Iara
        </Button>
      </div>
    </div>
  );
}
