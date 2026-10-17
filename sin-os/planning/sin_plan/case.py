"""Escreve o caso do NovoModelo (JSON + Parquet) a partir das entradas medidas em `inputs`.

Barras: SE=0, S=1, NE=2, N=3. Hidrelétricas: reservatório equivalente i de cada subsistema e, onde
há REE sem estoque (SE e N), uma usina fio d'água numerada a partir de 4, com uma restrição genérica
que limita a soma das duas à disponibilidade hidráulica.
Térmicas usina a usina (CVU da semana do PMO), eólica e solar como fontes não controláveis com
corte, carga líquida da parcela fixa, três patamares por mês e CVaR nos estágios.
"""

from __future__ import annotations

import calendar
import datetime as dt
import json
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from . import inputs as I

SCHEMA = "https://raw.githubusercontent.com/ons-ccee-epe/novomodelo/refs/heads/main/schemas/{}.schema.json"
#: 1 hm³ turbinado com produtividade 1 MW/(m³/s) gera 10⁶/3600 MWh.
MWH_PER_HM3 = 1e6 / 3600
BUS = {s: i for i, s in enumerate(I.SUBS)}
#: Subsistema cujo piso a calibração eleva e a folga mínima que o piso mantém abaixo do teto do mês.
FLOOR_SHIFT_SUB = "SE"
FLOOR_CEIL_GAP_PP = 5.0
NAMES = {"SE": "SUDESTE", "S": "SUL", "NE": "NORDESTE", "N": "NORTE"}
TECH = {"wind": "EOL", "solar": "UFV"}


@dataclass
class Params:
    """Parâmetros oficiais (ou convencionais do PMO) e de execução — todos vão para o relatório."""
    #: Custo de déficit de patamar único (R$/MWh) — valor homologado pela ANEEL usado pela CPAMP.
    deficit_cost: float = 7643.82
    #: CVaR da operação e da formação de preço recomendado pela CPAMP (α = 15%, λ = 40%).
    cvar_alpha: float = 0.15
    cvar_lambda: float = 0.40
    #: Taxa de desconto anual dos decks do PMO (dger.dat).
    discount_rate: float = 0.12
    horizon_months: int = 60
    openings: int = 20
    forward_passes: int = 8
    iterations: int = 60
    sim_scenarios: int = 200
    max_order: int = 6
    order_selection: str = "pacf_annual"
    seed: int = 20261017
    spill_cost: float = 0.01
    curtail_cost: float = 0.01
    exchange_cost: float = 0.01
    #: Penalidade do piso operativo de armazenamento, em R$/MWh de energia armazenada abaixo do piso,
    #: como múltiplo do CVU mais caro da frota: o modelo despacha toda térmica antes de violar o piso
    #: (o despacho por segurança energética do ONS), mas não chega ao custo de déficit.
    floor_cvu_mult: float = 1.0
    #: Elevação do piso operativo do SE (p.p. de EAR), a segunda alavanca da calibração do valor da
    #: água (o análogo do volume mínimo operativo dos modelos oficiais); 0 no caso puro.
    floor_shift_pp: float = 0.0
    #: Multiplicadores para sensibilidades (1 = caso base).
    inflow_mult: float = 1.0
    load_mult: float = 1.0
    ncs_mult: float = 1.0

    def risk(self) -> dict | str:
        if self.cvar_lambda <= 0:
            return "expectation"
        return {"cvar": {"alpha": self.cvar_alpha, "lambda": self.cvar_lambda}}


@dataclass
class Case:
    start: dt.date
    asof: dt.date
    k: dict[str, dict]
    store: dict[str, dict]
    hydro_mw: dict[str, float]
    history: pd.DataFrame
    fleet: I.Fleet
    lines: list[dict]
    demand: I.Demand
    params: Params = field(default_factory=Params)
    #: Recebimento/exportação líquidos máximos por subsistema.
    joint: dict[str, dict[str, float]] = field(default_factory=dict)
    #: Envelope operativo do armazenamento por subsistema e mês do ano (% do máximo).
    envelope: dict[str, dict[int, dict[str, float]]] = field(default_factory=dict)
    #: REEs a fio d'água (turbináveis, sem estoque) por subsistema.
    ror: I.RunOfRiver | None = None
    #: Defluência mínima do reservatório equivalente (MW) nos subsistemas sem fio d'água.
    min_outflow: dict[str, float] = field(default_factory=dict)

    def ror_ids(self) -> dict[str, int]:
        """Usinas fio d'água só nos subsistemas com REE sem estoque, numeradas a partir de 4."""
        subs = [s for s in I.SUBS if self.ror is not None and self.ror.rees.get(s)]
        return {s: 4 + i for i, s in enumerate(subs)}

    def stages(self) -> list[tuple[dt.date, dt.date]]:
        """Estágios mensais ancorados no dia de início: [D/m, D/m+1)."""
        return stage_dates(self.start, self.params.horizon_months)


