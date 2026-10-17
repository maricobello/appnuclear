"""Do dado aberto do ONS às entradas do caso de planejamento — tudo medido, nada inventado.

Cada subsistema vira um reservatório equivalente (o mesmo princípio dos REEs do NEWAVE), com a
energia natural afluente (ENA) no papel da vazão e produtividade 1 MW/(m³/s): 1 m³/s ≡ 1 MWmed e
1 MWmês ≡ 730,5 h × 3600 s / 10⁶ = 2,6298 hm³.

Só a ENA armazenável é água utilizável: o ONS a define como a ENA bruta menos a energia vertida
não turbinável nas usinas a fio d'água, e a diferença bruta − armazenável acompanha esse vertimento
medido usina a usina (correlação mensal de 0,95 a 0,997). Dentro da armazenável, a parte dos REEs
sem estoque (menos de um mês de afluência média em EAR máxima — Belo Monte, Itaipu, Madeira e Teles
Pires) é turbinável mas não armazenável: vai para uma usina fio d'água; o resto vai para o
reservatório. As duas dividem a disponibilidade hidráulica medida pelo ONS.

Calibração que o caso oficial resolve com evaporação, retiradas e produtividade variável: o fator
de aproveitamento k = (geração + energia vertida turbinável + ΔEAR) / ENA armazenável, medido usina
a usina nos últimos 24 meses, multiplica a ENA e fecha o balanço hídrico observado. O histórico desde
2000 é reconstruído na configuração atual de usinas pela % da MLT de cada dia (ver `inflow_history`).
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from . import ons

SUBS = ons.SUBS
MWMES_HM3 = 730.5 * 3600 / 1e6
#: Interligações do caso (sentido de referência origem → destino), como no módulo de intercâmbio do app.
PAIRS = (("N", "NE"), ("N", "SE"), ("NE", "SE"), ("S", "SE"))
#: Patamares de carga por posto da carga líquida do SIN (carga − eólica − solar) dentro do mês.
BLOCKS = (("pesada", 0.15), ("media", 0.50), ("leve", 0.35))
K_WINDOW_DAYS = 730
K_RANGE = (0.6, 1.08)
FLEET_DAYS = 28
LINE_DAYS = 365
LINE_QUANTILE = 0.995
GROWTH_RANGE = {"load": (-0.02, 0.06), "wind": (-0.10, 0.20), "solar": (-0.10, 0.40)}
#: Envelope operativo do armazenamento: EAR diária do ONS desde 2000.
EAR_FIRST_YEAR = 2000
ENVELOPE_CEIL_MARGIN_PP = 1.0
#: REE a fio d'água: EAR máxima abaixo deste número de meses da ENA armazenável média.
ROR_MAX_MONTHS = 1.0
#: Anos para o índice sazonal da carga e das renováveis.
SEASONAL_YEARS = 3
#: Vazão mínima agregada (o GHMIN dos REEs do NEWAVE): quantil da geração hidráulica diária no último ano.
MIN_OUTFLOW_DAYS = 365
MIN_OUTFLOW_QUANTILE = 0.01


# ─────────────────────────────── leitura ───────────────────────────────


def ena_daily(f: ons.Fetcher, upto: dt.date) -> pd.DataFrame:
    """ENA diária por subsistema desde 2000: data, sub, bruta, armaz (MWmed)."""
    frames = []
    for y in range(ons.ENA_FIRST_YEAR, upto.year + 1):
        p = f.yearly(ons.ena_path(y), y, upto.year)
        frames.append(ons.read_any(p))
    return tidy_ena(pd.concat(frames, ignore_index=True))


def tidy_ena(raw: pd.DataFrame) -> pd.DataFrame:
    df = pd.DataFrame({
        "date": pd.to_datetime(raw["ena_data"].astype(str).str[:10], errors="coerce"),
        "sub": ons.sub_of(raw["id_subsistema"]),
        "bruta": ons.num(raw["ena_bruta_regiao_mwmed"]),
        "armaz": ons.num(raw["ena_armazenavel_regiao_mwmed"]),
        # % da MLT da configuração de usinas vigente no dia (a armazenável usa a MLT da bruta)
        "apct": ons.num(raw["ena_armazenavel_regiao_percentualmlt"]),
    }).dropna()
    return df.drop_duplicates(["date", "sub"], keep="last").sort_values(["sub", "date"]).reset_index(drop=True)


def ear_daily(f: ons.Fetcher, years: range, this_year: int) -> pd.DataFrame:
    raw = pd.concat([ons.read_any(f.yearly(ons.ear_path(y), y, this_year)) for y in years], ignore_index=True)
    return tidy_ear(raw)


def tidy_ear(raw: pd.DataFrame) -> pd.DataFrame:
    df = pd.DataFrame({
        "date": pd.to_datetime(raw["ear_data"].astype(str).str[:10], errors="coerce"),
        "sub": ons.sub_of(raw["id_subsistema"]),
        "max": ons.num(raw["ear_max_subsistema"]),
        "cur": ons.num(raw["ear_verif_subsistema_mwmes"]),
    }).dropna()
    return df.drop_duplicates(["date", "sub"], keep="last").sort_values(["sub", "date"]).reset_index(drop=True)


def ena_ree_daily(f: ons.Fetcher, upto: dt.date) -> pd.DataFrame:
    """ENA diária por REE desde 2018 (primeiro ano publicado): data, ree, sub, armaz (MWmed)."""
    frames = []
    for y in range(ons.REE_FIRST_YEAR, upto.year + 1):
        p = f.maybe(ons.ena_ree_path(y), max_age_s=-1 if y < upto.year else None)
        if p is not None:
            frames.append(ons.read_any(p))
    if not frames:
        raise RuntimeError("ENA por REE do ONS indisponível")
    raw = pd.concat(frames, ignore_index=True)
    ree = raw["nom_reservatorioee"].astype("string").str.strip().str.upper()
    df = pd.DataFrame({
        "date": pd.to_datetime(raw["ena_data"].astype(str).str[:10], errors="coerce"),
        "ree": ree, "sub": ree.map(ons.REE_SUB),
        "armaz": ons.num(raw["ena_armazenavel_ree_mwmed"]),
    }).dropna()
    return df.drop_duplicates(["date", "ree"], keep="last").sort_values(["ree", "date"]).reset_index(drop=True)


def ear_ree_max(f: ons.Fetcher, on: dt.date) -> pd.Series:
    """EAR máxima de cada REE no dia (ou no último dia publicado antes dele), MWmês."""
    for y in (on.year, on.year - 1):
        p = f.maybe(ons.ear_ree_path(y), max_age_s=-1 if y < dt.date.today().year else None)
        if p is None:
            continue
        raw = ons.read_any(p)
        df = pd.DataFrame({"date": pd.to_datetime(raw["ear_data"].astype(str).str[:10], errors="coerce"),
                           "ree": raw["nom_ree"].astype("string").str.strip().str.upper(), "max": ons.num(raw["ear_max_ree"])}).dropna()
        df = df[df["date"] <= pd.Timestamp(on)]
        if len(df):
            last = df[df["date"] == df["date"].max()]
            return last.set_index("ree")["max"]
    raise RuntimeError("EAR por REE do ONS indisponível")


@dataclass
class RunOfRiver:
    """Parte fio d'água da ENA armazenável: os REEs sem estoque e a série diária por subsistema."""
    rees: dict[str, list[str]]
    daily: pd.DataFrame          # date, sub, ror (MWmed)
    share: dict[str, dict[int, float]]  # fração média da armazenável por mês do ano (para antes de 2018)
    table: list[dict]
    check_max_err: float


