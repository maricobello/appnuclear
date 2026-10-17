"""Leitura dos conjuntos de dados abertos do ONS usados pelo planejamento (bucket público na AWS).

Tudo vem de https://ons-aws-prod-opendata.s3.amazonaws.com/dataset/<conjunto>/, o mesmo endereço
dos downloads do portal dados.ons.org.br. Cada arquivo fica em cache local; a URL e o Last-Modified
entram no relatório para a procedência ser conferível.
"""

from __future__ import annotations

import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from pathlib import Path

import pandas as pd

S3 = "https://ons-aws-prod-opendata.s3.amazonaws.com/dataset"
SUBS = ("SE", "S", "NE", "N")
#: Até 2020 o ONS publica a ENA diária só em CSV; de 2021 em diante, em parquet.
ENA_FIRST_YEAR = 2000
ENA_PARQUET_FROM = 2021


def ena_path(y: int) -> str:
    ext = "parquet" if y >= ENA_PARQUET_FROM else "csv"
    return f"ena_subsistema_di/ENA_DIARIO_SUBSISTEMA_{y}.{ext}"


#: ENA e EAR por REE: o ONS publica desde 2018 (CSV até 2020, parquet depois).
REE_FIRST_YEAR = 2018
REE_PARQUET_FROM = 2021
#: REE → subsistema (configuração do PMO; a soma das ENAs por REE é conferida contra a do subsistema).
REE_SUB = {"PARANA": "SE", "PARANAPANEMA": "SE", "SUDESTE": "SE", "ITAIPU": "SE", "MADEIRA": "SE", "TELES PIRES": "SE",
           "SUL": "S", "IGUACU": "S", "NORDESTE": "NE", "NORTE": "N", "BELO MONTE": "N", "MANAUS-AMAPA": "N"}


def ena_ree_path(y: int) -> str:
    ext = "parquet" if y >= REE_PARQUET_FROM else "csv"
    return f"ena_ree_di/ENA_DIARIO_REE_{y}.{ext}"


def ear_ree_path(y: int) -> str:
    return f"ear_ree_di/EAR_DIARIO_REE_{y}.parquet"


def ear_path(y: int) -> str:
    return f"ear_subsistema_di/EAR_DIARIO_SUBSISTEMA_{y}.parquet"


def balance_path(y: int) -> str:
    return f"balanco_energia_subsistema_ho/BALANCO_ENERGIA_SUBSISTEMA_{y}.parquet"


def interchange_path(y: int) -> str:
    return f"intercambio_nacional_ho/INTERCAMBIO_NACIONAL_{y}.parquet"


def thermal_path(y: int, m: int) -> str:
    return f"geracao_termica_despacho_2_ho/GERACAO_TERMICA_DESPACHO-2_{y}_{m:02d}.parquet"


def cvu_path(y: int) -> str:
    return f"cvu_usitermica_se/CVU_USINA_TERMICA_{y}.parquet"


def cmo_weekly_path(y: int) -> str:
    return f"cmo_se/CMO_SEMANAL_{y}.parquet"


def cmo_halfhour_path(y: int) -> str:
    return f"cmo_tm/CMO_SEMIHORARIO_{y}.parquet"


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
    #: Arquivos anteriores a este ano são fechados: o cache vale para sempre.
    frozen_before: int = 0
    sources: list[Source] = field(default_factory=list)

    def get(self, rel: str, max_age_s: float | None = None) -> Path:
        """Baixa (ou reaproveita do cache) um arquivo do bucket; devolve o caminho local."""
        url = f"{S3}/{rel}"
        dest = self.cache / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        age = max_age_s if max_age_s is not None else self.max_age_s
        modified = None
        if not dest.exists() or (age >= 0 and time.time() - dest.stat().st_mtime > age):
            req = urllib.request.Request(url, headers={"User-Agent": "sin-os-planning/1.0"})
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
        if not any(s.url == url for s in self.sources):
            self.sources.append(Source(rel.split("/")[0], url, modified, dest.stat().st_size))
        return dest

    def yearly(self, rel: str, year: int, this_year: int) -> Path:
        """Arquivo anual: anos fechados ficam no cache sem revalidar."""
        return self.get(rel, max_age_s=-1 if year < this_year else None)

    def maybe(self, rel: str, **kw) -> Path | None:
        """Como get, mas devolve None se o arquivo ainda não existe no bucket (404)."""
        try:
            return self.get(rel, **kw)
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                return None
            raise


def read_any(path: Path) -> pd.DataFrame:
    if path.suffix == ".parquet":
        df = pd.read_parquet(path)
    else:
        df = pd.read_csv(path, sep=";", dtype=str, encoding="utf-8", encoding_errors="replace")
    for c in df.columns:
        if df[c].dtype == object or str(df[c].dtype).startswith("string"):
            df[c] = df[c].astype("string").str.strip()
    return df


def num(s: pd.Series) -> pd.Series:
    """Coluna numérica do ONS (no parquet alguns números vêm como texto, às vezes com vírgula)."""
    if pd.api.types.is_numeric_dtype(s):
        return s.astype(float)
    return pd.to_numeric(s.astype(str).str.strip().str.replace(",", ".", regex=False), errors="coerce")


def sub_of(s: pd.Series) -> pd.Series:
    """id_subsistema do ONS → SE/S/NE/N (o balanço chama o Sudeste de SE e o SIN de SIN)."""
    return s.astype("string").str.strip().str.upper().where(lambda x: x.isin(SUBS))
