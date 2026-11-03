"""Contrato HTTP do servidor de voz com o motor de teste (VOZ_ENGINE=tone): sem modelos."""

import importlib
import os

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("VOZ_ENGINE", "tone")
    monkeypatch.setenv("VOZ_API_KEY", "segredo")
    import app

    importlib.reload(app)
    return TestClient(app.app)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["engine"] == "tone"


def test_exige_chave(client):
    r = client.post("/v1/audio/speech", json={"input": "Olá"})
    assert r.status_code == 401


def test_fala_mp3_e_cache(client):
    h = {"Authorization": "Bearer segredo"}
    r = client.post("/v1/audio/speech", json={"model": "openvoice", "voice": "iara", "input": "O PLD do Sudeste está em 312 reais.", "response_format": "mp3"}, headers=h)
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/mpeg"
    assert len(r.content) > 1000
    again = client.post("/v1/audio/speech", json={"model": "openvoice", "voice": "iara", "input": "O PLD do Sudeste está em 312 reais.", "response_format": "mp3"}, headers=h)
    assert again.content == r.content


def test_wav_e_texto_vazio(client):
    h = {"Authorization": "Bearer segredo"}
    r = client.post("/v1/audio/speech", json={"input": "teste", "response_format": "wav"}, headers=h)
    assert r.status_code == 200 and r.content[:4] == b"RIFF"
    assert client.post("/v1/audio/speech", json={"input": "   "}, headers=h).status_code == 400
