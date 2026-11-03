import { speakable, splitSentences } from "./speech";

/**
 * Motor de voz no navegador: gravação com detecção de fala (VAD por energia com piso de
 * ruído medido no início) e síntese pt-BR frase a frase. O áudio só existe enquanto o
 * usuário fala depois de tocar no botão; vai para a transcrição e é descartado.
 */
export interface RecordControl {
  /** Parar e enviar o que foi gravado (toque no botão). */
  stop: boolean;
  /** Descartar (fechar o painel, Esc). */
  cancel: boolean;
}

export const supportsRecording = () =>
  typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined";

export const supportsSpeech = () => typeof window !== "undefined" && "speechSynthesis" in window;

const MIME = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export async function recordUtterance(ctl: RecordControl, onLevel: (v: number) => void): Promise<Blob | null> {
  // o AudioContext nasce ainda dentro do toque (antes do primeiro await): no Safari, criado
  // depois ele fica "suspended" e o medidor de voz leria silêncio
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    ctx.close().catch(() => undefined);
    throw e;
  }
  await ctx.resume().catch(() => undefined);
  // sem medidor (contexto suspenso), não dá para detectar fim de fala: só o toque encerra
  const vad = ctx.state === "running";
  const mime = MIME.find((t) => window.MediaRecorder.isTypeSupported?.(t)) ?? "";
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  rec.start(250);

  const t0 = performance.now();
  let noise = 0.008;
  let spoke = false;
  let lastVoice = t0;
  return new Promise<Blob | null>((resolve) => {
    let raf = 0;
    let finished = false;
    const done = (keep: boolean) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      onLevel(0);
      const finish = () => {
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => undefined);
        resolve(keep && chunks.length ? new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }) : null);
      };
      if (rec.state !== "inactive") {
        rec.onstop = finish;
        rec.stop();
      } else finish();
    };
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (now - t0 < 300) noise = Math.max(noise, rms); // piso de ruído do ambiente
      const threshold = Math.max(0.016, noise * 2.2);
      onLevel(Math.min(1, rms / 0.1));
      if (rms > threshold && now - t0 > 150) {
        spoke = true;
        lastVoice = now;
      }
      if (ctl.cancel) return done(false);
      if (ctl.stop) return done(spoke || now - t0 > 700);
      if (vad && spoke && now - lastVoice > 1300) return done(true); // pausa depois de falar = fim da frase
      if (vad && !spoke && now - t0 > 8000) return done(false); // ninguém falou
      if (now - t0 > 30000) return done(true);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
}

/** Frases que o Whisper "ouve" em silêncio ou ruído — descartadas. */
const HALLUCINATIONS = [/^legendas? pela comunidade/i, /amara\.org/i, /^obrigad[oa]( por assistir)?[.!]?$/i, /^tchau[,.! ]*(tchau)?[.!]?$/i, /^\.+$/, /^(e aí|é isso)[.!]?$/i];
export const isHallucination = (t: string) => !t.trim() || HALLUCINATIONS.some((r) => r.test(t.trim()));

/** Desbloqueia a síntese no iOS/Safari: precisa começar dentro de um gesto do usuário. */
export function primeSpeech() {
  if (!supportsSpeech()) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    /* sem síntese */
  }
}

export interface SpeakControl {
  stopped: boolean;
}

// o Chrome às vezes perde o onend se o enunciado for coletado: mantém referência
const alive: SpeechSynthesisUtterance[] = [];

export function speak(text: string, voice: SpeechSynthesisVoice | null, ctl: SpeakControl, onLevel: (v: number) => void): Promise<void> {
  if (!supportsSpeech()) return Promise.resolve();
  const synth = window.speechSynthesis;
  synth.cancel();
  const parts = splitSentences(speakable(text));
  return new Promise<void>((resolve) => {
    let i = 0;
    let raf = 0;
    const t0 = performance.now();
    const pulse = () => {
      const t = (performance.now() - t0) / 1000;
      onLevel(0.28 + 0.22 * Math.abs(Math.sin(t * 5.3)) * (0.6 + 0.4 * Math.sin(t * 1.7)));
      raf = requestAnimationFrame(pulse);
    };
    raf = requestAnimationFrame(pulse);
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(raf);
      onLevel(0);
      alive.length = 0;
      resolve();
    };
    const next = () => {
      if (ctl.stopped || i >= parts.length) return end();
      const u = new SpeechSynthesisUtterance(parts[i++]);
      u.lang = "pt-BR";
      if (voice) u.voice = voice;
      u.rate = 1.04;
      alive.push(u);
      let settled = false;
      const settle = (then: () => void) => () => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        then();
      };
      // rede de segurança: se o evento de fim não vier, segue depois de um tempo proporcional
      const guard = setTimeout(settle(next), 4000 + u.text.length * 110);
      u.onend = settle(next);
      u.onerror = settle(end);
      synth.speak(u);
    };
    next();
  });
}

