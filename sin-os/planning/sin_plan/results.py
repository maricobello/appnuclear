"""Da simulação do NovoModelo ao que interessa para quem opera: CMO e PLD por mês civil com faixas,
armazenamento, risco de déficit, valor da água e térmicas despachadas.

PLD: o CMO de cada patamar passa pelo piso e pelo teto horário da ANEEL e a média do estágio
(ponderada pelas horas dos patamares) fica limitada ao teto estrutural — a média mensal do PLD não
pode passar dele porque nenhum dia passa. Meses civis: cada estágio vai de um dia D ao dia D do mês
seguinte, então o valor de um mês é a média dos estágios que o tocam, ponderada pelos dias, feita
cenário a cenário antes de tirar os quantis.
"""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.dataset as ds

from . import case as C
from . import inputs as I

QUANTILES = {"p10": 0.10, "p50": 0.50, "p90": 0.90}
#: Janela dos desvios horários do CMO do DESSEM usados no PLD com ponta.
PEAK_DAYS = 30
#: Limites do PLD homologados pela ANEEL por ano (anos sem tabela usam o mais recente).
PLD_LIMITS = {
    2024: {"min": 61.07, "max_h": 1470.57, "max_est": 716.80},
    2025: {"min": 58.60, "max_h": 1542.23, "max_est": 751.73},
    2026: {"min": 57.31, "max_h": 1611.04, "max_est": 785.27},
}
#: 1 hm³ turbinado com produtividade 1 MW/(m³/s) gera 10⁶/3600 MWh.
MWH_PER_HM3 = 1e6 / 3600


def stage_pld(cmo_blocks: np.ndarray, hours: np.ndarray, lim: np.ndarray) -> np.ndarray:
    """PLD médio de cada estágio (cenário × estágio) a partir do CMO por patamar (cenário × estágio × patamar).

    `hours` é estágio × patamar; `lim` é estágio × (piso, teto horário, teto estrutural)."""
    w = hours / hours.sum(axis=1, keepdims=True)
    clamped = np.clip(cmo_blocks, lim[None, :, 0:1], lim[None, :, 1:2])
    return np.minimum((clamped * w[None]).sum(axis=2), lim[None, :, 2])


def peak_deviations(cmo_hourly: pd.DataFrame, start: dt.date, days: int = PEAK_DAYS) -> dict[str, np.ndarray]:
    """Desvios horários do CMO do DESSEM em torno da própria média, nos `days` dias antes do início.

    O SDDP mensal acerta o nível do CMO (o valor da água), mas não vê as horas de ponta do fim da
    tarde, quando a solar sai e o CMO horário dispara; como o PLD tem piso, a média mensal do PLD
    fica acima do PLD da média. Somar ao CMO do estágio os desvios horários recentes e só então
    aplicar piso e teto devolve esse efeito: com o CMO mensal realizado, o erro médio do PLD mensal
    de 2025–26 cai de 11,5 para 6,0 R$/MWh e o viés de −11 para ~0 (planning/README)."""
    a, b = pd.Timestamp(start) - pd.Timedelta(days=days), pd.Timestamp(start)
    out = {}
    for s in I.SUBS:
        x = cmo_hourly[(cmo_hourly["sub"] == s) & (cmo_hourly["h"] >= a) & (cmo_hourly["h"] < b)]["cmo"].to_numpy(float)
        if len(x) < days * 24 * 0.8:
            raise RuntimeError(f"CMO horário do DESSEM com só {len(x)} horas nos {days} dias antes de {start} no {s}")
        out[s] = x - x.mean()
    return out


def ponta_pld(stage_cmo: np.ndarray, dev: np.ndarray, lim: dict) -> np.ndarray:
    """PLD médio de cada cenário: CMO do estágio + desvios horários, entre piso e teto horário, e o
    teto estrutural sobre a média."""
    v = np.clip(stage_cmo[:, None] + dev[None, :], lim["min"], lim["max_h"]).mean(axis=1)
    return np.minimum(v, lim["max_est"])


