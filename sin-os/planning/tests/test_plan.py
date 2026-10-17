"""Testes do planejamento: derivações das entradas com dados sintéticos e um caso pequeno resolvido
de ponta a ponta pelo NovoModelo (escreve, valida, estima o PAR, treina, simula e agrega)."""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sin_plan import case as C  # noqa: E402
from sin_plan import inputs as I  # noqa: E402
from sin_plan import results as R  # noqa: E402

SUBS = I.SUBS


def synthetic_ena(first="2000-01-01", last="2025-12-31", seed=7) -> pd.DataFrame:
    """ENA diária com sazonalidade e persistência (MWmed), parte armazenável = 80% da bruta."""
    rng = np.random.default_rng(seed)
    days = pd.date_range(first, last, freq="D")
    base = {"SE": 35000, "S": 11000, "NE": 6000, "N": 11000}
    rows = []
    for s in SUBS:
        phase = {"SE": 0.0, "S": 2.5, "NE": 0.3, "N": 0.8}[s]
        season = 1 + 0.6 * np.cos(2 * np.pi * (days.dayofyear / 365.25) - phase)
        z = np.zeros(len(days))
        for i in range(1, len(days)):
            z[i] = 0.97 * z[i - 1] + 0.05 * rng.standard_normal()
        bruta = base[s] * season * np.exp(z)
        rows.append(pd.DataFrame({"date": days, "sub": s, "bruta": bruta, "armaz": 0.8 * bruta, "apct": 80 * season * np.exp(z)}))
    return pd.concat(rows, ignore_index=True)


def test_dates_and_seasons():
    start = dt.date(2026, 10, 16)
    st = C.stage_dates(start, 3)
    assert st == [(dt.date(2026, 10, 16), dt.date(2026, 11, 16)), (dt.date(2026, 11, 16), dt.date(2026, 12, 16)), (dt.date(2026, 12, 16), dt.date(2027, 1, 16))]
    assert C.calendar_months(start, 3) == [dt.date(2026, 10, 1), dt.date(2026, 11, 1), dt.date(2026, 12, 1), dt.date(2027, 1, 1)]
    assert C.month_weights(dt.date(2026, 10, 16), dt.date(2026, 11, 16)) == [(dt.date(2026, 10, 1), 16), (dt.date(2026, 11, 1), 15)]
    sea = C.seasons_for(start)
    assert sea["cycle_type"] == "custom" and len(sea["seasons"]) == 12
    dec = sea["seasons"][11]
    assert (dec["month_start"], dec["day_start"], dec["month_end"], dec["day_end"]) == (12, 16, 1, 15)
    assert C.seasons_for(dt.date(2026, 11, 1))["cycle_type"] == "monthly"
    # âncora nunca passa do dia 28 (fevereiro)
    assert I.anchor(dt.date(2026, 10, 30)) == dt.date(2026, 10, 28)
    assert I.anchor(dt.date(2026, 10, 15)) == dt.date(2026, 10, 16)


def test_inflow_history_windows_and_factor():
    ena = synthetic_ena(first="2024-01-01", last="2026-10-15")
    k = {"SE": 0.9, "S": 1.0, "NE": 0.8, "N": 1.0}
    h = I.inflow_history(ena, k, dt.date(2026, 10, 16))
    se = h[h["sub"] == "SE"].reset_index(drop=True)
    # janelas [16, 16) completas: a primeira começa em 16/01/2024 e a última termina no início do estudo
    assert se["start"].iloc[0] == dt.date(2024, 1, 16)
    assert se["end"].iloc[-1] == dt.date(2026, 10, 16)
    assert all((b - a).days in (28, 29, 30, 31) for a, b in zip(se["start"], se["end"]))
    w = ena[(ena["sub"] == "SE") & (ena["date"] >= "2026-09-16") & (ena["date"] < "2026-10-16")]
    # só a armazenável é água utilizável; sem REE fio d'água, tudo vai para o reservatório
    assert se["res"].iloc[-1] == pytest.approx(0.9 * w["armaz"].mean())
    assert se["ror"].iloc[-1] == 0.0


