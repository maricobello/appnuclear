"""Relatório do dia (JSON que o SIN OS mostra na tela Rede): rede, fluxos, N-1 e a validação."""

from __future__ import annotations

import datetime as dt
import math
import re

import numpy as np
import pandas as pd

from . import ons
from .dispatch import Dispatch
from .flows import FlowResult, N1_MIN_KV, PV_MIN_MW, SLACK_BUS
from .model import BASE_KV, TRAFO_VK_PERCENT, GridModel

VERSION = 1
PAIR_LABEL = {"N-NE": "Norte → Nordeste", "N-SE": "Norte → Sudeste/CO", "NE-SE": "Nordeste → Sudeste/CO", "S-SE": "Sul → Sudeste/CO"}
#: erro médio absoluto relativo ao fluxo médio no par: até 15% "bom", até 30% "atenção"
GOOD, WARN = 0.15, 0.30


def _name(s) -> str:
    """'LT  500 kV SE LAJEADO      / MIRACEMA   C 1  TO (x)' → 'LT 500 kV SE LAJEADO / MIRACEMA C 1 TO'."""
    return " ".join(str(s).split(" (")[0].split())


def _short(s) -> str:
    """Nome curto para o mapa: 'LT 500 kV SE LAJEADO / MIRACEMA C 1 TO' → 'LAJEADO / MIRACEMA C 1 TO'."""
    return re.sub(r"^LT\s+\d+\s*kV\s+(SE\s+)?", "", _name(s))


def _r(x, d=1):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), d)


def measured_interchange(f: ons.Fetcher, date: str) -> dict[str, list[float]]:
    raw = ons.read_any(f.get(ons.interchange_path(int(date[:4])), max_age_s=6 * 3600))
    t = pd.to_datetime(raw["din_instante"])
    raw = raw[t.dt.strftime("%Y-%m-%d") == date].assign(h=t.dt.hour, v=lambda x: ons.num(x["val_intercambiomwmed"]))
    raw["o"] = raw["id_subsistema_origem"].astype(str).str.strip()
    raw["d"] = raw["id_subsistema_destino"].astype(str).str.strip()
    out = {}
    for pair in PAIR_LABEL:
        o, d = pair.split("-")
        fwd = raw[(raw.o == o) & (raw.d == d)].groupby("h")["v"].sum().reindex(range(24))
        rev = raw[(raw.o == d) & (raw.d == o)].groupby("h")["v"].sum().reindex(range(24))
        if fwd.isna().all() and rev.isna().all():
            continue
        out[pair] = (fwd.fillna(0) - rev.fillna(0)).tolist()
    return out