def residual_quantiles(validation: dict | None, key: str = "pld_ponta", horizons: int = 6, min_n: int = 8) -> dict[str, list[dict]]:
    """Por subsistema, quantis 10% e 90% do erro (realizado − P50 previsto) do PLD em cada horizonte
    h da retroanálise (mês M+h previsto no 1º dia de M; só meses com o PLD realizado completo). Para
    no primeiro horizonte com menos de `min_n` meses: os seguintes herdam o último calculado."""
    out: dict[str, list[dict]] = {}
    if not validation:
        return out
    for s in I.SUBS:
        rows = []
        for h in range(horizons):
            r = []
            for row in validation.get("meses", []):
                hz = row.get("horizonte")
                if hz is not None:
                    if len(hz) <= h or hz[h]["realizado"][s] is None or hz[h][key][s]["p50"] is None:
                        continue
                    r.append(hz[h]["realizado"][s] - hz[h][key][s]["p50"])
                elif h == 0:
                    x = row["sub"][s]
                    prev = x["previsto"].get(key) or x["previsto"].get("pld")
                    if x["realizado"].get("pld") is None or x["realizado"].get("horas", 0) < 24 * 25 or not prev or prev.get("p50") is None:
                        continue
                    r.append(x["realizado"]["pld"] - prev["p50"])
            if len(r) < min_n:
                break
            rows.append({"h": h, "p10": round(float(np.quantile(r, 0.10)), 2), "p90": round(float(np.quantile(r, 0.90)), 2), "n": len(r)})
        if rows:
            out[s] = rows
    return out


def horizon_of(month: dt.date, start: dt.date) -> float:
    """Horizonte equivalente ao da retroanálise (que prevê M+h no dia 1º de M, com o meio do mês a
    h + 0,5 mês do início): meses de 30,44 dias entre o início do estudo e o meio do mês, menos ½."""
    mid = month + dt.timedelta(days=15)
    return max(0.0, (mid - start).days / 30.44 - 0.5)


def calibrated_band(months: list[dict], resid: dict[str, list[dict]], start: dt.date) -> None:
    """Faixa publicada = a mais larga entre a do modelo (incerteza hidrológica) e a mediana mais os
    quantis do erro da retroanálise no mesmo horizonte (conformal; entre os horizontes medidos,
    interpola; depois do último, repete), dentro do piso e do teto do PLD. Escreve `pld_faixa`."""
    for m in months:
        head = m.get("pld_ponta") or m["pld"]
        mm = dt.date.fromisoformat(m["mes"] + "-01")
        lim = limits(mm.year)
        h = horizon_of(mm, start)
        band = {}
        for s in I.SUBS:
            q = head[s]
            rs = resid.get(s) or []
            if not rs or q["p50"] is None:
                band[s] = {"p10": q["p10"], "p90": q["p90"], "calibrada": False}
                continue
            i = min(int(np.floor(h)), len(rs) - 1)
            j = min(i + 1, len(rs) - 1)
            w = 0.0 if i == j else h - i
            r10 = (1 - w) * rs[i]["p10"] + w * rs[j]["p10"]
            r90 = (1 - w) * rs[i]["p90"] + w * rs[j]["p90"]
            lo = max(lim["min"], q["p50"] + r10)
            hi = min(lim["max_h"], q["p50"] + r90)
            band[s] = {"p10": round(min(q["p10"], lo), 2), "p90": round(max(q["p90"], hi), 2), "calibrada": True}
        m["pld_faixa"] = band


#: Combinação publicada: peso do SDDP calibrado contra o DESSEM de 14 dias congelado, por horizonte.
BLEND_GRID = np.linspace(0.0, 1.0, 21)
BLEND_HORIZONS = 6
BLEND_MIN_N = 12


