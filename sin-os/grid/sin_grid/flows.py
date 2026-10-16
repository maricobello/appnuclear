"""Fluxo de potência AC do dia (24 h em lote) e N-1 da hora de maior carga, com o solver C++ do p3s.

Os fluxos nos ramos são calculados aqui a partir das tensões que o p3s devolve, com o mesmo modelo π
que o solver usa (impedância série e carregamento shunt da linha; transformador com a impedância
série e relação nominal). Uma hora é refeita no pandapower (runpp) e comparada: a diferença tem de
ficar abaixo de PANDAPOWER_TOL_MW, senão o relatório marca a rodada como não confiável.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import pandapower as pp
import pandapower.toolbox as pptb

from .dispatch import SUBS, Dispatch
from .model import GridModel

#: geradores acima disso controlam tensão (PV); abaixo, injeção fixa (PQ)
PV_MIN_MW = 20.0
LOAD_TAN_PHI = math.tan(math.acos(0.97))
PANDAPOWER_TOL_MW = 1.0
#: N-1 nas linhas de 440 kV ou mais e em todas as interligações entre subsistemas
N1_MIN_KV = 440.0
SLACK_BUS = 1106  # Itaipu 60 Hz 500 kV


@dataclass
class FlowResult:
    hours: list[str]
    converged: list[bool]
    iterations: list[int]
    #: MW de origem → destino em cada linha (linhas × horas), e carregamento em % da capacidade longa
    line_p: pd.DataFrame
    line_loading: pd.DataFrame
    trafo_loading: pd.DataFrame
    slack_mw: list[float]
    losses_mw: list[float]
    interchange: dict[str, list[float]]
    hvdc_n_se: list[float]
    check: dict
    n1: list[dict] = field(default_factory=list)
    n1_stats: dict = field(default_factory=dict)


def _continuous(m: GridModel) -> None:
    """Índices de barra contínuos (0..n−1): o p3s devolve tensões na ordem posicional."""
    old = m.net.bus.index.to_numpy()
    pptb.create_continuous_bus_index(m.net, start=0)
    remap = dict(zip(old, range(len(old))))
    m.buses["pp"] = m.buses["pp"].map(remap)


def attach(m: GridModel, d: Dispatch) -> dict[str, np.ndarray]:
    """Cria geradores, cargas e injeções dos elos no modelo; devolve as séries para o p3s."""
    net = m.net
    _continuous(m)
    pp_of = m.buses["pp"].to_dict()
    slack = SLACK_BUS if SLACK_BUS in pp_of else int(d.gen.sum(axis=1).idxmax())
    pp.create_ext_grid(net, pp_of[slack], vm_pu=1.0, va_degree=0.0, name="slack")

    gen = d.gen.drop(index=[slack], errors="ignore")
    big = gen[gen.max(axis=1) >= PV_MIN_MW]
    small = gen[gen.max(axis=1) < PV_MIN_MW]
    for b, row in big.iterrows():
        pp.create_gen(net, pp_of[b], p_mw=float(row[0]), vm_pu=1.0, name=str(b))
    sgen_rows = []
    for b, row in small.iterrows():
        pp.create_sgen(net, pp_of[b], p_mw=float(row[0]), q_mvar=0.0, name=f"g{b}")
        sgen_rows.append(row.to_numpy())
    # a geração da barra de referência sai do total: o slack a supre (e absorve o desequilíbrio)
    slack_gen = d.gen.loc[slack].to_numpy() if slack in d.gen.index else np.zeros(24)
    for b, row in d.hvdc.iterrows():
        pp.create_sgen(net, pp_of[int(b)], p_mw=float(row[0]), q_mvar=0.0, name=f"cc{b}")
        sgen_rows.append(row.to_numpy())
    # compensadores síncronos e estáticos do cadastro do ONS: só reativo, segurando a tensão da barra
    for b in d.compensators:
        if b in pp_of and pp_of[b] not in set(net.gen.bus) and pp_of[b] != pp_of[slack]:
            pp.create_gen(net, pp_of[b], p_mw=0.0, vm_pu=1.0, name=f"cs{b}")
            big = pd.concat([big, pd.DataFrame([np.zeros(24)], index=[f"cs{b}"], columns=big.columns)])
    loads = d.load
    for b, row in loads.iterrows():
        p0 = float(row[0])
        pp.create_load(net, pp_of[int(b)], p_mw=p0, q_mvar=max(p0, 0.0) * LOAD_TAN_PHI, name=f"c{b}")
    lp = loads.to_numpy()
    return {
        "slack_bus": slack,
        "slack_gen": slack_gen,
        "ts": {
            ("gen", "p_mw"): big.to_numpy(dtype=float),
            ("sgen", "p_mw"): np.array(sgen_rows, dtype=float).reshape(-1, 24),
            ("load", "p_mw"): lp.astype(float),
            ("load", "q_mvar"): np.maximum(lp, 0.0).astype(float) * LOAD_TAN_PHI,
        },
    }


def branch_params(net: pp.pandapowerNet) -> dict[str, np.ndarray]:
    """Parâmetros em p.u. na base de 100 MVA, iguais aos que o solver usa."""
    sb = net.sn_mva
    L = net.line
    vn = net.bus.loc[L.from_bus, "vn_kv"].to_numpy()
    zb = vn * vn / sb
    z_line = (L.r_ohm_per_km.to_numpy() + 1j * L.x_ohm_per_km.to_numpy()) * L.length_km.to_numpy() / zb
    b_line = 2 * math.pi * net.f_hz * L.c_nf_per_km.to_numpy() * 1e-9 * L.length_km.to_numpy() * zb
    T = net.trafo
    vk, vkr = T.vk_percent.to_numpy() / 100, T.vkr_percent.to_numpy() / 100
    z_tr = (vkr + 1j * np.sqrt(np.maximum(vk * vk - vkr * vkr, 1e-12))) * sb / T.sn_mva.to_numpy()
    return {
        "lf": L.from_bus.to_numpy(), "lt": L.to_bus.to_numpy(), "zl": z_line, "bl": b_line,
        "th": T.hv_bus.to_numpy(), "tl": T.lv_bus.to_numpy(), "zt": z_tr,
    }


def branch_flows(bp: dict[str, np.ndarray], V: np.ndarray, sb: float = 100.0):
    """V: (n_bus, T) complexo. Devolve S de origem e destino das linhas e do lado de alta dos trafos (MVA)."""
    Vf, Vt = V[bp["lf"]], V[bp["lt"]]
    y = (1 / bp["zl"])[:, None]
    ysh = (1j * bp["bl"] / 2)[:, None]
    If = (Vf - Vt) * y + Vf * ysh
    It = (Vt - Vf) * y + Vt * ysh
    Sf, St = Vf * np.conj(If) * sb, Vt * np.conj(It) * sb
    Vh, Vl = V[bp["th"]], V[bp["tl"]]
    Ih = (Vh - Vl) / bp["zt"][:, None]
    Sh = Vh * np.conj(Ih) * sb
    Sl = Vl * np.conj(-Ih) * sb
    return Sf, St, Sh, Sl


def run(m: GridModel, d: Dispatch, n_threads: int = 0, with_n1: bool = True) -> FlowResult:
    from p3s.calculateTrafoTapTable import calculate_trafo_characteristic
    from p3s.NewtonPowerflowCpp import NewtonPowerflow as Cpp

    a = attach(m, d)
    net = m.net
    calculate_trafo_characteristic(net, inplace=True)
    bp = branch_params(net)
    sub_of = m.buses.set_index("pp")["sub"].to_dict()
    lf_sub = np.array([sub_of.get(b) for b in bp["lf"]])
    th_sub = np.array([sub_of.get(b) for b in bp["th"]])

    # A carga do ONS já contém as perdas da rede (carga = geração ± intercâmbio). 1ª passada mede as
    # perdas de cada subsistema; a 2ª desconta essas perdas das barras de carga do subsistema.
    V = Cpp(net).calculate_timeseries_cpp(net, a["ts"], n_threads=n_threads)
    Sf, St, Sh, Sl = branch_flows(bp, np.nan_to_num(V))
    loss_line, loss_tr = (Sf + St).real, (Sh + Sl).real
    load_sub = np.array([sub_of.get(b) for b in net.load.bus])
    lp = a["ts"][("load", "p_mw")]
    gross = np.where(lp > 0, lp, 0.0)
    for s_ in SUBS:
        loss_s = loss_line[lf_sub == s_].sum(axis=0) + loss_tr[th_sub == s_].sum(axis=0)
        rows = load_sub == s_
        tot = gross[rows].sum(axis=0)
        lp[rows] -= gross[rows] * np.where(tot > 0, loss_s / np.maximum(tot, 1e-9), 0.0)
    a["ts"][("load", "q_mvar")] = np.maximum(lp, 0.0) * LOAD_TAN_PHI
    net.load["p_mw"] = lp[:, 0]
    net.load["q_mvar"] = a["ts"][("load", "q_mvar")][:, 0]
    V = Cpp(net).calculate_timeseries_cpp(net, a["ts"], n_threads=n_threads)  # (n_bus, 24)
    ok = np.isfinite(V).all(axis=0)
    Sf, St, Sh, Sl = branch_flows(bp, np.nan_to_num(V))
    lines, trafos = m.lines, m.trafos
    cap = lines["cap_mva"].reindex(net.line.index).to_numpy()
    lmax = np.maximum(np.abs(Sf), np.abs(St))
    line_loading = pd.DataFrame(100 * lmax / cap[:, None], index=net.line.index)
    line_p = pd.DataFrame(Sf.real, index=net.line.index)
    tmva = net.trafo.sn_mva.to_numpy()
    trafo_loading = pd.DataFrame(100 * np.maximum(np.abs(Sh), np.abs(Sl)) / tmva[:, None], index=net.trafo.index)

    # injeção do slack = soma das potências que saem da barra de referência
    sl = int(m.buses.loc[a["slack_bus"], "pp"])
    out = np.zeros(V.shape[1], dtype=complex)
    out += Sf[bp["lf"] == sl].sum(axis=0) + St[bp["lt"] == sl].sum(axis=0)
    out += Sh[bp["th"] == sl].sum(axis=0) + Sl[bp["tl"] == sl].sum(axis=0)
    slack_mw = (out.real - a["slack_gen"]).tolist()  # além da geração da própria usina
    losses = (Sf + St).real.sum(axis=0) + (Sh + Sl).real.sum(axis=0)

    # intercâmbio entre subsistemas: soma dos fluxos AC nas linhas que cruzam a fronteira (+ elos CC)
    lt_sub = np.array([sub_of.get(b) for b in bp["lt"]])
    inter: dict[str, np.ndarray] = {}
    for o, dst in (("N", "NE"), ("N", "SE"), ("NE", "SE"), ("S", "SE")):
        fwd = (lf_sub == o) & (lt_sub == dst)
        rev = (lf_sub == dst) & (lt_sub == o)
        flow = Sf.real[fwd].sum(axis=0) - Sf.real[rev].sum(axis=0)
        # trafos na fronteira (raro)
        tl_sub = np.array([sub_of.get(b) for b in bp["tl"]])
        flow = flow + Sh.real[(th_sub == o) & (tl_sub == dst)].sum(axis=0) - Sh.real[(th_sub == dst) & (tl_sub == o)].sum(axis=0)
        inter[f"{o}-{dst}"] = flow
    # Belo Monte em CC: o que sai de Xingu (terminal 1, negativo) vai para o Sudeste
    hv = d.hvdc
    xingu = -hv.loc[8100].to_numpy() if 8100 in hv.index else np.zeros(24)
    inter["N-SE"] = inter["N-SE"] + xingu

    # ---- conferência no pandapower (hora de maior carga): mesmas injeções, solver de referência
    peak = int(d.load.sum(axis=0).idxmax())
    check = {"hora": peak}
    try:
        _set_hour(net, a, peak)
        pp.runpp(net, init="dc", tolerance_mva=1e-6, max_iteration=50, numba=False)
        diff = np.abs(net.res_line.p_from_mw.to_numpy() - Sf.real[:, peak])
        check.update(convergiu=True, dif_max_mw=float(np.nanmax(diff)), dif_media_mw=float(np.nanmean(diff)),
                     ok=bool(np.nanmax(diff) < PANDAPOWER_TOL_MW))
    except Exception as e:  # noqa: BLE001 — registra e segue
        check.update(convergiu=False, erro=str(e)[:200], ok=False)

    res = FlowResult(
        hours=d.hours, converged=ok.tolist(), iterations=[], line_p=line_p, line_loading=line_loading, trafo_loading=trafo_loading,
        slack_mw=[float(x) for x in slack_mw], losses_mw=[float(x) for x in losses],
        interchange={k: [float(x) for x in v] for k, v in inter.items()}, hvdc_n_se=[float(x) for x in xingu], check=check,
    )
    if with_n1:
        res.n1, res.n1_stats = n_minus_1(m, a, peak, n_threads)
    return res


def _set_hour(net: pp.pandapowerNet, a: dict, h: int) -> None:
    ts = a["ts"]
    net.gen["p_mw"] = ts[("gen", "p_mw")][:, h]
    net.sgen["p_mw"] = ts[("sgen", "p_mw")][:, h]
    net.load["p_mw"] = ts[("load", "p_mw")][:, h]
    net.load["q_mvar"] = ts[("load", "q_mvar")][:, h]


def n_minus_1(m: GridModel, a: dict, h: int, n_threads: int) -> tuple[list[dict], dict]:
    """Perda de cada linha monitorada na hora h; carregamento pós-contingência contra a capacidade de curta duração."""
    from p3s.contingency.solver_cpp import solve_contingencies_cpp

    net = m.net
    _set_hour(net, a, h)
    info = m.lines.reindex(net.line.index)
    sub_de, sub_para = info["sub_de"], info["sub_para"]
    watch = (info["kv"] >= N1_MIN_KV) | ((sub_de != sub_para) & sub_de.isin(SUBS) & sub_para.isin(SUBS))
    # o p3s trata todo valor não nulo como uma contingência (0 inclusive): fora da lista = NaN
    net.line["outage_group"] = np.where(watch, net.line.index + 1, np.nan)
    net.trafo["outage_group"] = np.nan
    r = solve_contingencies_cpp(net, reslack_islands=False, n_threads=n_threads, init="flat")
    bp = branch_params(net)
    Sf, St, _, _ = branch_flows(bp, np.nan_to_num(r.V))
    cap = info["cap_curta"].to_numpy() if "cap_curta" in info else info["cap_mva"].to_numpy()
    load = 100 * np.maximum(np.abs(Sf), np.abs(St)) / cap[:, None]
    out = []
    idx = net.line.index.to_numpy()  # os vetores de fluxo são posicionais; o grupo é o índice da linha + 1
    pos = {int(i): k for k, i in enumerate(idx)}
    groups = [int(g) - 1 for g in r.groups]
    for c, g in enumerate(groups):
        if not r.converged[c]:
            out.append({"fora": int(g), "convergiu": False})
            continue
        col = load[:, c].copy()
        col[pos[g]] = np.nan  # a própria linha fora
        if np.all(np.isnan(col)):
            continue
        j = int(np.nanargmax(col))
        out.append({"fora": int(g), "convergiu": True, "pior": int(idx[j]), "carregamento": float(col[j]),
                    "sem_atendimento": int((~r.served[:, c]).sum())})
    stats = {"hora": h, "contingencias": len(groups), "convergiram": int(np.sum(r.converged)),
             "com_sobrecarga": int(sum(1 for x in out if x.get("carregamento", 0) > 100))}
    out.sort(key=lambda x: -x.get("carregamento", 0))
    return out, stats
