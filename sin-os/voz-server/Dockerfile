# Space do Hugging Face (SDK "docker", CPU básica gratuita) ou qualquer host de contêiner.
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends espeak-ng git libsndfile1 \
 && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH HF_HOME=/home/user/.cache/huggingface PYTHONUNBUFFERED=1
WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir --user -r requirements.txt \
 && pip install --no-cache-dir --user --no-deps "git+https://github.com/myshell-ai/OpenVoice.git"

COPY --chown=user . .

# baixa os modelos durante o build: a primeira fala não espera download
ARG VOZ_ENGINE=openvoice
RUN VOZ_ENGINE=$VOZ_ENGINE python -c "import app; app.engine()" || echo "pré-carga falhou; o /health mostra o motivo"

EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