def _blend_points(rows: list[dict], h: int, exclude: str | None = None) -> list[tuple]:
    """(P50 do SDDP, DESSEM 14 d com ponta, realizado, submercado, mês) no horizonte h da retroanálise."""
    out = []
    for r in rows:
        if r["mes"] == exclude:
            continue
        hz = r.get("horizonte") or []
        if len(hz) <= h:
            continue
        for s in I.SUBS:
            real, p50 = hz[h]["realizado"][s], hz[h]["pld_ponta"][s]["p50"]
            d14 = r["sub"][s].get("mercado", {}).get("dessem14_ponta")
            if real is not None and p50 is not None and d14 is not None:
                out.append((p50, d14, real, s, r["mes"]))
    return out


def _nonincreasing(ws: list[float]) -> list[float]:
    """Regressão isotônica (blocos adjacentes) que não deixa o peso crescer com o horizonte."""
    stack: list[list[float]] = []
    for w in ws:
        stack.append([w, 1])
        while len(stack) > 1 and stack[-1][0] > stack[-2][0]:
            w2, n2 = stack.pop()
            w1, n1 = stack.pop()
            stack.append([(w1 * n1 + w2 * n2) / (n1 + n2), n1 + n2])
    return [round(w, 3) for w, n in stack for _ in range(int(n))]


def blend_weights(validation: dict | None, exclude: str | None = None) -> list[dict]:
    """Peso do SDDP calibrado na combinação com o DESSEM de 14 dias congelado, por horizonte: o que
    minimiza o erro médio absoluto na retroanálise (submercados juntos), sem crescer com o horizonte.
    Na retroanálise de 2025–26 o SDDP só ajuda no mês seguinte; depois a âncora erra menos."""
    rows = (validation or {}).get("meses", [])
    fits = []
    for h in range(BLEND_HORIZONS):
        pts = _blend_points(rows, h, exclude)
        if len(pts) < BLEND_MIN_N:
            break
        m, d, y = (np.array([p[i] for p in pts], dtype=float) for i in range(3))
        mae = [np.mean(np.abs(w * m + (1 - w) * d - y)) for w in BLEND_GRID]
        fits.append((h, float(BLEND_GRID[int(np.argmin(mae))]), len(pts)))
    ws = _nonincreasing([w for _, w, _ in fits])
    return [{"h": h, "peso": w, "n": n} for (h, _, n), w in zip(fits, ws)]


def combination_residuals(validation: dict | None, weights: list[dict], exclude: str | None = None, min_n: int = 8) -> dict[str, list[dict]]:
    """Quantis 10% e 90% do erro (realizado − combinação) por submercado e horizonte."""
    rows = (validation or {}).get("meses", [])
    out: dict[str, list[dict]] = {}
    for s in I.SUBS:
        res = []
        for wh in weights:
            r = [real - (wh["peso"] * p50 + (1 - wh["peso"]) * d14) for p50, d14, real, ss, _ in _blend_points(rows, wh["h"], exclude) if ss == s]
            if len(r) < min_n:
                break
            res.append({"h": wh["h"], "p10": round(float(np.quantile(r, 0.10)), 2), "p90": round(float(np.quantile(r, 0.90)), 2), "n": len(r)})
        if res:
            out[s] = res
    return out


