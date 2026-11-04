"""
Servidor de voz da Iara — API compatível com OpenAI (POST /v1/audio/speech).

Motores (VOZ_ENGINE):
  openvoice  voz base pt-BR do Kokoro + conversor de timbre do OpenVoice V2 (MIT), que
             clona a voz da amostra VOZ_REFERENCIA. O OpenVoice V2 não fala português
             nativamente (inglês, espanhol, francês, chinês, japonês e coreano): o
             caminho oficial para outro idioma é "TTS base + conversor de timbre".
  kokoro     só a voz base pt-BR do Kokoro (Apache-2.0), sem clonagem — mais rápido.
  tone       tom de teste, sem modelo (para validar o contrato HTTP).

Segurança: com VOZ_API_KEY definida, exige "Authorization: Bearer <chave>". Use só
amostras de voz que você tem direito de clonar.
"""

from __future__ import annotations

import io
import math
import os
import tempfile
import threading
import wave
from collections import OrderedDict
from dataclasses import dataclass

import numpy as np
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

ENGINE = os.environ.get("VOZ_ENGINE", "openvoice").lower()
API_KEY = os.environ.get("VOZ_API_KEY", "")
BASE_VOICE = os.environ.get("VOZ_BASE", "pf_dora")  # pt-BR do Kokoro: pf_dora, pm_alex, pm_santa
REF_WAV = os.environ.get("VOZ_REFERENCIA", os.path.join(os.path.dirname(__file__), "referencia.wav"))
TAU = float(os.environ.get("VOZ_TAU", "0.3"))
MAX_CHARS = 800

# frase longa e variada para medir o timbre da voz base (entrada do conversor)
AMOSTRA_BASE = (
    "Bom dia! Eu sou a assistente do sistema elétrico. Hoje o preço da energia no Sudeste "
    "subiu no fim da tarde, mas a previsão para amanhã é de queda, com mais chuva no Sul e "
    "vento forte no Nordeste. Quer que eu abra a tela de previsão para você?"
)


class SpeechIn(BaseModel):
    model: str | None = None
    input: str = Field(default="", max_length=4000)
    voice: str | None = None
    response_format: str | None = "mp3"
    speed: float | None = 1.0


@dataclass
class Audio:
    pcm: np.ndarray  # float32 mono em [-1, 1]
    sr: int


class ToneEngine:
    name = "tone"
    clone = False

    def synth(self, text: str, voice: str | None, speed: float) -> Audio:
        sr = 24000
        dur = max(0.3, min(20.0, len(text) * 0.06 / max(0.5, speed)))
        t = np.arange(int(sr * dur)) / sr
        return Audio((0.2 * np.sin(2 * math.pi * 220 * t)).astype(np.float32), sr)


class KokoroEngine:
    name = "kokoro"
    clone = False

    def __init__(self) -> None:
        from kokoro import KPipeline  # import tardio: o motor "tone" não precisa do torch

        self.pipe = KPipeline(lang_code="p")  # "p" = português do Brasil

    def synth(self, text: str, voice: str | None, speed: float) -> Audio:
        v = voice if voice and voice.startswith(("pf_", "pm_")) else BASE_VOICE
        parts = [np.asarray(a, dtype=np.float32) for _, _, a in self.pipe(text, voice=v, speed=speed)]
        if not parts:
            raise ValueError("texto sem fala")
        return Audio(np.concatenate(parts), 24000)


class OpenVoiceEngine(KokoroEngine):
    name = "openvoice"

    def __init__(self) -> None:
        super().__init__()
        import torch
        from huggingface_hub import hf_hub_download
        from openvoice.api import ToneColorConverter

        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        cfg = hf_hub_download("myshell-ai/OpenVoiceV2", "converter/config.json")
        ckpt = hf_hub_download("myshell-ai/OpenVoiceV2", "converter/checkpoint.pth")
        try:
            self.tcc = ToneColorConverter(cfg, device=device, enable_watermark=False)
        except TypeError:  # versões antigas não têm o parâmetro (exigem o pacote wavmark)
            self.tcc = ToneColorConverter(cfg, device=device)
        self.tcc.load_ckpt(ckpt)
        self.sr_out = int(self.tcc.hps.data.sampling_rate)
        base = super().synth(AMOSTRA_BASE, BASE_VOICE, 1.0)
        self.src_se = self.tcc.extract_se([_tmp_wav(base)])
        self.tgt_se = self.tcc.extract_se([REF_WAV]) if os.path.exists(REF_WAV) else None
        self.clone = self.tgt_se is not None

    def synth(self, text: str, voice: str | None, speed: float) -> Audio:
        base = super().synth(text, voice, speed)
        if self.tgt_se is None:
            return base  # sem amostra de referência: fica a voz base
        path = _tmp_wav(base)
        try:
            out = self.tcc.convert(audio_src_path=path, src_se=self.src_se, tgt_se=self.tgt_se, output_path=None, tau=TAU)
        finally:
            os.unlink(path)
        return Audio(np.asarray(out, dtype=np.float32), self.sr_out)


