"""Rede pandapower do SIN a partir dos cadastros do ONS (rede de operação: rede básica + complementar).

Conversões (convenção ANAREDE usada pelo ONS no cadastro de linhas):
- resistência e reatância em % na base de 100 MVA: Z[Ω] = (valor / 100) · kV² / 100;
- shunt = potência reativa total de carregamento da linha em Mvar na tensão nominal:
  B[S] = Mvar / kV², C = B / (2π·60);
- capacidade operativa de longa duração em MVA → corrente máxima I[kA] = MVA / (√3 · kV).

O cadastro de transformadores não traz impedância: usa-se TRAFO_VK_PERCENT (12% na base do próprio
transformador, valor típico de autotransformadores de rede básica) e isso aparece no relatório como
premissa. Elos de corrente contínua não viram ramos AC: entram como injeções nas barras conversoras
(ver dispatch.HVDC_TERMINALS).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import pandapower as pp
import pandapower.toolbox as pptb
from pandapower.topology import connected_components, create_nxgraph

from . import ons
from .match import BusIndex, key

TRAFO_VK_PERCENT = 12.0
#: classes de tensão que dividem a mesma base no ANAREDE (a rede de 525 kV do Sul liga direto na de 500 kV)
BASE_KV = {525.0: 500.0}
TRAFO_VKR_PERCENT = 0.3
F_HZ = 60.0


def z_ohm(pct: float, kv: float) -> float:
    return pct / 100.0 * kv * kv / 100.0


def c_nf(mvar: float, kv: float) -> float:
    b = mvar / (kv * kv)
    return b / (2 * math.pi * F_HZ) * 1e9


def i_ka(mva: float, kv: float) -> float:
    return mva / (math.sqrt(3) * kv)


def base_kv(v: float) -> float:
    return BASE_KV.get(float(v), float(v))


def _num(x) -> float:
    try:
        v = float(str(x).replace(",", "."))
        return v if math.isfinite(v) else float("nan")
    except (TypeError, ValueError):
        return float("nan")


@dataclass
class GridModel:
    net: pp.pandapowerNet
    #: por barra ANAREDE: índice pandapower, tensão, subsistema, estado, nome, coordenadas
    buses: pd.DataFrame
    #: por linha pandapower: código ONS, nome, capacidade, subsistemas das pontas
    lines: pd.DataFrame
    trafos: pd.DataFrame
    index: BusIndex
    stats: dict = field(default_factory=dict)

    def pp_bus(self, anarede: int) -> int | None:
        r = self.buses.index.get_indexer([anarede])[0]
        return None if r < 0 else int(self.buses.iloc[r]["pp"])


def build(regs: dict[str, pd.DataFrame], on: str) -> GridModel:
    lines = ons.active(regs["linhas"], on)
    trafos = ons.active(regs["transformadores"], on)
    subs = regs["subestacoes"]
    stats: dict = {"linhas_cadastro": int(len(lines)), "trafos_cadastro": int(len(trafos))}

    ac = lines[(lines["nom_tipolinha"] != "LINHA DC") & lines["num_barra_de"].notna() & lines["num_barra_para"].notna()].copy()
    stats["linhas_cc"] = int((lines["nom_tipolinha"] == "LINHA DC").sum())
    stats["linhas_sem_barra"] = int(len(lines) - len(ac) - stats["linhas_cc"])
    ac["b_de"] = ac["num_barra_de"].map(_num).astype(int)
    ac["b_para"] = ac["num_barra_para"].map(_num).astype(int)
    ac["kv"] = ac["val_niveltensao_kv"].map(_num)
    tr = trafos[trafos["num_barra_primario"].notna() & trafos["num_barra_secundario"].notna()].copy()
    stats["trafos_sem_barra"] = int(len(trafos) - len(tr))
    tr["b_p"] = tr["num_barra_primario"].map(_num).astype(int)
    tr["b_s"] = tr["num_barra_secundario"].map(_num).astype(int)
    tr["kv_p"] = tr["val_tensaoprimario_kv"].map(_num)
    tr["kv_s"] = tr["val_tensaosecundario_kv"].map(_num)
    tr = tr[(tr["b_p"] != tr["b_s"]) & (tr["kv_p"] > 0) & (tr["kv_s"] > 0)]

    # ---- barras: tensão pela linha (a mais confiável), senão pelo transformador
    kv: dict[int, float] = {}
    for b, v in list(zip(ac["b_de"], ac["kv"])) + list(zip(ac["b_para"], ac["kv"])):
        kv.setdefault(int(b), base_kv(v))
    for b, v in list(zip(tr["b_p"], tr["kv_p"])) + list(zip(tr["b_s"], tr["kv_s"])):
        kv.setdefault(int(b), base_kv(v))

    s = subs[subs["num_barra"].notna() & (subs["num_barra"] != "")].copy()
    s["bus"] = s["num_barra"].map(_num).astype(int)
    s = s.drop_duplicates("bus").set_index("bus")
    # estação → coordenadas e subsistema, para barras que só aparecem nos transformadores
    st_pos = subs.assign(k=subs["nom_subestacao"].map(key)).drop_duplicates("k").set_index("k")

    info = []
    for b, v in kv.items():
        row = {"anarede": b, "kv": v, "sub": None, "uf": None, "nome": None, "lat": np.nan, "lon": np.nan}
        if b in s.index:
            r = s.loc[b]
            row.update(sub=r["id_subsistema"], uf=r["id_estado"], nome=r["nom_subestacao"], lat=_num(r["val_latitude"]), lon=_num(r["val_longitude"]))
        info.append(row)
    buses = pd.DataFrame(info).set_index("anarede")

    def fill_from(df: pd.DataFrame, bcol: str, subcol: str, ufcol: str, namecol: str):
        for r in df[[bcol, subcol, ufcol, namecol]].itertuples(index=False):
            b = int(r[0])
            if b in buses.index and buses.at[b, "sub"] is None:
                buses.at[b, "sub"], buses.at[b, "uf"], buses.at[b, "nome"] = r[1], r[2], r[3]
                k = key(r[3])
                if k in st_pos.index:
                    buses.at[b, "lat"], buses.at[b, "lon"] = _num(st_pos.at[k, "val_latitude"]), _num(st_pos.at[k, "val_longitude"])

    fill_from(ac, "b_de", "id_subsistema_terminalde", "id_estado_terminalde", "nom_subestacao_de")
    fill_from(ac, "b_para", "id_subsistema_terminalpara", "id_estado_terminalpara", "nom_subestacao_para")
    fill_from(tr, "b_p", "id_subsistema", "id_estado", "nom_subestacao")
    fill_from(tr, "b_s", "id_subsistema", "id_estado", "nom_subestacao")

    net = pp.create_empty_network(sn_mva=100.0, f_hz=F_HZ)
    pp_idx = pp.create_buses(net, len(buses), vn_kv=buses["kv"].to_numpy(), name=[str(x) for x in buses.index])
    buses["pp"] = pp_idx
    at = dict(zip(buses.index, pp_idx))

    # ---- linhas AC
    rows = []
    for r in ac.itertuples():
        v = float(buses.at[int(r.b_de), "kv"])  # base da barra: em p.u. a linha fica exatamente % / 100
        length = _num(r.val_comprimento)
        length = length if length and length > 0 else 1.0
        rp, xp, q = _num(r.val_resistencia), _num(r.val_reatancia), _num(r.val_shunt)
        if not (xp > 0):
            continue
        cap = next((c for c in (_num(r.val_capacoperlongasemlimit), _num(r.val_capacoperlongacomlimit), _num(r.val_capacopercurtasemlimit)) if c and c > 0), float("nan"))
        # pós-contingência vale a capacidade de curta duração (emergência); sem ela, a de longa
        cap_c = next((c for c in (_num(r.val_capacopercurtasemlimit), _num(r.val_capacopercurtacomlimit)) if c and c > 0), cap)
        rows.append((r, v, length, rp if rp > 0 else 0.0, xp, q if q > 0 else 0.0, cap, cap_c))
    stats["linhas_sem_impedancia"] = int(len(ac) - len(rows))
    li = []
    for r, v, length, rp, xp, q, cap, cap_c in rows:
        idx = pp.create_line_from_parameters(
            net, at[r.b_de], at[r.b_para], length_km=length,
            r_ohm_per_km=z_ohm(rp, v) / length, x_ohm_per_km=z_ohm(xp, v) / length,
            c_nf_per_km=c_nf(q, v) / length, max_i_ka=i_ka(cap, v) if cap == cap else 99.0,
            name=r.cod_equipamento,
        )
        li.append({"pp": idx, "cod": r.cod_equipamento, "nome": r.nom_linhadetransmissao, "kv": v, "cap_mva": cap, "cap_curta": cap_c,
                   "de": int(r.b_de), "para": int(r.b_para), "sub_de": r.id_subsistema_terminalde, "sub_para": r.id_subsistema_terminalpara,
                   "rede": r.nom_tipoderede})
    line_info = pd.DataFrame(li).set_index("pp")

    # ---- transformadores (impedância típica, ver TRAFO_VK_PERCENT)
    ti = []
    for r in tr.itertuples():
        hv, lv = (r.b_p, r.b_s) if r.kv_p >= r.kv_s else (r.b_s, r.b_p)
        vh, vl = max(r.kv_p, r.kv_s), min(r.kv_p, r.kv_s)
        sn = _num(r.val_potencianominal_mva)
        sn = sn if sn and sn > 0 else 100.0
        idx = pp.create_transformer_from_parameters(
            net, at[hv], at[lv], sn_mva=sn, vn_hv_kv=float(buses.at[hv, "kv"]), vn_lv_kv=float(buses.at[lv, "kv"]),
            vkr_percent=TRAFO_VKR_PERCENT, vk_percent=TRAFO_VK_PERCENT, pfe_kw=0.0, i0_percent=0.0, name=r.cod_equipamento,
        )
        ti.append({"pp": idx, "cod": r.cod_equipamento, "sub": r.id_subsistema, "uf": r.id_estado, "estacao": r.nom_subestacao,
                   "hv": int(hv), "lv": int(lv), "kv_hv": vh, "kv_lv": vl, "mva": sn})
    trafo_info = pd.DataFrame(ti).set_index("pp")

    # ---- ilhas: fica a maior componente conexa (o SIN interligado)
    g = create_nxgraph(net, respect_switches=False)
    comps = sorted(connected_components(g), key=len, reverse=True)
    main = set(comps[0]) if comps else set()
    drop = [b for b in net.bus.index if b not in main]
    stats["barras"] = int(len(net.bus))
    stats["ilhas_descartadas"] = int(len(comps) - 1)
    stats["barras_fora_da_ilha_principal"] = int(len(drop))
    if drop:
        pptb.drop_buses(net, drop)
        buses = buses[buses["pp"].isin(net.bus.index)]
        line_info = line_info[line_info.index.isin(net.line.index)]
        trafo_info = trafo_info[trafo_info.index.isin(net.trafo.index)]
    stats["linhas"] = int(len(net.line))
    stats["trafos"] = int(len(net.trafo))
    stats["barras_ilha_principal"] = int(len(net.bus))
    stats["barras_com_coordenada"] = int(buses["lat"].notna().sum())
    stats["linhas_com_capacidade"] = int(line_info["cap_mva"].notna().sum())

    index = BusIndex(subs, set(int(b) for b in buses.index))

    return GridModel(net=net, buses=buses, lines=line_info, trafos=trafo_info, index=index, stats=stats)
