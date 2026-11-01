"""Nível de curto-circuito trifásico nas barras do SIN e força da rede para a conexão de inversores (SCR).

Método da fonte de tensão equivalente da IEC 60909-0: em cada barra, I''k = c·Un / (√3·|Zth|) e
S''k = c·Un² / |Zth|, com Zth a impedância de Thévenin da rede vista da barra (cargas, capacitâncias
das linhas e admitâncias em derivação desprezadas). As mesmas convenções do curto do pandapower,
que confere o cálculo em duas horas do dia:

- máximo (c = 1,1, limitado a Um/Un da classe de tensão): transformadores de rede com o fator
  K_T = 0,95·c_max / (1 + 0,6·x_T); linhas a 20 °C;
- mínimo (c = 1,0): sem K_T; resistência das linhas a 80 °C, R·[1 + 0,004·(80 − 20)].

Fontes (o que sustenta a tensão num curto): máquinas síncronas em operação na hora — hidrelétricas,
térmicas e nucleares — e compensadores síncronos. A potência ligada de cada usina vem da
disponibilidade sincronizada que o ONS publica por usina e hora (inclui unidades girando como
compensador ou com pouca carga); nas usinas sem esse dado, as unidades ligadas são as mínimas para a
geração da hora com cada uma a até 90% da potência efetiva (estimativa conservadora), e geração
residual (abaixo de 5% de uma unidade) não liga unidade. Cada fonte entra com a reatância
subtransitória típica do tipo de máquina mais a do transformador elevador, na base da potência
ligada: no modelo, as usinas estão na barra de alta da estação, sem o elevador. No mínimo, cada barra
perde o compensador síncrono cuja saída mais derruba o curto dela (critério N-1, por atualização de posto 1
da matriz de impedâncias).

Ficam fora as eólicas, solares e baterias (o inversor limita a corrente e a relação de curto-circuito
padrão não conta com eles), os elos de corrente contínua (conversoras LCC não alimentam curto) e
Itaipu 50 Hz. A potência eólica e solar já ligada vai junto no relatório, vista de cada barra pelos
fatores de interação |Z_jk/Z_kk| (CIGRE) — na própria subestação e na região (fator ≥ 0,7) —, para a
relação de curto-circuito composta: o parque novo disputa a mesma rede com os que já estão lá.

Por barra: o mínimo do dia (c = 1,0 na hora mais fraca) e o máximo do despacho do dia (c = 1,1 na hora
mais forte) — este não é o máximo da IEC para superação de disjuntor, que liga todas as unidades.
A relação de curto-circuito de uma usina de P MW na barra é SCR = S''k mínimo / P.
"""

from __future__ import annotations

import copy
import math
import re
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import ons
from .dispatch import Dispatch, compensator_bus
from .match import key, pick_plant, same_place, tokens, unit_groups
from .model import GridModel

#: reatância subtransitória típica (pu na potência da máquina) por tipo de usina do ONS
X_SUBTRANSIENT = {"HIDROELÉTRICA": 0.25, "TÉRMICA": 0.17, "NUCLEAR": 0.22}
#: transformador elevador da usina (pu na potência da máquina)
X_STEP_UP = 0.12
#: compensador síncrono: reatância subtransitória e transformador (pu na potência nominal)
X_SYNC_COMPENSATOR = 0.25 + 0.10
COS_PHI = 0.9
#: carregamento máximo de cada unidade ligada: unidades = ⌈geração / (0,9 · potência efetiva)⌉
UNIT_LOADING = 0.9
#: geração abaixo dessa fração de uma unidade é residual (medição, serviço auxiliar): não liga unidade
RESIDUAL_FRACTION = 0.05
RESIDUAL_MW = 1.0
#: relação R/X das fontes (IEC 60909: R_G ≈ 0,05·X''d para máquinas de 100 MVA ou mais)
RX_SOURCE = 0.05
C_MAX, C_MIN = 1.1, 1.0
#: tensão máxima do equipamento por tensão nominal (kV): c_max·Un não passa de Um (IEC 60909-0, tabela 1)
U_MAX = {69.0: 72.5, 88.0: 92.4, 138.0: 145.0, 161.0: 170.0, 230.0: 245.0, 289.0: 300.0, 345.0: 362.0, 440.0: 460.0, 500.0: 550.0, 525.0: 550.0, 765.0: 800.0}
#: temperatura final das linhas no curto mínimo e coeficiente de temperatura da resistência
END_TEMP_C = 80.0
ALPHA_R = 0.004
#: diferença relativa aceita entre o cálculo próprio e o pandapower
PANDAPOWER_TOL = 1e-6
KV_RE = re.compile(r"(\d{2,3})\s*kV", re.I)
#: "CS  331 / -171 Mvar ARARAQUARA 2" → 331 (a faixa do compensador síncrono vem no nome do equipamento)
CS_RATING_RE = re.compile(r"\bCS\s+(\d+(?:[.,]\d+)?)\s*/", re.I)
#: o cadastro usa 9999,9 como valor de preenchimento: acima disso o limite não é potência de verdade
MAX_COMPENSATOR_MVAR = 2000.0
#: tipos de usina com inversor (contam na relação de curto-circuito composta)
IBR_TYPES = ("EOL", "FOTO", "SOLAR", "BATER")
COMPENSATOR = "COMPENSADOR SÍNCRONO"