def combination_loo(validation: dict | None) -> dict[str, dict[str, list[dict]]]:
    """A combinação publicada (`apply_combination`) refeita em cada mês da retroanálise com os pesos e
    os quantis do erro calibrados sem esse mês: {mês: {submercado: [{"h", "p10", "p50", "p90",
    "realizado"}]}}, sem arredondar (a faixa fica None sem quantis)."""
    rows = (validation or {}).get("meses", [])
    out: dict[str, dict[str, list[dict]]] = {}
    for r in rows:
        ws = blend_weights(validation, exclude=r["mes"])
        if not ws:
            continue
        resid = combination_residuals(validation, ws, exclude=r["mes"])
        for s in I.SUBS:
            d14 = r["sub"][s].get("mercado", {}).get("dessem14_ponta")
            if d14 is None:
                continue
            rs, pts = resid.get(s) or [], []
            for h, x in enumerate(r.get("horizonte") or []):
                p50 = x["pld_ponta"][s]["p50"]
                if p50 is None:
                    continue
                w = ws[min(h, len(ws) - 1)]["peso"]
                c, lim = w * p50 + (1 - w) * d14, limits(int(x["mes"][:4]))
                q = rs[min(h, len(rs) - 1)] if rs else None
                pts.append({"h": h, "p10": max(lim["min"], min(c + q["p10"], c)) if q else None, "p50": c,
                            "p90": min(lim["max_h"], max(c + q["p90"], c)) if q else None, "realizado": x["realizado"][s]})
            out.setdefault(r["mes"], {})[s] = pts
    return out


def _at(rows: list[dict], h: float, key: str) -> float:
    i = min(int(np.floor(h)), len(rows) - 1)
    j = min(i + 1, len(rows) - 1)
    w = 0.0 if i == j else h - i
    return (1 - w) * rows[i][key] + w * rows[j][key]


def apply_combination(months: list[dict], d14: dict[str, dict[str, float]], weights: list[dict], resid: dict[str, list[dict]], start: dt.date) -> None:
    """Escreve `pld_previsto`, o PLD publicado: peso(h) × P50 do SDDP calibrado + (1 − peso(h)) × o
    DESSEM de 14 dias com a ponta (`d14[mês][submercado]`), com a faixa dos quantis do erro da
    combinação no mesmo horizonte, entre o piso e o teto do ano."""
    if not weights:
        return
    for m in months:
        head = m.get("pld_ponta") or m["pld"]
        mm = dt.date.fromisoformat(m["mes"] + "-01")
        lim, h = limits(mm.year), horizon_of(mm, start)
        w = _at(weights, h, "peso")
        out = {}
        for s in I.SUBS:
            p, d = head[s]["p50"], (d14.get(m["mes"]) or {}).get(s)
            if p is None or d is None:
                break
            c = w * p + (1 - w) * d
            rs = resid.get(s) or []
            lo, hi = (c + _at(rs, h, "p10"), c + _at(rs, h, "p90")) if rs else (head[s]["p10"], head[s]["p90"])
            out[s] = {"p10": round(max(lim["min"], min(lo, c)), 2), "p50": round(c, 2), "p90": round(min(lim["max_h"], max(hi, c)), 2)}
        else:
            m["pld_previsto"] = out
            m["peso_sddp"] = round(w, 3)


def limits(year: int) -> dict:
    known = sorted(PLD_LIMITS)
    y = max([k for k in known if k <= year], default=known[0])
    return PLD_LIMITS[y]


def read(out: Path, entity: str, columns: list[str] | None = None) -> pd.DataFrame:
    path = out / "simulation" / entity
    if not path.exists():
        return pd.DataFrame()
    return ds.dataset(path, format="parquet", partitioning=None).to_table(columns=columns).to_pandas()


def _q(x: np.ndarray, digits: int = 2) -> dict:
    x = np.asarray(x, dtype=float)
    x = x[np.isfinite(x)]
    if not len(x):
        return {"mean": None, **{k: None for k in QUANTILES}}
    return {"mean": round(float(x.mean()), digits), **{k: round(float(np.quantile(x, q)), digits) for k, q in QUANTILES.items()}}