def test_usable_factor_closes_water_balance():
    days = pd.date_range("2024-01-01", "2026-01-01", freq="D")
    ena = pd.DataFrame([{"date": d, "sub": s, "bruta": 1000.0, "armaz": 800.0} for d in days for s in SUBS])
    # vertimento total 150, dos quais 50 turbináveis: o não turbinável já está fora da armazenável
    evt = pd.DataFrame([{"date": d, "sub": s, "gen": 600.0, "spill": 150.0, "spill_t": 50.0, "avail": 2000.0} for d in days for s in SUBS])
    # EAR sobe 4 MWmês por dia → 4 × 730,5 / 24 = 121,75 MWmed de ΔEAR
    ear = pd.DataFrame([{"date": d, "sub": s, "max": 1e6, "cur": 1e5 + 4.0 * i} for i, d in enumerate(days) for s in SUBS])
    k = I.usable_factor(evt, ena, ear, dt.date(2025, 12, 31), days=700)
    assert k["SE"]["k_bruto"] == pytest.approx((600 + 50 + 121.75) / 800, abs=1e-4)
    assert k["SE"]["k"] == pytest.approx(k["SE"]["k_bruto"], abs=1e-4)
    evt["spill_t"] = 400.0
    assert I.usable_factor(evt, ena, ear, dt.date(2025, 12, 31), days=700)["SE"]["k"] == I.K_RANGE[1]  # limitado à faixa plausível


def test_run_of_river_split_and_current_configuration():
    days = pd.date_range("2016-01-01", "2026-09-30", freq="D")
    rng = np.random.default_rng(1)
    anomaly = np.exp(rng.normal(0, 0.2, len(days)))
    # a usina fio d'água entra em 2018: a ENA publicada do SE salta de 60 para 100 (MLT 60 → 100)
    mlt_then = np.where(days < "2018-01-01", 60.0, 100.0)
    ena = pd.concat([pd.DataFrame({"date": days, "sub": s, "bruta": mlt_then * anomaly, "armaz": mlt_then * anomaly, "apct": 100 * anomaly}) for s in SUBS])
    ree_days = days[days >= "2018-01-01"]
    an = anomaly[days >= "2018-01-01"]
    ree = pd.concat([
        pd.DataFrame({"date": ree_days, "ree": "PARANA", "sub": "SE", "armaz": 60 * an}),
        pd.DataFrame({"date": ree_days, "ree": "MADEIRA", "sub": "SE", "armaz": 40 * an}),
        *[pd.DataFrame({"date": ree_days, "ree": n, "sub": s, "armaz": 100 * an}) for n, s in (("SUL", "S"), ("NORDESTE", "NE"), ("NORTE", "N"))],
    ])
    earmax = pd.Series({"PARANA": 1000.0, "MADEIRA": 2.0, "SUL": 500.0, "NORDESTE": 900.0, "NORTE": 400.0})
    asof = dt.date(2026, 9, 30)
    ror = I.run_of_river(ree, earmax, ena, asof)
    assert ror.rees["SE"] == ["MADEIRA"] and ror.rees["N"] == [] and ror.check_max_err < 1e-9
    assert ror.share["SE"][5] == pytest.approx(0.4)
    mlt = I.mlt_now(ena, asof)
    assert mlt["SE"][7] == pytest.approx(100.0)
    h = I.inflow_history(ena, {s: 1.0 for s in SUBS}, dt.date(2026, 10, 1), ror, mlt)
    se = h[h["sub"] == "SE"].set_index("start")
    # janela de 2016 (antes da usina) reconstruída na configuração de hoje: 100 × anomalia, 40% fio d'água
    w = ena[(ena["sub"] == "SE") & (ena["date"] >= "2016-03-01") & (ena["date"] < "2016-04-01")]
    assert se.loc[dt.date(2016, 3, 1), "res"] + se.loc[dt.date(2016, 3, 1), "ror"] == pytest.approx((w["apct"]).mean(), rel=1e-6)
    assert se.loc[dt.date(2016, 3, 1), "ror"] == pytest.approx(0.4 * w["apct"].mean(), rel=1e-6)
    # sem a correção de configuração, 2016 ficaria 40% abaixo
    raw = I.inflow_history(ena, {s: 1.0 for s in SUBS}, dt.date(2026, 10, 1), ror).set_index(["sub", "start"])
    assert raw.loc[("SE", dt.date(2016, 3, 1)), ["res", "ror"]].sum() == pytest.approx(0.6 * w["apct"].mean(), rel=1e-6)


