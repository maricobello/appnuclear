"""Valor da água implícito: a aversão a risco com que o SDDP enxerga o valor da água que a operação
oficial enxerga hoje.

O caso montado com dados abertos é mais folgado que o deck oficial — não tem os volumes mínimos
operativos, as restrições usina a usina, a produtividade que cai com a queda nem a previsão de
vazões do DECOMP. No λ padrão (0,40), o CMO do 1º estágio de jun/2025 saía R$ 18 enquanto o DESSEM
das duas semanas anteriores estava em R$ 212. Em vez de inventar as peças que faltam, cada rodada
calibra a aversão a risco para que o CMO do 1º estágio (mediana dos cenários, SE) reproduza o CMO
médio do DESSEM nos 14 dias anteriores — o dado público mais recente do valor da água oficial — e o
SDDP propaga essa leitura pelo horizonte. É o mesmo raciocínio da volatilidade implícita: um
parâmetro, lido do preço observado.

O parâmetro é um índice v num caminho de duas etapas:

* v ≤ v(0,99): o λ do CVaR, com v = −ln(1 − λ). O CVaR aninhado em 60 estágios compõe o peso dos
  piores cenários, então o CMO sobe devagar até λ ≈ 0,8 e dispara perto de 1 (jun/2025: λ 0,40 →
  R$ 18, 0,90 → 171, 0,93 → 222, 0,95 → 248); em v a curva é quase reta.
* acima disso, com λ = 0,99: o piso operativo do SE sobe 10 p.p. de EAR por unidade de v (até 40
  p.p.) — o análogo do volume mínimo operativo dos modelos oficiais. Serve aos meses em que nem o
  CVaR extremo cria escassez no caso aberto (dez/2025: CMO ≈ 0 com λ 0,99 e o DESSEM a R$ 300).

O λ vem primeiro porque, onde os dois alcançam o alvo, ele erra menos o resto do horizonte e o
armazenamento (jun/2025: λ 0,93 → PLD do SE de R$ 223 a 182 até nov e EAR de jun a 69,9%; piso
+35 p.p. → R$ 264 a 135 e EAR a 71,8%; realizado R$ 227 a 296 e 66,5%).
"""

from __future__ import annotations

import datetime as dt
import math
from typing import Callable

import pandas as pd

from . import inputs as I

#: Janela do alvo: CMO médio do DESSEM nos dias antes do início do estudo.
TARGET_DAYS = 14
#: Subsistema de referência (os outros seguem pela rede do caso).
TARGET_SUB = "SE"
#: Aceita o ponto quando o CMO do 1º estágio fica a menos de max(abs, rel × alvo) do alvo.
TOL_ABS = 8.0
TOL_REL = 0.08
MAX_RUNS = 8
#: Maior passo de extrapolação em v (um salto ao extremo desperdiça rodada: o CMO é escada de CVU).
STEP_MAX = 2.0
#: Fim da 1ª etapa: λ = 1 é CVaR puro e satura (o CMO para de responder).
LAM_MAX = 0.99
#: 2ª etapa: p.p. de elevação do piso do SE por unidade de v, e o máximo.
FLOOR_PP_PER_V = 10.0
FLOOR_MAX_PP = 40.0
V_LAM = -math.log(1.0 - LAM_MAX)
V_MAX = V_LAM + FLOOR_MAX_PP / FLOOR_PP_PER_V
#: Segundo ponto quando não há o da rodada anterior e o padrão fica abaixo do alvo (o de 2025–26).
COLD_GUESS = 0.85


def target_cmo(cmo_hourly: pd.DataFrame, start: dt.date, days: int = TARGET_DAYS) -> dict[str, float]:
    """CMO horário médio do DESSEM por subsistema nos `days` dias antes de `start` (sem piso nem teto)."""
    a, b = pd.Timestamp(start) - pd.Timedelta(days=days), pd.Timestamp(start)
    out = {}
    for s in I.SUBS:
        x = cmo_hourly[(cmo_hourly["sub"] == s) & (cmo_hourly["h"] >= a) & (cmo_hourly["h"] < b)]["cmo"]
        if len(x) < days * 24 * 0.8:
            raise RuntimeError(f"CMO horário do DESSEM com só {len(x)} horas nos {days} dias antes de {start} no {s}")
        out[s] = round(float(x.mean()), 2)
    return out


def point(v: float) -> tuple[float, float]:
    """(λ, elevação do piso do SE em p.p.) do índice v."""
    v = min(max(v, 0.0), V_MAX)
    if v <= V_LAM:
        return round(min(LAM_MAX, 1.0 - math.exp(-v)), 3), 0.0
    return LAM_MAX, round(min(FLOOR_MAX_PP, (v - V_LAM) * FLOOR_PP_PER_V), 1)


