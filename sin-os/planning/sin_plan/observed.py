"""O que de fato aconteceu, para comparar com a retroanálise: CMO do DESSEM (semi-horário), PLD
reconstruído com os limites da ANEEL do próprio ano, CMO semanal do DECOMP e EAR no fim do mês."""

from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from . import inputs as I
from . import ons
from .results import limits


def cmo_halfhour(f: ons.Fetcher, years: list[int], this_year: int) -> pd.DataFrame:
    raw = pd.concat([ons.read_any(f.yearly(ons.cmo_halfhour_path(y), y, this_year)) for y in years], ignore_index=True)
    return pd.DataFrame({"ts": pd.to_datetime(raw["din_instante"]), "sub": ons.sub_of(raw["id_subsistema"]),
                         "cmo": ons.num(raw["val_cmo"])}).dropna()


def cmo_weekly(f: ons.Fetcher, years: list[int], this_year: int) -> pd.DataFrame:
    raw = pd.concat([ons.read_any(f.yearly(ons.cmo_weekly_path(y), y, this_year)) for y in years], ignore_index=True)
    return pd.DataFrame({"week": pd.to_datetime(raw["din_instante"]), "sub": ons.sub_of(raw["id_subsistema"]),
                         "cmo": ons.num(raw["val_cmomediasemanal"])}).dropna()


def cmo_hourly(cmo: pd.DataFrame) -> pd.DataFrame:
    """CMO horário (média das duas meias horas) por subsistema: colunas sub, h, cmo."""
    return cmo.assign(h=cmo["ts"].dt.floor("h")).groupby(["sub", "h"], as_index=False)["cmo"].mean()


def pld_hourly(cmo: pd.DataFrame) -> pd.DataFrame:
    """PLD horário = CMO horário (média das duas meias horas) entre piso e teto horário, com o teto
    estrutural aplicado à média de cada dia (mesma regra do app)."""
    h = cmo_hourly(cmo)
    lim = h["h"].dt.year.map(lambda y: limits(int(y)))
    lo = lim.map(lambda x: x["min"])
    hi = lim.map(lambda x: x["max_h"])
    est = lim.map(lambda x: x["max_est"])
    h["pld"] = h["cmo"].clip(lower=lo, upper=hi)
    h["day"] = h["h"].dt.normalize()
    h["est"], h["lo"] = est, lo
    m = h.groupby(["sub", "day"])["pld"].transform("mean")
    k = np.where(m > h["est"], (h["est"] - h["lo"]) / (m - h["lo"]), 1.0)
    h["pld"] = np.where(m > h["est"], h["lo"] + (h["pld"] - h["lo"]) * k, h["pld"])
    return h[["sub", "h", "cmo", "pld"]]


def month_stats(hourly: pd.DataFrame, weekly: pd.DataFrame, ear: pd.DataFrame, month: dt.date) -> dict:
    """Médias realizadas de um mês civil por subsistema."""
    a, b = pd.Timestamp(month), pd.Timestamp(I.add_months(month, 1))
    out = {}
    for s in I.SUBS:
        x = hourly[(hourly["sub"] == s) & (hourly["h"] >= a) & (hourly["h"] < b)]
        # semanas operativas (sábado a sexta) ponderadas pelos dias dentro do mês
        w = weekly[weekly["sub"] == s].copy()
        days = []
        for wk in w["week"]:
            ws = wk - pd.Timedelta(days=6) if wk.dayofweek == 4 else wk  # din_instante é o início ou o fim da semana
            we = ws + pd.Timedelta(days=7)
            days.append(max(0, (min(we, b) - max(ws, a)).days))
        w["d"] = days
        w = w[w["d"] > 0]
        e = ear[(ear["sub"] == s) & (ear["date"] == b - pd.Timedelta(days=1))]
        out[s] = {
            "cmo_dessem": round(float(x["cmo"].mean()), 2) if len(x) else None,
            "pld": round(float(x["pld"].mean()), 2) if len(x) else None,
            "horas": int(len(x)),
            "cmo_decomp": round(float((w["cmo"] * w["d"]).sum() / w["d"].sum()), 2) if len(w) else None,
            "ear_fim_pct": round(100 * float(e["cur"].iloc[0] / e["max"].iloc[0]), 2) if len(e) else None,
        }
    return out