def test_seasonal_forecast_and_growth():
    days = pd.date_range("2022-01-01", "2025-12-31", freq="D")
    x = pd.Series(100 * (1 + 0.2 * np.sin(2 * np.pi * (days.dayofyear - 80) / 365.25)), index=days)
    asof = pd.Timestamp("2025-12-31")
    f = I.seasonal_forecast(x, asof, [dt.date(2026, 6, 1), dt.date(2027, 6, 1)], 0.0)
    jun = x[x.index.month == 6].mean()
    assert f[dt.date(2026, 6, 1)] == pytest.approx(jun, rel=0.01)
    g = I.seasonal_forecast(x, asof, [dt.date(2026, 6, 1)], 0.05)
    assert g[dt.date(2026, 6, 1)] / f[dt.date(2026, 6, 1)] == pytest.approx(1.05 ** ((pd.Timestamp("2026-06-15") - pd.Timestamp("2025-07-02")).days / 365.25), rel=1e-6)
    assert I.ncs_growth(0.2, 1) == pytest.approx(1.2)
    assert I.ncs_growth(0.2, 2) == pytest.approx(1.2 * 1.1)
    assert I.ncs_growth(0.2, 1.5) == pytest.approx(1.2 * 1.1 ** 0.5)


def test_storage_envelope_and_joint_limits():
    days = pd.date_range("2000-01-01", "2025-12-31", freq="D")
    pct = 50 + 30 * np.sin(2 * np.pi * days.dayofyear / 365.25)
    ear = pd.concat([pd.DataFrame({"date": days, "sub": s, "max": 100.0, "cur": pct}) for s in SUBS], ignore_index=True)
    env = I.storage_envelope(ear, dt.date(2025, 12, 31))
    for m in range(1, 13):
        x = pct[days.month == m]
        assert env["SE"][m]["min"] == pytest.approx(x.min(), abs=0.01)
        assert env["SE"][m]["max"] == pytest.approx(min(100, x.max() + I.ENVELOPE_CEIL_MARGIN_PP), abs=0.01)
    ts = pd.date_range("2025-01-01", "2025-12-31 23:00", freq="h")
    ic = np.linspace(-5000, 3000, len(ts))
    bal = pd.concat([pd.DataFrame({"ts": ts, "sub": s, "ic": ic}) for s in SUBS], ignore_index=True)
    lim = I.joint_limits(bal, dt.date(2025, 12, 31))
    assert lim["N"]["recebe_mw"] == pytest.approx(np.quantile(-ic[ic < 0], 0.995), abs=1)
    assert lim["N"]["exporta_mw"] == pytest.approx(np.quantile(ic[ic > 0], 0.995), abs=1)


def test_min_outflow_is_low_quantile_of_daily_generation():
    days = pd.date_range("2025-01-01", "2025-12-31", freq="D")
    gen = 3000 + 500 * np.sin(2 * np.pi * days.dayofyear / 365.25)
    evt = pd.concat([pd.DataFrame({"date": days, "sub": s, "gen": gen}) for s in SUBS], ignore_index=True)
    mo = I.min_outflow(evt, dt.date(2025, 12, 31), ["S", "NE"])
    assert set(mo) == {"S", "NE"}
    assert mo["NE"] == pytest.approx(np.quantile(gen, I.MIN_OUTFLOW_QUANTILE), abs=0.1)
    with pytest.raises(RuntimeError):
        I.min_outflow(evt[evt["date"] < "2025-06-01"], dt.date(2025, 12, 31), ["NE"])


