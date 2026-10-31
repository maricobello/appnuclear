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


def test_casamentos_errados_achados_na_auditoria():
    """Regressão: pares que a regra antiga casava errado (inicial sozinha, ordem trocada, prefixo longo)."""
    t = lambda s: tokens(key(s))  # noqa: E731
    assert not same_place(t("PROMISSAO"), t("P. PRIMAVERA"))
    assert not same_place(t("N.AVANHANDAVA"), t("NORDESTE"))
    assert not same_place(t("MIRANDA"), t("M. MORAES"))
    assert not same_place(t("SE 230 kV Jorge Lacerda C"), t("CHAPECOENSE"))
    assert not same_place(t("Ponte Nova"), t("NOVA PONTE"))
    assert not same_place(t("Santa Clara"), t("SANTAQUITERIA"))
    assert not same_place(t("SEC LT CAICARAS BARRETOS"), t("L.C.BARRETO"))
    assert not same_place(t("SEC C1 LT VALPARAISO FLORIDA PAULISTA"), t("C. PAULISTA"))
    # o que tem de continuar casando
    assert same_place(t("JAGUARA"), t("JAGUARA-345"))  # a classe de tensão no nome não conta
    assert same_place(t("Ribeirão Preto"), t("RIBEIRAOPRETO"))  # palavras coladas pelo cadastro
    assert same_place(t("Polo Petroquímico"), t("P.PETROQUIMIC"))  # nome cortado no limite de letras
    assert same_place(t("SECC LT JOAO CAMARA III MONTE VERDE"), t("J. CAMARA III"))
    assert same_place(t("Jorge Lacerda"), t("J.LACERDA-A"))  # a letra final é o pátio
    # nome da usina contra o da estação (último recurso): inicial não pode deixar palavra sobrando
    assert not same_place(t("UTE SAO JOSE"), t("S.JOSE CAMPOS"), full=True)
    assert same_place(t("UHE JIRAU"), t("JIRAU MAR.DIR"), full=True)


def _index():
    import pandas as pd
    from sin_grid.match import BusIndex

    rows = [  # (estado, código, nome, kV, barra)
        ("BA", "BAFNL", "FUNIL", 138, 5904), ("SP", "SPAPA", "APARECIDA", 88, 459), ("RO", "ROUSSA", "SANTO ANTONIO", 230, 91341),
        ("RJ", "RJSTSJ", "SAO JOSE", 500, 108), ("MA", "MAETR", "ESTREITO", 500, 5594), ("MG", "MGSTES", "ESTREITO", 500, 3010),
        ("RS", "RSSAN", "SANTO ANGELO", 500, 1045), ("SP", "SPSAA", "SANTO ANGELO", 440, 593), ("SP", "SPSAA", "SANTO ANGELO", 345, 594),
        ("MT", "MTPRT", "PARANAITA", 500, 4494), ("SP", "SPSTIN", "IBIUNA", 500, 87), ("SP", "SPSTIN", "IBIUNA", 345, 86),
        ("BA", "BAUPR", "UTE PROSPERIDAD", 230, 5021), ("GO", "GOUCD", "C. DOURADA", 230, 749),
    ]
    subs = pd.DataFrame(rows, columns=["id_estado", "id_subestacao", "nom_subestacao", "val_niveltensao", "num_barra"]).astype({"num_barra": str})
    return BusIndex(subs, {r[4] for r in rows})


def test_estacao_no_estado_certo():
    ix = _index()
    # mesmo nome em outro estado não serve (Funil RJ, Aparecida AM, Jaraqui AM, São José RS, Estreito MG)
    assert ix.find("FUNIL", 138.0, "RJ") is None
    assert ix.find("APARECIDA", 69.0, "AM") is None
    assert ix.find("SANTO ANTONIO", 69.0, "AM") is None
    assert ix.find("SAO JOSE", None, "RS") is None
    assert ix.find("ESTREITO", None, "MG") == 3010 and ix.find("ESTREITO", None, "MA") == 5594
    assert ix.find("SANTO ANGELO", None, "SP") == 593
    # fronteira: só o nome exato, num estado vizinho, com barra na tensão pedida (São Manoel PA → Paranaíta MT)
    assert ix.find("PARANAITA", 500.0, "PA") == 4494
    assert ix.find("PARANAITA", None, "PA") is None
    assert ix.find("PARANAITA", 500.0, "SP") is None  # SP não faz divisa com MT
    assert ix.find("PARANAITA", 230.0, "PA") is None  # sem barra na tensão pedida
    # código do equipamento: 6 primeiros caracteres; o 7º é a tensão
    from sin_grid.match import code_kv

    assert ix.by_code("SPSAA-0CS1") == 593 and code_kv("SPSAA-0CS1") is None
    assert code_kv("BAMDN25CS1") == 500.0 and ix.by_code("SPSTIN3CS1", code_kv("SPSTIN3CS1")) == 86
    assert ix.by_code("BAUPR10UG1") == 5021  # usina 1 da estação BAUPR
    assert ix.by_code("GOUCDR0UG2") is None  # Codora não é Cachoeira Dourada