def run_of_river(ree: pd.DataFrame, earmax: pd.Series, ena: pd.DataFrame, asof: dt.date) -> RunOfRiver:
    """Separa os REEs sem estoque (EAR máxima < ROR_MAX_MONTHS meses da ENA armazenável média dos
    últimos 3 anos) e confere que a soma dos REEs bate com a ENA armazenável de cada subsistema."""
    r = ree[ree["date"] <= pd.Timestamp(asof)]
    recent = r[r["date"] > pd.Timestamp(asof) - pd.Timedelta(days=3 * 365)]
    mean = recent.groupby("ree")["armaz"].mean()
    table, rees = [], {s: [] for s in SUBS}
    for name, a in mean.items():
        mx = float(earmax.get(name, 0.0))
        months = mx / a if a > 0 else np.inf
        is_ror = months < ROR_MAX_MONTHS
        sub = ons.REE_SUB.get(name)
        table.append({"ree": name, "sub": sub, "ena_armazenavel_mwmed": round(float(a), 1), "ear_max_mwmes": round(mx, 1),
                      "meses_de_estoque": round(float(months), 2) if np.isfinite(months) else None, "fio_dagua": bool(is_ror)})
        if is_ror and sub:
            rees[sub].append(name)
    tot = r.groupby(["date", "sub"])["armaz"].sum().rename("ree_sum").reset_index()
    chk = tot.merge(ena[["date", "sub", "armaz"]], on=["date", "sub"])
    err = float(((chk["ree_sum"] - chk["armaz"]).abs() / chk["armaz"].abs().clip(lower=1.0)).max()) if len(chk) else 1.0
    if err > 0.02:
        raise RuntimeError(f"soma da ENA por REE difere da ENA do subsistema em até {err:.1%}: mapeamento REE → subsistema mudou?")
    ror = r[r["ree"].isin([x for v in rees.values() for x in v])].groupby(["date", "sub"])["armaz"].sum().clip(lower=0.0)
    daily = ror.rename("ror").reset_index()
    sub_daily = ena.set_index(["date", "sub"])["armaz"]
    share: dict[str, dict[int, float]] = {}
    for s in SUBS:
        x = daily[daily["sub"] == s].set_index("date")["ror"]
        if x.empty:
            share[s] = {m: 0.0 for m in range(1, 13)}
            continue
        a = sub_daily.xs(s, level="sub").reindex(x.index)
        by = pd.DataFrame({"ror": x, "a": a}).dropna()
        share[s] = {int(m): float(np.clip(g["ror"].sum() / g["a"].sum(), 0.0, 1.0)) for m, g in by.groupby(by.index.month)}
    return RunOfRiver(rees=rees, daily=daily, share=share, table=sorted(table, key=lambda x: (x["sub"] or "", x["ree"])), check_max_err=round(err, 5))


def balance_hourly(f: ons.Fetcher, years: range, this_year: int) -> pd.DataFrame:
    raw = pd.concat([ons.read_any(f.yearly(ons.balance_path(y), y, this_year)) for y in years], ignore_index=True)
    return tidy_balance(raw)


def tidy_balance(raw: pd.DataFrame) -> pd.DataFrame:
    df = pd.DataFrame({
        "ts": pd.to_datetime(raw["din_instante"]),
        "sub": ons.sub_of(raw["id_subsistema"]),
        "hydro": ons.num(raw["val_gerhidraulica"]),
        "thermal": ons.num(raw["val_gertermica"]),
        "wind": ons.num(raw["val_gereolica"]),
        "solar": ons.num(raw["val_gersolar"]),
        "load": ons.num(raw["val_carga"]),
        "ic": ons.num(raw["val_intercambio"]),
    }).dropna(subset=["ts", "sub"])
    return df.drop_duplicates(["ts", "sub"], keep="last").sort_values(["ts", "sub"]).reset_index(drop=True)