def test_implied_risk_path_brackets_and_limits():
    import math

    from sin_plan import calibrate as K

    # caminho: λ até 0,99 e depois o piso do SE; ida e volta pelo índice
    assert K.point(K.index(0.931)) == (0.931, 0.0) and K.point(K.index(0.99, 12.0)) == (0.99, 12.0)
    assert K.point(K.V_MAX + 5) == (K.LAM_MAX, K.FLOOR_MAX_PP) and K.point(-1) == (0.0, 0.0)

    # curva medida em jun/2025 (λ → CMO do 1º estágio, SE): lenta até 0,8, dispara perto de 1 e satura
    pts = [(0.0, 0.0), (0.4, 17.56), (0.904, 170.73), (0.931, 221.92), (0.954, 247.72), (0.99, 249.0)]

    def jun25(lam, floor_pp):
        v = -math.log(1 - min(lam, K.LAM_MAX))
        xs = [-math.log(1 - x) for x, _ in pts]
        return float(np.interp(v, xs, [y for _, y in pts])) + 9.0 * floor_pp  # o piso encarece a água

    calls = []
    r = K.implied_risk(lambda lam, fl: calls.append((lam, fl)) or jun25(lam, fl), 211.85)
    assert r["limite"] is None and abs(r["cmo"] - 211.85) <= r["tolerancia"] and len(calls) <= K.MAX_RUNS
    assert calls[0] == (0.4, 0.0) and 0.9 < r["lambda"] < 0.95 and r["piso_pp"] == 0.0
    # partida a quente no ponto da rodada anterior: duas rodadas (a pura e a do palpite)
    warm = []
    r2 = K.implied_risk(lambda lam, fl: warm.append((lam, fl)) or jun25(lam, fl), 215.0, guess=(0.93, 0.0))
    assert warm == [(0.4, 0.0), (0.93, 0.0)] and r2["lambda"] == 0.93
    # λ saturado (dez/2025: CMO ≈ 0 até λ 0,99): a busca segue pelo piso do SE
    def dec25(lam, floor_pp):
        return 0.2 + 12.0 * max(0.0, floor_pp - 8.0)
    d = K.implied_risk(dec25, 300.0)
    assert d["lambda"] == K.LAM_MAX and d["piso_pp"] > 8 and abs(d["cmo"] - 300.0) <= d["tolerancia"] and d["limite"] is None
    # alvo acima do que o caminho alcança: teto; abaixo do valor esperado: piso
    top = K.implied_risk(lambda lam, fl: 100.0 * lam, 400.0, max_runs=12)
    assert top["limite"] == "teto" and top["piso_pp"] == K.FLOOR_MAX_PP
    floor = K.implied_risk(lambda lam, fl: 50 + 100 * lam, 10.0)
    assert floor["lambda"] == 0.0 and floor["limite"] == "piso"
    low = K.implied_risk(lambda lam, fl: 300 * lam, 30.0)
    assert low["lambda"] < 0.4 and abs(low["cmo"] - 30.0) <= low["tolerancia"]
    hours = pd.date_range("2026-01-01", "2026-01-31 23:00", freq="h")
    hc = pd.concat([pd.DataFrame({"sub": s, "h": hours, "cmo": 100.0 + i}) for i, s in enumerate(SUBS)], ignore_index=True)
    assert K.target_cmo(hc, dt.date(2026, 2, 1)) == {"SE": 100.0, "S": 101.0, "NE": 102.0, "N": 103.0}
    with pytest.raises(RuntimeError):
        K.target_cmo(hc, dt.date(2026, 3, 1))