/* ------------------------------------------------------------ voz natural */

let actx: AudioContext | null = null;
let current: AudioBufferSourceNode | null = null;
const audioCache = new Map<string, ArrayBuffer>();

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  actx ??= new AC();
  return actx;
}

/** Desbloqueia o áudio no iOS/Safari: chamar dentro do toque do usuário. */
export function primeAudio() {
  try {
    void audioContext()?.resume();
  } catch {
    /* sem Web Audio */
  }
}

/** Blocos de fala: o primeiro curto (a voz começa logo), os seguintes juntam frases até ~280 caracteres. */
export function speechChunks(text: string, max = 280): string[] {
  const sents = splitSentences(speakable(text), 220);
  if (!sents.length) return [];
  const out = [sents[0]];
  for (const s of sents.slice(1)) {
    const last = out[out.length - 1];
    const fits = (last + " " + s).length <= max;
    if (fits && (out.length > 1 || last.length < 25)) out[out.length - 1] = `${last} ${s}`;
    else out.push(s);
  }
  return out;
}

/**
 * Fala com a voz do servidor (OpenVoice, ElevenLabs ou Azure), bloco a bloco: enquanto um
 * toca, o próximo já está sendo gerado. O orbe pulsa com a energia real do áudio. Se o
 * primeiro bloco falhar, devolve "fallback" e quem chamou usa a voz do sistema.
 */
export async function speakNatural(text: string, headers: Record<string, string>, ctl: SpeakControl, onLevel: (v: number) => void): Promise<"ok" | "fallback"> {
  const ctx = audioContext();
  const parts = speechChunks(text);
  if (!ctx || !parts.length) return ctx ? "ok" : "fallback";
  await ctx.resume().catch(() => undefined);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.connect(ctx.destination);
  const buf = new Float32Array(analyser.fftSize);
  let raf = 0;
  const meter = () => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    onLevel(Math.min(1, Math.sqrt(sum / buf.length) / 0.12));
    raf = requestAnimationFrame(meter);
  };
  const fetchPart = async (s: string): Promise<AudioBuffer> => {
    let bytes = audioCache.get(s);
    if (!bytes) {
      const res = await fetch("/api/assistente/fala", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ texto: s }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = await res.arrayBuffer();
      if (audioCache.size > 40) audioCache.clear();
      audioCache.set(s, bytes);
    }
    // decodeAudioData consome o buffer: decodifica uma cópia para o cache continuar válido
    return ctx.decodeAudioData(bytes.slice(0));
  };
  raf = requestAnimationFrame(meter);
  try {
    let pending = fetchPart(parts[0]);
    for (let i = 0; i < parts.length; i++) {
      if (ctl.stopped) break;
      let audio: AudioBuffer;
      try {
        audio = await pending;
      } catch {
        if (i === 0) return "fallback";
        break;
      }
      if (i + 1 < parts.length) {
        pending = fetchPart(parts[i + 1]);
        pending.catch(() => undefined);
      }
      if (ctl.stopped) break;
      await new Promise<void>((resolve) => {
        const src = ctx.createBufferSource();
        src.buffer = audio;
        src.connect(analyser);
        current = src;
        src.onended = () => {
          if (current === src) current = null;
          resolve();
        };
        src.start();
      });
    }
    return "ok";
  } finally {
    cancelAnimationFrame(raf);
    onLevel(0);
    analyser.disconnect();
  }
}

export function stopSpeaking() {
  if (supportsSpeech()) window.speechSynthesis.cancel();
  try {
    current?.stop();
  } catch {
    /* já parou */
  }
  current = null;
}
