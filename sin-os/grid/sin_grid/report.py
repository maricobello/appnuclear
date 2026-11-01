"""Relatório do dia (JSON que o SIN OS mostra na tela Rede): rede, fluxos, N-1 e a validação."""

from __future__ import annotations

import datetime as dt
import math
import re

import numpy as np
import pandas as pd

from . import ons
from .dispatch import Dispatch
from . import shortcircuit as scm
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


#: barras abaixo disso ficam fora do curto: o modelo não tem a rede de distribuição, e o valor nelas é só
#: o do transformador presumido (dezenas de kA sem significado físico)
SC_MIN_KV = 69.0
SUBSYSTEMS = ("N", "NE", "SE", "S")
#: barras de fronteira: como a interligação com o país vizinho afeta o curto
BORDER = {
    "UY": ("Uruguai", "lado de 60 Hz das conversoras de frequência (Rivera, Melo): o Uruguai, em 50 Hz, não contribui para o curto, então o valor vale como está"),
    "AR": ("Argentina", "lado de 60 Hz das conversoras de Garabi: a Argentina, em 50 Hz, não contribui para o curto, então o valor vale como está"),
    "PY": ("Paraguai", "o lado de 50 Hz de Itaipu e a rede paraguaia ficam fora do modelo"),
    "VE": ("Venezuela", "ligação em corrente alternada com a Venezuela: com ela em serviço, a rede venezuelana soma ao curto, e ela não está no modelo"),
}


def _g(x: float) -> str:
    """Número curto com vírgula decimal: 0.25 → '0,25'."""
    return f"{x:g}".replace(".", ",")


def _sk(x: float) -> float:
    return round(float(x), 1) if x < 10 else round(float(x))