def stage_dates(start: dt.date, n: int) -> list[tuple[dt.date, dt.date]]:
    return [(I.add_months(start, i), I.add_months(start, i + 1)) for i in range(n)]


def calendar_months(start: dt.date, n: int) -> list[dt.date]:
    """Meses civis (dia 1) tocados pelos n estágios a partir de `start`."""
    end = I.add_months(start, n)
    out, m = [], I.month_start(start)
    while m < end:
        out.append(m)
        m = I.add_months(m, 1)
    return out


def month_weights(a: dt.date, b: dt.date) -> list[tuple[dt.date, int]]:
    """Dias do intervalo [a, b) em cada mês civil."""
    out, m = [], I.month_start(a)
    while m < b:
        nxt = I.add_months(m, 1)
        days = (min(b, nxt) - max(a, m)).days
        if days > 0:
            out.append((m, days))
        m = nxt
    return out


def seasons_for(start: dt.date) -> dict:
    """Estações de um mês cada, começando no dia de âncora (mensal civil quando a âncora é o dia 1)."""
    if start.day == 1:
        return {"cycle_type": "monthly", "seasons": [{"id": m - 1, "month_start": m, "label": calendar.month_name[m]} for m in range(1, 13)]}
    d = start.day
    return {"cycle_type": "custom", "seasons": [
        {"id": m - 1, "month_start": m, "day_start": d, "month_end": m % 12 + 1, "day_end": d - 1,
         "label": f"{d:02d}/{m:02d}–{d - 1:02d}/{m % 12 + 1:02d}"} for m in range(1, 13)]}


def _dump(path: Path, name: str, body: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"$schema": SCHEMA.format(name), **body}, ensure_ascii=False, indent=1))


def _parquet(path: Path, cols: dict[str, pa.Array]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.table(cols), path, compression="none")  # o leitor do NovoModelo não traz snappy


def _blend(per_month: pd.Series, a: dt.date, b: dt.date) -> float:
    w = month_weights(a, b)
    return sum(float(per_month.loc[m]) * d for m, d in w) / sum(d for _, d in w)


def _blocks(blocks_cal: pd.DataFrame, sub: str, a: dt.date, b: dt.date) -> pd.DataFrame:
    """Patamares do estágio: fatores misturados pelos dias de cada mês civil; duração do mês dominante."""
    w = month_weights(a, b)
    tot = sum(d for _, d in w)
    major = max(w, key=lambda x: x[1])[0].month
    base = blocks_cal[(blocks_cal["cal"] == major) & (blocks_cal["sub"] == sub)].sort_values("block").reset_index(drop=True)
    out = base.copy()
    for col in ("load_f", "wind_f", "solar_f"):
        out[col] = 0.0
        for m, d in w:
            x = blocks_cal[(blocks_cal["cal"] == m.month) & (blocks_cal["sub"] == sub)].sort_values("block")[col].to_numpy()
            out[col] += x * d / tot
    return out


