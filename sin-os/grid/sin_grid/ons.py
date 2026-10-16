"""Leitura dos conjuntos de dados abertos do ONS (bucket público na AWS).

Tudo vem de https://ons-aws-prod-opendata.s3.amazonaws.com/dataset/<conjunto>/ — o mesmo endereço
que o portal dados.ons.org.br usa para os downloads. Cada arquivo baixado fica em cache local e a
URL e a data de atualização (Last-Modified) entram no relatório, para a procedência ser conferível.
"""

from __future__ import annotations

import time
import urllib.request
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from pathlib import Path

import pandas as pd

S3 = "https://ons-aws-prod-opendata.s3.amazonaws.com/dataset"

#: Cadastros (mudam pouco: revalidados a cada 24 h)
REGISTRIES = {
    "linhas": "linha_transmissao/LINHA_TRANSMISSAO.csv",
    "subestacoes": "subestacao/SUBESTACAO.csv",
    "transformadores": "capacidade-transformacao/CAPACIDADE_TRANSFORMACAO.csv",
    "unidades_geradoras": "capacidade-geracao/CAPACIDADE_GERACAO.parquet",
    "modalidade_usinas": "modalidade_usina/MODALIDADE_USINA.csv",
    "conjuntos": "usina_conjunto/RELACIONAMENTO_USINA_CONJUNTO.csv",
    "controle_reativo": "equipamento_controle_reativo/EQP_CONTROLE_REATIVO.csv",
}


def generation_path(year: int, month: int) -> str:
    return f"geracao_usina_2_ho/GERACAO_USINA-2_{year}_{month:02d}.parquet"


def balance_path(year: int) -> str:
    return f"balanco_energia_subsistema_ho/BALANCO_ENERGIA_SUBSISTEMA_{year}.parquet"


def interchange_path(year: int) -> str:
    return f"intercambio_nacional_ho/INTERCAMBIO_NACIONAL_{year}.parquet"


def controlled_flow_path(date: str) -> str:
    return f"programacao_fluxo_controlado/PROGRAMACAO_FLUXO_CONTROLADO_{date.replace('-', '_')}.parquet"


@dataclass
class Source:
    name: str
    url: str
    modified: str | None
    bytes: int


@dataclass
class Fetcher:
    cache: Path
    max_age_s: float = 24 * 3600
    sources: list[Source] = field(default_factory=list)

    def get(self, rel: str, max_age_s: float | None = None) -> Path:
        """Baixa (ou reaproveita do cache) um arquivo do bucket; devolve o caminho local."""
        url = f"{S3}/{rel}"
        dest = self.cache / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        age = max_age_s if max_age_s is not None else self.max_age_s
        modified = None
        if not dest.exists() or time.time() - dest.stat().st_mtime > age:
            req = urllib.request.Request(url, headers={"User-Agent": "sin-os-grid/1.0"})
            with urllib.request.urlopen(req, timeout=180) as r:
                data = r.read()
                lm = r.headers.get("Last-Modified")
                modified = parsedate_to_datetime(lm).isoformat() if lm else None
            tmp = dest.with_suffix(dest.suffix + ".part")
            tmp.write_bytes(data)
            tmp.replace(dest)
            if modified:
                (dest.parent / (dest.name + ".modified")).write_text(modified)
        else:
            meta = dest.parent / (dest.name + ".modified")
            modified = meta.read_text() if meta.exists() else None
        self.sources.append(Source(rel.split("/")[0], url, modified, dest.stat().st_size))
        return dest


def read_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";", dtype=str, encoding="utf-8", encoding_errors="replace")
    return df.apply(lambda s: s.str.strip() if s.dtype == object else s)


def read_any(path: Path) -> pd.DataFrame:
    if path.suffix == ".parquet":
        df = pd.read_parquet(path)
        for c in df.columns:
            if df[c].dtype == object:
                df[c] = df[c].str.strip()
        return df
    return read_csv(path)


def num(s: pd.Series) -> pd.Series:
    """Coluna numérica do ONS (no parquet alguns números vêm como texto, às vezes com vírgula)."""
    if pd.api.types.is_numeric_dtype(s):
        return s.astype(float)
    return pd.to_numeric(s.astype(str).str.strip().str.replace(",", ".", regex=False), errors="coerce")


def registries(f: Fetcher) -> dict[str, pd.DataFrame]:
    return {k: read_any(f.get(rel)) for k, rel in REGISTRIES.items()}


def active(df: pd.DataFrame, on: str) -> pd.DataFrame:
    """Equipamentos em operação na data: entrou em operação até `on` e não foi desativado até lá."""
    start = df["dat_entradaoperacao"].fillna("").astype(str).str[:10]
    stop = df["dat_desativacao"].fillna("").astype(str).str[:10]
    return df[(start != "") & (start <= on) & ((stop == "") | (stop == "None") | (stop > on))]