def short_circuit(m: GridModel, sc: scm.ShortCircuitResult) -> dict:
    """Por barra (69 kV ou mais): [ANAREDE, nome, kV nominal, UF, subsistema ou país, lat, lon, S''k mín (MVA),
    hora, S''k máx (MVA), hora, MW eólicos/solares já ligados vistos da barra (região: fator de interação ≥ 0,7
    e a própria subestação), S''k mín com todos os compensadores ligados (MVA), os mesmos MW só da subestação]."""
    info = m.buses.reset_index().set_index("pp").reindex(m.net.bus.index)
    kv = m.net.bus.vn_kv.to_numpy()
    kv_nom = info["kv_nom"].to_numpy(dtype=float) if "kv_nom" in info else kv
    sk_min, h_min = sc.sk_min.min(axis=1), sc.sk_min.argmin(axis=1)
    sk_max, h_max = sc.sk_max.max(axis=1), sc.sk_max.argmax(axis=1)
    ibr_ok = sc.ibr_eq_mw is not None
    ibr = sc.ibr_eq_mw if ibr_ok else np.zeros(len(kv))
    ibr_st = sc.ibr_station_mw if sc.ibr_station_mw is not None else ibr
    sk_all = sc.sk_min_all if sc.sk_min_all is not None else sk_min
    rows = []
    countries: set[str] = set()
    for i in range(len(kv)):
        if kv[i] < SC_MIN_KV or not (sk_min[i] > 0 and sk_max[i] > 0):
            continue
        b = info.iloc[i]
        nome = " ".join(str(b["nome"]).split())[:80] if isinstance(b["nome"], str) and b["nome"].strip() else f"barra {int(b['anarede'])}"
        uf = b["uf"] if isinstance(b["uf"], str) else None
        sub = b["sub"] if isinstance(b["sub"], str) else None
        if sub and sub not in SUBSYSTEMS:
            countries.add(sub)
        v = kv_nom[i] if np.isfinite(kv_nom[i]) and kv_nom[i] > 0 else kv[i]
        rows.append([int(b["anarede"]), nome, _r(v, 1), uf, sub, _r(b["lat"], 3), _r(b["lon"], 3), _sk(sk_min[i]), int(h_min[i]),
                     _sk(sk_max[i]), int(h_max[i]), round(float(ibr[i])), _sk(max(sk_all[i], sk_min[i])), round(float(ibr_st[i]))])
    ck = sc.check
    st = sc.stats
    x = scm.X_SUBTRANSIENT
    if st.get("disponibilidade_sincronizada"):
        units = (f"Potência síncrona de cada usina: a disponibilidade sincronizada que o ONS publica por usina e hora "
                 f"({st.get('usinas_pela_disponibilidade', 0)} usinas, {_g(round(100 * st.get('geracao_sincrona_com_disponibilidade', 0)))}% da geração "
                 f"síncrona do dia; pode incluir unidades girando como compensador), em unidades inteiras e nunca abaixo do que a geração da hora "
                 f"exige. Nas outras {st.get('usinas_pela_geracao', 0)}, as unidades mínimas para a geração, cada uma a até "
                 f"{_g(100 * scm.UNIT_LOADING)}% da potência efetiva; geração residual (abaixo de {_g(100 * scm.RESIDUAL_FRACTION)}% de uma unidade) "
                 f"não liga unidade.")
    else:
        units = (f"Sem a disponibilidade sincronizada do ONS neste dia: em cada usina, as unidades mínimas para a geração da hora, cada uma "
                 f"a até {_g(100 * scm.UNIT_LOADING)}% da potência efetiva (estimativa conservadora); geração residual não liga unidade.")
    premissas = [
        f"Reatância subtransitória típica: hidrelétrica {_g(x['HIDROELÉTRICA'])}, térmica {_g(x['TÉRMICA'])} e nuclear {_g(x['NUCLEAR'])} pu, mais "
        f"{_g(scm.X_STEP_UP)} pu do transformador elevador, na potência da máquina (cos φ {_g(scm.COS_PHI)}); compensador síncrono {_g(scm.X_SYNC_COMPENSATOR)} pu.",
        units,
        "Compensadores síncronos do cadastro com a potência da faixa do equipamento, na barra da tensão escrita no código do equipamento; "
        "sem ela, na do terminal do elo CC da subestação ou na de maior tensão. No mínimo, cada barra perde o compensador cuja saída mais "
        f"derruba o curto dela (critério N-1, entre os maiores de {st.get('compensadores_n1', 0)} subestações).",
        "Ficam fora eólicas, solares e baterias (o inversor limita a corrente), elos CC e Itaipu 50 Hz; também as pequenas usinas embutidas na "
        "distribuição e as que não têm barra no modelo, o que deixa o curto calculado de 2% a 5% abaixo do real na mediana.",
        "Mínimo com c = 1,0, sem K_T e com a resistência das linhas a 80 °C. Máximo com c = 1,1 (limitado a Um/Un), K_T nos transformadores e "
        "linhas a 20 °C, mas com o despacho do dia: não serve para superação de disjuntor, que pede todas as unidades ligadas e os fatores K_G/K_S. "
        "A rede de 525 kV do Sul, com a base de 500 kV no cadastro, entra com Un = 525 kV.",
        f"Transformadores com a reatância presumida do modelo ({_g(TRAFO_VK_PERCENT)}%): em 138 kV o curto depende dela (±12% entre 10% e 14%); "
        "em 230 a 500 kV, ±2% a 3%. Compensação série das linhas fora do modelo.",
        "Incerteza típica do curto mínimo: −5% a +10% em 230 a 500 kV e ±12% em 138 kV. Perto de hidrelétricas sem a disponibilidade "
        "sincronizada, unidades girando como compensador podem somar mais.",
        "SCR composto: o curto mínimo dividido pela potência nova somada à eólica e solar já ligada (potência instalada do cadastro do ONS), "
        f"cada parque pesado pelo fator de interação |Z_jk/Z_kk| da CIGRE: os da própria subestação e os das vizinhas com fator de "
        f"{_g(scm.IF_REGIONAL)} ou mais. Somar os fatores pequenos de todo o sistema não diria nada; o estudo de acesso do ONS faz a conta completa.",
    ]
    fronteira = {c: {"pais": BORDER.get(c, (c, ""))[0], "nota": BORDER.get(c, (c, "a rede do país vizinho fica fora do modelo"))[1]} for c in sorted(countries)}
    for c, v in fronteira.items():
        premissas.append(f"Fronteira com {v['pais']}: {v['nota']}.")
    return {
        "metodo": "IEC 60909, fonte de tensão equivalente: S''k = c·Un²/|Zth| (c = 1,0 no mínimo; 1,1 no máximo, limitado a Um/Un), "
                  "com as máquinas síncronas ligadas em cada hora",
        "premissas": premissas,
        "horaFraca": sc.weak_hour,
        "horaForte": sc.strong_hour,
        "mvaSincrono": [_r(v, 0) for v in sc.online_mva],
        "fontes": {k: v for k, v in st.items() if k in ("usinas", "usinas_pela_disponibilidade", "geracao_sincrona_com_disponibilidade", "compensadores",
                                                       "compensadores_n1", "usinas_sem_capacidade_no_cadastro", "mva_medio_por_tipo")},
        "inversores": ibr_ok,
        "validacao": {"horas": [int(h) for h in ck.get("horas", [])], "dif_rel_max": float(ck["dif_rel_max"]) if ck.get("dif_rel_max") is not None else None,
                      "ok": bool(ck.get("ok")), **({"erro": ck["erro"]} if ck.get("erro") else {})},
        "fronteira": fronteira,
        "barras": rows,
    }


def build(m: GridModel, d: Dispatch, r: FlowResult, f: ons.Fetcher, meta: dict, sc: scm.ShortCircuitResult | None = None) -> dict:
    curto = None
    if sc is not None:
        try:  # a seção de curto nunca derruba o relatório do fluxo
            curto = short_circuit(m, sc)
        except Exception as e:  # noqa: BLE001
            print(f"::warning::seção de curto-circuito fora do relatório: {type(e).__name__}: {e}", flush=True)
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
        **({"curto": curto} if curto is not None else {}),
        "sources": [{"name": s.name, "url": s.url, "modified": s.modified} for s in _unique_sources(f)],
    }


def _unique_sources(f: ons.Fetcher):
    seen = {}
    for s in f.sources:
        seen[s.url] = s
    return list(seen.values())