#: Até 2023 a energia vertida turbinável sai em um arquivo por ano; depois, um por mês.
EVT_MONTHLY_FROM = 2024


def evt_path(y: int, m: int | None = None) -> str:
    tail = f"{y}_{m:02d}" if m is not None else f"{y}"
    return f"energia_vertida_turbinavel_ho/ENERGIA_VERTIDA_TURBINAVEL_{tail}.parquet"


def months_back(end: dt.date, n: int) -> list[tuple[int, int]]:
    """Os n meses civis que terminam no mês de `end` (inclusive), do mais antigo ao mais novo."""
    out, y, m = [], end.year, end.month
    for _ in range(n):
        out.append((y, m))
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return out[::-1]


def evt_daily(f: ons.Fetcher, months: list[tuple[int, int]], current: tuple[int, int]) -> pd.DataFrame:
    """Geração, energia vertida e disponibilidade das hidrelétricas por subsistema e dia (MWmed)."""
    cols = ["id_subsistema", "din_instante", "val_geracao", "val_disponibilidade", "val_energiavertida", "val_energiavertidaturbinavel"]
    frames = []
    def read(p):  # o ONS muda colunas entre arquivos: lê só as que existem
        have = set(pq.read_schema(p).names)
        return pd.read_parquet(p, columns=[c for c in cols if c in have])

    for y in sorted({y for y, _ in months if y < EVT_MONTHLY_FROM}):
        p = f.maybe(evt_path(y), max_age_s=-1)
        if p is not None:
            x = read(p)
            frames.append(x[x["din_instante"].dt.month.isin([m for yy, m in months if yy == y])])
    for y, m in months:
        if y < EVT_MONTHLY_FROM:
            continue
        p = f.maybe(evt_path(y, m), max_age_s=None if (y, m) == current else -1)
        if p is not None:
            frames.append(read(p))
    if not frames:
        raise RuntimeError("energia vertida turbinável do ONS indisponível")
    return tidy_evt(pd.concat(frames, ignore_index=True))


def tidy_evt(raw: pd.DataFrame) -> pd.DataFrame:
    df = pd.DataFrame({
        "ts": pd.to_datetime(raw["din_instante"]),
        "sub": ons.sub_of(raw["id_subsistema"]),
        "gen": ons.num(raw["val_geracao"]),
        "spill": ons.num(raw["val_energiavertida"]),
        "spill_t": ons.num(raw["val_energiavertidaturbinavel"]) if "val_energiavertidaturbinavel" in raw else np.nan,
        "avail": ons.num(raw["val_disponibilidade"]),
    }).dropna(subset=["ts", "sub"])
    h = df.groupby(["ts", "sub"])[["gen", "spill", "spill_t", "avail"]].sum(min_count=1).reset_index()
    h["date"] = h["ts"].dt.normalize()
    d = h.groupby(["date", "sub"]).agg(gen=("gen", "mean"), spill=("spill", "mean"), spill_t=("spill_t", "mean"),
                                       avail=("avail", "mean"), hours=("ts", "nunique")).reset_index()
    return d[d["hours"] >= 23].drop(columns="hours")


THERMAL_COLS = ["din_instante", "id_subsistema", "nom_usina", "cod_usinaplanejamento", "ceg", "val_verifgeracao",
                "val_proginflexibilidade", "val_progdisponibilidade"]


def thermal_hourly(f: ons.Fetcher, months: list[tuple[int, int]], current: tuple[int, int]) -> pd.DataFrame:
    """Despacho térmico hora × usina. A disponibilidade programada só existe nos arquivos desde jan/2026:
    nos anteriores a coluna vem vazia e o caso usa o cadastro (ver `thermal_fleet`)."""
    frames = []
    for y, m in months:
        p = f.maybe(ons.thermal_path(y, m), max_age_s=None if (y, m) == current else -1)
        if p is not None:
            have = set(pq.read_schema(p).names)
            frames.append(pd.read_parquet(p, columns=[c for c in THERMAL_COLS if c in have]))
    if not frames:
        raise RuntimeError("despacho térmico do ONS indisponível")
    raw = pd.concat(frames, ignore_index=True)
    col = lambda c: raw[c] if c in raw else pd.Series(np.nan, index=raw.index)  # noqa: E731
    return pd.DataFrame({
        "ts": pd.to_datetime(raw["din_instante"]),
        "sub": ons.sub_of(raw["id_subsistema"]),
        "name": raw["nom_usina"].astype("string").str.strip(),
        "code": pd.to_numeric(raw["cod_usinaplanejamento"], errors="coerce"),
        "ceg": col("ceg").astype("string").str.strip(),
        "gen": ons.num(raw["val_verifgeracao"]),
        "inflex": ons.num(raw["val_proginflexibilidade"]),
        "avail": ons.num(col("val_progdisponibilidade")),
    }).dropna(subset=["ts", "sub"])


REGISTRY_PATH = "capacidade-geracao/CAPACIDADE_GERACAO.parquet"


def thermal_registry(f: ons.Fetcher, on: dt.date) -> pd.Series:
    """Potência efetiva (MW) das unidades térmicas e nucleares em operação na data, somada por CEG."""
    r = ons.read_any(f.get(REGISTRY_PATH))
    tipo = r["nom_tipousina"].astype("string").str.upper()
    r = r[tipo.str.contains("TÉRMICA|TERMICA|NUCLEAR", regex=True, na=False)]
    start = r["dat_entradaoperacao"].astype("string").str[:10].fillna("")
    stop = r["dat_desativacao"].astype("string").str[:10].fillna("")
    d = on.isoformat()
    r = r[(start != "") & (start <= d) & ((stop == "") | (stop == "None") | (stop > d))]
    return ons.num(r["val_potenciaefetiva"]).groupby(r["ceg"].astype("string").str.strip()).sum()