@dataclass
class Sources:
    """Fontes de curto: barra (posição na rede), reatância total (pu na potência ligada) e MVA ligados por
    hora. ``n1``: índice do maior compensador síncrono de cada barra com compensador (candidatos do N-1)."""

    pos: np.ndarray  # (k,)
    x_total: np.ndarray  # (k,)
    mva: np.ndarray  # (k, 24)
    kind: list[str]
    name: list[str]
    stats: dict = field(default_factory=dict)
    n1: list[int] = field(default_factory=list)

    def on(self, case: str) -> np.ndarray:  # noqa: ARG002 — o mesmo conjunto nos dois casos; o N-1 vem depois
        return self.mva


@dataclass
class ShortCircuitResult:
    #: S''k (MVA) por barra (posição) e hora: mínimo (c = 1,0) e máximo (c = 1,1, limitado a Um/Un)
    sk_min: np.ndarray  # (n, 24)
    sk_max: np.ndarray  # (n, 24)
    online_mva: np.ndarray  # (24,) potência síncrona ligada
    weak_hour: int
    strong_hour: int
    check: dict
    stats: dict
    #: MW de eólicas, solares e baterias na barra (posição) e o equivalente visto dela, pelos fatores de
    #: interação na hora mais fraca: na região (fator ≥ 0,7, mais as barras da própria subestação) e só na
    #: subestação
    ibr_mw: np.ndarray | None = None
    ibr_eq_mw: np.ndarray | None = None
    ibr_station_mw: np.ndarray | None = None
    #: S''k mínimo do dia com todos os compensadores ligados (sem o N-1)
    sk_min_all: np.ndarray | None = None


def availability_path(year: int, month: int) -> str:
    return f"disponibilidade_usina_ho/DISPONIBILIDADE_USINA_{year}_{month:02d}.parquet"


def load_sync(f: ons.Fetcher, date: str) -> pd.DataFrame | None:
    """Disponibilidade sincronizada (MW) por usina e hora do dia: índice (CEG, nome), colunas 0–23.
    None se o arquivo do mês não existir ou o dia não tiver as 24 horas."""
    raw = ons.read_any(f.get(availability_path(int(date[:4]), int(date[5:7])), max_age_s=6 * 3600))
    t = pd.to_datetime(raw["din_instante"])
    day = raw[t.dt.strftime("%Y-%m-%d") == date].assign(h=t.dt.hour, mw=lambda x: ons.num(x["val_dispsincronizada"]))
    if day["h"].nunique() < 24:
        return None
    return day.pivot_table(index=["ceg", "nom_usina"], columns="h", values="mw", aggfunc="sum").reindex(columns=range(24)).fillna(0.0)


def _sync_row(sync: pd.DataFrame | None, ceg: str, name: str) -> np.ndarray | None:
    """Linha da disponibilidade da usina: pelo CEG e, se ele reunir mais de uma usina, pelo nome."""
    if sync is None or not ceg or ceg not in sync.index.get_level_values(0):
        return None
    rows = sync.loc[ceg]
    if len(rows) == 1:
        return rows.iloc[0].to_numpy(dtype=float)
    q = tokens(key(name))
    hit = [n for n in rows.index if same_place(q, tokens(key(n)))]
    return rows.loc[hit[0]].to_numpy(dtype=float) if len(hit) == 1 else None


