"""Testes do modelo da rede: conversões de unidade, casamento de nomes e fluxo nos ramos."""

import copy
import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sin_grid.match import parse_point, same_place, tokens, key  # noqa: E402
from sin_grid.model import base_kv, c_nf, i_ka, z_ohm  # noqa: E402
from sin_grid.flows import branch_flows  # noqa: E402


def test_conversoes_do_cadastro_ons():
    # LT 230 kV Cruzeiro do Sul / Feijó: X = 23,846% (base 100 MVA), shunt 44,8 Mvar, 280 km
    assert z_ohm(23.846, 230) == pytest.approx(0.23846 * 529, rel=1e-12)
    c_total = c_nf(44.8, 230)  # nF no total da linha
    assert c_total == pytest.approx(44.8 / 230**2 / (2 * math.pi * 60) * 1e9)
    # conferência física: ~8 nF/km é o típico de linha de 230 kV
    assert 6 < c_total / 280 < 12
    assert i_ka(780, 230) == pytest.approx(780 / (math.sqrt(3) * 230))
    assert base_kv(525) == 500 and base_kv(440) == 440


def test_ponto_de_conexao():
    name, kv = parse_point("SE SANTA VITORIA DO PALMAR 2 138,0 kV")
    assert kv == 138.0 and "SANTA VITORIA" in name
    assert parse_point("Rede de Distribuição em 13,8 kV") == (None, None)
    assert parse_point("SC 500 kV Porto Velho")[1] == 500.0


def test_nomes_abreviados_do_ons():
    t = lambda s: tokens(key(s))  # noqa: E731
    assert same_place(t("SALTO SANTIAGO"), t("S.SANTIAGO"))
    # a inicial "S" não vale por duas palavras
    assert not same_place(t("SALTO SANTIAGO"), t("S. OSORIO"))
    assert same_place(t("CURRAL NOVO DO PIAUI II"), t("C.NOVO PIAUI2"))
    assert same_place(t("SC Porto Velho"), t("C.PORTO VELHO"))
    # números têm de ser iguais
    assert not same_place(t("ANGRA 2"), t("ANGRA FUR"))
    assert not same_place(t("MIRANDA II"), t("MIRANDA"))


def test_fluxo_no_ramo_modelo_pi():
    # linha 0,01 + j0,1 p.u., carregamento 0,2 p.u.; V1 = 1∠0, V2 = 0,98∠−5°
    bp = {"lf": np.array([0]), "lt": np.array([1]), "zl": np.array([0.01 + 0.1j]), "bl": np.array([0.2]),
          "th": np.array([], dtype=int), "tl": np.array([], dtype=int), "zt": np.array([], dtype=complex)}
    V = np.array([[1.0 + 0j], [0.98 * np.exp(-1j * np.radians(5))]])
    Sf, St, _, _ = branch_flows(bp, V)
    i = (V[0, 0] - V[1, 0]) / (0.01 + 0.1j) + V[0, 0] * 0.1j
    assert Sf[0, 0] == pytest.approx(V[0, 0] * np.conj(i) * 100)
    # perdas = Re(Sf + St) ≥ 0 e iguais a R·|I_série|²
    i_s = (V[0, 0] - V[1, 0]) / (0.01 + 0.1j)
    assert (Sf + St).real[0, 0] == pytest.approx(0.01 * abs(i_s) ** 2 * 100)


def test_p3s_igual_ao_pandapower():
    """Lote de 24 h no p3s (C++/KLU) contra o runpp do pandapower em cada hora, numa rede de teste."""
    pytest.importorskip("p3s.nr_klu", reason="extensão C++ do p3s não instalada")
    import pandapower as pp
    import pandapower.networks as pn
    from p3s.calculateTrafoTapTable import calculate_trafo_characteristic
    from p3s.NewtonPowerflowCpp import NewtonPowerflow as Cpp

    net = pn.case30()
    net.trafo["shift_degree"] = 0.0
    calculate_trafo_characteristic(net, inplace=True)
    rng = np.random.default_rng(1)
    scale = 1 + 0.1 * rng.standard_normal((len(net.load), 24))
    p0, q0 = net.load.p_mw.to_numpy()[:, None], net.load.q_mvar.to_numpy()[:, None]
    ts = {("load", "p_mw"): p0 * scale, ("load", "q_mvar"): q0 * scale}
    V = Cpp(net).calculate_timeseries_cpp(net, ts, n_threads=1)
    for h in (0, 11, 23):
        n2 = copy.deepcopy(net)
        n2.load["p_mw"], n2.load["q_mvar"] = ts[("load", "p_mw")][:, h], ts[("load", "q_mvar")][:, h]
        pp.runpp(n2, tolerance_mva=1e-9, trafo_model="t")
        assert np.allclose(np.abs(V[:, h]), n2.res_bus.vm_pu.to_numpy(), atol=1e-6)


def test_n1_do_p3s_igual_ao_pandapower():
    """Só linhas com grupo viram contingência (NaN fica de fora; 0 seria uma contingência a mais)
    e cada caso bate com o runpp do pandapower com a linha desligada."""
    pytest.importorskip("p3s.nr_klu", reason="extensão C++ do p3s não instalada")
    import pandapower as pp
    import pandapower.networks as pn
    from p3s.calculateTrafoTapTable import calculate_trafo_characteristic
    from p3s.contingency.solver_cpp import solve_contingencies_cpp

    net = pn.case30()
    net.trafo["shift_degree"] = 0.0
    calculate_trafo_characteristic(net, inplace=True)
    watched = [0, 5, 12]
    net.line["outage_group"] = np.nan
    net.line.loc[watched, "outage_group"] = [i + 1 for i in watched]
    net.trafo["outage_group"] = np.nan
    r = solve_contingencies_cpp(net, reslack_islands=False, n_threads=1, init="flat")
    assert sorted(int(g) - 1 for g in r.groups) == watched
    for c, g in enumerate(r.groups):
        n2 = copy.deepcopy(net)
        n2.line.loc[int(g) - 1, "in_service"] = False
        pp.runpp(n2, tolerance_mva=1e-9, trafo_model="t")
        assert r.converged[c]
        ref = n2.res_bus.vm_pu.to_numpy()
        # barra ilhada pela saída (a linha 12 é radial): os dois marcam a mesma barra sem atendimento
        assert np.array_equal(r.served[:, c], np.isfinite(ref))
        ok = r.served[:, c]
        assert np.allclose(np.abs(r.V[ok, c]), ref[ok], atol=1e-6)


def test_nomes_no_relatorio():
    from sin_grid.report import _name, _short

    raw = "LT  500 kV SE LAJEADO           / MIRACEMA             C 1  TO (Fase A)"
    assert _name(raw) == "LT 500 kV SE LAJEADO / MIRACEMA C 1 TO"
    assert _short(raw) == "LAJEADO / MIRACEMA C 1 TO"
    assert _short("LT 765 kV ITABERA / TIJUCO PRETO C 1 SP") == "ITABERA / TIJUCO PRETO C 1 SP"