def availability_factor(th: pd.DataFrame, cap: pd.Series) -> dict[str, float]:
    """Disponibilidade programada ÷ potência do cadastro, por subsistema, nas usinas com as duas
    informações (fator usado para os meses em que o ONS ainda não publicava a disponibilidade)."""
    x = th.dropna(subset=["avail"])
    if x.empty:
        return {}
    hours = x["ts"].nunique()
    a = x.groupby(["sub", "ceg"])["avail"].sum() / hours
    out = {}
    for s in SUBS:
        if s not in a.index.get_level_values(0):
            continue
        aa = a.loc[s]
        c = cap.reindex(aa.index).dropna()
        if c.sum() > 0:
            out[s] = round(float(min(1.0, aa.loc[c.index].sum() / c.sum())), 4)
    return out


def cvu_weekly(f: ons.Fetcher, years: list[int], this_year: int) -> pd.DataFrame:
    """CVU por semana operativa. O PMO de janeiro começa no fim de dezembro e fica no arquivo do ano
    seguinte, então quem chama inclui y+1 (ausente no ano corrente: pulado)."""
    frames = []
    for y in years:
        p = f.maybe(ons.cvu_path(y), max_age_s=-1 if y < this_year else None)
        if p is not None:
            frames.append(ons.read_any(p))
    if not frames:
        raise RuntimeError("CVU das térmicas indisponível")
    raw = pd.concat(frames, ignore_index=True)
    return pd.DataFrame({
        "start": pd.to_datetime(raw["dat_iniciosemana"]),
        "end": pd.to_datetime(raw["dat_fimsemana"]),
        "code": pd.to_numeric(raw["cod_usinaplanejamento"], errors="coerce"),
        "sub": ons.sub_of(raw["id_subsistema"]),
        "name": raw["nom_usina"].astype("string").str.strip(),
        "cvu": ons.num(raw["val_cvu"]),
        "study": raw["nom_semanaoperativa"].astype("string").str.strip(),
        "rev": pd.to_numeric(raw["num_revisao"], errors="coerce"),
    }).dropna(subset=["start", "code", "cvu"])


def interchange_hourly(f: ons.Fetcher, years: range, this_year: int) -> pd.DataFrame:
    raw = pd.concat([ons.read_any(f.yearly(ons.interchange_path(y), y, this_year)) for y in years], ignore_index=True)
    return tidy_interchange(raw)


def tidy_interchange(raw: pd.DataFrame) -> pd.DataFrame:
    """Uma linha por par de referência e hora; positivo no sentido origem → destino de PAIRS."""
    a = ons.sub_of(raw["id_subsistema_origem"])
    b = ons.sub_of(raw["id_subsistema_destino"])
    v = ons.num(raw["val_intercambiomwmed"])
    rows = []
    for o, d in PAIRS:
        fwd = (a == o) & (b == d)
        rev = (a == d) & (b == o)
        part = pd.DataFrame({"ts": pd.to_datetime(raw["din_instante"]), "flow": np.where(fwd, v, -v)})[fwd | rev]
        part["pair"] = f"{o}-{d}"
        rows.append(part)
    df = pd.concat(rows, ignore_index=True).dropna()
    return df.groupby(["pair", "ts"], as_index=False)["flow"].sum()


# ─────────────────────────────── derivações ───────────────────────────────


def as_of(ena: pd.DataFrame, ear: pd.DataFrame) -> dt.date:
    """Último dia com ENA e EAR dos quatro subsistemas: o estudo começa no dia seguinte."""
    def full(df: pd.DataFrame) -> set:
        c = df.groupby("date")["sub"].nunique()
        return set(c[c == len(SUBS)].index)
    days = full(ena) & full(ear)
    if not days:
        raise RuntimeError("sem dia com ENA e EAR completos")
    return max(days).date()


def usable_factor(evt: pd.DataFrame, ena: pd.DataFrame, ear: pd.DataFrame, asof: dt.date, days: int = K_WINDOW_DAYS) -> dict[str, dict]:
    """k = (geração + energia vertida turbinável + ΔEAR) / ENA armazenável nos últimos `days` dias, por subsistema."""
    lo = pd.Timestamp(asof) - pd.Timedelta(days=days)
    hi = pd.Timestamp(asof)
    out = {}
    for s in SUBS:
        e = evt[(evt["sub"] == s) & (evt["date"] > lo) & (evt["date"] <= hi)].set_index("date")
        n = ena[(ena["sub"] == s) & (ena["date"] > lo) & (ena["date"] <= hi)].set_index("date")["armaz"]
        st = ear[ear["sub"] == s].set_index("date")["cur"]
        common = e.index.intersection(n.index)
        if len(common) < days * 0.8:
            raise RuntimeError(f"fator de aproveitamento: só {len(common)} dias com geração/vertimento e ENA no {s}")
        first, last = common.min(), common.max()
        if first - pd.Timedelta(days=1) not in st.index or last not in st.index:
            raise RuntimeError(f"fator de aproveitamento: EAR ausente nas pontas da janela no {s}")
        # ΔEAR em MWmês sobre a janela → MWmed médio
        ds = (st[last] - st[first - pd.Timedelta(days=1)]) * 730.5 / (len(common) * 24)
        if e.loc[common, "spill_t"].isna().mean() > 0.1:
            raise RuntimeError(f"fator de aproveitamento: energia vertida turbinável ausente no {s}")
        gen, spill, ena_m = e.loc[common, "gen"].mean(), e.loc[common, "spill_t"].mean(), n.loc[common].mean()
        raw = (gen + spill + ds) / ena_m
        out[s] = {"k": float(np.clip(raw, *K_RANGE)), "k_bruto": round(float(raw), 4), "dias": int(len(common)),
                  "geracao_mwmed": round(float(gen), 1), "vertimento_mwmed": round(float(spill), 1),
                  "delta_ear_mwmed": round(float(ds), 1), "ena_mwmed": round(float(ena_m), 1)}
    return out