def plant_units(groups: dict, ceg: str, name: str) -> tuple[int, float]:
    """(número de unidades, potência efetiva total em MW) da usina, separando CEGs com mais de uma."""
    u = pick_plant(groups.get(ceg), name)
    if u is None or not len(u):
        return 0, 0.0
    mw = ons.num(u["val_potenciaefetiva"])
    mw = mw[mw > 0]
    return int(len(mw)), float(mw.sum())


def _ceg_mw(groups: dict, ceg: str) -> float:
    """Potência efetiva total (MW) das unidades em operação de um CEG."""
    tot = 0.0
    for u in groups.get(ceg, {}).values():
        mw = ons.num(u["val_potenciaefetiva"])
        tot += float(mw[mw > 0].sum())
    return tot


def online_mva(p_mw: np.ndarray, n_units: float, unit_mw: float) -> np.ndarray:
    """MVA síncronos ligados para gerar p_mw: as unidades mínimas a até UNIT_LOADING da potência efetiva.
    Geração residual (abaixo de 5% de uma unidade, ou de 1 MW sem cadastro) não liga unidade."""
    p = np.maximum(np.asarray(p_mw, dtype=float), 0.0)
    if n_units > 0 and unit_mw > 0:
        p = np.where(p < RESIDUAL_FRACTION * unit_mw, 0.0, p)
        n_on = np.minimum(np.ceil(p / (UNIT_LOADING * unit_mw) - 1e-9), n_units)
        return n_on * unit_mw / COS_PHI
    p = np.where(p < RESIDUAL_MW, 0.0, p)
    return p / (UNIT_LOADING * COS_PHI)