def index(lam: float, floor_pp: float = 0.0) -> float:
    """Índice v de (λ, piso): inverso de `point`."""
    return round(-math.log(1.0 - min(lam, LAM_MAX)) + max(floor_pp, 0.0) / FLOOR_PP_PER_V, 4)


def implied_risk(cmo_at: Callable[[float, float], float], target: float, start: float = 0.4, guess: tuple[float, float] | None = None,
                 tol_abs: float = TOL_ABS, tol_rel: float = TOL_REL, max_runs: int = MAX_RUNS) -> dict:
    """Acha o índice v com cmo_at(λ, piso) ≈ alvo. `cmo_at` roda o SDDP e devolve o CMO do 1º estágio,
    que cresce com v. Roda sempre o λ `start` sem piso (o padrão, a referência "pura"); depois o
    `guess` (o ponto da rodada anterior) ou, sem ele, COLD_GUESS ou λ = 0 conforme o lado do alvo;
    então secante em v, interpolando entre os dois pontos mais próximos que cercam o alvo ou
    extrapolando pelos dois últimos. Se nem v = 0 nem V_MAX alcançam o alvo, fica no extremo e marca
    o limite."""
    tol = max(tol_abs, tol_rel * abs(target))
    tried: dict[float, float] = {}
    at: dict[float, tuple[float, float]] = {}  # índice → (λ, piso) exatamente como rodados

    def f(v: float) -> float:
        lam, fl = point(v)
        key = index(lam, fl)
        if key not in tried:
            tried[key] = float(cmo_at(lam, fl))
            at[key] = (lam, fl)
        return tried[key] - target

    def result(v: float, limit: str | None = None) -> dict:
        key = index(*point(v))
        lam, fl = at[key]
        return {"lambda": lam, "piso_pp": fl, "indice": key, "cmo": round(tried[key], 2), "alvo": round(float(target), 2),
                "tolerancia": round(tol, 2), "limite": limit,
                "tentativas": [{"lambda": at[k][0], "piso_pp": at[k][1], "cmo": round(x, 2)} for k, x in sorted(tried.items())]}

    v0 = index(start)
    f0 = f(v0)
    if abs(f0) <= tol:
        return result(v0)
    vg = index(*guess) if guess is not None else None
    nxt = vg if vg is not None and vg != v0 else (index(COLD_GUESS) if f0 < 0 else 0.0)
    while len(tried) < max_runs:
        fl = f(nxt)
        if abs(fl) <= tol:
            return result(nxt)
        below = [k for k, x in tried.items() if x < target]
        above = [k for k, x in tried.items() if x > target]
        if below and above:
            lo, hi = max(below), min(above)
            if hi <= lo:  # ruído do SDDP quebrou a monotonia: fica com o mais perto
                break
            cand = lo + (hi - lo) * (target - tried[lo]) / (tried[hi] - tried[lo])
            cand = min(max(cand, lo + 0.15 * (hi - lo)), hi - 0.15 * (hi - lo))
        elif below:  # todos abaixo do alvo: sobe pela reta dos dois maiores (ou vai ao extremo)
            if index(LAM_MAX, FLOOR_MAX_PP) in tried:
                return result(V_MAX, "teto")
            a, b = sorted(below)[-2:] if len(below) >= 2 else (None, below[0])
            slope = (tried[b] - tried[a]) / (b - a) if a is not None and b > a else 0.0
            if slope > 1e-6:
                cand = b + (target - tried[b]) / slope
            else:  # sem resposta: vai ao fim do λ; já no fim (λ saturado), sobe o piso 10 p.p.
                cand = V_LAM if b < V_LAM - 1e-6 else b + 1.0
            cand = min(max(cand, b + 0.2), b + STEP_MAX, V_MAX)
        else:  # todos acima: desce pela reta dos dois menores (ou vai ao valor esperado)
            if 0.0 in tried:
                return result(0.0, "piso")
            a, b = sorted(above)[:2] if len(above) >= 2 else (above[0], None)
            slope = (tried[b] - tried[a]) / (b - a) if b is not None and b > a else 0.0
            cand = a - (tried[a] - target) / slope if slope > 1e-6 else 0.0
            cand = max(min(cand, a - 0.2), a - STEP_MAX, 0.0)
        lam, flp = point(cand)
        nxt = index(lam, flp)
        if nxt in tried:  # a secante caiu num ponto já rodado: não há o que refinar
            break
    best = min(tried, key=lambda k: abs(tried[k] - target))
    return result(best)
