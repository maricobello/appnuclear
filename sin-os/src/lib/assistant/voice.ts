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

export function stopSpeaking() {
  if (supportsSpeech()) window.speechSynthesis.cancel();
}