def month_start(d: dt.date) -> dt.date:
    return d.replace(day=1)


def add_months(d: dt.date, n: int) -> dt.date:
    """Mesmo dia do mês, n meses depois (o dia de âncora nunca passa de 28)."""
    y, m = divmod(d.month - 1 + n, 12)
    return dt.date(d.year + y, m + 1, d.day)


def anchor(asof: dt.date) -> dt.date:
    """Início do estudo: o dia seguinte ao último dado, recuado para o dia 28 se cair em 29–31.

    Os estágios vão de um dia D ao mesmo dia D do mês seguinte (estações customizadas do NovoModelo),
    então o estudo começa exatamente numa fronteira de estação e não há estágio parcial."""
    start = asof + dt.timedelta(days=1)
    return start.replace(day=28) if start.day > 28 else start


def mlt_now(ena: pd.DataFrame, asof: dt.date) -> dict[str, dict[int, float]]:
    """MLT da configuração atual por subsistema e mês do ano (ENA ÷ % MLT nos últimos 365 dias)."""
    w = ena[(ena["date"] > pd.Timestamp(asof) - pd.Timedelta(days=365)) & (ena["date"] <= pd.Timestamp(asof)) & (ena["apct"] > 5)]
    w = w.assign(mlt=w["armaz"] / (w["apct"] / 100), cal=w["date"].dt.month)
    out = {}
    for s in SUBS:
        g = w[w["sub"] == s].groupby("cal")["mlt"].median()
        if len(g) < 12:
            raise RuntimeError(f"MLT atual do {s}: só {len(g)} meses com ENA e % MLT no último ano")
        out[s] = {int(m): float(v) for m, v in g.items()}
    return out


def inflow_history(ena: pd.DataFrame, k: dict[str, float], start: dt.date, ror: RunOfRiver | None = None,
                   mlt: dict[str, dict[int, float]] | None = None) -> pd.DataFrame:
    """Médias da ENA armazenável × k em janelas [dia D, dia D do mês seguinte) antes de `start`,
    separadas em reservatório (res) e fio d'água (ror).

    Configuração atual: a ENA publicada em cada dia usa as usinas existentes naquele dia (a MLT do N
    dobrou com Belo Monte, a do SE subiu 55% com Madeira e Teles Pires), então a série bruta não é
    estacionária. Com `mlt`, cada dia vira % da MLT do dia × MLT de hoje do mesmo mês. A fração fio
    d'água é a do dia pela ENA por REE (desde 2018) ou, antes, a média do mesmo mês do ano."""
    first = ena["date"].min().date()
    w0 = dt.date(first.year, first.month, start.day)
    if w0 < first:
        w0 = add_months(w0, 1)
    edges = []
    a = w0
    while a < start:
        edges.append(a)
        a = add_months(a, 1)
    edges.append(start)
    df = ena[(ena["date"] >= pd.Timestamp(w0)) & (ena["date"] < pd.Timestamp(start))][["date", "sub", "armaz", "apct"]].copy()
    df["cal"] = df["date"].dt.month
    raw = df["armaz"].clip(lower=0.0)
    if mlt is not None:
        m_now = pd.DataFrame([(s_, m, v) for s_, d in mlt.items() for m, v in d.items()], columns=["sub", "cal", "mlt"])
        df = df.merge(m_now, on=["sub", "cal"], how="left")
        raw = df["armaz"].clip(lower=0.0)
        df["armaz"] = (df["apct"] / 100 * df["mlt"]).clip(lower=0.0)
    if ror is not None:
        df = df.merge(ror.daily, on=["date", "sub"], how="left")
        sh = pd.DataFrame([(s_, m, v) for s_, d in ror.share.items() for m, v in d.items()], columns=["sub", "cal", "share"])
        df = df.merge(sh, on=["sub", "cal"], how="left")
        first_ree = ror.daily["date"].min() if len(ror.daily) else pd.Timestamp.max
        day_share = (df["ror"] / raw.to_numpy().clip(min=1.0)).clip(0.0, 1.0)
        share = np.where(df["date"] >= first_ree, day_share.fillna(0.0), df["share"].fillna(0.0))
        df["ror"] = df["armaz"] * share
    else:
        df["ror"] = 0.0
    bins = pd.to_datetime(edges)
    df["w"] = pd.cut(df["date"], bins=bins, right=False, labels=False)
    g = df.groupby(["sub", "w"]).agg(armaz=("armaz", "mean"), ror=("ror", "mean"), n=("date", "nunique")).reset_index()
    g["start"] = [edges[int(i)] for i in g["w"]]
    g["end"] = [edges[int(i) + 1] for i in g["w"]]
    g = g[g["n"] == [(e - s).days for s, e in zip(g["start"], g["end"])]]
    kk = g["sub"].map(k)
    g["res"] = (g["armaz"] - g["ror"]) * kk
    g["ror"] = g["ror"] * kk
    return g[["sub", "start", "end", "res", "ror"]].reset_index(drop=True)


def storage(ear: pd.DataFrame, asof: dt.date) -> dict[str, dict]:
    day = ear[ear["date"] == pd.Timestamp(asof)].set_index("sub")
    return {s: {"max_mwmes": float(day.loc[s, "max"]), "cur_mwmes": float(day.loc[s, "cur"]),
                "pct": round(100 * float(day.loc[s, "cur"]) / float(day.loc[s, "max"]), 2)} for s in SUBS}


