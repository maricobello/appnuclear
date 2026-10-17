"""Roda o NovoModelo: escolhe a ordem do modelo de afluências e treina/simula a política.

Estimação: PAR(p)-A (componente anual) com a maior ordem máxima que o próprio NovoModelo aceita
como estacionária em todas as usinas e estações; se nenhuma passar, cai para o PAR(p) clássico.
A escolha e as tentativas vão para o relatório.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import novomodelo
import novomodelo.io as nio
import pandas as pd
from novomodelo import run as nrun

from .case import Params

CANDIDATES = [("pacf_annual", 6), ("pacf_annual", 5), ("pacf_annual", 4), ("pacf_annual", 3), ("pacf_annual", 2),
              ("pacf", 6), ("pacf", 3), ("pacf", 1)]
LABEL = {"pacf_annual": "PAR(p)-A", "pacf": "PAR(p)"}


def version() -> str:
    try:
        from importlib import metadata
        return metadata.version("novomodelo-python")
    except Exception:  # noqa: BLE001
        return getattr(novomodelo, "__version__", "")


def estimate(case_dir: Path, params: Params) -> dict:
    """Grava em config.json a primeira configuração de estimação válida; devolve o que foi tentado."""
    cfg_path = case_dir / "config.json"
    cfg = json.loads(cfg_path.read_text())
    tried = []
    for method, order in CANDIDATES:
        cfg["estimation"] = {"max_order": order, "order_selection": method, "min_observations_per_season": 20}
        cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=1))
        r = nio.validate(str(case_dir))
        if r["valid"]:
            return {"metodo": LABEL[method], "ordem_max": order, "tentativas": tried}
        tried.append({"metodo": LABEL[method], "ordem_max": order, "erro": " ".join(e["message"] for e in r["errors"])[:300]})
    raise RuntimeError("nenhuma configuração de estimação válida: " + json.dumps(tried, ensure_ascii=False))


def fix_estimation(case_dir: Path, est: dict) -> None:
    """Reusa uma estimação já escolhida (as sensibilidades e as rodadas da calibração do λ partem da
    mesma série e do mesmo modelo de afluências do caso base)."""
    cfg_path = case_dir / "config.json"
    cfg = json.loads(cfg_path.read_text())
    method = next(k for k, v in LABEL.items() if v == est["metodo"])
    cfg["estimation"] = {"max_order": est["ordem_max"], "order_selection": method, "min_observations_per_season": 20}
    cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=1))


def run(case_dir: Path, out_dir: Path, threads: int | None = None) -> dict:
    """Treina e simula; devolve o resumo com a trajetória do limite inferior."""
    t0 = time.time()
    lbs: list[float] = []

    def on_iter(d: dict) -> None:
        if d.get("lower_bound") is not None:
            lbs.append(float(d["lower_bound"]))

    r = nrun.run(str(case_dir), output_dir=str(out_dir), threads=threads, on_iteration=on_iter,
                 config_overrides={"exports.stochastic": True})
    # com CVaR o limite inferior é a medida de risco e o "superior" amostral é um custo esperado, então
    # o gap clássico não se aplica: a convergência é medida pela estabilização do limite inferior.
    tail = lbs[-10:] if len(lbs) >= 10 else lbs
    stab = (max(tail) - min(tail)) / abs(tail[-1]) if tail and tail[-1] else None
    return {
        "iterations": int(r["iterations"]), "lower_bound": float(r["lower_bound"]),
        "upper_bound": float(r["upper_bound"]) if r.get("upper_bound") is not None else None,
        "seconds": round(time.time() - t0, 1),
        "lb_variacao_ultimas_10": round(float(stab), 5) if stab is not None else None,
        "lb_trajetoria": [round(x / 1e9, 4) for x in lbs[:: max(1, len(lbs) // 30)]],
    }


def fitted_orders(out_dir: Path) -> dict:
    """Ordens ajustadas por usina e estação, lidas dos artefatos exportados da estimação."""
    p = out_dir / "stochastic"
    for name in ("inflow_ar_coefficients.parquet", "ar_coefficients.parquet"):
        f = p / name
        if f.exists():
            df = pd.read_parquet(f)
            hid = next((c for c in df.columns if c.startswith("hydro")), None)
            season = next((c for c in df.columns if "season" in c or "stage" in c), None)
            lag = next((c for c in df.columns if "lag" in c), None)
            if hid and season and lag:
                g = df.groupby([hid, season])[lag].max().groupby(level=0).agg(["min", "max", "mean"])
                return {int(k): {"min": int(v["min"]), "max": int(v["max"]), "media": round(float(v["mean"]), 2)} for k, v in g.iterrows()}
    return {}