def collect_sources(m: GridModel, d: Dispatch, regs: dict[str, pd.DataFrame], sync: pd.DataFrame | None = None) -> Sources:
    pos_of = dict(zip(m.buses.index, m.net.bus.index.get_indexer(m.buses["pp"])))
    groups = unit_groups(ons.active(regs["unidades_geradoras"], d.date))
    ph = d.plant_hours
    hours = list(range(24))
    pos, xt, mva, kind, name = [], [], [], [], []
    no_capacity, by_sync, by_gen = 0, 0, 0
    e_sync, e_all = 0.0, 0.0
    by_type: dict[str, float] = {}
    for idx, r in ph.iterrows():
        tipo = str(r.get("nom_tipousina") or "")
        if tipo not in X_SUBTRANSIENT or pd.isna(r["bus"]) or r["metodo"] in ("embutida", "elo CC", "sem barra"):
            continue
        b = int(r["bus"])
        if b not in pos_of or pos_of[b] < 0:
            continue
        p = r[hours].to_numpy(dtype=float)
        ceg, nome = (str(idx[0]), str(idx[2])) if isinstance(idx, tuple) else ("", str(idx))
        e_all += float(np.maximum(p, 0).sum())
        n, total = plant_units(groups, ceg, nome)
        sy = _sync_row(sync, ceg, nome)
        if sy is not None:
            # disponibilidade sincronizada do ONS (MW das unidades girando), nunca abaixo da geração e em
            # unidades inteiras: a disponibilidade cai com a queda baixa, a potência da máquina não
            # e nunca abaixo das unidades mínimas para a geração: às vezes o dado vem defasado (Itá com 829 MW
            # sincronizados o dia todo gerando até 1.417 MW)
            base = np.maximum(sy, np.maximum(p, 0.0))
            if n > 0 and total > 0:
                unit = total / n
                s = np.clip(np.ceil(base / unit - RESIDUAL_FRACTION), 0, n) * unit / COS_PHI
            else:
                s = base / COS_PHI
            s = np.maximum(s, online_mva(p, n, total / n if n else 0.0))
            by_sync += int(np.any(s > 0))
            e_sync += float(np.maximum(p, 0).sum())
        else:
            s = online_mva(p, n, total / n if n else 0.0)
            if n == 0 and np.any(s > 0):
                no_capacity += 1
            by_gen += int(np.any(s > 0))
        if not np.any(s > 0):
            continue
        pos.append(pos_of[b])
        xt.append(X_SUBTRANSIENT[tipo] + X_STEP_UP)
        mva.append(s)
        kind.append(tipo)
        name.append(nome)
        by_type[tipo] = by_type.get(tipo, 0.0) + float(s.mean())

    # compensadores síncronos do cadastro: ligados no máximo; no mínimo sai o maior de cada subestação
    n_comp = 0
    comp_at: dict[int, list[int]] = {}
    eq = regs.get("controle_reativo")
    if eq is not None:
        eq = ons.active(eq, d.date)
        eq = eq[eq["nom_tipoequipamento"].fillna("").str.contains("Síncrono", case=False)]
        for r in eq.itertuples():
            q = compensator_mvar(r.nom_equipamento, r.val_limitesuperior_mvar, r.val_potreativanominal_mvar)
            b = compensator_bus(m, getattr(r, "cod_equipamento", ""), r.nom_subestacao, r.id_estado)
            if not (q > 0) or b is None or b not in pos_of or pos_of[b] < 0:
                continue
            comp_at.setdefault(pos_of[b], []).append(len(pos))
            pos.append(pos_of[b])
            xt.append(X_SYNC_COMPENSATOR)
            mva.append(np.full(24, q))
            kind.append(COMPENSATOR)
            name.append(" ".join(str(r.nom_equipamento).split()))
            n_comp += 1
            by_type[COMPENSATOR] = by_type.get(COMPENSATOR, 0.0) + q
    arr = np.array(mva, dtype=float).reshape(-1, 24)
    n1 = [max(ks, key=lambda k: arr[k, 0]) for ks in comp_at.values()]
    stats = {
        "usinas": int(sum(1 for k in kind if k != COMPENSATOR)),
        "usinas_pela_disponibilidade": by_sync,
        "usinas_pela_geracao": by_gen,
        "geracao_sincrona_com_disponibilidade": round(e_sync / e_all, 3) if e_all > 0 else 0.0,
        "compensadores": n_comp,
        "compensadores_n1": len(n1),
        "usinas_sem_capacidade_no_cadastro": no_capacity,
        "mva_medio_por_tipo": {k: round(v) for k, v in sorted(by_type.items())},
    }
    return Sources(np.array(pos, dtype=int), np.array(xt, dtype=float), arr, kind, name, stats, n1)


def ibr_by_bus(m: GridModel, d: Dispatch, regs: dict[str, pd.DataFrame]) -> np.ndarray:
    """MW instalados de eólicas, solares e baterias em cada barra (posição na rede): conjuntos pela soma das
    usinas que os compõem; sem cadastro, a maior geração horária do dia (limite inferior)."""
    groups = unit_groups(ons.active(regs["unidades_geradoras"], d.date))
    cl = regs.get("conjuntos")
    members: dict[str, list[str]] = {}
    if cl is not None:
        live = cl[cl["dat_fimrelacionamento"].fillna("").isin(["", "None"])]
        members = live.groupby("id_ons_conjunto")["ceg"].apply(list).to_dict()
    pos_of = dict(zip(m.buses.index, m.net.bus.index.get_indexer(m.buses["pp"])))
    out = np.zeros(len(m.net.bus))
    for idx, r in d.plant_hours.iterrows():
        tipo = str(r.get("nom_tipousina") or "").upper()
        if not any(t in tipo for t in IBR_TYPES) or pd.isna(r["bus"]) or r["metodo"] in ("embutida", "elo CC", "sem barra"):
            continue
        p = pos_of.get(int(r["bus"]), -1)
        if p < 0:
            continue
        ceg, ido, nome = (str(idx[0]), str(idx[1]), str(idx[2])) if isinstance(idx, tuple) else ("", "", str(idx))
        mw = sum(_ceg_mw(groups, c) for c in members.get(ido, []))
        if mw <= 0:
            mw = plant_units(groups, ceg, nome)[1]
        if mw <= 0:
            mw = float(np.max(r[list(range(24))].to_numpy(dtype=float)))
        out[p] += max(mw, 0.0)
    return out