def hydro_availability(evt: pd.DataFrame, asof: dt.date, days: int = FLEET_DAYS) -> dict[str, float]:
    """Disponibilidade hidráulica média (soma das usinas, MW) nos últimos `days` dias."""
    w = evt[(evt["date"] > pd.Timestamp(asof) - pd.Timedelta(days=days)) & (evt["date"] <= pd.Timestamp(asof))]
    return {s: round(float(w.loc[w["sub"] == s, "avail"].mean()), 1) for s in SUBS}


def min_outflow(evt: pd.DataFrame, asof: dt.date, subs: list[str], days: int = MIN_OUTFLOW_DAYS, q: float = MIN_OUTFLOW_QUANTILE) -> dict[str, float]:
    """Defluência mínima agregada (MW ≡ m³/s com produtividade 1) dos subsistemas pedidos: o quantil
    `q` da geração hidráulica diária nos últimos `days` dias.

    Resume as vazões mínimas das usinas (no São Francisco, a defluência mínima de Sobradinho e Xingó
    segura o NE acima de ~2,5 GW o ano inteiro), que o caso agregado não vê: sem ela o reservatório
    equivalente pode guardar toda a afluência e zerar a geração. Só vale para subsistemas sem fio
    d'água, em que a geração medida é toda do reservatório."""
    w = evt[(evt["date"] > pd.Timestamp(asof) - pd.Timedelta(days=days)) & (evt["date"] <= pd.Timestamp(asof))]
    out = {}
    for s in subs:
        g = w.loc[w["sub"] == s, "gen"].dropna()
        if len(g) < 0.8 * days:
            raise RuntimeError(f"geração hidráulica diária do {s} com só {len(g)} dias para a vazão mínima")
        out[s] = round(float(g.quantile(q)), 1)
    return out


def storage_envelope(ear: pd.DataFrame, asof: dt.date) -> dict[str, dict[int, dict[str, float]]]:
    """Mínimo e máximo de EAR (% do máximo) já operados em cada mês do ano, de 2000 até `asof`.

    O teto resume os volumes de espera para controle de cheias e as regras operativas que o deck
    oficial traz e os dados abertos não: em 27 anos o SE nunca passou de ~90%. O piso é o estado
    mais deplecionado que o ONS já aceitou naquele mês (crises de 2001, 2014–15, 2017 e 2021)."""
    e = ear[ear["date"] <= pd.Timestamp(asof)].copy()
    e["pct"] = 100 * e["cur"] / e["max"]
    e["cal"] = e["date"].dt.month
    out: dict[str, dict[int, dict[str, float]]] = {}
    for s in SUBS:
        g = e[e["sub"] == s].groupby("cal")["pct"].agg(["min", "max", "count"])
        if len(g) < 12 or (g["count"] < 300).any():
            raise RuntimeError(f"histórico de EAR curto demais para o envelope do {s}")
        out[s] = {int(m): {"min": round(float(r["min"]), 2), "max": round(float(min(100.0, r["max"] + ENVELOPE_CEIL_MARGIN_PP)), 2)} for m, r in g.iterrows()}
    return out


def joint_limits(bal: pd.DataFrame, asof: dt.date, days: int = LINE_DAYS, q: float = LINE_QUANTILE) -> dict[str, dict[str, float]]:
    """Exportação e recebimento líquidos máximos de cada subsistema (quantil `q` do intercâmbio
    líquido do balanço no último ano): limites simultâneos que a soma das interligações não mostra."""
    w = bal[(bal["ts"] > pd.Timestamp(asof) - pd.Timedelta(days=days)) & (bal["ts"] < pd.Timestamp(asof) + pd.Timedelta(days=1))]
    out = {}
    for s in SUBS:
        x = w.loc[w["sub"] == s, "ic"].dropna()
        if len(x) < days * 24 * 0.8:
            raise RuntimeError(f"intercâmbio líquido do {s}: só {len(x)} horas no último ano")
        pos, neg = x[x > 0], -x[x < 0]
        out[s] = {"exporta_mw": round(float(pos.quantile(q)) if len(pos) else 0.0, 0),
                  "recebe_mw": round(float(neg.quantile(q)) if len(neg) else 0.0, 0)}
    return out


def growth(series: pd.Series, asof: pd.Timestamp, lo: float, hi: float) -> float:
    """Crescimento de 12 meses: média dos últimos 365 dias ÷ média dos 365 anteriores − 1 (limitado)."""
    a = series[(series.index > asof - pd.Timedelta(days=365)) & (series.index <= asof)].mean()
    b = series[(series.index > asof - pd.Timedelta(days=730)) & (series.index <= asof - pd.Timedelta(days=365))].mean()
    if not np.isfinite(a) or not np.isfinite(b) or b <= 0:
        return 0.0
    return float(np.clip(a / b - 1, lo, hi))


@dataclass
class Fleet:
    plants: pd.DataFrame
    #: Geração média das térmicas sem CVU no PMO (vai para a parcela fixa, MWmed por subsistema).
    no_cvu_mw: dict[str, float]
    study: str
    #: Média da geração térmica do arquivo de despacho por subsistema (para a parcela fixa).
    dispatched_mw: dict[str, float]
    #: De onde veio o limite de geração: "programada" (ONS) ou "cadastro × fator" (meses antigos).
    avail_source: str = "programada"
    avail_factor: dict[str, float] = field(default_factory=dict)


