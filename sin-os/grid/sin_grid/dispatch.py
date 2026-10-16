"""Despacho real de um dia, hora a hora, nas barras do modelo.

- geração: ``geracao_usina_2_ho`` (MWmed por usina e hora) → barra pelo casamento de match.py;
- carga: ``balanco_energia_subsistema_ho`` (carga de cada subsistema por hora), rateada entre as
  barras de carga do subsistema na proporção da potência dos transformadores que descem para ≤ 138 kV;
- geração embutida (micro/minigeração distribuída, pequenas usinas e o que não casou com barra):
  abate a carga das barras do próprio estado, na mesma proporção — é assim que a rede básica a vê;
- elos de corrente contínua e conversoras de frequência: ``programacao_fluxo_controlado`` (MW
  programados por polo, a cada meia hora; média das duas meias horas) como injeções nas barras AC
  das conversoras. O lado de 50 Hz de Itaipu fica fora do modelo: a energia de Itaipu 50 Hz entra
  só pela injeção em Ibiúna.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import ons
from .match import key, map_plants
from .model import GridModel

SUBS = ("N", "NE", "SE", "S")
KV_RE = re.compile(r"(\d{2,3})\s*kV", re.I)

#: elemento de fluxo controlado (prefixo do nome no ONS) → barra AC de cada terminal (número ANAREDE).
#: Conferido no cadastro de subestações do ONS (nome, tensão e estado da barra).
HVDC_TERMINALS: dict[str, dict[str, int | None]] = {
    "XNG-EST": {"1": 8100, "2": 3010},  # Xingu 500 kV (PA) → Estreito 500 kV (MG)
    "Xingu - Terminal Rio": {"1": 8100, "2": 9605},  # Xingu 500 kV → Terminal Rio 500 kV (RJ)
    "CPV-ARA2": {"1": 7055, "2": 7057},  # Coletora Porto Velho 500 kV (RO) → Araraquara 2 500 kV (SP)
    "FOZ-IBI": {"1": None, "2": 86},  # Foz do Iguaçu 50 Hz (fora do modelo) → Ibiúna 345 kV (SP)
    "BtB 1 CPV": {"1": 7055, "2": 7054},  # back-to-back: Coletora Porto Velho 500 kV → 230 kV
    "BtB 2 CPV": {"1": 7055, "2": 7054},
    "GARABI 1B": {"1": 972},  # conversora de Garabi (importação da Argentina), lado de 60 Hz
    "GARABI 2B": {"1": 973},
}
#: fluxos controlados que não viram injeção (defasadores dentro da rede AC; interligações sem barra no modelo)
HVDC_IGNORED = ("Defasador", "CF ", "IMP PARAGUAI", "LT 230 KV Boa Vista")

LOAD_KV_MAX = 138.0
LOAD_KV_MIN = 34.5


@dataclass
class Dispatch:
    date: str
    hours: list[str]
    #: MW por barra ANAREDE (colunas = horas)
    gen: pd.DataFrame
    load: pd.DataFrame
    hvdc: pd.DataFrame
    plants: pd.DataFrame
    balance: pd.DataFrame
    #: barras com compensador síncrono ou estático (cadastro de equipamentos de controle de reativo)
    compensators: list[int] = field(default_factory=list)
    stats: dict = field(default_factory=dict)


def _hourly(df: pd.DataFrame, col: str, date: str) -> pd.DataFrame:
    t = pd.to_datetime(df[col])
    return df[t.dt.strftime("%Y-%m-%d") == date].assign(h=t.dt.hour)


def load_weights(m: GridModel, plant_buses: set[int]) -> pd.DataFrame:
    """Barras de carga: lado de baixa (34,5–138 kV) de transformadores que descem da rede; peso = MVA."""
    t = m.trafos
    t = t[(t["kv_lv"] <= LOAD_KV_MAX) & (t["kv_lv"] >= LOAD_KV_MIN) & ~t["lv"].isin(plant_buses)]
    w = t.groupby("lv")["mva"].sum().rename("w").to_frame()
    w["sub"] = m.buses.loc[w.index, "sub"].to_numpy()
    w["uf"] = m.buses.loc[w.index, "uf"].to_numpy()
    return w[w["sub"].isin(SUBS)]


def build(m: GridModel, f: ons.Fetcher, regs: dict[str, pd.DataFrame], date: str) -> Dispatch:
    y, mo = int(date[:4]), int(date[5:7])
    gen_raw = ons.read_any(f.get(ons.generation_path(y, mo), max_age_s=6 * 3600))
    gen_day = _hourly(gen_raw, "din_instante", date).fillna({"ceg": "", "id_ons": ""})
    gen_day["val_geracao"] = ons.num(gen_day["val_geracao"]).fillna(0.0)
    hours = sorted(gen_day["h"].unique().tolist())
    if len(hours) < 24:
        raise ValueError(f"geração por usina incompleta em {date}: {len(hours)} horas")

    plants = map_plants(gen_day, regs["unidades_geradoras"], regs["modalidade_usinas"], regs["conjuntos"], m.index)
    by_plant = gen_day.groupby(["ceg", "id_ons", "nom_usina", "h"], dropna=False)["val_geracao"].sum().unstack("h").reindex(columns=range(24), fill_value=0.0).fillna(0.0)
    pl = plants.drop_duplicates(["ceg", "id_ons", "nom_usina"]).set_index(["ceg", "id_ons", "nom_usina"])
    by_plant = by_plant.join(pl[["bus", "metodo", "id_estado", "id_subsistema"]])

    mapped = by_plant[by_plant["bus"].notna()]
    gen = mapped.groupby("bus")[list(range(24))].sum()
    gen.index = gen.index.astype(int)

    embedded = by_plant[by_plant["metodo"].isin(["embutida", "sem barra"])].groupby("id_estado")[list(range(24))].sum()
    via_hvdc = by_plant[by_plant["metodo"] == "elo CC"][list(range(24))].sum()

    # ---- carga por subsistema (balanço horário do ONS)
    bal_raw = ons.read_any(f.get(ons.balance_path(y), max_age_s=6 * 3600))
    bal_raw["id_subsistema"] = bal_raw["id_subsistema"].astype(str).str.strip()
    bal = _hourly(bal_raw, "din_instante", date)
    bal = bal[bal["id_subsistema"].isin(SUBS)].assign(val_carga=lambda x: ons.num(x["val_carga"]))
    carga = bal.pivot_table(index="id_subsistema", columns="h", values="val_carga", aggfunc="sum").reindex(columns=range(24))
    if carga.isna().any().any() or len(carga) < 4:
        raise ValueError(f"balanço do ONS incompleto em {date}")

    w = load_weights(m, set(gen.index))
    load = pd.DataFrame(0.0, index=w.index, columns=range(24))
    for s in SUBS:
        ws = w[w["sub"] == s]["w"]
        if ws.sum() <= 0:
            raise ValueError(f"sem barras de carga no subsistema {s}")
        load.loc[ws.index] += np.outer(ws / ws.sum(), carga.loc[s].to_numpy())
    # geração embutida abate a carga do estado (estado sem barra de carga: subsistema da usina)
    lost_uf = 0.0
    for uf, row in embedded.iterrows():
        wu = w[w["uf"] == uf]["w"]
        if wu.sum() <= 0:
            lost_uf += float(row.sum())
            continue
        load.loc[wu.index] -= np.outer(wu / wu.sum(), row.to_numpy())

    # ---- elos CC e conversoras
    fc_raw = ons.read_any(f.get(ons.controlled_flow_path(date), max_age_s=6 * 3600))
    # linha sem patamar ou terminal não tem onde entrar: fica de fora
    fc_raw = fc_raw.assign(p=ons.num(fc_raw["num_patamar"]), t=ons.num(fc_raw["tip_terminal"])).dropna(subset=["p", "t"])
    fc_raw["h"] = (fc_raw["p"].astype(int) - 1) // 2
    fc_raw["val_carga"] = ons.num(fc_raw["val_carga"]).fillna(0.0)
    fc_raw["tip_terminal"] = fc_raw["t"].astype(int)
    fc = fc_raw.groupby(["nom_elementofluxocontrolado", "tip_terminal", "h"])["val_carga"].mean().unstack("h").reindex(columns=range(24)).fillna(0.0)
    hv = {}
    unmapped_fc = []
    for (name, term), row in fc.iterrows():
        if any(name.startswith(p) for p in HVDC_IGNORED):
            continue
        k = next((k for k in HVDC_TERMINALS if k in name), None)
        if k is None:
            if row.abs().sum() > 0:
                unmapped_fc.append(name)
            continue
        b = HVDC_TERMINALS[k].get(str(term))
        if b is None:
            continue
        if b not in m.buses.index:
            unmapped_fc.append(f"{name} (barra {b} fora do modelo)")
            continue
        hv[b] = hv.get(b, 0) + row.to_numpy()
    hvdc = pd.DataFrame(hv, index=range(24)).T if hv else pd.DataFrame(columns=range(24))

    # ---- compensadores (controle de tensão): nome do equipamento traz a tensão, a subestação vem no cadastro
    comp = []
    eq = regs.get("controle_reativo")
    if eq is not None:
        eq = ons.active(eq, date)
        eq = eq[eq["nom_tipoequipamento"].str.contains("Compensador", na=False)]
        for r in eq.itertuples():
            kvm = KV_RE.search(str(r.nom_equipamento))
            b = m.index.find(key(r.nom_subestacao), float(kvm.group(1)) if kvm else None, uf=r.id_estado)
            if b is not None:
                comp.append(int(b))
    total_gen = by_plant[list(range(24))].sum()
    stats = {
        "geracao_mwh": float(total_gen.sum()),
        "geracao_por_metodo_mwh": by_plant.groupby("metodo")[list(range(24))].sum().sum(axis=1).round(1).to_dict(),
        "geracao_rede_basica_casada": float(mapped[list(range(24))].sum().sum() / max(1.0, by_plant[~by_plant["metodo"].isin(["embutida", "elo CC"])][list(range(24))].sum().sum())),
        "itaipu_50hz_mwh": float(via_hvdc.sum()),
        "carga_mwh": float(carga.sum().sum()),
        "barras_de_carga": int(len(w)),
        "barras_com_geracao": int(len(gen)),
        "embutida_sem_barra_de_carga_mwh": lost_uf,
        "fluxos_controlados_sem_barra": sorted(set(unmapped_fc)),
    }
    stats["compensadores_casados"] = len(set(comp))
    stats["compensadores_cadastro"] = int(len(eq)) if eq is not None else 0
    return Dispatch(date=date, hours=[f"{date}T{h:02d}:00" for h in range(24)], gen=gen, load=load, hvdc=hvdc, plants=plants, balance=bal,
                    compensators=sorted(set(comp)), stats=stats)