def build(m: GridModel, d: Dispatch, r: FlowResult, f: ons.Fetcher, meta: dict) -> dict:
    real = measured_interchange(f, d.date)
    inter = []
    for pair, label in PAIR_LABEL.items():
        mod = np.array(r.interchange.get(pair, [np.nan] * 24))
        rv = np.array(real.get(pair, [np.nan] * 24), dtype=float)
        ok = np.isfinite(mod) & np.isfinite(rv)
        mae = float(np.mean(np.abs(mod[ok] - rv[ok]))) if ok.any() else None
        scale = float(np.mean(np.abs(rv[ok]))) if ok.any() else None
        rel = mae / scale if mae is not None and scale and scale > 50 else None
        corr = float(np.corrcoef(mod[ok], rv[ok])[0, 1]) if ok.sum() > 3 and np.std(rv[ok]) > 1 and np.std(mod[ok]) > 1 else None
        status = None if rel is None else ("bom" if rel <= GOOD else "atencao" if rel <= WARN else "ruim")
        inter.append({"par": pair, "nome": label, "modelo": [_r(x, 0) for x in mod], "real": [_r(x, 0) for x in rv],
                      "mae_mw": _r(mae, 0), "erro_rel": _r(rel, 3), "correlacao": _r(corr, 3), "status": status})

    # ---- linhas: mapa (todas com coordenada) e as mais carregadas com a série do dia
    info = m.lines.reindex(r.line_loading.index)
    pos = m.buses.set_index("pp")[["lat", "lon", "nome", "sub"]]
    fb, tb = m.net.line.from_bus, m.net.line.to_bus
    mx = r.line_loading.max(axis=1)
    hmax = r.line_loading.idxmax(axis=1)
    lines = []
    for idx in r.line_loading.index:
        a, b = pos.loc[fb[idx]], pos.loc[tb[idx]]
        if not (np.isfinite(a.lat) and np.isfinite(a.lon) and np.isfinite(b.lat) and np.isfinite(b.lon)):
            continue
        lines.append({"id": int(idx), "n": _short(info.at[idx, "nome"]), "kv": int(info.at[idx, "kv"]), "a": [_r(a.lat, 3), _r(a.lon, 3)], "b": [_r(b.lat, 3), _r(b.lon, 3)],
                      "max": _r(mx[idx], 0) if np.isfinite(mx[idx]) else None})
    known = mx[np.isfinite(mx)].sort_values(ascending=False)
    top = []
    for idx in known.index[:30]:
        top.append({"id": int(idx), "nome": _name(info.at[idx, "nome"]), "kv": int(info.at[idx, "kv"]),
                    "cap_mva": _r(info.at[idx, "cap_mva"], 0), "subs": [info.at[idx, "sub_de"], info.at[idx, "sub_para"]],
                    "max": _r(mx[idx], 1), "hora_max": int(hmax[idx]),
                    "carregamento": [_r(x, 1) for x in r.line_loading.loc[idx]], "mw": [_r(x, 0) for x in r.line_p.loc[idx]]})
    tr_mx = r.trafo_loading.max(axis=1).sort_values(ascending=False)
    ti = m.trafos.reindex(tr_mx.index)
    top_tr = [{"id": int(i), "estacao": ti.at[i, "estacao"], "kv": f"{_r(ti.at[i, 'kv_hv'], 0):g}/{_r(ti.at[i, 'kv_lv'], 0):g}", "mva": _r(ti.at[i, "mva"], 0),
               "max": _r(tr_mx[i], 1)} for i in tr_mx.index[:15]]

    ok_n1 = [x for x in r.n1 if x.get("convergiu")]
    n1_top = [{"fora": _name(m.lines.at[x["fora"], "nome"]), "pior": _name(m.lines.at[x["pior"], "nome"]),
               "carregamento": _r(x["carregamento"], 1), "cap_curta_mva": _r(m.lines.at[x["pior"], "cap_curta"], 0),
               "sem_atendimento": x.get("sem_atendimento", 0)} for x in ok_n1[:20]]
    # contingências em que o fluxo não fecha: colapso de tensão de verdade ou limite do modelo
    n1_fail = [_name(m.lines.at[x["fora"], "nome"]) for x in r.n1 if not x.get("convergiu")][:10]

    plants = d.plants.assign(MWmed=d.plants["val_geracao"] / 24)
    grid_plants = plants[~plants["metodo"].isin(["embutida", "elo CC"])]
    unmatched = plants[plants["metodo"] == "sem barra"].sort_values("MWmed", ascending=False)
    vm = None
    if hasattr(m.net, "res_bus") and len(m.net.res_bus):
        v = m.net.res_bus["vm_pu"].dropna()
        vm = {"hora": r.check.get("hora"), "faixa_090_110": _r(float(((v >= 0.9) & (v <= 1.1)).mean()), 3), "min": _r(v.min(), 3), "max": _r(v.max(), 3)}

    by_method = plants.groupby("metodo")["MWmed"].sum()
    return {
        "v": VERSION,
        "date": d.date,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "hours": d.hours,
        "peakHour": r.check.get("hora"),
        "solver": meta.get("solver", {}),
        "model": {
            **{k: v for k, v in m.stats.items()},
            "barras_de_carga": d.stats["barras_de_carga"], "barras_com_geracao": d.stats["barras_com_geracao"],
            "compensadores": d.stats.get("compensadores_casados"), "compensadores_cadastro": d.stats.get("compensadores_cadastro"),
            "elos_cc_barras": [int(b) for b in d.hvdc.index],
        },
        "assumptions": [
            f"Transformadores com reatância de {TRAFO_VK_PERCENT:g}% na base do próprio equipamento (o cadastro do ONS não publica a impedância).",
            "Compensação série das linhas não está no cadastro: as interligações Norte–Sul aparecem mais 'pesadas' que na realidade.",
            f"Carga de cada subsistema (balanço horário do ONS, já com as perdas) rateada pela potência dos transformadores que descem para 34,5–138 kV; as perdas calculadas pelo modelo são descontadas.",
            "Geração distribuída, pequenas usinas e usinas sem barra no cadastro abatem a carga do próprio estado.",
            f"Usinas a partir de {PV_MIN_MW:g} MW e compensadores síncronos/estáticos controlam a tensão em 1,0 pu; reatores e capacitores manobráveis não entram.",
            "Elos de corrente contínua e conversoras pelos valores programados do ONS (média das meias horas); defasadores de Angra e Porto Colômbia como transformadores comuns.",
            f"Barra de referência: Itaipu 60 Hz 500 kV (barra {SLACK_BUS}); classes de 500 e 525 kV na mesma base ({', '.join(f'{k:g}→{v:g}' for k, v in BASE_KV.items())} kV).",
        ],
        "validation": {
            "converged": int(sum(r.converged)), "hours": len(r.converged),
            "pandapower": {k: (_r(v, 9) if isinstance(v, float) else v) for k, v in r.check.items()},
            "slack_mw": {"min": _r(min(r.slack_mw), 0), "mean": _r(float(np.mean(r.slack_mw)), 0), "max": _r(max(r.slack_mw), 0)},
            "carga_media_mw": _r(d.stats["carga_mwh"] / 24, 0),
            "perdas_media_mw": _r(float(np.mean(r.losses_mw)), 0),
            "perdas_pct": _r(100 * float(np.mean(r.losses_mw)) / (d.stats["carga_mwh"] / 24), 2),
            "cobertura_rede_basica": _r(1 - unmatched["MWmed"].sum() / max(1.0, grid_plants["MWmed"].sum()), 4),
            "geracao_mwmed_por_metodo": {k: _r(v, 0) for k, v in by_method.items()},
            "usinas_sem_barra": [{"nome": x.nom_usina, "uf": x.id_estado, "mwmed": _r(x.MWmed, 0)} for x in unmatched.head(10).itertuples()],
            "intercambio": inter,
            "tensao": vm,
        },
        "lines": lines,
        "topLines": top,
        "topTrafos": top_tr,
        "n1": {**r.n1_stats, "criterio": f"linhas de {N1_MIN_KV:g} kV ou mais e interligações entre subsistemas; pós-contingência contra a capacidade de curta duração", "top": n1_top, "nao_convergiram": n1_fail},
        "hvdc": {"xingu_sudeste_mw": [_r(x, 0) for x in r.hvdc_n_se]},
        "sources": [{"name": s.name, "url": s.url, "modified": s.modified} for s in _unique_sources(f)],
    }


def _unique_sources(f: ons.Fetcher):
    seen = {}
    for s in f.sources:
        seen[s.url] = s
    return list(seen.values())