def write(case: Case, out: Path) -> dict:
    """Escreve o caso em `out`; devolve um resumo do que entrou (vai para o relatório)."""
    p = case.params
    st = case.stages()
    d = case.demand
    _dump(out / "config.json", "config", {
        "training": {
            "selection": {"method": "sampled", "forward_passes": p.forward_passes},
            "stopping_rules": [{"type": "iteration_limit", "limit": p.iterations}],
            "scenario_source": {"seed": p.seed, "inflow": {"scheme": "in_sample"}, "load": {"scheme": "in_sample"}, "ncs": {"scheme": "in_sample"}},
        },
        "simulation": {"enabled": True, "selection": {"method": "sampled", "num_scenarios": p.sim_scenarios}},
        "modeling": {"inflow_non_negativity": {"method": "truncation"}},
        "estimation": {"max_order": p.max_order, "order_selection": p.order_selection, "min_observations_per_season": 20},
    })

    blk = {(sid, s): _blocks(d.blocks, s, a, b) for sid, (a, b) in enumerate(st) for s in I.SUBS}
    stages_json = []
    for sid, (a, b) in enumerate(st):
        hours = (b - a).days * 24
        bl = blk[(sid, "SE")]
        blocks = [{"id": int(r.block), "name": r.name.upper(), "hours": round(hours * float(r.share), 6)} for r in bl.itertuples()]
        blocks[-1]["hours"] = round(hours - sum(x["hours"] for x in blocks[:-1]), 6)
        stages_json.append({
            "id": sid, "start_date": a.isoformat(), "end_date": b.isoformat(), "season_id": a.month - 1, "blocks": blocks,
            "state_variables": {"storage": True, "inflow_lags": True}, "num_openings": p.openings, "risk_measure": p.risk(),
        })
    _dump(out / "stages.json", "stages", {
        "season_definitions": seasons_for(case.start),
        "policy_graph": {"type": "finite_horizon", "annual_discount_rate": p.discount_rate},
        "stages": stages_json,
    })

    deficit = [{"depth_mw": None, "cost": p.deficit_cost}]
    _dump(out / "penalties.json", "penalties", {
        "bus": {"deficit_segments": deficit, "excess_cost": 100.0},
        "line": {"exchange_cost": p.exchange_cost},
        "hydro": {"spillage_cost": p.spill_cost, "turbined_cost": 0.0, "diversion_cost": 0.1, "storage_violation_below_cost": 10000.0,
                  "filling_target_violation_cost": 50000.0, "turbined_violation_below_cost": 500.0, "outflow_violation_below_cost": 500.0,
                  "outflow_violation_above_cost": 500.0, "generation_violation_below_cost": 1000.0, "evaporation_violation_cost": 5000.0,
                  "water_withdrawal_violation_cost": 1000.0},
        "non_controllable_source": {"curtailment_cost": p.curtail_cost},
    })
    op = "2000-01-01"
    _dump(out / "system/buses.json", "buses", {"buses": [{"id": BUS[s], "name": NAMES[s], "operational_start_date": op, "deficit_segments": deficit} for s in I.SUBS]})

    hydros, models = [], []
    rids = case.ror_ids()
    for s in I.SUBS:
        i, cap = BUS[s], case.hydro_mw[s]
        plants = [(i, f"REE_{s}", case.store[s]["max_mwmes"] * I.MWMES_HM3)] + ([(rids[s], f"FIO_{s}", 0.0)] if s in rids else [])
        for hid, name, vmax in plants:
            hydros.append({
                "id": hid, "name": name, "operational_start_date": op, "downstream_id": None,
                "reservoir": {"min_storage_hm3": 0.0, "max_storage_hm3": round(vmax, 3)},
                "outflow": {"min_outflow_m3s": case.min_outflow.get(s, 0.0) if hid == i else 0.0, "max_outflow_m3s": None},
                "generation": {"model": "constant_productivity", "min_turbined_m3s": 0.0, "max_turbined_m3s": cap, "min_generation_mw": 0.0, "max_generation_mw": cap},
                "unit_groups": [{"id": 0, "name": name, "bus_id": i, "min_generation_mw": 0.0, "max_generation_mw": cap, "min_turbined_m3s": 0.0, "max_turbined_m3s": cap}],
            })
            models.append({"hydro_id": hid, "selection_mode": "stage_ranges", "stage_ranges": [
                {"start_stage_id": 0, "end_stage_id": None, "model": "constant_productivity", "productivity_mw_per_m3s": 1.0}]})
    hydros.sort(key=lambda h: h["id"])
    models.sort(key=lambda m: m["hydro_id"])
    _dump(out / "system/hydros.json", "hydros", {"hydros": hydros})
    _dump(out / "system/hydro_production_models.json", "production_models", {"production_models": models})

    th = case.fleet.plants.reset_index(drop=True)
    _dump(out / "system/thermals.json", "thermals", {"thermals": [
        {"id": int(r.Index), "name": f"{r.name} ({int(r.code)})", "operational_start_date": op, "bus_id": BUS[r.sub],
         "generation": {"min_mw": round(float(r.min_mw), 3), "max_mw": round(float(max(r.max_mw, r.min_mw)), 3)}, "cost_per_mwh": round(float(r.cvu), 2)}
        for r in th.itertuples()]})

    _dump(out / "system/lines.json", "lines", {"lines": [
        {"id": j, "name": f"{x['from']}_{x['to']}", "operational_start_date": op, "source_bus_id": BUS[x["from"]], "target_bus_id": BUS[x["to"]],
         "capacity": {"direct_mw": float(x["direct_mw"]), "reverse_mw": float(x["reverse_mw"])}, "exchange_cost": p.exchange_cost}
        for j, x in enumerate(case.lines)]})

    # fontes não controláveis: uma por subsistema e tecnologia com geração relevante
    ncs_list, ncs_stats, ncs_factors = [], [], []
    nid = 0
    for s in I.SUBS:
        for tech in ("wind", "solar"):
            sel = d.ncs[(d.ncs["sub"] == s) & (d.ncs["tech"] == tech)]
            per_month = sel.set_index("month")["mw"] * p.ncs_mult
            x = [_blend(per_month, a, b) for a, b in st]
            if max(x) < 5.0:
                continue
            rel = float(sel["std_rel"].iloc[0])
            gmax = round(2.0 * max(x), 1)
            ncs_list.append({"id": nid, "name": f"{TECH[tech]}_{s}", "operational_start_date": op, "bus_id": BUS[s], "max_generation_mw": gmax, "curtailment_cost": p.curtail_cost})
            for sid in range(len(st)):
                mean = x[sid] / gmax
                ncs_stats.append((nid, sid, mean, rel * mean))
                ncs_factors.append({"ncs_id": nid, "stage_id": sid, "block_factors": [
                    {"block_id": int(r.block), "factor": round(float(getattr(r, f"{tech}_f")), 6)} for r in blk[(sid, s)].itertuples()]})
            nid += 1
    _dump(out / "system/non_controllable_sources.json", "non_controllable_sources", {"non_controllable_sources": ncs_list})
    _parquet(out / "scenarios/non_controllable_stats.parquet", {
        "ncs_id": pa.array([r[0] for r in ncs_stats], pa.int32()), "stage_id": pa.array([r[1] for r in ncs_stats], pa.int32()),
        "mean": pa.array([r[2] for r in ncs_stats], pa.float64()), "std": pa.array([r[3] for r in ncs_stats], pa.float64())})
    _dump(out / "scenarios/non_controllable_factors.json", "non_controllable_factors", {"non_controllable_factors": ncs_factors})

    # carga líquida da parcela fixa (pequenas usinas fora da ENA, térmicas fora do despacho)
    lrows, lfac, net = [], [], {}
    for s in I.SUBS:
        ld = d.load[d.load["sub"] == s].set_index("month")["mw"]
        fx = d.fixed[d.fixed["sub"] == s].set_index("month")["mw"]
        for sid, (a, b) in enumerate(st):
            v = _blend(ld, a, b) * p.load_mult - _blend(fx, a, b)
            net[(s, sid)] = v
            lrows.append((BUS[s], sid, v))
            lfac.append({"bus_id": BUS[s], "stage_id": sid, "block_factors": [
                {"block_id": int(r.block), "factor": round(float(r.load_f), 6)} for r in blk[(sid, s)].itertuples()]})
    _parquet(out / "scenarios/load_seasonal_stats.parquet", {
        "bus_id": pa.array([r[0] for r in lrows], pa.int32()), "stage_id": pa.array([r[1] for r in lrows], pa.int32()),
        "mean_mw": pa.array([r[2] for r in lrows], pa.float64()), "std_mw": pa.array([0.0] * len(lrows), pa.float64())})
    _dump(out / "scenarios/load_factors.json", "load_factors", {"load_factors": lfac})

    # histórico de afluências (MWmed ≡ m³/s) em janelas alinhadas às estações
    h = case.history
    hist = []
    for s in I.SUBS:
        x = h[h["sub"] == s]
        for col, hid in [("res", BUS[s])] + ([("ror", rids[s])] if s in rids else []):
            hist += [(hid, r.start, r.end, float(getattr(r, col)) * p.inflow_mult) for r in x.itertuples()]
    hist.sort(key=lambda r: (r[0], r[1]))
    _parquet(out / "scenarios/inflow_history.parquet", {
        "hydro_id": pa.array([r[0] for r in hist], pa.int32()), "start_date": pa.array([r[1] for r in hist], pa.date32()),
        "end_date": pa.array([r[2] for r in hist], pa.date32()), "value_m3s": pa.array([r[3] for r in hist], pa.float64())})
    _dump(out / "initial_conditions.json", "initial_conditions", {
        "storage": sorted([{"hydro_id": BUS[s], "value_hm3": round(case.store[s]["cur_mwmes"] * I.MWMES_HM3, 3)} for s in I.SUBS]
                          + [{"hydro_id": rids[s], "value_hm3": 0.0} for s in rids], key=lambda x: x["hydro_id"]),
        "filling_storage": [],
    })

    # disponibilidade hidráulica conjunta (reservatório + fio d'água) por subsistema
    gc, gb = [], []
    for s in I.SUBS:
        cid = BUS[s]
        expr = f"hydro_generation({BUS[s]})" + (f" + hydro_generation({rids[s]})" if s in rids else "")
        gc.append({"id": cid, "name": f"hidro_disp_{s}", "description": f"Geração hidráulica do {s} ≤ disponibilidade medida pelo ONS",
                   "expression": expr, "slack": {"enabled": False}})
        gb += [(cid, sid, None, case.hydro_mw[s]) for sid in range(len(st))]

    # recebimento/exportação líquidos simultâneos (só onde há mais de uma interligação)
    for s in I.SUBS:
        terms = []
        for j, x in enumerate(case.lines):
            if x["from"] == s:
                terms.append(f"line_exchange({j})")
            elif x["to"] == s:
                terms.append(f"-line_exchange({j})")
        lim = case.joint.get(s)
        if len(terms) < 2 or not lim:
            continue
        cid = 10 + BUS[s]
        expr = " + ".join(terms).replace("+ -", "- ")
        gc.append({"id": cid, "name": f"intercambio_liquido_{s}", "description": f"Exportação líquida do {s} entre −recebimento e +exportação máximos medidos",
                   "expression": expr, "slack": {"enabled": False}})
        gb += [(cid, sid, -float(lim["recebe_mw"]), float(lim["exporta_mw"])) for sid in range(len(st))]

    # piso operativo flexível do armazenamento (mínimo já operado no mês), pago como despacho por segurança
    floors = {}
    if case.envelope:
        cvu_max = float(case.fleet.plants["cvu"].max())
        pen = p.floor_cvu_mult * cvu_max * MWH_PER_HM3 / 730.5  # folga em hm³ × penalidade × horas do estágio
        for s in I.SUBS:
            cid = 20 + BUS[s]
            gc.append({"id": cid, "name": f"piso_operativo_{s}", "description": f"Armazenamento do {s} acima do mínimo já operado no mês (flexível)",
                       "expression": f"hydro_storage_final({BUS[s]})", "slack": {"enabled": True, "penalty": round(pen, 4)}})
            vmax = case.store[s]["max_mwmes"] * I.MWMES_HM3
            for sid, (a, b) in enumerate(st):
                cal = (b - dt.timedelta(days=1)).month
                env = case.envelope[s][cal]
                lo = min(env["min"] + (p.floor_shift_pp if s == FLOOR_SHIFT_SUB else 0.0), env["max"] - FLOOR_CEIL_GAP_PP)
                floors[(s, sid)] = round(max(env["min"], lo), 2)
                gb.append((cid, sid, round(vmax * floors[(s, sid)] / 100, 3), None))
    _dump(out / "constraints/generic_constraints.json", "generic_constraints", {"constraints": gc})
    gc.sort(key=lambda c: c["id"])
    gb.sort(key=lambda r: (r[0], r[1]))
    _parquet(out / "constraints/generic_constraint_bounds.parquet", {
        "constraint_id": pa.array([r[0] for r in gb], pa.int32()), "stage_id": pa.array([r[1] for r in gb], pa.int32()),
        "block_id": pa.array([None] * len(gb), pa.int32()), "bound_lower": pa.array([r[2] for r in gb], pa.float64()),
        "bound_upper": pa.array([r[3] for r in gb], pa.float64())})

    # teto operativo do armazenamento (máximo já operado no mês): acima dele o modelo verte
    hb = []
    if case.envelope:
        for s in I.SUBS:
            vmax = case.store[s]["max_mwmes"] * I.MWMES_HM3
            for sid, (a, b) in enumerate(st):
                cal = (b - dt.timedelta(days=1)).month
                hb.append((BUS[s], sid, round(vmax * case.envelope[s][cal]["max"] / 100, 3)))
        _parquet(out / "constraints/hydro_bounds.parquet", {
            "hydro_id": pa.array([r[0] for r in hb], pa.int32()), "stage_id": pa.array([r[1] for r in hb], pa.int32()),
            "max_storage_hm3": pa.array([r[2] for r in hb], pa.float64())})

    return {"estagios": len(st), "inicio": case.start.isoformat(), "fim": st[-1][1].isoformat(), "termicas": len(th), "fio_dagua": rids,
            "fontes_nao_controlaveis": len(ncs_list), "patamares": [n for n, _ in I.BLOCKS],
            "carga_liquida_mw": {s: [round(net[(s, i)], 1) for i in range(len(st))] for s in I.SUBS}}