def test_published_combination_weights_and_band():
    rng = np.random.default_rng(7)
    rows = []
    for i in range(18):
        mes = f"{2025 + (i // 12)}-{i % 12 + 1:02d}"
        real0 = 150 + 50 * np.sin(i / 3)
        sub, hz = {}, []
        for s in SUBS:
            sub[s] = {"mercado": {"dessem14_ponta": real0 + rng.normal(0, 10)}}
        for h in range(6):
            real = real0 + 20 * h
            hz.append({"h": h, "mes": mes, "realizado": {s: real for s in SUBS},
                       # o SDDP acerta o 1º mês e erra cada vez mais depois; a âncora congela o nível
                       "pld_ponta": {s: {"p10": None, "p50": real + (0 if h == 0 else 80 * h), "p90": None} for s in SUBS}})
        rows.append({"mes": mes, "sub": sub, "horizonte": hz})
    val = {"meses": rows}
    w = R.blend_weights(val)
    assert [x["h"] for x in w] == list(range(6))
    assert w[0]["peso"] > 0.5 and all(a["peso"] >= b["peso"] for a, b in zip(w, w[1:]))  # não cresce com o horizonte
    assert R._nonincreasing([0.2, 0.5, 0.1]) == [0.35, 0.35, 0.1]
    res = R.combination_residuals(val, w)
    assert set(res) == set(SUBS) and len(res["SE"]) == 6
    months = [{"mes": "2026-11", "cobertura": 1.0, "pld": {s: {"mean": 90.0, "p10": 85.0, "p50": 90.0, "p90": 95.0} for s in SUBS}},
              {"mes": "2027-04", "cobertura": 1.0, "pld": {s: {"mean": 70.0, "p10": 60.0, "p50": 70.0, "p90": 80.0} for s in SUBS}}]
    d14 = {m["mes"]: {s: 100.0 for s in SUBS} for m in months}
    R.apply_combination(months, d14, w, res, dt.date(2026, 10, 17))
    import run  # noqa: E402  (o log da rodada diária sai antes do envio: não pode quebrar)
    lines = run.pld_lines(months[0])
    assert lines[0].startswith("PLD publicado 2026-11") and lines[1].startswith("PLD do SDDP 2026-11") and "SE 90.0 (P10 85.0–P90 95.0)" in lines[1]
    assert run.pld_lines({**months[0], "pld_previsto": None}) == lines[1:]
    for m in months:
        lim = R.limits(int(m["mes"][:4]))
        for s in SUBS:
            q = m["pld_previsto"][s]
            assert lim["min"] <= q["p10"] <= q["p50"] <= q["p90"] <= lim["max_h"]
        assert 0 <= m["peso_sddp"] <= 1
    # mais longe, mais peso na âncora
    assert months[1]["peso_sddp"] <= months[0]["peso_sddp"]
    # sem retroanálise não há combinação
    bare = [{"mes": "2026-11", "cobertura": 1.0, "pld": {s: {"mean": 90.0, "p10": 85.0, "p50": 90.0, "p90": 95.0} for s in SUBS}}]
    R.apply_combination(bare, d14, R.blend_weights(None), {}, dt.date(2026, 10, 17))
    assert "pld_previsto" not in bare[0]
    # fora da amostra: cada mês da retroanálise refeito com pesos e faixa calibrados sem ele
    loo = R.combination_loo(val)
    r0 = rows[4]
    w0 = R.blend_weights(val, exclude=r0["mes"])
    x = loo[r0["mes"]]["SE"][0]
    assert x["p50"] == w0[0]["peso"] * r0["horizonte"][0]["pld_ponta"]["SE"]["p50"] + (1 - w0[0]["peso"]) * r0["sub"]["SE"]["mercado"]["dessem14_ponta"]
    assert [y["h"] for y in loo[r0["mes"]]["SE"]] == list(range(6)) and x["p10"] <= x["p50"] <= x["p90"]
    assert R.combination_loo(None) == {}


def test_interchange_sign():
    raw = pd.DataFrame({
        "din_instante": ["2026-01-01 00:00:00"] * 2,
        "id_subsistema_origem": ["N", "SE"], "id_subsistema_destino": ["SE", "N"],
        "val_intercambiomwmed": ["100", "40"],
    })
    out = I.tidy_interchange(raw)
    assert out.loc[out["pair"] == "N-SE", "flow"].iloc[0] == pytest.approx(60.0)