def thermal_fleet(th: pd.DataFrame, cvu: pd.DataFrame, start: dt.date, days: int = FLEET_DAYS,
                  cap: pd.Series | None = None, factor: dict[str, float] | None = None) -> Fleet:
    """Térmicas dos últimos `days` dias: limite = disponibilidade programada média, mínimo = inflexibilidade média, CVU da semana do PMO.

    Sem disponibilidade programada na janela (arquivos anteriores a 2026), o limite é a potência do
    cadastro × o fator de disponibilidade do subsistema medido nos meses que têm as duas."""
    lo, hi = pd.Timestamp(start) - pd.Timedelta(days=days), pd.Timestamp(start)
    w = th[(th["ts"] >= lo) & (th["ts"] < hi)]
    hours = w["ts"].nunique()
    if hours < days * 24 * 0.9:
        raise RuntimeError(f"despacho térmico com só {hours} horas na janela de {days} dias")
    source = "programada"
    if w["avail"].notna().mean() < 0.5:
        if cap is None or not factor:
            raise RuntimeError("despacho térmico sem disponibilidade programada e sem cadastro para substituir")
        w = w.copy()
        w["avail"] = w["ceg"].map(cap).astype(float) * w["sub"].map(factor).astype(float)
        source = "cadastro × fator"
    g = w.groupby("code").agg(name=("name", "last"), sub=("sub", "last"), gen=("gen", "sum"),
                              inflex=("inflex", "sum"), avail=("avail", "sum")).reset_index()
    for c in ("gen", "inflex", "avail"):
        g[c] = g[c] / hours
    # CVU: semana do PMO que contém o início do estudo (ou a mais recente antes dele), revisão mais nova
    cv = cvu[cvu["start"] <= hi].sort_values(["start", "rev"])
    wk = cv[cv["start"] == cv["start"].max()]
    wk = wk.sort_values("rev").drop_duplicates("code", keep="last")
    g = g.merge(wk[["code", "cvu"]], on="code", how="left")
    no = g[g["cvu"].isna()]
    plants = g[g["cvu"].notna()].copy()
    plants["max_mw"] = plants[["avail", "inflex", "gen"]].max(axis=1)
    plants["min_mw"] = plants[["inflex"]].min(axis=1).clip(lower=0.0)
    plants = plants[plants["max_mw"] > 0.5].sort_values(["sub", "cvu"]).reset_index(drop=True)
    return Fleet(
        plants=plants[["code", "name", "sub", "cvu", "min_mw", "max_mw", "gen"]],
        no_cvu_mw={s: round(float(no.loc[no["sub"] == s, "gen"].sum()), 1) for s in SUBS},
        study=str(wk["study"].iloc[-1]) if len(wk) else "",
        dispatched_mw={s: round(float(g.loc[g["sub"] == s, "gen"].sum()), 1) for s in SUBS},
        avail_source=source,
        avail_factor=dict(factor or {}) if source != "programada" else {},
    )


def line_limits(ic: pd.DataFrame, asof: dt.date, days: int = LINE_DAYS, q: float = LINE_QUANTILE) -> list[dict]:
    """Limite de cada interligação em cada sentido = quantil `q` do fluxo medido no último ano."""
    w = ic[(ic["ts"] > pd.Timestamp(asof) - pd.Timedelta(days=days)) & (ic["ts"] < pd.Timestamp(asof) + pd.Timedelta(days=1))]
    out = []
    for o, d in PAIRS:
        x = w.loc[w["pair"] == f"{o}-{d}", "flow"]
        if len(x) < days * 24 * 0.8:
            raise RuntimeError(f"intercâmbio {o}-{d}: só {len(x)} horas no último ano")
        pos, neg = x[x > 0], -x[x < 0]
        out.append({"pair": f"{o}-{d}", "from": o, "to": d,
                    "direct_mw": round(float(pos.quantile(q)) if len(pos) else 0.0, 0),
                    "reverse_mw": round(float(neg.quantile(q)) if len(neg) else 0.0, 0),
                    "mean_mw": round(float(x.mean()), 1)})
    return out


@dataclass
class Demand:
    """Carga, renováveis e parcela fixa por subsistema e mês do horizonte, mais os patamares."""
    months: list[dt.date]
    load: pd.DataFrame          # month, sub, mw  (carga do balanço)
    fixed: pd.DataFrame         # month, sub, mw  (pequenas usinas fora da ENA e térmicas fora do despacho)
    ncs: pd.DataFrame           # month, sub, tech, mw, std_rel
    blocks: pd.DataFrame        # month(cal), block, share, sub, load_f, wind_f, solar_f
    growth: dict = field(default_factory=dict)


def seasonal_forecast(daily: pd.Series, asof: pd.Timestamp, months: list[dt.date], g: float, damped: bool = False) -> dict[dt.date, float]:
    """Média dos últimos 365 dias × índice sazonal médio dos últimos SEASONAL_YEARS anos × crescimento.

    O índice de um ano só (o mesmo mês do ano anterior) carrega o clima daquele ano: as ondas de calor
    de 2024 fizeram a carga de abr–mai/2025 sair 4 GW acima do realizado. Com três anos o erro cai."""
    x = daily.dropna()
    level = float(x[(x.index > asof - pd.Timedelta(days=365)) & (x.index <= asof)].mean())
    idx: dict[int, list[float]] = {}
    for back in range(SEASONAL_YEARS):
        hi = asof - pd.Timedelta(days=365 * back)
        w = x[(x.index > hi - pd.Timedelta(days=365)) & (x.index <= hi)]
        if len(w) < 330 or w.mean() <= 0:
            continue
        for m, v in (w.groupby(w.index.month).mean() / w.mean()).items():
            idx.setdefault(int(m), []).append(float(v))
    si = {m: float(np.mean(v)) for m, v in idx.items()}
    mid = asof - pd.Timedelta(days=182)
    out = {}
    for t in months:
        years = (pd.Timestamp(t) + pd.Timedelta(days=14) - mid).days / 365.25
        out[t] = level * si.get(t.month, 1.0) * (ncs_growth(g, years) if damped else (1 + g) ** years)
    return out


