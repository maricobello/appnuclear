"""Busca os dados no ONS e monta o `Case` para uma data de referência (hoje ou um dia passado).

Para um dia passado (retroanálise), só entra o que estava publicado até a véspera do início: ENA,
EAR, balanço e geração/vertimento até `asof`, a frota térmica dos 28 dias anteriores e o CVU da
semana do PMO em vigor. Nada do futuro vaza para o caso.
"""

from __future__ import annotations

import datetime as dt

import pandas as pd

from . import case as C
from . import inputs as I
from . import ons


def load(f: ons.Fetcher, upto: dt.date) -> dict:
    """Lê tudo o que o caso precisa até `upto` (inclusive)."""
    y = upto.year
    this = dt.date.today().year
    cur = (dt.date.today().year, dt.date.today().month)
    ena = I.ena_daily(f, upto)
    ree = I.ena_ree_daily(f, upto)
    ear = I.ear_daily(f, range(I.EAR_FIRST_YEAR, y + 1), this)
    bal = I.balance_hourly(f, range(y - 2, y + 1), this)
    evt = I.evt_daily(f, I.months_back(upto, 26), cur)
    th = I.thermal_hourly(f, I.months_back(upto, 2), cur)
    cap = fac = None
    if th["avail"].notna().mean() < 0.5:
        # arquivo antigo (antes de 2026): fator de disponibilidade medido nos dois últimos meses publicados
        today = dt.date.today()
        ref = I.thermal_hourly(f, I.months_back(today.replace(day=1) - dt.timedelta(days=1), 2), cur)
        cap = I.thermal_registry(f, upto)
        fac = I.availability_factor(ref, I.thermal_registry(f, today))
    cvu = I.cvu_weekly(f, [y - 1, y, y + 1] if y < this else [y - 1, y], this)
    ic = I.interchange_hourly(f, range(y - 1, y + 1), this)
    cut = pd.Timestamp(upto) + pd.Timedelta(days=1)
    return {
        "ena": ena[ena["date"] < cut], "ear": ear[ear["date"] < cut], "bal": bal[bal["ts"] < cut],
        "evt": evt[evt["date"] < cut], "th": th[th["ts"] < cut], "cvu": cvu, "ic": ic[ic["ts"] < cut],
        "cap": cap, "avail_factor": fac,
        "ree": ree[ree["date"] < cut], "ree_max": I.ear_ree_max(f, upto),
    }


def assemble(data: dict, params: C.Params | None = None, asof: dt.date | None = None) -> C.Case:
    params = params or C.Params()
    ena, ear = data["ena"], data["ear"]
    start = I.anchor(asof or I.as_of(ena, ear))
    asof = start - dt.timedelta(days=1)
    kk = I.usable_factor(data["evt"], ena, ear, asof)
    k = {s: v["k"] for s, v in kk.items()}
    fleet = I.thermal_fleet(data["th"], data["cvu"], start, cap=data.get("cap"), factor=data.get("avail_factor"))
    ror = I.run_of_river(data["ree"], data["ree_max"], ena, asof)
    return C.Case(
        start=start, asof=asof, k=kk,
        store=I.storage(ear, asof),
        hydro_mw=I.hydro_availability(data["evt"], asof),
        history=I.inflow_history(ena, k, start, ror, I.mlt_now(ena, asof)),
        ror=ror,
        fleet=fleet,
        lines=I.line_limits(data["ic"], asof),
        joint=I.joint_limits(data["bal"], asof),
        envelope=I.storage_envelope(ear, asof),
        demand=I.demand(data["bal"], data["evt"], fleet, asof, C.calendar_months(start, params.horizon_months)),
        params=params,
        min_outflow=I.min_outflow(data["evt"], asof, [s for s in I.SUBS if not ror.rees.get(s)]),
    )
