"""Roda o modelo da rede para um dia e grava/envia o relatório.

    python grid/run.py --date auto --out rede.json [--post https://sinos-iota.vercel.app]

``--date auto`` escolhe o último dia com as quatro fontes completas (geração por usina, balanço,
intercâmbio e fluxo controlado). ``--post`` envia para /api/rede/ingest com o token da variável de
ambiente ADMIN_KEY (o mesmo da Vercel).
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import os
import re
import sys
import time
import urllib.request
import warnings
from importlib import metadata
from pathlib import Path

warnings.filterwarnings("ignore", category=FutureWarning)
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pandas as pd  # noqa: E402

from sin_grid import dispatch, flows, model, ons, report, shortcircuit  # noqa: E402

P3S_COMMIT = os.environ.get("P3S_COMMIT", "")


#: geração somada usina por usina × geração do balanço do ONS no mesmo dia: acima disso (fração da carga),
#: um dos dois ainda não foi consolidado (30/10/2026: 4,1 GW médios a mais de eólica no Nordeste)
GEN_BALANCE_TOL = 0.02


def generation_gap(g: pd.DataFrame, b: pd.DataFrame, d: dt.date) -> float:
    """|geração das usinas − geração do balanço| ÷ carga, nas médias do dia."""
    gh = pd.to_datetime(g["din_instante"])
    gsum = float(ons.num(g.loc[gh.dt.date == d, "val_geracao"]).fillna(0.0).sum())
    bh = pd.to_datetime(b["din_instante"])
    bd = b[(bh.dt.date == d) & b["id_subsistema"].astype(str).str.strip().isin(dispatch.SUBS)]
    bgen = float(sum(ons.num(bd[c]).fillna(0.0).sum() for c in bd.columns if c.startswith("val_ger")))
    load = float(ons.num(bd["val_carga"]).fillna(0.0).sum())
    return abs(gsum - bgen) / load if load > 0 else 1.0


def latest_complete_day(f: ons.Fetcher, today: dt.date) -> str:
    """Último dia (até D−1) com geração por usina e balanço nas 24 horas, as duas fechando entre si, e o
    arquivo de fluxo controlado. Se nenhum dos 7 fechar, o mais recente completo (com aviso)."""
    fallback: str | None = None
    for back in range(1, 8):
        d = today - dt.timedelta(days=back)
        try:
            g = ons.read_any(f.get(ons.generation_path(d.year, d.month), max_age_s=3 * 3600))
            hrs = pd.to_datetime(g["din_instante"])
            if hrs[hrs.dt.date == d].dt.hour.nunique() < 24:
                continue
            b = ons.read_any(f.get(ons.balance_path(d.year), max_age_s=3 * 3600))
            bh = pd.to_datetime(b["din_instante"])
            if bh[bh.dt.date == d].dt.hour.nunique() < 24:
                continue
            f.get(ons.controlled_flow_path(d.isoformat()), max_age_s=3 * 3600)
            gap = generation_gap(g, b, d)
            if gap > GEN_BALANCE_TOL:
                print(f"::warning::{d.isoformat()} pulado: geração por usina e balanço do ONS diferem em {100 * gap:.1f}% da carga (dado ainda não consolidado)", flush=True)
                fallback = fallback or d.isoformat()
                continue
            return d.isoformat()
        except Exception:  # noqa: BLE001 — arquivo ainda não publicado: tenta o dia anterior
            continue
    if fallback:
        print(f"::warning::nenhum dia fecha geração × balanço nos últimos 7; segue com {fallback}", flush=True)
        return fallback
    raise SystemExit("nenhum dia completo nos últimos 7 dias")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default="auto")
    ap.add_argument("--cache", default=str(Path.home() / ".cache" / "sin-grid"))
    ap.add_argument("--out", default="rede.json")
    ap.add_argument("--post", default="")
    ap.add_argument("--threads", type=int, default=0)
    args = ap.parse_args()

    if args.date != "auto" and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.date):
        raise SystemExit("--date: use auto ou AAAA-MM-DD")
    t0 = time.time()
    f = ons.Fetcher(Path(args.cache))
    date = latest_complete_day(f, dt.date.today()) if args.date == "auto" else args.date
    print(f"dia {date}", flush=True)
    regs = ons.registries(f)
    m = model.build(regs, date)
    print(f"rede: {m.stats['barras_ilha_principal']} barras, {m.stats['linhas']} linhas, {m.stats['trafos']} transformadores ({time.time() - t0:.0f} s)", flush=True)
    d = dispatch.build(m, f, regs, date)
    r = flows.run(m, d, n_threads=args.threads)
    # curto-circuito trifásico (IEC 60909) nas 24 horas; se falhar, o relatório do fluxo sai assim mesmo
    try:
        t1 = time.time()
        try:  # potência sincronizada por usina e hora (ONS); sem ela, as unidades saem da geração
            sync = shortcircuit.load_sync(f, date)
        except Exception as e:  # noqa: BLE001
            sync = None
            print(f"::warning::disponibilidade sincronizada indisponível: {e}", flush=True)
        sc = shortcircuit.run(m, d, regs, sync=sync)
        st = sc.stats
        print(f"curto: {st['usinas']} usinas ({st['usinas_pela_disponibilidade']} pela disponibilidade sincronizada, "
              f"{100 * st['geracao_sincrona_com_disponibilidade']:.0f}% da geração síncrona) e {st['compensadores']} compensadores · "
              f"{st['mva_sincrono_min']}–{st['mva_sincrono_max']} MVA ligados · pandapower {sc.check.get('dif_rel_max')} · {time.time() - t1:.0f} s", flush=True)
        if not sc.check.get("ok"):
            print(f"::warning::conferência do curto com o pandapower falhou: {sc.check.get('erro') or sc.check.get('dif_rel_max')}", flush=True)
    except Exception as e:  # noqa: BLE001
        sc = None
        print(f"::warning::curto-circuito não calculado: {e}", flush=True)
    meta = {"solver": {"nome": "p3s (parallel pandapower solver, Fraunhofer IEE)", "versao": _version("parallel-pandapower-solver"),
                       "commit": P3S_COMMIT, "pandapower": _version("pandapower"),
                       "metodo": "Newton-Raphson AC em lote (C++/KLU), 24 horas; N-1 em lote na hora de maior carga",
                       "segundos": round(time.time() - t0, 1)}}
    rep = report.build(m, d, r, f, meta, sc)
    rep["solver"]["segundos"] = round(time.time() - t0, 1)
    Path(args.out).write_text(json.dumps(rep, ensure_ascii=False))
    v = rep["validation"]
    print(f"convergiu {v['converged']}/{v['hours']} · pandapower {v['pandapower'].get('dif_max_mw')} MW · referência {v['slack_mw']} MW · perdas {v['perdas_pct']}% · cobertura {v['cobertura_rede_basica']}", flush=True)
    for x in v["intercambio"]:
        print(f"  {x['nome']}: erro médio {x['mae_mw']} MW ({x['erro_rel']}) · correlação {x['correlacao']} · {x['status']}", flush=True)
    print(f"N-1: {rep['n1'].get('contingencias')} contingências, {rep['n1'].get('com_sobrecarga')} com sobrecarga · {len(json.dumps(rep)) / 1e3:.0f} kB · {time.time() - t0:.0f} s", flush=True)

    if args.post:
        token = os.environ.get("ADMIN_KEY") or os.environ.get("CRON_SECRET") or ""
        body = gzip.compress(json.dumps(rep, ensure_ascii=False).encode())
        req = urllib.request.Request(args.post.rstrip("/") + "/api/rede/ingest", data=body, method="POST",
                                     headers={"Content-Type": "application/json", "Content-Encoding": "gzip", "Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            text = resp.read().decode(errors="replace")
        print("enviado:", resp.status, text[:300], flush=True)
        try:
            answer = json.loads(text)
            stored = answer.get("armazenamento")
            if answer.get("curto_descartado"):
                print(f"::warning::o app recusou a seção de curto-circuito: {answer['curto_descartado']}", flush=True)
        except (ValueError, AttributeError):
            stored = None
        if stored != "firestore":
            # o app aceitou, mas só na memória da instância (Firestore fora ou sem cota): aparece no resumo do Actions
            print(f"::warning::relatório recebido mas guardado em '{stored}', não no Firestore", flush=True)
    return 0


def _version(pkg: str) -> str:
    try:
        return metadata.version(pkg)
    except metadata.PackageNotFoundError:
        return ""


if __name__ == "__main__":
    raise SystemExit(main())