@dataclass
class Sim:
    """Matrizes cenário × estágio por subsistema, prontas para agregar."""
    stages: list[tuple[dt.date, dt.date]]
    cmo: dict[str, np.ndarray]
    pld: dict[str, np.ndarray]
    cmo_block: dict[str, np.ndarray]   # cenário × estágio × patamar
    ear_pct: dict[str, np.ndarray]     # fim do estágio
    deficit_mw: dict[str, np.ndarray]
    load_mw: dict[str, np.ndarray]
    thermal_mw: dict[str, np.ndarray]
    water_value: dict[str, np.ndarray]  # R$/MWh no início do estágio
    curtail_mw: dict[str, np.ndarray]
    scenarios: int
    #: PLD com os desvios horários do DESSEM (None sem a série horária).
    pld_ponta: dict[str, np.ndarray] | None = None
    #: Afluência (reservatório + fio d'água) e geração hidráulica simuladas, MWmed (cenário × estágio).
    inflow_mw: dict[str, np.ndarray] | None = None
    hydro_mw: dict[str, np.ndarray] | None = None


def load_sim(case: C.Case, out: Path, dev: dict[str, np.ndarray] | None = None) -> Sim:
    st = case.stages()
    hours = _block_hours(case)
    nb = hours.shape[1]
    b = read(out, "buses", ["scenario_id", "stage_id", "block_id", "bus_id", "spot_price", "deficit_mw", "load_mw"])
    b = b[b["block_id"].notna()]
    nsc = int(b["scenario_id"].max()) + 1
    ns = len(st)
    lim = np.array([[limits(a.year)[k] for k in ("min", "max_h", "max_est")] for a, _ in st])
    cmo, pld, cmob, dfc, ld = {}, {}, {}, {}, {}
    for s in I.SUBS:
        x = b[b["bus_id"] == C.BUS[s]]
        arr = np.full((nsc, ns, nb), np.nan)
        arr[x["scenario_id"].to_numpy(int), x["stage_id"].to_numpy(int), x["block_id"].to_numpy(int)] = x["spot_price"].to_numpy(float)
        dm = np.zeros((nsc, ns, nb))
        dm[x["scenario_id"].to_numpy(int), x["stage_id"].to_numpy(int), x["block_id"].to_numpy(int)] = x["deficit_mw"].to_numpy(float)
        lm = np.zeros((nsc, ns, nb))
        lm[x["scenario_id"].to_numpy(int), x["stage_id"].to_numpy(int), x["block_id"].to_numpy(int)] = x["load_mw"].to_numpy(float)
        w = hours / hours.sum(axis=1, keepdims=True)
        cmob[s] = arr
        cmo[s] = (arr * w[None]).sum(axis=2)
        pld[s] = stage_pld(arr, hours, lim)
        dfc[s] = (dm * w[None]).sum(axis=2)
        ld[s] = (lm * w[None]).sum(axis=2)

    h = read(out, "hydros", ["scenario_id", "stage_id", "block_id", "hydro_id", "storage_final_hm3", "water_value_per_hm3", "inflow_m3s", "generation_mw"])
    hs = h[h["block_id"].isna()] if h["block_id"].isna().any() else h.groupby(["scenario_id", "stage_id", "hydro_id"], as_index=False).last()
    ear, wv = {}, {}
    for s in I.SUBS:
        x = hs[hs["hydro_id"] == C.BUS[s]]
        e = np.full((nsc, ns), np.nan)
        e[x["scenario_id"].to_numpy(int), x["stage_id"].to_numpy(int)] = x["storage_final_hm3"].to_numpy(float)
        ear[s] = 100 * e / (case.store[s]["max_mwmes"] * I.MWMES_HM3)
        v = np.full((nsc, ns), np.nan)
        v[x["scenario_id"].to_numpy(int), x["stage_id"].to_numpy(int)] = x["water_value_per_hm3"].to_numpy(float)
        wv[s] = -v / MWH_PER_HM3  # dual do armazenamento: mais água reduz o custo, então o valor é −dual

    # afluência e geração hidráulica por subsistema (reservatório + fio d'água), para os diagnósticos
    rids = case.ror_ids()
    wst0 = hours / hours.sum(axis=1, keepdims=True)
    hb = h[h["block_id"].notna()].copy()
    hb["sub"] = hb["hydro_id"].map({**{C.BUS[s]: s for s in I.SUBS}, **{v: k for k, v in rids.items()}})
    hb["w"] = wst0[hb["stage_id"].to_numpy(int), hb["block_id"].to_numpy(int)]
    hb["gw"] = hb["generation_mw"] * hb["w"]
    hb["iw"] = hb["inflow_m3s"] * hb["w"]
    agg = hb.groupby(["sub", "scenario_id", "stage_id"])[["gw", "iw"]].sum().reset_index()
    inflow, hgen = {}, {}
    for s in I.SUBS:
        x = agg[agg["sub"] == s]
        a1, a2 = np.zeros((nsc, ns)), np.zeros((nsc, ns))
        a1[x["scenario_id"].to_numpy(int), x["stage_id"].to_numpy(int)] = x["iw"].to_numpy(float)
        a2[x["scenario_id"].to_numpy(int), x["stage_id"].to_numpy(int)] = x["gw"].to_numpy(float)
        inflow[s], hgen[s] = a1, a2

    t = read(out, "thermals", ["scenario_id", "stage_id", "block_id", "thermal_id", "generation_mw"])
    t = t[t["block_id"].notna()]
    sub_of = case.fleet.plants["sub"].to_numpy()
    t["sub"] = sub_of[t["thermal_id"].to_numpy(int)]
    th = {}
    wst = hours / hours.sum(axis=1, keepdims=True)
    t["w"] = wst[t["stage_id"].to_numpy(int), t["block_id"].to_numpy(int)]
    t["gw"] = t["generation_mw"] * t["w"]
    g = t.groupby(["sub", "scenario_id", "stage_id"])["gw"].sum().reset_index()
    for s in I.SUBS:
        x = g[g["sub"] == s]
        m = np.zeros((nsc, ns))
        m[x["scenario_id"].to_numpy(int), x["stage_id"].to_numpy(int)] = x["gw"].to_numpy(float)
        th[s] = m

    curt = {s: np.zeros((nsc, ns)) for s in I.SUBS}
    n = read(out, "non_controllables")
    if not n.empty and "curtailment_mw" in n.columns:
        names = json.loads((Path(str(out).replace("-out", "")) / "system" / "non_controllable_sources.json").read_text())["non_controllable_sources"] \
            if (Path(str(out).replace("-out", "")) / "system" / "non_controllable_sources.json").exists() else []
        bus_of = {x["id"]: x["bus_id"] for x in names}
        n = n[n["block_id"].notna()]
        n["bus"] = n[[c for c in n.columns if c.endswith("_id") and c.startswith("non")][0]].map(bus_of)
        n["w"] = wst[n["stage_id"].to_numpy(int), n["block_id"].to_numpy(int)]
        n["cw"] = n["curtailment_mw"] * n["w"]
        g = n.groupby(["bus", "scenario_id", "stage_id"])["cw"].sum().reset_index()
        for s in I.SUBS:
            x = g[g["bus"] == C.BUS[s]]
            curt[s][x["scenario_id"].to_numpy(int), x["stage_id"].to_numpy(int)] = x["cw"].to_numpy(float)
    ponta = None
    if dev:
        ponta = {}
        for s in I.SUBS:
            m = np.full((nsc, ns), np.nan)
            for sid, (a, _) in enumerate(st):
                m[:, sid] = ponta_pld(cmo[s][:, sid], dev[s], limits(a.year))
            ponta[s] = m
    return Sim(stages=st, cmo=cmo, pld=pld, cmo_block=cmob, ear_pct=ear, deficit_mw=dfc, load_mw=ld, thermal_mw=th,
               water_value=wv, curtail_mw=curt, scenarios=nsc, pld_ponta=ponta, inflow_mw=inflow, hydro_mw=hgen)


