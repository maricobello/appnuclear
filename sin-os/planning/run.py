"""Planejamento da operação do SIN com o NovoModelo (SDDP oficial de ONS/CCEE/EPE) e dados abertos do ONS.

    python planning/run.py --out planejamento.json [--post https://sinos-iota.vercel.app]

Monta o caso no último dia com ENA e EAR publicados, escolhe o modelo de afluências, treina e
simula a política no λ padrão e depois na aversão a risco implícita (o λ e, se ele satura, o piso do
SE que fazem o CMO do 1º estágio reproduzir o CMO recente do DESSEM; ver sin_plan/calibrate.py), roda
as sensibilidades e grava/envia o relatório. ``--post`` envia para /api/planejamento/ingest com o
token da variável de ambiente ADMIN_KEY (o mesmo da Vercel) e lê de lá o ponto da rodada anterior
para começar a busca.
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import gzip
import json
import os
import shutil
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sin_plan import build, calibrate, case as C, inputs as I, observed, ons, results, solve  # noqa: E402

#: Sensibilidades (cada uma é um SDDP completo): nome, rótulo e o que muda nos parâmetros.
SENSITIVITIES = [
    ("neutro", "Sem aversão a risco (valor esperado, sem CVaR nem piso elevado)", {"cvar_lambda": 0.0, "floor_shift_pp": 0.0}),
    ("seco", "Hidrologia 15% mais seca (histórico de ENA × 0,85)", {"inflow_mult": 0.85}),
    ("carga", "Carga 5% maior", {"load_mult": 1.05}),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=str(Path.home() / ".cache" / "sin-plan"))
    ap.add_argument("--work", default="/tmp/sin-plan")
    ap.add_argument("--out", default="planejamento.json")
    ap.add_argument("--post", default="")
    ap.add_argument("--threads", type=int, default=0)
    ap.add_argument("--sens", default="all", help="all, none ou nomes separados por vírgula")
    ap.add_argument("--validation", default=str(Path(__file__).resolve().parent / "validacao.json"))
    args = ap.parse_args()

    t0 = time.time()
    f = ons.Fetcher(Path(args.cache))
    data = build.load(f, dt.date.today())
    cs = build.assemble(data, C.Params())
    print(f"caso: estudo a partir de {cs.start} (dados até {cs.asof}) · {len(cs.fleet.plants)} térmicas · k {({s: v['k'] for s, v in cs.k.items()})}", flush=True)
    work = Path(args.work)
    hourly = dessem_hourly(f, cs.start)
    dev = optional("PLD com ponta", results.peak_deviations, hourly, cs.start)
    target = optional("calibração do λ", calibrate.target_cmo, hourly, cs.start)

    # SDDP puro (λ padrão) e, com o CMO recente do DESSEM, a aversão a risco implícita: o caso base é o calibrado
    runs: dict[tuple[float, float], dict] = {}
    pure_key = (round(cs.params.cvar_lambda, 3), 0.0)

    def run_at(lam: float, floor_pp: float = 0.0) -> float:
        k = (round(lam, 3), round(floor_pp, 1))
        if k not in runs:
            c = dataclasses.replace(cs, params=dataclasses.replace(cs.params, cvar_lambda=k[0], floor_shift_pp=k[1]))
            pure = runs.get(pure_key)
            runs[k] = run_case(c, work / f"lambda-{k[0]:.3f}-piso-{k[1]:.1f}", args.threads, est_fixed=pure["par"] if pure else None, dev=dev)
            r = runs[k]
            print(f"λ {k[0]} piso +{k[1]} p.p.: {r['solver']['iterations']} iterações em {r['solver']['seconds']} s · CMO SE do 1º estágio {r['cmo0']['SE']:.2f}", flush=True)
        return runs[k]["cmo0"][calibrate.TARGET_SUB]

    run_at(*pure_key)
    guess = previous_point(args.post) if target else None
    cal = calibrate.implied_risk(run_at, target[calibrate.TARGET_SUB], start=pure_key[0], guess=guess) if target else None
    best_key = (cal["lambda"], cal["piso_pp"]) if cal else pure_key
    base, pure = runs[best_key], runs[pure_key]
    cs = dataclasses.replace(cs, params=dataclasses.replace(cs.params, cvar_lambda=best_key[0], floor_shift_pp=best_key[1]))
    print(f"base: λ {best_key[0]} piso +{best_key[1]} p.p.{' (implícitos, alvo ' + str(cal['alvo']) + ')' if cal else ' (padrão: sem CMO do DESSEM para calibrar)'} · PAR {base['par']['metodo']} ordem máx. {base['par']['ordem_max']}", flush=True)

    sens = []
    wanted = [s[0] for s in SENSITIVITIES] if args.sens == "all" else [] if args.sens == "none" else args.sens.split(",")
    for name, label, change in SENSITIVITIES:
        if name not in wanted:
            continue
        p = dataclasses.replace(cs.params, **change)
        r = run_case(dataclasses.replace(cs, params=p), work / name, args.threads, est_fixed=base["par"], dev=dev)
        sens.append({"nome": name, "rotulo": label, "parametros": change, "meses": r["report"]["meses"][:13],
                     "pld_12m": r["report"]["pld_12m"], **({"pld_12m_ponta": r["report"]["pld_12m_ponta"]} if "pld_12m_ponta" in r["report"] else {}),
                     "segundos": r["solver"]["seconds"]})
        print(f"sensibilidade {name}: {r['solver']['seconds']} s", flush=True)

    validation = json.loads(Path(args.validation).read_text()) if Path(args.validation).exists() else None
    resid = results.residual_quantiles(validation)
    for r in [base["report"], *sens]:
        results.calibrated_band(r["meses"], resid, cs.start)
    # o publicado: SDDP calibrado combinado com o DESSEM de 14 dias congelado, pesos da retroanálise
    weights = results.blend_weights(validation)
    comb_resid = results.combination_residuals(validation, weights)
    d14 = anchor_by_month(target, dev, base["report"]["meses"])
    results.apply_combination(base["report"]["meses"], d14, weights, comb_resid, cs.start)
    rep = compose(cs, base, sens, f.sources, time.time() - t0, Path(args.validation), dev)
    rep["calibracao"] = {"residuo": resid, "fonte": "retroanálise (planning/validacao.json): erro do PLD por horizonte, P10 e P90"} if resid else None
    rep["combinacao"] = combination_summary(weights, comb_resid, d14, base["report"]) if weights and d14 else None
    rep["calibracao_risco"] = risk_summary(cal, target, pure_key[0], pure) if cal else None
    Path(args.out).write_text(json.dumps(rep, ensure_ascii=False))
    print(f"relatório {len(json.dumps(rep)) / 1e3:.0f} kB · {time.time() - t0:.0f} s", flush=True)
    for line in pld_lines(rep["resultado"]["meses"][1] if len(rep["resultado"]["meses"]) > 1 else rep["resultado"]["meses"][0]):
        print(line, flush=True)

    if args.post:
        post(args.post, rep)
    return 0


def dessem_hourly(f: ons.Fetcher, start: dt.date):
    """CMO horário do DESSEM das semanas antes do início (None se a série não vier)."""
    try:
        years = sorted({(start - dt.timedelta(days=max(results.PEAK_DAYS, calibrate.TARGET_DAYS) + 1)).year, start.year})
        return observed.cmo_hourly(observed.cmo_halfhour(f, years, dt.date.today().year))
    except Exception as e:  # noqa: BLE001 — ponta e calibração são refinamentos; sem elas o resto do relatório vale
        print(f"::warning::sem CMO horário do DESSEM: {e}", flush=True)
        return None


def optional(what: str, fn, hourly, start: dt.date):
    """Ponta e calibração dependem do CMO do DESSEM: sem ele (ou com buraco na janela) o relatório
    sai com o SDDP no λ padrão e o aviso no log."""
    if hourly is None:
        return None
    try:
        return fn(hourly, start)
    except Exception as e:  # noqa: BLE001
        print(f"::warning::sem {what}: {e}", flush=True)
        return None


def previous_point(base_url: str) -> tuple[float, float] | None:
    """λ e piso implícitos da última rodada publicada: a busca começa por eles (o valor da água muda devagar)."""
    if not base_url:
        return None
    try:
        token = os.environ.get("ADMIN_KEY") or os.environ.get("CRON_SECRET") or ""
        req = urllib.request.Request(base_url.rstrip("/") + "/api/planejamento", headers={"Authorization": f"Bearer {token}"} if token else {})
        with urllib.request.urlopen(req, timeout=30) as resp:
            cal = (json.loads(resp.read()).get("report") or {}).get("calibracao_risco") or {}
        lam, fl = cal.get("lambda"), cal.get("piso_pp", 0.0)
        return (float(lam), float(fl or 0.0)) if lam is not None and 0 <= float(lam) <= 1 else None
    except Exception as e:  # noqa: BLE001 — sem o palpite a busca só faz uma rodada a mais
        print(f"sem o ponto da rodada anterior ({e}); a busca parte do zero", flush=True)
        return None


def pld_lines(m: dict) -> list[str]:
    """Resumo do mês para o log: o PLD publicado (a combinação) e o do SDDP calibrado."""
    head, band = m.get("pld_ponta") or m["pld"], m.get("pld_faixa") or {}
    fmt = lambda q, b: f"{q['p50']} (P10 {b['p10']}–P90 {b['p90']})"  # noqa: E731
    out = [f"PLD do SDDP {m['mes']}: " + " · ".join(f"{s} {fmt(head[s], band.get(s) or head[s])}" for s in I.SUBS)]
    if m.get("pld_previsto"):
        out.insert(0, f"PLD publicado {m['mes']} (peso do SDDP {m.get('peso_sddp')}): " + " · ".join(f"{s} {fmt(m['pld_previsto'][s], m['pld_previsto'][s])}" for s in I.SUBS))
    return out


def anchor_by_month(target: dict | None, dev: dict | None, months: list[dict]) -> dict[str, dict[str, float]]:
    """PLD com ponta do CMO médio do DESSEM nos 14 dias anteriores, congelado em todos os meses (com o
    piso e o teto de cada ano): a âncora da combinação publicada."""
    if not target or not dev:
        return {}
    out = {}
    for m in months:
        lim = results.limits(int(m["mes"][:4]))
        out[m["mes"]] = {s: round(float(results.ponta_pld(np.array([target[s]]), dev[s], lim)[0]), 2) for s in I.SUBS}
    return out


def combination_summary(weights: list[dict], resid: dict, d14: dict, rep: dict) -> dict:
    """Pesos e erros da combinação, a âncora e a média dos 12 meses civis inteiros do publicado."""
    full = [m for m in rep["meses"] if m["cobertura"] >= 0.999 and "pld_previsto" in m][:12]
    avg = {s: {k: round(float(np.mean([m["pld_previsto"][s][k] for m in full])), 2) for k in ("p10", "p50", "p90")} for s in I.SUBS} if len(full) == 12 else None
    first = next(iter(d14.values()))
    return {"pesos": weights, "residuo": resid, "ancora": first, "pld_12m": avg,
            "fonte": "peso do SDDP calibrado contra o DESSEM de 14 dias congelado, por horizonte, que minimiza o erro da retroanálise (planning/validacao.json); faixa pelos quantis do erro da combinação"}


def risk_summary(cal: dict, target: dict, lam0: float, pure: dict) -> dict:
    """λ implícito, o alvo e o que o SDDP puro (λ padrão) daria: o leitor vê quanto a calibração mexe."""
    head = lambda m: m.get("pld_ponta") or m["pld"]  # noqa: E731
    return {**cal, "lambda_padrao": lam0, "sub": calibrate.TARGET_SUB, "alvo_por_sub": target,
            "alvo_fonte": f"CMO médio do DESSEM nos {calibrate.TARGET_DAYS} dias antes do início do estudo (ONS)",
            "puro": [{"mes": m["mes"], "pld_p50": {s: head(m)[s]["p50"] for s in I.SUBS}} for m in pure["report"]["meses"][:13]],
            "puro_pld_12m": {s: (pure["report"].get("pld_12m_ponta") or pure["report"]["pld_12m"]).get(s, {}).get("mean") for s in I.SUBS}}


def compose(cs: C.Case, base: dict, sens: list[dict], sources: list, seconds: float, validation: Path, dev: dict | None = None) -> dict:
    """Relatório enviado ao app (o contrato é o esquema src/lib/planning/report.ts)."""
    ponta = None
    if dev:
        ponta = {"janela_dias": results.PEAK_DAYS, "fonte": "CMO semi-horário do DESSEM (ONS)",
                 "desvio": {s: {k: round(float(np.quantile(dev[s], q)), 2) for k, q in (("p05", 0.05), ("p50", 0.5), ("p95", 0.95))} for s in I.SUBS}}
    return {
        "v": 1,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "asof": cs.asof.isoformat(),
        "start": cs.start.isoformat(),
        "solver": {"nome": "NovoModelo (ONS · CCEE · EPE)", "versao": solve.version(), "metodo": "SDDP — programação dinâmica dual estocástica",
                   **base["solver"], "segundos_total": round(seconds, 1)},
        "params": {**dataclasses.asdict(cs.params), "pld_limites": {str(y): v for y, v in results.PLD_LIMITS.items()}},
        "caso": case_summary(cs, base),
        "resultado": base["report"],
        **({"ponta": ponta} if ponta else {}),
        "sensibilidades": sens,
        "validacao": load_validation(validation),
        "fontes": [dataclasses.asdict(s) for s in sources][:80],
    }


def run_case(cs: C.Case, case_dir: Path, threads: int, est_fixed: dict | None = None, dev: dict | None = None) -> dict:
    out_dir = case_dir.with_name(case_dir.name + "-out")
    shutil.rmtree(case_dir, ignore_errors=True)
    shutil.rmtree(out_dir, ignore_errors=True)
    summary = C.write(cs, case_dir)
    if est_fixed:
        solve.fix_estimation(case_dir, est_fixed)
        est = {k: v for k, v in est_fixed.items() if k != "ordens"}
    else:
        est = solve.estimate(case_dir, cs.params)
    sol = solve.run(case_dir, out_dir, threads=threads or None)
    sim = results.load_sim(cs, out_dir, dev)
    rep = results.report(cs, sim)
    est = {**est, "ordens": solve.fitted_orders(out_dir)}
    cmo0 = {s: float(np.median(sim.cmo[s][:, 0])) for s in I.SUBS}
    shutil.rmtree(out_dir, ignore_errors=True)
    return {"summary": summary, "par": est, "solver": sol, "report": rep, "cmo0": cmo0}


def case_summary(cs: C.Case, base: dict) -> dict:
    fl = cs.fleet.plants
    return {
        "aproveitamento_ena": cs.k,
        "fio_dagua": {"rees": cs.ror.rees, "tabela": cs.ror.table, "erro_soma_ree": cs.ror.check_max_err,
                      "fracao_media": {s: round(float(np.mean(list(v.values()))), 3) for s, v in cs.ror.share.items()}} if cs.ror else None,
        "armazenamento": cs.store,
        "vazao_minima_mw": cs.min_outflow,
        "hidro_disponivel_mw": cs.hydro_mw,
        "intercambio": cs.lines,
        "intercambio_liquido": cs.joint,
        "envelope": {s: {str(m): v for m, v in cs.envelope[s].items()} for s in I.SUBS},
        "termicas": {"usinas": int(len(fl)), "pmo": cs.fleet.study, "fonte_disponibilidade": cs.fleet.avail_source,
                     "disponivel_mw": {s: round(float(fl.loc[fl["sub"] == s, "max_mw"].sum()), 1) for s in I.SUBS},
                     "inflexivel_mw": {s: round(float(fl.loc[fl["sub"] == s, "min_mw"].sum()), 1) for s in I.SUBS},
                     "cvu_faixa": [round(float(fl["cvu"].min()), 2), round(float(fl["cvu"].median()), 2), round(float(fl["cvu"].max()), 2)]},
        "crescimento_12m": cs.demand.growth,
        "estagios": base["summary"]["estagios"], "fim": base["summary"]["fim"], "patamares": base["summary"]["patamares"],
        "fontes_nao_controlaveis": base["summary"]["fontes_nao_controlaveis"],
        "carga_liquida_mw": {s: v[:13] for s, v in base["summary"]["carga_liquida_mw"].items()},
        "par": base["par"],
    }


def load_validation(p: Path) -> dict | None:
    if not p.exists():
        return None
    v = json.loads(p.read_text())
    # o publicado do mês seguinte refeito sem o próprio mês, como na métrica da combinação
    pub = {m: {s: next(({k: round(x[k], 2) if x[k] is not None else None for k in ("p10", "p50", "p90")} for x in pts if x["h"] == 0), None)
               for s, pts in subs.items()} for m, subs in results.combination_loo(v).items()}
    return {"metricas": v.get("metricas", {}), "meses": [
        {"mes": r["mes"], **({"lambda": r["calibracao"]["lambda"], "piso_pp": r["calibracao"].get("piso_pp", 0.0)} if r.get("calibracao") else {}),
         "sub": {s: {"previsto_pld": r["sub"][s]["previsto"]["pld"],
                                     **({"previsto_pld_ponta": r["sub"][s]["previsto"]["pld_ponta"]} if "pld_ponta" in r["sub"][s]["previsto"] else {}),
                                     **({"publicado": pub[r["mes"]][s]} if pub.get(r["mes"], {}).get(s) else {}),
                                     **({"previsto_puro": r["sub"][s]["puro"]["pld_ponta"]["p50"]} if "puro" in r["sub"][s] else {}),
                                     **({"dessem14": r["sub"][s]["mercado"]["dessem14_ponta"]} if "mercado" in r["sub"][s] else {}),
                                     "realizado_pld": r["sub"][s]["realizado"]["pld"],
                                     "previsto_ear": r["sub"][s]["previsto"]["ear_fim_pct"], "realizado_ear": r["sub"][s]["realizado"]["ear_fim_pct"],
                                     "decomp": r["sub"][s]["realizado"]["cmo_decomp"], "persistencia": r["sub"][s]["persistencia_pld"]} for s in I.SUBS}}
        for r in v.get("meses", [])]}


def post(base_url: str, rep: dict) -> None:
    token = os.environ.get("ADMIN_KEY") or os.environ.get("CRON_SECRET") or ""
    body = gzip.compress(json.dumps(rep, ensure_ascii=False).encode())
    req = urllib.request.Request(base_url.rstrip("/") + "/api/planejamento/ingest", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "Content-Encoding": "gzip", "Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        text = resp.read().decode(errors="replace")
    print("enviado:", resp.status, text[:300], flush=True)
    try:
        stored = json.loads(text).get("armazenamento")
    except ValueError:
        stored = None
    if stored != "firestore":
        print(f"::warning::relatório recebido mas guardado em '{stored}', não no Firestore", flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