def demand(bal: pd.DataFrame, evt: pd.DataFrame, fleet: Fleet, asof: dt.date, months: list[dt.date]) -> Demand:
    a = pd.Timestamp(asof)
    b = bal[bal["ts"] < a + pd.Timedelta(days=1)].copy()
    b["m"] = b["ts"].dt.to_period("M")
    counts = b.groupby("m")["ts"].nunique()
    full = counts[counts >= counts.index.days_in_month * 24 * 0.98].index
    last_full = max(full)
    gr: dict[str, dict] = {}
    load_rows, ncs_rows, fixed_rows = [], [], []
    # parcela fixa: hidráulica do balanço que não está nas usinas da ENA + térmica fora do arquivo de despacho
    e28 = evt[(evt["date"] > a - pd.Timedelta(days=FLEET_DAYS)) & (evt["date"] <= a)]
    b28 = b[b["ts"] > a - pd.Timedelta(days=FLEET_DAYS)]
    for s in SUBS:
        bs = b[b["sub"] == s].set_index("ts")
        monthly = bs.groupby(bs["m"])[["load", "wind", "solar"]].mean()
        daily = bs[["load", "wind", "solar"]].resample("D").mean()
        gl = growth(daily["load"], a, *GROWTH_RANGE["load"])
        gw = growth(daily["wind"], a, *GROWTH_RANGE["wind"])
        gs = growth(daily["solar"], a, *GROWTH_RANGE["solar"])
        gr[s] = {"carga": round(gl, 4), "eolica": round(gw, 4), "solar": round(gs, 4)}
        small_hydro = max(0.0, float(b28.loc[b28["sub"] == s, "hydro"].mean()) - float(e28.loc[e28["sub"] == s, "gen"].mean()))
        other_th = max(0.0, float(b28.loc[b28["sub"] == s, "thermal"].mean()) - fleet.dispatched_mw[s]) + fleet.no_cvu_mw[s]
        fl = seasonal_forecast(daily["load"], a, months, gl)
        fw = seasonal_forecast(daily["wind"], a, months, gw, damped=True)
        fs = seasonal_forecast(daily["solar"], a, months, gs, damped=True)
        for t in months:
            load_rows.append({"month": t, "sub": s, "mw": fl[t]})
            fixed_rows.append({"month": t, "sub": s, "mw": small_hydro + other_th})
            for tech, fc in (("wind", fw), ("solar", fs)):
                ncs_rows.append({"month": t, "sub": s, "tech": tech, "mw": fc[t], "std_rel": interannual_std(monthly[tech])})
    return Demand(months=months, load=pd.DataFrame(load_rows), fixed=pd.DataFrame(fixed_rows), ncs=pd.DataFrame(ncs_rows),
                  blocks=block_profile(b, last_full), growth=gr)


def ncs_growth(g: float, years: float) -> float:
    """Expansão das renováveis: o ritmo dos últimos 12 meses no 1º ano, caindo à metade a cada ano
    seguinte (anos fracionários contam proporcionalmente; tempo negativo desconta o mesmo ritmo)."""
    if years <= 0:
        return (1 + g) ** years
    m, j = 1.0, 0
    while years - j >= 1:
        m *= 1 + g * 0.5 ** j
        j += 1
    return m * (1 + g * 0.5 ** j) ** (years - j)


def interannual_std(monthly: pd.Series) -> float:
    """Desvio relativo da razão ano a ano do mesmo mês em torno da sua mediana (robusto, via MAD)."""
    x = monthly.dropna()
    x = x[x > 1.0]
    r = []
    for p, v in x.items():
        prev = x.get(p - 12)
        if prev is not None and prev > 1.0:
            r.append(v / prev)
    if len(r) < 12:
        return 0.0
    r = np.asarray(r)
    mad = np.median(np.abs(r - np.median(r)))
    return float(min(0.3, 1.4826 * mad / np.median(r)))


def block_profile(b: pd.DataFrame, last_full: pd.Period) -> pd.DataFrame:
    """Para cada mês civil (última ocorrência completa), patamares pelo posto da carga líquida do SIN."""
    rows = []
    for cal in range(1, 13):
        p = pd.Period(year=last_full.year, month=cal, freq="M")
        if p > last_full:
            p -= 12
        x = b[b["m"] == p]
        piv = x.pivot_table(index="ts", columns="sub", values=["load", "wind", "solar"], aggfunc="sum")
        if piv.empty:
            raise RuntimeError(f"balanço sem dados em {p}")
        net = (piv["load"].sum(axis=1) - piv["wind"].sum(axis=1) - piv["solar"].sum(axis=1)).sort_values(ascending=False)
        n = len(net)
        edges = np.round(np.cumsum([0] + [sh for _, sh in BLOCKS]) * n).astype(int)
        for i, (name, _) in enumerate(BLOCKS):
            hrs = net.index[edges[i]:edges[i + 1]]
            for s in SUBS:
                def f(col: str) -> float:
                    tot = piv[col][s].mean()
                    return float(max(piv[col][s].loc[hrs].mean() / tot, 1e-3)) if tot > 1.0 else 1.0
                rows.append({"cal": cal, "block": i, "name": name, "share": (edges[i + 1] - edges[i]) / n, "sub": s,
                             "load_f": f("load"), "wind_f": f("wind"), "solar_f": f("solar")})
    return pd.DataFrame(rows)