#: fator de interação a partir do qual um parque de outra subestação conta no SCR composto regional
IF_REGIONAL = 0.7


def interaction_mw(Z: np.ndarray, ibr: np.ndarray, station: list, cut: float | None = None) -> np.ndarray:
    """Inversores já ligados vistos de cada barra k: Σ_j min(1, |Z_jk / Z_kk|) · P_j (fatores de interação
    da CIGRE). Sem ``cut``, só as barras j da mesma subestação (na barra de alta, os parques das barras de
    baixa contam inteiros; numa de baixa, os da alta contam menos). Com ``cut``, também as barras de outras
    subestações com fator ≥ cut: somar todos os fatores pequenos de dezenas de GW não diria nada."""
    out = np.zeros(len(ibr))
    J = np.flatnonzero(ibr > 0)
    if not len(J):
        return out
    dk = np.abs(np.diag(Z))
    f = np.minimum(np.abs(Z[J, :]) / dk[None, :], 1.0)  # f[j, k]
    st = np.array([x if x is not None else f"#{i}" for i, x in enumerate(station)], dtype=object)
    mask = st[J][:, None] == st[None, :]
    if cut is not None:
        mask = mask | (f >= cut)
    return (f * mask).T @ ibr[J]


def compensator_mvar(name: object, upper: object, nominal: object) -> float:
    """Potência do compensador síncrono (Mvar sobre-excitado): pelo nome ("CS 150 / -105 Mvar"); sem ele, o
    limite superior ou a potência nominal do cadastro, descartando o preenchimento 9999,9."""
    m = CS_RATING_RE.search(str(name))
    if m:
        return float(m.group(1).replace(",", "."))
    for v in (upper, nominal):
        x = abs(float(ons.num(pd.Series([v])).iloc[0])) if v is not None else float("nan")
        if 0 < x < MAX_COMPENSATOR_MVAR:
            return x
    return 0.0


def c_max_factor(vn_kv: np.ndarray) -> np.ndarray:
    """c_max por barra: 1,1, sem passar de Um/Un da classe de tensão."""
    return np.array([min(C_MAX, U_MAX.get(float(v), math.inf) / float(v)) for v in vn_kv])


def network_admittance(m: GridModel, case: str) -> np.ndarray:
    """Matriz de admitâncias (p.u., base da rede) só com linhas e transformadores, nas convenções da IEC 60909."""
    net = m.net
    sb = net.sn_mva
    n = len(net.bus)
    pos = pd.Series(np.arange(n), index=net.bus.index)
    Y = np.zeros((n, n), dtype=complex)
    L = net.line[net.line.in_service]
    vn = net.bus.loc[L.from_bus, "vn_kv"].to_numpy()
    kr = 1.0 if case == "max" else 1.0 + ALPHA_R * (END_TEMP_C - 20.0)
    z = (L.r_ohm_per_km.to_numpy() * kr + 1j * L.x_ohm_per_km.to_numpy()) * L.length_km.to_numpy() / (vn * vn / sb)
    par = L["parallel"].to_numpy(dtype=float) if "parallel" in L else 1.0
    _stamp(Y, pos[L.from_bus].to_numpy(), pos[L.to_bus].to_numpy(), par / z)
    T = net.trafo[net.trafo.in_service]
    vk, vkr = T.vk_percent.to_numpy() / 100, T.vkr_percent.to_numpy() / 100
    x = np.sqrt(np.maximum(vk * vk - vkr * vkr, 0.0))
    kt = 0.95 * C_MAX / (1 + 0.6 * x) if case == "max" else np.ones_like(x)
    zt = kt * (vkr + 1j * x) * sb / T.sn_mva.to_numpy()
    tpar = T["parallel"].to_numpy(dtype=float) if "parallel" in T else 1.0
    _stamp(Y, pos[T.hv_bus].to_numpy(), pos[T.lv_bus].to_numpy(), tpar / zt)
    return Y


def _stamp(Y: np.ndarray, a: np.ndarray, b: np.ndarray, y: np.ndarray) -> None:
    np.add.at(Y, (a, a), y)
    np.add.at(Y, (b, b), y)
    np.add.at(Y, (a, b), -y)
    np.add.at(Y, (b, a), -y)