def balance_year(seed=3) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    ts = pd.date_range("2024-01-01", "2025-12-31 23:00", freq="h")
    hour = ts.hour.to_numpy()
    rows = []
    for s, base in (("SE", 42000), ("S", 13000), ("NE", 13000), ("N", 9000)):
        solar = np.clip(np.sin(np.pi * (hour - 6) / 12), 0, None) * base * 0.15
        load = base * (1 + 0.12 * np.sin(np.pi * (hour - 8) / 14)) + rng.normal(0, base * 0.01, len(ts))
        rows.append(pd.DataFrame({"ts": ts, "sub": s, "hydro": base * 0.6, "thermal": base * 0.08, "wind": base * 0.1 + rng.normal(0, base * 0.01, len(ts)),
                                  "solar": solar, "load": load, "ic": 0.0}))
    return pd.concat(rows, ignore_index=True)


def test_block_profile_factors_average_to_one():
    b = balance_year()
    b["m"] = b["ts"].dt.to_period("M")
    blocks = I.block_profile(b, pd.Period("2025-12", "M"))
    for cal in (1, 7):
        x = blocks[(blocks["cal"] == cal) & (blocks["sub"] == "SE")]
        assert x["share"].sum() == pytest.approx(1.0)
        for col in ("load_f", "wind_f", "solar_f"):
            assert (x["share"] * x[col]).sum() == pytest.approx(1.0, abs=0.01)
        # a ponta líquida (pesada) é de noite: quase sem solar
        assert x[x["block"] == 0]["solar_f"].iloc[0] < 0.5


def test_stage_pld_floor_cap_and_structural():
    cmo = np.array([[[10.0, 50.0, 3000.0]]])  # 1 cenário × 1 estágio × 3 patamares
    hours = np.array([[100.0, 100.0, 100.0]])
    lim = np.array([[57.31, 1611.04, 785.27]])
    v = R.stage_pld(cmo, hours, lim)
    assert v[0, 0] == pytest.approx(min((57.31 + 57.31 + 1611.04) / 3, 785.27))
    low = R.stage_pld(np.array([[[10.0, 20.0, 30.0]]]), hours, lim)
    assert low[0, 0] == pytest.approx(57.31)