def test_compensador_de_ibiuna_no_terminal_do_elo():
    from types import SimpleNamespace
    from sin_grid.dispatch import compensator_bus

    m = SimpleNamespace(index=_index())
    # sem tensão no código: a barra do terminal do elo CC (Ibiúna 345 kV), não a de maior tensão
    assert compensator_bus(m, "SPSTIN0CS1", "IBIUNA", "SP") == 86
    assert compensator_bus(m, "MGEST-0CS1", "ESTREITO", "MG") == 3010  # código não acha: nome no estado


def test_usinas_do_mesmo_ceg():
    import pandas as pd
    from sin_grid.match import pick_plant, unit_groups
    from sin_grid.shortcircuit import plant_units

    u = pd.DataFrame({"ceg": ["X"] * 4 + ["Y"], "nom_usina": ["BELO MONTE", "BELO MONTE", "PIMENTAL", "PIMENTAL", "XINGO"],
                      "cod_equipamento": ["PABM--0UG1", "PABM--0UG2", "PAPI--0UG1", "PAPI--0UG2", "ALUXG-0UG1"],
                      "val_potenciaefetiva": ["611.11", "611.11", "38.85", "38.85", "527"]})
    g = unit_groups(u)
    assert list(pick_plant(g["X"], "UHE PIMENTAL")["cod_equipamento"]) == ["PAPI--0UG1", "PAPI--0UG2"]
    assert plant_units(g, "X", "BELO MONTE") == (2, pytest.approx(1222.22))
    assert plant_units(g, "Y", "USINA XINGO") == (1, 527.0)


def test_fatores_de_interacao_na_subestacao():
    from sin_grid.shortcircuit import interaction_mw

    # barra 0 (alta) e 1 (baixa, atrás de um transformador) na mesma estação; barra 2 noutra
    Z = np.array([[0.10, 0.10, 0.05], [0.10, 0.30, 0.05], [0.05, 0.05, 0.20]], dtype=complex)
    ibr = np.array([0.0, 300.0, 500.0])
    eq = interaction_mw(Z, ibr, ["A", "A", "B"])
    assert eq[0] == pytest.approx(300.0)  # vista da alta, o parque da baixa conta inteiro (fator limitado a 1)
    assert eq[1] == pytest.approx(300.0)
    assert eq[2] == pytest.approx(500.0)  # a outra estação não soma
    eq2 = interaction_mw(Z, np.array([400.0, 0.0, 0.0]), ["A", "A", "B"])
    assert eq2[1] == pytest.approx(400.0 * 0.10 / 0.30)  # vista da baixa, o da alta conta menos


def test_c_max_limitado_pela_tensao_maxima():
    from sin_grid.shortcircuit import c_max_factor

    c = c_max_factor(np.array([500.0, 230.0, 138.0, 88.0]))
    assert c[0] == pytest.approx(1.1) and c[1] == pytest.approx(245 / 230) and c[2] == pytest.approx(145 / 138) and c[3] == pytest.approx(1.1)


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


# ---------------------------------------------------------------- curto-circuito (IEC 60909)

def _sc_net():
    """Rede de teste: 500 kV (2 barras) → transformador 500/230 → 230 kV (2 barras), com resistência nas linhas."""
    import pandapower as pp

    net = pp.create_empty_network(sn_mva=100.0, f_hz=60.0)
    b = [pp.create_bus(net, v) for v in (500, 500, 230, 230)]
    pp.create_line_from_parameters(net, b[0], b[1], length_km=200, r_ohm_per_km=0.02, x_ohm_per_km=0.33, c_nf_per_km=13, max_i_ka=2)
    pp.create_transformer_from_parameters(net, b[1], b[2], sn_mva=600, vn_hv_kv=500, vn_lv_kv=230, vkr_percent=0.3, vk_percent=12, pfe_kw=0, i0_percent=0)
    pp.create_line_from_parameters(net, b[2], b[3], length_km=80, r_ohm_per_km=0.06, x_ohm_per_km=0.5, c_nf_per_km=9, max_i_ka=1)
    return net, b