def _tmp_wav(a: Audio) -> str:
    f = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    f.close()
    with open(f.name, "wb") as fh:
        fh.write(to_wav(a))
    return f.name


def to_wav(a: Audio) -> bytes:
    pcm16 = (np.clip(a.pcm, -1, 1) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(a.sr)
        w.writeframes(pcm16.tobytes())
    return buf.getvalue()


def to_mp3(a: Audio) -> bytes | None:
    try:
        import lameenc
    except ImportError:
        return None
    enc = lameenc.Encoder()
    enc.set_bit_rate(128)
    enc.set_in_sample_rate(a.sr)
    enc.set_channels(1)
    enc.set_quality(2)
    pcm16 = (np.clip(a.pcm, -1, 1) * 32767).astype("<i2")
    return bytes(enc.encode(pcm16.tobytes()) + enc.flush())


def make_engine():
    if ENGINE == "tone":
        return ToneEngine()
    if ENGINE == "kokoro":
        return KokoroEngine()
    return OpenVoiceEngine()


app = FastAPI(title="Voz da Iara", version="1.0")
_engine = None
_err: str | None = None
_lock = threading.Lock()
_cache: OrderedDict[tuple, tuple[bytes, str]] = OrderedDict()


def engine():
    global _engine, _err
    if _engine is None and _err is None:
        with _lock:
            if _engine is None and _err is None:
                try:
                    _engine = make_engine()
                except Exception as e:  # noqa: BLE001 — o /health mostra o motivo
                    _err = f"{type(e).__name__}: {e}"[:300]
    if _engine is None:
        raise HTTPException(503, f"motor de voz indisponível: {_err}")
    return _engine


def _auth(authorization: str | None) -> None:
    if API_KEY and (authorization or "") != f"Bearer {API_KEY}":
        raise HTTPException(401, "chave inválida")


@app.get("/health")
def health():
    try:
        e = engine()
        return {"ok": True, "engine": e.name, "clone": bool(getattr(e, "clone", False)), "voz_base": BASE_VOICE}
    except HTTPException as h:
        return JSONResponse({"ok": False, "engine": ENGINE, "erro": h.detail}, status_code=503)


@app.get("/v1/models")
def models(authorization: str | None = Header(default=None)):
    _auth(authorization)
    return {"object": "list", "data": [{"id": "openvoice", "object": "model"}, {"id": "kokoro", "object": "model"}]}


@app.post("/v1/audio/speech")
def speech(body: SpeechIn, authorization: str | None = Header(default=None)):
    _auth(authorization)
    text = " ".join(body.input.split())[:MAX_CHARS]
    if not text:
        raise HTTPException(400, "input vazio")
    speed = min(1.6, max(0.6, body.speed or 1.0))
    fmt = (body.response_format or "mp3").lower()
    key = (text, body.voice, round(speed, 2), fmt)
    if key in _cache:
        _cache.move_to_end(key)
        data, ctype = _cache[key]
        return Response(data, media_type=ctype)
    e = engine()
    with _lock:  # um modelo por vez: CPU de Space gratuito tem 2 núcleos
        audio = e.synth(text, body.voice, speed)
    data = to_mp3(audio) if fmt == "mp3" else None
    ctype = "audio/mpeg"
    if data is None:
        data, ctype = to_wav(audio), "audio/wav"
    _cache[key] = (data, ctype)
    if len(_cache) > 256:
        _cache.popitem(last=False)
    return Response(data, media_type=ctype)