def small_case(tmp: Path) -> C.Case:
    start = dt.date(2026, 1, 16)
    asof = start - dt.timedelta(days=1)
    ena = synthetic_ena(last=asof.isoformat())
    k = {s: 0.95 for s in SUBS}
    bal = balance_year()
    days_r = pd.date_range("2018-01-01", asof, freq="D")
    se = ena[(ena["sub"] == "SE") & (ena["date"] >= "2018-01-01")]
    ree = pd.DataFrame({"date": se["date"], "ree": "MADEIRA", "sub": "SE", "armaz": 0.3 * se["armaz"]})
    ror = I.RunOfRiver(rees={"SE": ["MADEIRA"], "S": [], "NE": [], "N": []}, daily=ree.groupby(["date", "sub"])["armaz"].sum().rename("ror").reset_index(),
                       share={s: {m: (0.3 if s == "SE" else 0.0) for m in range(1, 13)} for s in SUBS}, table=[], check_max_err=0.0)
    assert len(days_r) > 0
    plants = pd.DataFrame([
        {"code": 1, "name": "Nuclear", "sub": "SE", "cvu": 30.0, "min_mw": 1500.0, "max_mw": 1900.0, "gen": 1800.0},
        {"code": 2, "name": "Gás SE", "sub": "SE", "cvu": 250.0, "min_mw": 0.0, "max_mw": 6000.0, "gen": 500.0},
        {"code": 3, "name": "Gás NE", "sub": "NE", "cvu": 400.0, "min_mw": 0.0, "max_mw": 3000.0, "gen": 100.0},
        {"code": 4, "name": "Óleo N", "sub": "N", "cvu": 1500.0, "min_mw": 0.0, "max_mw": 1500.0, "gen": 0.0},
        {"code": 5, "name": "Carvão S", "sub": "S", "cvu": 180.0, "min_mw": 300.0, "max_mw": 1500.0, "gen": 600.0},
    ])
    fleet = I.Fleet(plants=plants, no_cvu_mw={s: 0.0 for s in SUBS}, study="sintético", dispatched_mw={s: 0.0 for s in SUBS})
    params = C.Params(horizon_months=6, openings=3, forward_passes=2, iterations=4, sim_scenarios=8)
    months = C.calendar_months(start, params.horizon_months)
    evt = pd.DataFrame([{"date": pd.Timestamp(d), "sub": s, "gen": 0.6 * b, "spill": 0.0, "avail": b}
                        for d in pd.date_range(asof - dt.timedelta(days=40), asof) for s, b in (("SE", 42000), ("S", 13000), ("NE", 13000), ("N", 9000))])
    demand = I.demand(bal, evt, fleet, dt.date(2025, 12, 31), months)
    days = pd.date_range("2000-01-01", asof, freq="D")
    ear = pd.concat([pd.DataFrame({"date": days, "sub": s, "max": 100.0, "cur": 50 + 30 * np.sin(2 * np.pi * days.dayofyear / 365.25)}) for s in SUBS])
    return C.Case(
        start=start, asof=asof,
        k={s: {"k": 0.95, "k_bruto": 0.95, "dias": 700, "geracao_mwmed": 0.0, "vertimento_mwmed": 0.0, "delta_ear_mwmed": 0.0, "ena_mwmed": 0.0} for s in SUBS},
        store={"SE": {"max_mwmes": 200000.0, "cur_mwmes": 110000.0, "pct": 55.0}, "S": {"max_mwmes": 20000.0, "cur_mwmes": 15000.0, "pct": 75.0},
               "NE": {"max_mwmes": 50000.0, "cur_mwmes": 30000.0, "pct": 60.0}, "N": {"max_mwmes": 15000.0, "cur_mwmes": 9000.0, "pct": 60.0}},
        hydro_mw={"SE": 45000.0, "S": 13000.0, "NE": 9000.0, "N": 17000.0},
        history=I.inflow_history(ena, k, start, ror, I.mlt_now(ena, asof)),
        ror=ror,
        fleet=fleet,
        lines=[{"pair": "N-NE", "from": "N", "to": "NE", "direct_mw": 4500.0, "reverse_mw": 6000.0, "mean_mw": 0.0},
               {"pair": "N-SE", "from": "N", "to": "SE", "direct_mw": 9000.0, "reverse_mw": 2000.0, "mean_mw": 0.0},
               {"pair": "NE-SE", "from": "NE", "to": "SE", "direct_mw": 8000.0, "reverse_mw": 4500.0, "mean_mw": 0.0},
               {"pair": "S-SE", "from": "S", "to": "SE", "direct_mw": 6500.0, "reverse_mw": 11000.0, "mean_mw": 0.0}],
        demand=demand,
        params=params,
        joint={"SE": {"exporta_mw": 7000.0, "recebe_mw": 13000.0}, "S": {"exporta_mw": 6500.0, "recebe_mw": 11000.0},
               "NE": {"exporta_mw": 14000.0, "recebe_mw": 8000.0}, "N": {"exporta_mw": 11000.0, "recebe_mw": 5600.0}},
        envelope=I.storage_envelope(ear, asof),
        min_outflow={"NE": 2500.0},
    )


