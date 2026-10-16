"""Casamento usina → barra da rede, só com cadastros do ONS.

Ordem das tentativas (a primeira que acha vence), cada uma registrada no resultado:

1. ``codigo``: o código de equipamento das unidades geradoras (cadastro de capacidade instalada,
   ex. ``ALUXG-0UG5``) começa pelo código da estação, o mesmo do cadastro de subestações (``ALUXG``);
2. ``conjunto``: conjuntos eólicos/solares vão para o ponto de conexão mais citado pelas usinas que
   os compõem (cadastro de modalidade, ex. ``SE OUROLANDIA II 230,0 kV``);
3. ``ponto``: o ponto de conexão da própria usina;
4. ``nome``: o nome da usina contra o nome da subestação, no mesmo estado.

Nomes do ONS vêm abreviados ("C.NOVO PIAUI2", "U.JLACERDA A"), então o casamento por nome é por
palavras: romanos viram números, preposições saem, uma palavra casa com outra se uma for prefixo da
outra (≥ 3 letras) e os números têm de ser iguais. Sem candidato único no estado, não casa.
"""

from __future__ import annotations

import re
import unicodedata

import pandas as pd

STOP = {
    "SE", "SUBESTACAO", "USINA", "US", "U", "UH", "UHE", "UTE", "UT", "UTN", "UNE", "PCH", "CGH", "UEE", "UFV",
    "CONJUNTO", "CONJ", "EOLICO", "EOLICA", "SOLAR", "FOTOVOLTAICO", "FOTOVOLTAICA", "COMPLEXO", "KV", "HZ",
}
SMALL = {"DO", "DA", "DE", "DOS", "DAS", "E", "D", "MAR"}
ROMAN = {"I": "1", "II": "2", "III": "3", "IV": "4", "V": "5", "VI": "6", "VII": "7", "VIII": "8", "IX": "9", "X": "10"}
#: abreviações do cadastro: "C.PORTO VELHO" = subestação coletora ("SC 500 kV Porto Velho" no ponto de conexão)
SYNONYM = {"SC": "C", "COLETORA": "C"}
KV = re.compile(r"(\d{2,3}(?:[.,]\d+)?)\s*k\s*v", re.I)


def norm(s: object) -> str:
    t = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z0-9]+", " ", t).strip()


def key(s: object) -> str:
    return " ".join(w for w in norm(s).split() if w not in STOP)


def tokens(k: str) -> list[str]:
    out: list[str] = []
    for w in k.split():
        w = SYNONYM.get(ROMAN.get(w, w), ROMAN.get(w, w))
        if w in SMALL:
            continue
        m = re.match(r"^([A-Z]{3,})(\d+)$", w)  # "PIAUI2" → "PIAUI", "2"
        out.extend([m.group(1), m.group(2)] if m else [w])
    return out


def _tok_eq(a: str, b: str) -> bool:
    if a == b:
        return True
    if a.isdigit() or b.isdigit():
        return False
    # inicial abreviada: "C" (de "C.NOVO") casa com "CURRAL"
    if len(a) == 1 or len(b) == 1:
        return a[0] == b[0]
    return len(a) >= 3 and len(b) >= 3 and (a.startswith(b) or b.startswith(a))


def same_place(q: list[str], c: list[str]) -> bool:
    """Cada palavra do nome mais curto casa com uma palavra DIFERENTE do outro; números têm de ser iguais.

    O casamento é um a um ("S. OSORIO" não serve para "SALTO SANTIAGO": a inicial "S" só pode valer por
    uma das palavras)."""
    if not q or not c:
        return False
    nq, nc = {a for a in q if a.isdigit()}, {b for b in c if b.isdigit()}
    if nq != nc and (nq or nc):
        return False
    short, long_ = (q, c) if len(q) <= len(c) else (c, q)
    used = [False] * len(long_)

    def assign(i: int) -> bool:  # emparelhamento por busca em profundidade (listas curtas)
        if i == len(short):
            return True
        for j, b in enumerate(long_):
            if not used[j] and _tok_eq(short[i], b):
                used[j] = True
                if assign(i + 1):
                    return True
                used[j] = False
        return False

    return assign(0)


def parse_point(p: object) -> tuple[str | None, float | None]:
    """'SE SANTA VITORIA DO PALMAR 2 138,0 kV' → ('SANTA VITORIA PALMAR 2', 138.0). Rede de distribuição → (None, None)."""
    if not isinstance(p, str) or not p.strip():
        return None, None
    n = norm(p)
    if "DISTRIBUI" in n or "ALIMENTADOR" in n:
        return None, None
    m = KV.search(p)
    kv = float(m.group(1).replace(",", ".")) if m else None
    return key(KV.sub(" ", p)) or None, kv