def source_admittance(src: Sources, h: int, n: int, sb: float, case: str = "max") -> np.ndarray:
    """Admitância das fontes ligadas na hora h, somada por barra (p.u.): |Z| = x_total · Sbase / S ligado."""
    mva = src.on(case)
    y = np.zeros(n, dtype=complex)
    on = mva[:, h] > 0
    if not np.any(on):
        raise ValueError(f"nenhuma fonte síncrona ligada às {h}h")
    zmag = src.x_total[on] * sb / mva[on, h]
    z = zmag / math.sqrt(1 + RX_SOURCE**2) * complex(RX_SOURCE, 1.0)
    np.add.at(y, src.pos[on], 1.0 / z)
    return y


def levels(Y0: np.ndarray, src: Sources, h: int, c: float, sb: float, case: str = "max") -> np.ndarray:
    """S''k (MVA) em todas as barras na hora h: c·Sbase / |Z_ii|."""
    Y = Y0.copy()
    Y[np.diag_indices_from(Y)] += source_admittance(src, h, len(Y0), sb, case)
    Zii = np.diag(np.linalg.inv(Y))
    return c * sb / np.abs(Zii)


def pandapower_check(m: GridModel, src: Sources, h: int, case: str) -> np.ndarray:
    """O mesmo curto pelo pandapower (calc_sc, IEC 60909): rede só com linhas e transformadores e as fontes
    como equivalentes de rede (S''k = c · S ligado / x_total, o que dá a mesma impedância da fonte)."""
    import pandapower as pp
    import pandapower.shortcircuit as sc

    net = copy.deepcopy(m.net)
    for el in ("gen", "sgen", "load", "ext_grid", "shunt", "ward", "xward", "storage"):
        if el in net and len(net[el]):
            net[el]["in_service"] = False
    net.line["endtemp_degree"] = END_TEMP_C
    mva = src.on(case)
    on = mva[:, h] > 0
    agg: dict[int, complex] = {}
    for p, x, s in zip(src.pos[on], src.x_total[on], mva[on, h]):
        agg[int(p)] = agg.get(int(p), 0) + s / x  # admitâncias em paralelo (mesma relação R/X)
    bus_at = net.bus.index.to_numpy()
    for p, s_over_x in agg.items():
        sk = abs(s_over_x)
        pp.create_ext_grid(net, int(bus_at[p]), s_sc_max_mva=C_MAX * sk, s_sc_min_mva=C_MIN * sk, rx_max=RX_SOURCE, rx_min=RX_SOURCE)
    sc.calc_sc(net, case=case, fault="3ph")
    return net.res_bus_sc.loc[bus_at, "skss_mw"].to_numpy()


def _clean_error(e: Exception) -> str:
    """Mensagem curta para a tela, sem caminhos de arquivo do servidor."""
    msg = re.sub(r"(?:[A-Za-z]:)?(?:[\\/][\w.\-]+){2,}", "…", str(e))
    return f"{type(e).__name__}: {' '.join(msg.split())}"[:160]


def unit_admittance(src: Sources, k: int, sb: float) -> complex:
    """Admitância (p.u.) de uma fonte sozinha, na potência dela (compensador: constante no dia)."""
    z = src.x_total[k] * sb / float(src.mva[k].max()) / math.sqrt(1 + RX_SOURCE**2) * complex(RX_SOURCE, 1.0)
    return 1.0 / z


def n1_worst(Z: np.ndarray, cands: list[tuple[int, complex]]) -> np.ndarray:
    """|Z_kk| no pior N-1 de cada barra: tirar a fonte de admitância y da barra c muda a matriz por posto 1
    (Sherman–Morrison), Z'_kk = Z_kk + Z_kc² · y / (1 − y · Z_cc); fica o maior |Z'_kk| entre os candidatos."""
    zkk = np.diag(Z)
    worst = np.abs(zkk)
    for c, y in cands:
        col = Z[:, c]
        worst = np.maximum(worst, np.abs(zkk + col * col * (y / (1.0 - y * Z[c, c]))))
    return worst


