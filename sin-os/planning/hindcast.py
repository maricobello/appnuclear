"""Retroanálise: roda o caso como se fosse o dia 1º de cada mês passado e compara com o realizado.

    python planning/hindcast.py --from 2025-01 --to 2026-09 --out planning/validacao.json

Para cada mês M o caso usa só o que estava publicado até o último dia de M−1 (ENA, EAR, balanço,
vertimento, frota térmica, CVU da semana do PMO e o CMO do DESSEM até a véspera). O estágio h é
exatamente o mês M+h, então o PLD previsto para os próximos meses e a EAR prevista para o fim de M
se comparam direto com o realizado. Cada mês roda o SDDP com o λ padrão (o "puro") e depois com o
valor da água implícito (calibrate.py: λ do CVaR e, se ele satura, o piso do SE), como a rodada diária. Referências: persistência (o PLD de M−1), o CMO
médio do DESSEM nos 14 dias anteriores com a ponta (o melhor preditor de mercado simples) e o CMO
semanal do DECOMP do próprio ONS.
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from sin_plan import build, calibrate, case as C, inputs as I, observed, ons, results, solve  # noqa: E402

#: Horizontes guardados (estágio h = mês M+h) e avaliados nas métricas por horizonte.
HORIZONS = 12
EVAL_HORIZONS = 6
#: Mês "completo" para comparar: ao menos 25 dias de PLD horário.
MIN_HOURS = 24 * 25


def month(s: str) -> dt.date:
    y, m = s.split("-")
    return dt.date(int(y), int(m), 1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="first")
    ap.add_argument("--to", dest="last")
    ap.add_argument("--merge", help="pasta com os JSON de cada mês (saída dos jobs da matriz) para juntar")
    ap.add_argument("--cache", default=str(Path.home() / ".cache" / "sin-plan"))
    ap.add_argument("--work", default="/tmp/sin-plan-hindcast")
    ap.add_argument("--out", default="validacao.json")
    ap.add_argument("--threads", type=int, default=0)
    args = ap.parse_args()
    if args.merge:
        rows = {}
        for p in sorted(Path(args.merge).glob("*.json")):
            for r in json.loads(p.read_text()).get("meses", []):
                rows[r["mes"]] = r
        merged = [rows[k] for k in sorted(rows)]
        Path(args.out).write_text(json.dumps({"meses": merged, "metricas": metrics(merged)}, ensure_ascii=False, indent=1))
        print(f"{len(merged)} meses juntados em {args.out}")
        return 0
    if not args.first or not args.last:
        ap.error("use --from e --to (AAAA-MM) ou --merge")

    f = ons.Fetcher(Path(args.cache))
    params = C.Params()
    work = Path(args.work)
    prev = json.loads(Path(args.out).read_text()) if Path(args.out).exists() else {"meses": []}
    done = {r["mes"]: r for r in prev.get("meses", []) if "horizonte" in r}
    m, last = month(args.first), month(args.last)
    today = dt.date.today()
    years = [y for y in range(m.year - 1, today.year + 1) if y >= 2021]
    half = observed.cmo_halfhour(f, years, today.year)
    cmo_h = observed.cmo_hourly(half)
    hourly = observed.pld_hourly(half)
    weekly = observed.cmo_weekly(f, years, today.year)
    ear_all = I.ear_daily(f, range(m.year - 1, today.year + 1), today.year)
    ena_all = I.ena_daily(f, today)
    evt_all = I.evt_daily(f, I.months_back(today, 26), (today.year, today.month))
    real_cache: dict[dt.date, dict] = {}

    def realized(mm: dt.date) -> dict:
        if mm not in real_cache:
            real_cache[mm] = observed.month_stats(hourly, weekly, ear_all, mm)
        return real_cache[mm]

    rows = []
    while m <= last:
        key = m.strftime("%Y-%m")
        if key in done:
            rows.append(done[key])
            m = I.add_months(m, 1)
            continue
        t0 = time.time()
        asof = m - dt.timedelta(days=1)
        cs = build.assemble(build.load(f, asof), params, asof=asof)
        dev = results.peak_deviations(cmo_h, cs.start)
        target = calibrate.target_cmo(cmo_h, cs.start)
        runs: dict[tuple[float, float], dict] = {}
        pure_key = (round(params.cvar_lambda, 3), 0.0)

        def run_at(lam: float, floor_pp: float, cs=cs, dev=dev, runs=runs, key=key) -> float:
            k = (round(lam, 3), round(floor_pp, 1))
            if k not in runs:
                c = dataclasses.replace(cs, params=dataclasses.replace(cs.params, cvar_lambda=k[0], floor_shift_pp=k[1]))
                tag = f"{key}-l{k[0]:.3f}-p{k[1]:.1f}"
                case_dir, out_dir = work / tag, work / f"{tag}-out"
                shutil.rmtree(case_dir, ignore_errors=True)
                shutil.rmtree(out_dir, ignore_errors=True)
                C.write(c, case_dir)
                pure = runs.get(pure_key)
                if pure is None:
                    est = solve.estimate(case_dir, c.params)
                else:
                    est = pure["par"]
                    solve.fix_estimation(case_dir, est)
                run = solve.run(case_dir, out_dir, threads=args.threads or None)
                sim = results.load_sim(c, out_dir, dev)
                runs[k] = {"par": est, "iteracoes": run["iterations"], "segundos": run["seconds"], **summarize(sim)}
                shutil.rmtree(out_dir, ignore_errors=True)
                shutil.rmtree(case_dir, ignore_errors=True)
            return runs[k]["cmo0"][calibrate.TARGET_SUB]

        last_m = rows[-1] if rows and rows[-1]["mes"] == I.add_months(m, -1).strftime("%Y-%m") else None
        lc = (last_m or {}).get("calibracao")
        guess = (lc["lambda"], lc.get("piso_pp", 0.0)) if lc else None
        cal = calibrate.implied_risk(run_at, target[calibrate.TARGET_SUB], start=params.cvar_lambda, guess=guess)
        best, pure = runs[(cal["lambda"], cal["piso_pp"])], runs[pure_key]
        real, real_prev = realized(m), realized(I.add_months(m, -1))
        lim = results.limits(m.year)
        a, b = pd.Timestamp(m), pd.Timestamp(I.add_months(m, 1))
        diag = {}
        for s in I.SUBS:
            ena_m = ena_all[(ena_all["sub"] == s) & (ena_all["date"] >= a) & (ena_all["date"] < b)]["armaz"].mean()
            gen_m = evt_all[(evt_all["sub"] == s) & (evt_all["date"] >= a) & (evt_all["date"] < b)]["gen"].mean()
            diag[s] = {"afluencia_prev_mwmed": best["inflow0"][s], "afluencia_real_mwmed": round(float(ena_m * cs.k[s]["k"]), 0),
                       "geracao_hidro_prev_mwmed": best["hydro0"][s], "geracao_hidro_real_mwmed": round(float(gen_m), 0)}
        row = {"mes": key, "asof": asof.isoformat(), "segundos": round(time.time() - t0, 1), "par": pure["par"], "iteracoes": best["iteracoes"],
               "calibracao": cal, "diagnostico": diag,
               "termicas": {"disponibilidade": cs.fleet.avail_source, "fator": cs.fleet.avail_factor, "usinas": int(len(cs.fleet.plants))}, "sub": {}}
        for s in I.SUBS:
            row["sub"][s] = {
                "previsto": {"cmo": best["stage"][0]["cmo"][s], "pld": best["stage"][0]["pld"][s], "pld_ponta": best["stage"][0]["pld_ponta"][s],
                             "ear_fim_pct": best["stage"][0]["ear"][s]},
                "puro": {"cmo": pure["stage"][0]["cmo"][s], "pld_ponta": pure["stage"][0]["pld_ponta"][s]},
                "mercado": {"dessem14_cmo": target[s], "dessem14_ponta": round(float(results.ponta_pld(np.array([target[s]]), dev[s], lim)[0]), 2),
                            "decomp_semana": decomp_week(weekly, s, asof)},
                "realizado": real[s],
                "persistencia_pld": real_prev[s]["pld"],
                "ear_inicio_pct": cs.store[s]["pct"],
            }
        row["horizonte"] = []
        for h in range(min(HORIZONS, len(best["stage"]))):
            mh = I.add_months(m, h)
            rh = realized(mh) if mh < dt.date(today.year, today.month, 1) else None
            row["horizonte"].append({
                "h": h, "mes": mh.strftime("%Y-%m"),
                "pld_ponta": {s: best["stage"][h]["pld_ponta"][s] for s in I.SUBS},
                "puro_p50": {s: pure["stage"][h]["pld_ponta"][s]["p50"] for s in I.SUBS},
                "realizado": {s: rh[s]["pld"] if rh and rh[s]["horas"] >= MIN_HOURS else None for s in I.SUBS},
            })
        rows.append(row)
        Path(args.out).write_text(json.dumps({"meses": rows, "metricas": metrics(rows)}, ensure_ascii=False, indent=1))
        x = row["sub"]["SE"]
        print(f"{key}: {row['segundos']} s · λ {cal['lambda']}{' + piso ' + str(cal['piso_pp']) + ' p.p.' if cal['piso_pp'] else ''} ({len(cal['tentativas'])} rodadas, alvo {cal['alvo']}, CMO {cal['cmo']}{', ' + cal['limite'] if cal['limite'] else ''})"
              f" · PLD SE previsto {x['previsto']['pld_ponta']['p50']} (puro {x['puro']['pld_ponta']['p50']}, DESSEM 14 d {x['mercado']['dessem14_ponta']}) × realizado {real['SE']['pld']}"
              f" · EAR SE {x['previsto']['ear_fim_pct']['p50']}% × {real['SE']['ear_fim_pct']}%", flush=True)
        m = I.add_months(m, 1)
    Path(args.out).write_text(json.dumps({"meses": rows, "metricas": metrics(rows)}, ensure_ascii=False, indent=1))
    return 0


def summarize(sim: results.Sim) -> dict:
    """O que a retroanálise guarda de uma rodada: quantis por estágio dos primeiros meses."""
    out = {"cmo0": {s: float(np.median(sim.cmo[s][:, 0])) for s in I.SUBS},
           "inflow0": {s: results._q(sim.inflow_mw[s][:, 0], 0) for s in I.SUBS},
           "hydro0": {s: results._q(sim.hydro_mw[s][:, 0], 0) for s in I.SUBS}, "stage": []}
    for h in range(min(HORIZONS, len(sim.stages))):
        out["stage"].append({
            "cmo": {s: results._q(sim.cmo[s][:, h]) for s in I.SUBS},
            "pld": {s: results._q(sim.pld[s][:, h]) for s in I.SUBS},
            "pld_ponta": {s: results._q(sim.pld_ponta[s][:, h]) for s in I.SUBS},
            "ear": {s: results._q(sim.ear_pct[s][:, h], 1) for s in I.SUBS},
        })
    return out


def decomp_week(weekly: pd.DataFrame, s: str, asof: dt.date) -> float | None:
    """CMO do DECOMP da semana operativa (sábado a sexta) que contém `asof`: já publicado na véspera."""
    w = weekly[weekly["sub"] == s]
    t = pd.Timestamp(asof)
    for wk, cmo in zip(w["week"], w["cmo"]):
        ws = wk - pd.Timedelta(days=6) if wk.dayofweek == 4 else wk
        if ws <= t < ws + pd.Timedelta(days=7):
            return round(float(cmo), 2)
    return None


def metrics(rows: list[dict]) -> dict:
    """Erros por subsistema do PLD do mês M (P50 com ponta, calibrado) contra persistência, o SDDP
    puro, o DESSEM de 14 dias com ponta e o DECOMP; cobertura das faixas (a do modelo e a publicada,
    calibrada fora da amostra); EAR do fim de M; e o erro por horizonte (M a M+5)."""
    out = {}
    comb = combination_loo(rows) if any("horizonte" in r for r in rows) else {}
    for s in I.SUBS:
        ok_rows = [x for x in rows if x["sub"][s]["realizado"]["pld"] is not None and x["sub"][s]["realizado"]["horas"] >= MIN_HOURS]
        r = [x["sub"][s] for x in ok_rows]
        if not r:
            continue
        real = np.array([x["realizado"]["pld"] for x in r])
        p50 = np.array([x["previsto"]["pld"]["p50"] for x in r])
        p10 = np.array([x["previsto"]["pld"]["p10"] for x in r])
        p90 = np.array([x["previsto"]["pld"]["p90"] for x in r])
        has_k = all("pld_ponta" in x["previsto"] for x in r)
        k50 = np.array([x["previsto"]["pld_ponta"]["p50"] for x in r]) if has_k else None
        k10 = np.array([x["previsto"]["pld_ponta"]["p10"] for x in r]) if has_k else None
        k90 = np.array([x["previsto"]["pld_ponta"]["p90"] for x in r]) if has_k else None
        pers = arr([x["persistencia_pld"] for x in r])
        lim = [results.limits(int(x["mes"][:4])) for x in ok_rows]
        dec = np.array([np.clip(x["realizado"]["cmo_decomp"], lm["min"], lm["max_h"]) if x["realizado"]["cmo_decomp"] is not None else np.nan for x, lm in zip(r, lim)])
        pure = arr([x.get("puro", {}).get("pld_ponta", {}).get("p50") for x in r])
        d14 = arr([x.get("mercado", {}).get("dessem14_ponta") for x in r])
        e_real = arr([x["realizado"]["ear_fim_pct"] for x in r])
        e50 = np.array([x["previsto"]["ear_fim_pct"]["p50"] for x in r])
        e10 = np.array([x["previsto"]["ear_fim_pct"]["p10"] for x in r])
        e90 = np.array([x["previsto"]["ear_fim_pct"]["p90"] for x in r])
        ok = np.isfinite(e_real)
        out[s] = {
            "meses": int(len(r)),
            "pld_mae_modelo": mae(p50, real), "pld_mae_persistencia": mae(pers, real), "pld_mae_decomp": mae(dec, real),
            "pld_vies_modelo": round(float((p50 - real).mean()), 2),
            "pld_cobertura_p10_p90": round(float(((real >= p10) & (real <= p90)).mean()), 3),
            "pld_mae_ponta": mae(k50, real) if has_k else None,
            "pld_vies_ponta": round(float((k50 - real).mean()), 2) if has_k else None,
            "pld_cobertura_p10_p90_ponta": round(float(((real >= k10) & (real <= k90)).mean()), 3) if has_k else None,
            "pld_cobertura_calibrada": loo_coverage(real, k50, k10, k90, lim) if has_k else None,
            "pld_mae_puro": mae(pure, real),
            "pld_mae_dessem14": mae(d14, real),
            "ear_mae_pp": mae(e50, e_real), "ear_vies_pp": round(float((e50[ok] - e_real[ok]).mean()), 2) if ok.any() else None,
            "ear_cobertura_p10_p90": round(float(((e_real[ok] >= e10[ok]) & (e_real[ok] <= e90[ok])).mean()), 3) if ok.any() else None,
            "horizonte": horizon_metrics(rows, s, comb.get(s, {})),
        }
        if comb.get(s, {}).get(0):
            out[s]["pld_mae_combinado"] = comb[s][0]["mae"]
            out[s]["pld_cobertura_combinado"] = comb[s][0]["cobertura"]
    return out


def combination_loo(rows: list[dict]) -> dict[str, dict[int, dict]]:
    """Erro médio e cobertura da faixa da combinação publicada (results.apply_combination) por
    submercado e horizonte, com pesos e quantis do erro calibrados sem o mês avaliado."""
    loo = results.combination_loo({"meses": rows})
    out: dict[str, dict[int, dict]] = {}
    for s in I.SUBS:
        out[s] = {}
        for h in range(EVAL_HORIZONS):
            pts = [x for m in loo.values() for x in m.get(s, []) if x["h"] == h and x["realizado"] is not None]
            hit = [x["p10"] <= x["realizado"] <= x["p90"] for x in pts if x["p10"] is not None]
            if len(pts) >= 3:
                out[s][h] = {"mae": round(float(np.mean([abs(x["p50"] - x["realizado"]) for x in pts])), 2),
                             "cobertura": round(float(np.mean(hit)), 3) if hit else None}
    return out


def horizon_metrics(rows: list[dict], s: str, comb: dict[int, dict] | None = None) -> list[dict]:
    """Erro médio do P50 por horizonte h (mês M+h previsto no 1º dia de M) contra a persistência e o
    DESSEM de 14 dias congelados (os dois repetem o último valor conhecido para todo h), e o da
    combinação publicada calibrada sem o mês avaliado."""
    out = []
    for h in range(EVAL_HORIZONS):
        trip = []
        for x in rows:
            hz = x.get("horizonte") or []
            if len(hz) <= h or hz[h]["realizado"][s] is None:
                continue
            q = hz[h]["pld_ponta"][s]
            trip.append((q["p50"], q["p10"], q["p90"], hz[h]["puro_p50"][s], x["sub"][s]["persistencia_pld"],
                         x["sub"][s].get("mercado", {}).get("dessem14_ponta"), hz[h]["realizado"][s]))
        if len(trip) < 3:
            continue
        p50, p10, p90, pure, pers, d14, real = (arr(list(c)) for c in zip(*trip))
        c = (comb or {}).get(h) or {}
        out.append({"h": h, "n": len(trip), "mae_modelo": mae(p50, real), "mae_puro": mae(pure, real), "mae_persistencia": mae(pers, real),
                    "mae_dessem14": mae(d14, real), "vies_modelo": round(float(np.nanmean(p50 - real)), 2),
                    "cobertura_modelo": round(float(((real >= p10) & (real <= p90)).mean()), 3),
                    "mae_combinado": c.get("mae"), "cobertura_combinado": c.get("cobertura")})
    return out


def arr(v: list) -> np.ndarray:
    return np.array([np.nan if x is None else x for x in v], dtype=float)


def mae(a: np.ndarray | None, b: np.ndarray) -> float | None:
    if a is None:
        return None
    m = np.isfinite(a) & np.isfinite(b)
    return round(float(np.abs(a[m] - b[m]).mean()), 2) if m.any() else None


def loo_coverage(real: np.ndarray, p50: np.ndarray, p10: np.ndarray, p90: np.ndarray, lim: list[dict]) -> float | None:
    """Cobertura da faixa publicada (a do modelo alargada pelos quantis do erro, como em
    results.calibrated_band) com cada mês avaliado pela calibração dos outros meses: medir com os
    próprios erros daria ~80% por construção."""
    if len(real) < 9:
        return None
    err = real - p50
    hit = []
    for i in range(len(real)):
        rest = np.delete(err, i)
        lo = min(p10[i], max(lim[i]["min"], p50[i] + np.quantile(rest, 0.10)))
        hi = max(p90[i], min(lim[i]["max_h"], p50[i] + np.quantile(rest, 0.90)))
        hit.append(lo <= real[i] <= hi)
    return round(float(np.mean(hit)), 3)


if __name__ == "__main__":
    raise SystemExit(main())