def test_unidades_ligadas_pela_geracao():
    from sin_grid.shortcircuit import COS_PHI, online_mva

    s = online_mva(np.array([0, 50, 95, 180, 400, 500]), n_units=4, unit_mw=100)
    # ⌈P / (0,9 · 100)⌉ unidades, no máximo 4, cada uma com 100 MW / cos φ
    assert list(np.round(s * COS_PHI / 100)) == [0, 1, 2, 2, 4, 4]
    # sem cadastro: a geração da hora com o mesmo carregamento
    assert online_mva(np.array([90.0]), 0, 0)[0] == pytest.approx(90 / (0.9 * COS_PHI))
    # geração residual (UT Maranhão 4 com 0,05 MW) não liga uma unidade de 170 MW
    assert online_mva(np.array([0.05, 8.0, 9.0]), 1, 170)[0] == 0 and online_mva(np.array([9.0]), 1, 170)[0] > 0
    assert online_mva(np.array([0.5]), 0, 0)[0] == 0


def test_potencia_do_compensador_sincrono():
    from sin_grid.shortcircuit import compensator_mvar

    # a faixa vem no nome; o limite do cadastro às vezes é o preenchimento 9999,9
    assert compensator_mvar("CS  331 / -171 Mvar ARARAQUARA 2              3 SP", "9999.9", None) == 331
    assert compensator_mvar("COMPENSADOR K1", "150", None) == 150
    assert compensator_mvar("COMPENSADOR K1", "9999.9", float("nan")) == 0.0


def test_curto_analitico_em_duas_barras():
    import pandapower as pp
    from types import SimpleNamespace
    from sin_grid.shortcircuit import C_MAX, RX_SOURCE, Sources, levels, network_admittance

    net = pp.create_empty_network(sn_mva=100.0, f_hz=60.0)
    a, b = pp.create_bus(net, 230), pp.create_bus(net, 230)
    pp.create_line_from_parameters(net, a, b, length_km=100, r_ohm_per_km=0.05, x_ohm_per_km=0.5, c_nf_per_km=9, max_i_ka=1)
    src = Sources(pos=np.array([0]), x_total=np.array([0.3]), mva=np.full((1, 24), 1000.0), kind=["HIDROELÉTRICA"], name=["u"])
    sk = levels(network_admittance(SimpleNamespace(net=net), "max"), src, 0, C_MAX, 100.0)
    zs = 0.3 * 100 / 1000 / math.sqrt(1 + RX_SOURCE**2) * complex(RX_SOURCE, 1)  # p.u.
    zl = complex(5, 50) / (230**2 / 100)
    assert sk[0] == pytest.approx(C_MAX * 100 / abs(zs), rel=1e-12)
    assert sk[1] == pytest.approx(C_MAX * 100 / abs(zs + zl), rel=1e-12)


def test_curto_proprio_igual_ao_pandapower():
    """Matriz de impedâncias própria × calc_sc do pandapower (K_T no máximo, linhas a 80 °C no mínimo)."""
    from types import SimpleNamespace
    from sin_grid.shortcircuit import C_MAX, C_MIN, Sources, levels, network_admittance, pandapower_check

    net, b = _sc_net()
    m = SimpleNamespace(net=net)
    mva = np.zeros((3, 24))
    mva[0, :], mva[1, :12], mva[2, :] = 3000.0, 800.0, 150.0  # a segunda fonte desliga ao meio-dia
    src = Sources(pos=np.array([0, 3, 3]), x_total=np.array([0.37, 0.29, 0.35]), mva=mva, kind=["H", "T", "C"], name=["a", "b", "c"])
    for h in (5, 15):
        own_max = levels(network_admittance(m, "max"), src, h, C_MAX, 100.0)
        own_min = levels(network_admittance(m, "min"), src, h, C_MIN, 100.0)
        assert np.max(np.abs(own_max / pandapower_check(m, src, h, "max") - 1)) < 1e-9
        assert np.max(np.abs(own_min / pandapower_check(m, src, h, "min") - 1)) < 1e-9
        # mínimo abaixo do máximo em todas as barras
        assert np.all(own_min < own_max)
    # sem a segunda fonte (tarde), o curto na barra 3 cai
    assert levels(network_admittance(m, "max"), src, 15, C_MAX, 100.0)[3] < levels(network_admittance(m, "max"), src, 5, C_MAX, 100.0)[3]
