---
title: Voz da Iara
emoji: 🎙️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# Voz da Iara (OpenVoice)

Servidor de voz natural da Iara, com API compatível com a da OpenAI (`POST /v1/audio/speech`).
O SIN OS chama este servidor pela rota `/api/assistente/fala`. Se ele estiver fora do ar, a Iara volta sozinha para a voz do navegador.

## Como funciona

O OpenVoice V2 (MIT) fala nativamente inglês, espanhol, francês, chinês, japonês e coreano. **Não fala português.**
Para outro idioma, o caminho oficial é **TTS base + conversor de timbre**:

1. **Voz base pt-BR**: o Kokoro-82M (Apache-2.0) gera a fala em português. Vozes: `pf_dora` (feminina), `pm_alex` e `pm_santa` (masculinas).
2. **Clonagem**: o conversor de timbre do OpenVoice V2 aplica sobre essa fala o timbre da amostra `referencia.wav`.

O sotaque e o ritmo vêm da voz base; o timbre vem da amostra. Sem `referencia.wav`, fica só a voz base, que já soa bem menos robótica que a voz do navegador.

## Publicar num Space gratuito do Hugging Face

1. Em huggingface.co, crie um **New Space** com SDK **Docker** e hardware **CPU basic** (grátis).
2. Envie os arquivos desta pasta: `app.py`, `requirements.txt`, `Dockerfile` e `README.md`.
3. Opcional: envie `referencia.wav`, com 10 a 30 s de fala limpa, uma pessoa só e sem música. Use apenas voz que você tem autorização para clonar.
4. Em **Settings → Variables and secrets** do Space, crie o secret `VOZ_API_KEY` com uma chave longa.
5. Espere o build (10 a 20 min na primeira vez). Depois teste `https://SEU-USUARIO-SEU-SPACE.hf.space/health`.
6. Na Vercel (Settings → Environment Variables), crie:
   - `TTS_BASE_URL` = `https://SEU-USUARIO-SEU-SPACE.hf.space`
   - `TTS_API_KEY` = a mesma `VOZ_API_KEY` (marque como Sensitive)
   - opcional: `TTS_VOICE`, `TTS_SPEED`

   Depois, faça um redeploy.

## Variáveis

| Variável | Padrão | O que faz |
|---|---|---|
| `VOZ_ENGINE` | `openvoice` | `openvoice` (base + clonagem), `kokoro` (só a base, mais rápido) ou `tone` (teste) |
| `VOZ_API_KEY` | — | Exige `Authorization: Bearer <chave>` |
| `VOZ_BASE` | `pf_dora` | Voz base pt-BR do Kokoro |
| `VOZ_REFERENCIA` | `referencia.wav` | Amostra da voz a clonar |
| `VOZ_TAU` | `0.3` | Força da conversão de timbre (0,1 a 1) |

## Desempenho

Na CPU gratuita (2 núcleos), cada frase leva cerca de 1 a 3 s. A Iara pede o próximo bloco enquanto o atual toca e guarda as frases repetidas.
Um Space gratuito dorme depois de 48 h sem uso e acorda no primeiro pedido, o que leva alguns minutos.

## Teste local do contrato HTTP (sem modelos)

```bash
pip install -r requirements-test.txt
python -m pytest -q test_app.py
```

## Alternativas, se o português não agradar

Todas usam a mesma API, então basta trocar o servidor:

- Chatterbox Multilingual (MIT): clona voz e fala português. Precisa de GPU para ter baixa latência.
- ElevenLabs: `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID`.
- Azure Neural, com nível gratuito de cerca de 500 mil caracteres por mês (confira o plano F0): `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION`.