def test_floor_shift_raises_only_the_se_floor_and_stays_below_the_ceiling(tmp_path: Path):
    import dataclasses

    import pyarrow.parquet as pq

    cs = small_case(tmp_path)

    def floors(shift):
        c = dataclasses.replace(cs, params=dataclasses.replace(cs.params, floor_shift_pp=shift))
        d = tmp_path / f"piso{shift}"
        C.write(c, d)
        b = pq.read_table(d / "constraints/generic_constraint_bounds.parquet").to_pandas()
        return {s: b[b["constraint_id"] == 20 + C.BUS[s]]["bound_lower"].to_numpy() for s in SUBS}

    base, up = floors(0.0), floors(12.0)
    vmax = cs.store["SE"]["max_mwmes"] * I.MWMES_HM3
    for sid, (a, b) in enumerate(cs.stages()):
        env = cs.envelope["SE"][(b - dt.timedelta(days=1)).month]
        pct = max(env["min"], min(env["min"] + 12.0, env["max"] - C.FLOOR_CEIL_GAP_PP))  # nunca abaixo do mínimo operado
        assert up["SE"][sid] == pytest.approx(vmax * round(pct, 2) / 100, rel=1e-6)
        assert up["SE"][sid] >= base["SE"][sid]
    for s in ("S", "NE", "N"):
        assert (up[s] == base[s]).all()


def test_small_case_end_to_end(tmp_path: Path):
    pytest.importorskip("novomodelo")
    from sin_plan import solve

    cs = small_case(tmp_path)
    case_dir, out_dir = tmp_path / "caso", tmp_path / "caso-out"
    summary = C.write(cs, case_dir)
    assert summary["estagios"] == 6 and summary["termicas"] == 5 and summary["fio_dagua"] == {"SE": 4}
    hy = {h["name"]: h for h in __import__("json").loads((case_dir / "system/hydros.json").read_text())["hydros"]}
    assert hy["REE_NE"]["outflow"]["min_outflow_m3s"] == 2500.0 and hy["REE_SE"]["outflow"]["min_outflow_m3s"] == 0.0
    est = solve.estimate(case_dir, cs.params)
    assert est["metodo"] in ("PAR(p)-A", "PAR(p)")
    run = solve.run(case_dir, out_dir, threads=2)
    assert run["iterations"] == 4
    sim = R.load_sim(cs, out_dir)
    assert sim.scenarios == 8
    rep = R.report(cs, sim)
    lim = R.limits(2026)
    for m in rep["meses"]:
        for s in SUBS:
            q = m["pld"][s]
            assert lim["min"] - 1e-6 <= q["p10"] <= q["p50"] <= q["p90"] <= lim["max_h"] + 1e-6
    for e in rep["estagios"]:
        for s in SUBS:
            assert 0 <= e["ear_fim_pct"][s]["p50"] <= 100.5
            assert 0 <= e["risco_deficit"][s] <= 1
    # defluência mínima no NE: turbinado + vertido + folga cobre o piso, e a folga (penalizada) só
    # aparece quando a água vale mais que a penalidade de violação
    hy = R.read(out_dir, "hydros", ["scenario_id", "stage_id", "block_id", "hydro_id", "outflow_m3s", "outflow_slack_below_m3s"])
    hy = hy[hy["block_id"].notna() & (hy["hydro_id"] == C.BUS["NE"])]
    assert (hy["outflow_m3s"] + hy["outflow_slack_below_m3s"]).min() >= 2500.0 - 1e-3
    bu = R.read(out_dir, "buses", ["scenario_id", "stage_id", "block_id", "bus_id", "spot_price"])
    bu = bu[bu["block_id"].notna() & (bu["bus_id"] == C.BUS["NE"])]
    pen = __import__("json").loads((case_dir / "penalties.json").read_text())["hydro"]["outflow_violation_below_cost"]
    j = hy.merge(bu, on=["scenario_id", "stage_id", "block_id"])
    assert (j.loc[j["spot_price"] < pen, "outflow_slack_below_m3s"] < 1e-6).all()
    # teto operativo: o armazenamento simulado nunca passa do máximo já operado no mês
    for sid, (a, b) in enumerate(cs.stages()):
        cal = (b - dt.timedelta(days=1)).month
        assert np.nanmax(sim.ear_pct["SE"][:, sid]) <= cs.envelope["SE"][cal]["max"] + 0.05