def run(m: GridModel, d: Dispatch, regs: dict[str, pd.DataFrame], with_check: bool = True,
        sync: pd.DataFrame | None = None) -> ShortCircuitResult:
    src = collect_sources(m, d, regs, sync)
    if len(src.pos) == 0:
        raise ValueError("nenhuma fonte síncrona casada com barra")
    sb = m.net.sn_mva
    n = len(m.net.bus)
    online = src.mva.sum(axis=0)
    weak, strong = int(np.argmin(online)), int(np.argmax(online))
    Ymax = network_admittance(m, "max")
    Ymin = network_admittance(m, "min")
    # N-1: para cada barra, o compensador síncrono (o maior de cada subestação) cuja saída mais derruba o curto
    cands = [(int(src.pos[k]), unit_admittance(src, k, sb)) for k in src.n1]
    sk_max = np.zeros((n, 24))
    sk_min = np.zeros((n, 24))
    sk_all = np.zeros((n, 24))
    Zweak = None
    for h in range(24):
        sk_max[:, h] = levels(Ymax, src, h, C_MAX, sb)
        Y = Ymin.copy()
        Y[np.diag_indices_from(Y)] += source_admittance(src, h, n, sb)
        Z = np.linalg.inv(Y)
        sk_all[:, h] = C_MIN * sb / np.abs(np.diag(Z))
        sk_min[:, h] = C_MIN * sb / n1_worst(Z, cands)
        if h == weak:
            Zweak = Z
    check: dict = {"horas": [weak, strong]}
    if with_check:
        try:  # o mínimo confere com todos os compensadores; o N-1 é identidade algébrica (teste próprio)
            pmin = pandapower_check(m, src, weak, "min")
            pmax = pandapower_check(m, src, strong, "max")
            dif = max(float(np.max(np.abs(pmin - sk_all[:, weak]) / pmin)), float(np.max(np.abs(pmax - sk_max[:, strong]) / pmax)))
            check.update(dif_rel_max=dif, ok=bool(dif < PANDAPOWER_TOL))
        except Exception as e:  # noqa: BLE001 — registra e segue: a tela mostra a conferência como falha
            check.update(ok=False, erro=_clean_error(e))
    # depois da conferência (o pandapower usa 1,1 e a base da barra em todas): c_max·Un ≤ Um e a tensão
    # nominal das barras de 525 kV, que no ANAREDE têm a base de 500 kV (o mínimo usa c·Un com Un = 525)
    vn = m.net.bus.vn_kv.to_numpy()
    info = m.buses.reset_index().set_index("pp").reindex(m.net.bus.index)
    nominal = info["kv_nom"].to_numpy(dtype=float) if "kv_nom" in info else vn
    r = np.where(np.isfinite(nominal) & (nominal > 0), nominal / vn, 1.0)
    sk_max *= (c_max_factor(vn) / C_MAX * r)[:, None]
    sk_min *= (r * r)[:, None]
    sk_all *= (r * r)[:, None]
    ibr = ibr_eq = ibr_st = None
    try:  # eólica e solar já ligadas: na barra e vistas de cada barra (fatores de interação na hora mais fraca)
        ibr = ibr_by_bus(m, d, regs)
        pp_to_bus = dict(zip(m.buses["pp"], m.buses.index))
        station = [m.index.station_of(pp_to_bus[b]) if b in pp_to_bus else None for b in m.net.bus.index]
        ibr_st = interaction_mw(Zweak, ibr, station)
        ibr_eq = interaction_mw(Zweak, ibr, station, IF_REGIONAL)
    except Exception as e:  # noqa: BLE001 — sem isso, o SCR sai só o simples (e a tela avisa)
        print(f"::warning::eólica e solar por barra fora do curto: {_clean_error(e)}", flush=True)
        ibr = ibr_eq = ibr_st = None
    stats = {**src.stats, "mva_sincrono_min": round(float(online.min())), "mva_sincrono_max": round(float(online.max())),
             "disponibilidade_sincronizada": sync is not None}
    return ShortCircuitResult(sk_min=sk_min, sk_max=sk_max, online_mva=online, weak_hour=weak, strong_hour=strong,
                              check=check, stats=stats, ibr_mw=ibr, ibr_eq_mw=ibr_eq, ibr_station_mw=ibr_st,
                              sk_min_all=sk_all.min(axis=1))