class BusIndex:
    """Índice das barras do cadastro de subestações (número de barra ANAREDE, tensão, estado)."""

    def __init__(self, subs: pd.DataFrame, valid_buses: set[int]):
        s = subs.copy()
        s = s[s["num_barra"].notna() & (s["num_barra"] != "")]
        s["bus"] = s["num_barra"].astype(float).astype(int)
        s = s[s["bus"].isin(valid_buses)]
        s["kv"] = s["val_niveltensao"].astype(float)
        s["key"] = s["nom_subestacao"].map(key)
        s["toks"] = s["key"].map(tokens)
        self.s = s
        self.by_key: dict[str, list[tuple[float, int]]] = {}
        self.by_uf: dict[str, list[tuple[str, list[str], float, int]]] = {}
        for r in s.itertuples():
            self.by_key.setdefault(r.key, []).append((r.kv, r.bus))
            self.by_uf.setdefault(r.id_estado, []).append((r.key, r.toks, r.kv, r.bus))
        best = s.sort_values("kv", ascending=False).drop_duplicates("id_subestacao")
        self.station = dict(zip(best["id_subestacao"], best["bus"]))
        self.station_ids = set(self.station)

    @staticmethod
    def _pick(cands: list[tuple[float, int]], kv: float | None) -> int:
        if kv is None:
            return max(cands)[1]
        return min(cands, key=lambda c: (abs(c[0] - kv), -c[0]))[1]

    def find(self, name_key: str | None, kv: float | None, uf: str | None) -> int | None:
        if not name_key:
            return None
        cands = self.by_key.get(name_key)
        if not cands:
            q = tokens(name_key)
            hits: dict[str, list[tuple[float, int]]] = {}
            for k, toks, kv_, bus in self.by_uf.get(uf or "", []):
                if same_place(q, toks):
                    hits.setdefault(k, []).append((kv_, bus))
            if not hits:
                return None

            def rank(k: str):
                # quem tem barra na tensão pedida vem primeiro; depois o nome de tamanho mais parecido
                has_kv = kv is not None and any(abs(v - kv) <= 0.1 * kv for v, _ in hits[k])
                return (not has_kv, abs(len(tokens(k)) - len(q)), k)

            cands = hits[min(hits, key=rank)]
        return self._pick(cands, kv)

    def find_partial(self, name_key: str | None, uf: str | None) -> int | None:
        """Último recurso: a primeira palavra do nome (≥ 5 letras) aponta uma única estação do estado
        com barra de 230 kV ou mais (ex.: usina "ANGRA 2", cuja barra própria não está na rede de
        operação, liga na subestação "ANGRA" de 500 kV)."""
        if not name_key:
            return None
        q = [t for t in tokens(name_key) if not t.isdigit()]
        if not q or len(q[0]) < 5:
            return None
        hits: dict[str, list[tuple[float, int]]] = {}
        for k, toks, kv_, bus in self.by_uf.get(uf or "", []):
            if toks and toks[0] == q[0] and kv_ >= 230:
                hits.setdefault(k, []).append((kv_, bus))
        if len(hits) != 1:
            return None
        return max(next(iter(hits.values())))[1]

    def by_code(self, code: object) -> int | None:
        c = str(code).strip()
        first = c.split("-")[0]
        if first in self.station_ids:
            return self.station[first]
        for n in range(min(7, len(c)), 3, -1):
            if c[:n] in self.station_ids:
                return self.station[c[:n]]
        return None


#: Usinas cuja energia NÃO entra pela rede AC de 60 Hz no ponto da usina (vão pelos elos CC).
VIA_HVDC = {"ITAIPU 50 HZ"}


def map_plants(gen: pd.DataFrame, units: pd.DataFrame, modality: pd.DataFrame, clusters: pd.DataFrame, index: BusIndex) -> pd.DataFrame:
    """Uma linha por usina da geração horária com a barra e o método (ou o motivo de não casar)."""
    plants = gen.groupby(["ceg", "id_ons", "nom_usina", "nom_tipousina", "id_subsistema", "id_estado", "cod_modalidadeoperacao"], dropna=False)["val_geracao"].sum().reset_index()
    unit_codes = units.groupby("ceg")["cod_equipamento"].apply(list).to_dict()
    points = modality.drop_duplicates("ceg").set_index("ceg")["nom_pontoconexao"].to_dict()
    live = clusters[clusters["dat_fimrelacionamento"].fillna("").isin(["", "None"])]
    members = live.groupby("id_ons_conjunto")["ceg"].apply(list).to_dict()

    def one(r) -> tuple[int | None, str]:
        name = str(r.nom_usina).strip().upper()
        if name in VIA_HVDC:
            return None, "elo CC"
        mod = str(r.cod_modalidadeoperacao)
        if mod.startswith("Pequenas Usinas"):
            return None, "embutida"
        if mod == "Conjunto de Usinas":
            votes: dict[int, int] = {}
            for c in members.get(r.id_ons, []):
                b = index.find(*parse_point(points.get(c)), uf=r.id_estado)
                if b is not None:
                    votes[b] = votes.get(b, 0) + 1
            if votes:
                return max(votes, key=lambda b: (votes[b], -b)), "conjunto"
            b = index.find(*parse_point(r.nom_usina), uf=r.id_estado)
            return (b, "conjunto") if b is not None else (None, "sem barra")
        for code in unit_codes.get(r.ceg, []):
            b = index.by_code(code)
            if b is not None:
                return b, "codigo"
        b = index.find(*parse_point(points.get(r.ceg)), uf=r.id_estado)
        if b is not None:
            return b, "ponto"
        b = index.find(key(r.nom_usina), None, uf=r.id_estado)
        if b is not None:
            return b, "nome"
        b = index.find_partial(key(r.nom_usina), uf=r.id_estado)
        if b is not None:
            return b, "nome parcial"
        return None, "sem barra"

    res = [one(r) for r in plants.itertuples()]
    plants["bus"] = [b for b, _ in res]
    plants["metodo"] = [m for _, m in res]
    return plants