def _block_hours(case: C.Case) -> np.ndarray:
    st = case.stages()
    out = np.zeros((len(st), len(I.BLOCKS)))
    for sid, (a, b) in enumerate(st):
        bl = C._blocks(case.demand.blocks, "SE", a, b)
        hrs = (b - a).days * 24
        out[sid] = bl["share"].to_numpy() * hrs
    return out


def monthly(sim: Sim, metric: dict[str, np.ndarray]) -> list[tuple[dt.date, dict[str, np.ndarray]]]:
    """Agrega uma métrica cenário × estágio em meses civis, ponderando pelos dias de cada estágio no mês."""
    months = C.calendar_months(sim.stages[0][0], len(sim.stages))
    rows = []
    for m in months:
        nxt = I.add_months(m, 1)
        w = np.array([max(0, (min(b, nxt) - max(a, m)).days) for a, b in sim.stages], dtype=float)
        if w.sum() == 0:
            continue
        covered = w.sum() / (nxt - m).days
        vals = {s: (metric[s] * w[None]).sum(axis=1) / w.sum() for s in I.SUBS}
        rows.append((m, vals, covered))
    return rows


def report(case: C.Case, sim: Sim, months_out: int = 13) -> dict:
    """Bloco de resultados do relatório (o resto — parâmetros, procedência — monta o run.py)."""
    mo = []
    cmo_m = monthly(sim, sim.cmo)
    pld_m = monthly(sim, sim.pld)
    ponta_m = monthly(sim, sim.pld_ponta) if sim.pld_ponta else [(m, None, c) for m, _, c in pld_m]
    for (m, cv, cov), (_, pv, _), (_, kv, _) in zip(cmo_m[:months_out], pld_m[:months_out], ponta_m[:months_out]):
        row = {"mes": m.strftime("%Y-%m"), "cobertura": round(cov, 3),
               "cmo": {s: _q(cv[s]) for s in I.SUBS}, "pld": {s: _q(pv[s]) for s in I.SUBS}}
        if kv is not None:
            row["pld_ponta"] = {s: _q(kv[s]) for s in I.SUBS}
        mo.append(row)
    stg = []
    for sid, (a, b) in enumerate(sim.stages[:months_out]):
        stg.append({
            "inicio": a.isoformat(), "fim": b.isoformat(),
            "ear_fim_pct": {s: _q(sim.ear_pct[s][:, sid], 1) for s in I.SUBS},
            "risco_deficit": {s: round(float((sim.deficit_mw[s][:, sid] > 1e-3 * np.maximum(sim.load_mw[s][:, sid], 1)).mean()), 4) for s in I.SUBS},
            "deficit_esperado_mw": {s: round(float(sim.deficit_mw[s][:, sid].mean()), 1) for s in I.SUBS},
            "termica_mw": {s: _q(sim.thermal_mw[s][:, sid], 0) for s in I.SUBS},
            "corte_renovavel_mw": {s: round(float(sim.curtail_mw[s][:, sid].mean()), 1) for s in I.SUBS},
            "valor_agua": {s: _q(sim.water_value[s][:, sid]) for s in I.SUBS},
        })
    first = {}
    for s in I.SUBS:
        first[s] = {name: _q(sim.cmo_block[s][:, 0, i]) for i, (name, _) in enumerate(I.BLOCKS)}
    # média dos próximos 12 meses civis completos (o que o mercado negocia como "A+1 rolante")
    def avg12(rows: list) -> dict:
        full = [(m, v) for m, v, cov in rows if cov >= 0.999][:12]
        return {s: _q(np.mean([v[s] for _, v in full], axis=0)) for s in I.SUBS} if len(full) == 12 else {}

    out = {"meses": mo, "estagios": stg, "primeiro_estagio_patamares": first, "pld_12m": avg12(pld_m), "cenarios": sim.scenarios}
    if sim.pld_ponta:
        out["pld_12m_ponta"] = avg12(ponta_m)
    return out
