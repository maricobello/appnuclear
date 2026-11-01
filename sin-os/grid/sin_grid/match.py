"""Casamento usina → barra da rede, só com cadastros do ONS.

Ordem das tentativas (a primeira que acha vence), cada uma registrada no resultado:

1. ``codigo``: o código de equipamento das unidades geradoras (cadastro de capacidade instalada,
   ex. ``ALUXG-0UG5``) começa pelo código da estação, o mesmo do cadastro de subestações (``ALUXG``);
   ``estacao``: uma estação com exatamente o nome da usina, no mesmo estado;
2. ``conjunto``: conjuntos eólicos/solares vão para o ponto de conexão mais citado pelas usinas que
   os compõem (cadastro de modalidade, ex. ``SE OUROLANDIA II 230,0 kV``);
3. ``ponto``: o ponto de conexão da própria usina;
4. ``nome``: o nome da usina contra o nome da subestação, no mesmo estado.

Nomes do ONS vêm abreviados ("C.NOVO PIAUI2", "U.JLACERDA A"), então o casamento por nome é por
palavras: romanos viram números, preposições saem, uma palavra casa com outra se uma for prefixo da
outra (≥ 3 letras) ou a inicial dela, os números têm de ser iguais (a classe de tensão escrita no
nome, como em "JAGUARA-345", não conta), a ordem das palavras é a mesma e pelo menos uma palavra é
igual por inteiro ("PROMISSAO" não é "P. PRIMAVERA"; "PONTE NOVA" não é "NOVA PONTE").

A estação tem de estar no estado da usina. Só passa a fronteira quando o ponto de conexão diz a
tensão e a estação de mesmo nome no estado vizinho tem barra nela (São Manoel, no Pará, liga em
Paranaíta 500 kV, no Mato Grosso); "FUNIL" do Rio de Janeiro nunca vira a "FUNIL" da Bahia.
"""

from __future__ import annotations

import re
import unicodedata

import pandas as pd

STOP = {
    "SE", "SUBESTACAO", "USINA", "USI", "US", "U", "UH", "UHE", "UTE", "UT", "UTN", "UNE", "PCH", "CGH", "UEE", "UFV",
    "CONJUNTO", "CONJ", "EOLICO", "EOLICA", "SOLAR", "FOTOVOLTAICO", "FOTOVOLTAICA", "COMPLEXO", "KV", "HZ",
    # descrição do ponto de conexão ("SEC LT AGUA VERMELHA JALES") e nomes de empresa ("DA MATA CPFL PAULISTA")
    "LT", "LD", "SEC", "SECC", "SCC", "SECCIONAMENTO", "SECCIONADORA", "DERIV", "DERIVACAO", "SIMPLES", "DUPLO",
    "TAP", "CONEXAO", "LINHA", "CIRCUITO", "ICG", "C1", "C2", "C3",
    "CPFL", "CELESC", "COPEL", "CEMIG", "ELETROSUL", "ESU", "CHESF", "ELETRONORTE", "ENERGISA", "TRANSMISSAO",
}
SMALL = {"DO", "DA", "DE", "DOS", "DAS", "E", "D", "MAR"}
ROMAN = {"I": "1", "II": "2", "III": "3", "IV": "4", "V": "5", "VI": "6", "VII": "7", "VIII": "8", "IX": "9", "X": "10"}
#: abreviações do cadastro: "C.PORTO VELHO" = subestação coletora ("SC 500 kV Porto Velho" no ponto de conexão)
SYNONYM = {"SC": "C", "COLETORA": "C"}
#: "138 kV", "500,0 kV" e "230/69 kV" (transformação: vale a maior)
KV = re.compile(r"(?:(\d{2,3}(?:[.,]\d+)?)\s*/\s*)?(\d{2,3}(?:[.,]\d+)?)\s*k\s*v", re.I)
#: número que, no nome de uma estação, é a classe de tensão ("JAGUARA-345") e não parte do nome
VOLTAGE_CLASS = {"69", "88", "138", "230", "345", "440", "500", "525", "765"}
#: dígito de tensão dos códigos de equipamento do ONS (7º caractere: "BAMDN25CS1" → 500 kV; 0 = tensão
#: da máquina, sem dizer a de conexão). Conferido contra os cadastros de linhas e transformadores.
CODE_KV = {"1": 138.0, "2": 230.0, "3": 345.0, "4": 440.0, "5": 500.0, "7": 765.0}
_BORDERS = (
    "AC-AM AC-RO AL-BA AL-PE AL-SE AM-MT AM-PA AM-RO AM-RR AP-PA BA-ES BA-GO BA-MG BA-PE BA-PI BA-SE BA-TO "
    "CE-PB CE-PE CE-PI CE-RN DF-GO DF-MG ES-MG ES-RJ GO-MG GO-MS GO-MT GO-TO MA-PA MA-PI MA-TO MG-MS MG-RJ "
    "MG-SP MS-MT MS-PR MS-SP MT-PA MT-RO MT-TO PA-RR PA-TO PB-PE PB-RN PE-PI PI-TO PR-SC PR-SP RJ-SP RS-SC"
)
#: estados vizinhos (fronteira terrestre)
NEIGHBORS: dict[str, set[str]] = {}
for _p in _BORDERS.split():
    _a, _b = _p.split("-")
    NEIGHBORS.setdefault(_a, set()).add(_b)
    NEIGHBORS.setdefault(_b, set()).add(_a)


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
    return [w for w in out if w not in VOLTAGE_CLASS]


def _tok_eq(a: str, b: str) -> int:
    """0 = não casa; 1 = só pela inicial ou por prefixo; 2 = a mesma palavra (igual, ou cortada no fim
    pelo limite de letras do cadastro: "PETROQUIMIC" = "PETROQUIMICO", "CHAVANT" = "CHAVANTES")."""
    if a == b:
        return 2 if len(a) >= 3 and not a.isdigit() else 1
    if not (a.isalpha() and b.isalpha()):
        return 0
    # inicial abreviada: "C" (de "C.NOVO") casa com "CURRAL"
    if len(a) == 1 or len(b) == 1:
        return int(a[0] == b[0])
    if len(a) < 3 or len(b) < 3 or not (a.startswith(b) or b.startswith(a)):
        return 0
    lo, hi = sorted((len(a), len(b)))
    return 2 if lo >= 6 and hi >= 8 and hi - lo <= 2 else 1


def _one_typo(a: str, b: str) -> bool:
    """Palavras longas (8 letras ou mais) que diferem por uma letra trocada, sobrando ou faltando, com a
    mesma inicial: erro de grafia do cadastro ("EMBORAÇÃO" por "EMBORCAÇÃO")."""
    if a[0] != b[0] or min(len(a), len(b)) < 8 or abs(len(a) - len(b)) > 1 or not (a.isalpha() and b.isalpha()):
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    s, t = (a, b) if len(a) < len(b) else (b, a)
    i = 0
    while i < len(s) and s[i] == t[i]:
        i += 1
    return s[i:] == t[i + 1:]


def same_place(q: list[str], c: list[str], full: bool = False) -> bool:
    """Cada palavra do nome mais curto casa com uma palavra DIFERENTE do outro, na mesma ordem; os
    números têm de ser iguais e pelo menos uma palavra tem de ser a mesma por inteiro.

    O casamento é um a um ("S. OSORIO" não serve para "SALTO SANTIAGO": a inicial "S" só pode valer por
    uma das palavras); a inicial sozinha não basta ("MIRANDA" não é "M. MORAES"), o prefixo longo
    também não ("SANTA CLARA" não é "SANTAQUITERIA") nem a ordem trocada ("PONTE NOVA" não é "NOVA
    PONTE"); nome abreviado tem de ser explicado por inteiro ("L.C.BARRETO" não é "CAICARAS BARRETOS":
    o "L" fica sem palavra; a letra final, como em "J.LACERDA-A", é o pátio e pode sobrar). Palavras
    coladas pelo cadastro valem ("RIBEIRAOPRETO" = "RIBEIRAO PRETO"). Com ``full`` (nome da usina contra
    nome da estação, o último recurso), casamento que usou inicial não pode deixar palavra sobrando: "SAO
    JOSE" não vira "S.JOSE CAMPOS"."""
    if not q or not c:
        return False
    nq, nc = {a for a in q if a.isdigit()}, {b for b in c if b.isdigit()}
    if nq != nc and (nq or nc):
        return False
    short, long_ = (q, c) if len(q) <= len(c) else (c, q)
    # só o nome da estação (c) abreviado precisa ser explicado por inteiro; no ponto de conexão sobra
    # inicial de outra estação ("Sec. LT C. Novo do Parecis / Brasnorte")
    initials = {j for j, w in enumerate(long_[:-1]) if len(w) == 1 and w.isalpha()} if long_ is c else set()
    every = set(range(len(long_) - 1 if len(long_[-1]) == 1 and long_[-1].isalpha() else len(long_)))

    def assign(i: int, start: int, whole: bool, used: frozenset, init: bool = False) -> bool:  # busca em profundidade
        if i == len(short):
            return whole and initials <= used and not (full and init and not every <= used)
        for j in range(start, len(long_)):
            e = _tok_eq(short[i], long_[j]) or (2 if _one_typo(short[i], long_[j]) else 0)
            ini = e == 1 and (len(short[i]) == 1 or len(long_[j]) == 1)
            if e and assign(i + 1, j + 1, whole or e == 2, used | {j}, init or ini):
                return True
            for n in (2, 3):  # palavras coladas, dos dois lados
                if i + n <= len(short) and "".join(short[i:i + n]) == long_[j] and assign(i + n, j + 1, True, used | {j}, init):
                    return True
                if j + n <= len(long_) and "".join(long_[j:j + n]) == short[i] and assign(i + 1, j + n, True, used | set(range(j, j + n)), init):
                    return True
        return False

    return assign(0, 0, False, frozenset())


def parse_point(p: object) -> tuple[str | None, float | None]:
    """'SE SANTA VITORIA DO PALMAR 2 138,0 kV' → ('SANTA VITORIA PALMAR 2', 138.0). Rede de distribuição → (None, None)."""
    if not isinstance(p, str) or not p.strip():
        return None, None
    n = norm(p)
    if "DISTRIBUI" in n or "ALIMENTADOR" in n:
        return None, None
    m = KV.search(p)
    kv = max(float(g.replace(",", ".")) for g in m.groups() if g) if m else None
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
        self.by_key: dict[str, list[tuple[float, int, str]]] = {}
        self.by_uf: dict[str, list[tuple[str, list[str], float, int]]] = {}
        for r in s.itertuples():
            self.by_key.setdefault(r.key, []).append((r.kv, r.bus, r.id_estado))
            self.by_uf.setdefault(r.id_estado, []).append((r.key, r.toks, r.kv, r.bus))
        self.station_buses: dict[str, list[tuple[float, int]]] = {}
        for r in s.itertuples():
            self.station_buses.setdefault(r.id_subestacao, []).append((r.kv, r.bus))
        best = s.sort_values("kv", ascending=False).drop_duplicates("id_subestacao")
        self.station = dict(zip(best["id_subestacao"], best["bus"]))
        self.station_ids = set(self.station)
        self.bus_station = dict(zip(s["bus"], s["id_subestacao"]))

    def station_of(self, bus: int) -> str | None:
        """Código da estação (cadastro de subestações) a que a barra pertence."""
        return self.bus_station.get(int(bus))

    @staticmethod
    def _pick(cands: list[tuple[float, int]], kv: float | None) -> int:
        if kv is None:
            return max(cands)[1]
        return min(cands, key=lambda c: (abs(c[0] - kv), -c[0]))[1]

    def _token_hits(self, q: list[str], states, full: bool = False) -> dict[str, list[tuple[float, int]]]:
        hits: dict[str, list[tuple[float, int]]] = {}
        for st in states:
            for k, toks, kv_, bus in self.by_uf.get(st, []):
                if same_place(q, toks, full):
                    hits.setdefault(k, []).append((kv_, bus))
        return hits

    def exact(self, name_key: str | None, uf: str | None, kv: float | None = None) -> int | None:
        """Barra da estação de nome exatamente `name_key` no estado, na tensão mais próxima de `kv` (sem
        casamento por palavras). Estação toda abaixo da tensão pedida não serve: é pátio auxiliar (a
        "SANTO ANTONIO" de 230 kV não é a saída de 500 kV da usina)."""
        if not name_key or not uf:
            return None
        same = [(v, b) for v, b, u in self.by_key.get(name_key, []) if u == uf]
        if not same or (kv is not None and max(v for v, _ in same) < 0.9 * kv):
            return None
        return self._pick(same, kv)

    def find(self, name_key: str | None, kv: float | None, uf: str | None, full: bool = False) -> int | None:
        """Barra da estação de nome `name_key` no estado `uf`, na tensão mais próxima de `kv` (sem tensão,
        a maior). Fora do estado, só num vizinho e se a estação tiver barra na tensão pedida."""
        if not name_key:
            return None
        exact = self.by_key.get(name_key, [])
        same = [(v, b) for v, b, u in exact if uf is None or u == uf]
        if same:
            return self._pick(same, kv)
        q = tokens(name_key)
        hits = self._token_hits(q, [uf] if uf else [], full)
        if not hits:
            if uf and kv is not None:  # fronteira: só o nome exato, no vizinho, com barra na tensão pedida
                near = NEIGHBORS.get(uf, set())
                at_kv = [(v, b) for v, b, u in exact if u in near and abs(v - kv) <= 0.1 * kv]
                if at_kv:
                    return self._pick(at_kv, kv)
            return None

        def rank(k: str):
            # quem tem barra na tensão pedida vem primeiro; depois o nome de tamanho mais parecido
            has_kv = kv is not None and any(abs(v - kv) <= 0.1 * kv for v, _ in hits[k])
            return (not has_kv, abs(len(tokens(k)) - len(q)), k)

        return self._pick(hits[min(hits, key=rank)], kv)

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

    def by_code(self, code: object, kv: float | None = None) -> int | None:
        """Barra pela estação do código de equipamento: os 6 primeiros caracteres sem o preenchimento
        "-" ("ALUXG-0UG5" → ALUXG, "SPSTIN0CS1" → SPSTIN). Sem tensão pedida, a barra de maior tensão."""
        st = station_code(code)
        if st not in self.station_buses:
            st = st.rstrip("0123456789")  # "BAUPR10UG1": usina 1 da estação BAUPR
            if st not in self.station_buses:
                return None
        return self.station[st] if kv is None else self._pick(self.station_buses[st], kv)


def station_code(code: object) -> str:
    return str(code).strip()[:6].rstrip("-")


def code_kv(code: object) -> float | None:
    """Tensão de conexão escrita no código do equipamento (7º caractere), quando há."""
    c = str(code).strip()
    return CODE_KV.get(c[6]) if len(c) > 6 else None


#: Usinas cuja energia NÃO entra pela rede AC de 60 Hz no ponto da usina (vão pelos elos CC).
VIA_HVDC = {"ITAIPU 50 HZ"}


def unit_groups(units: pd.DataFrame) -> dict[str, dict[str, pd.DataFrame]]:
    """Unidades geradoras por CEG e, dentro dele, por usina: alguns CEGs reúnem mais de uma (Belo Monte e
    Pimental, Henry Borden Externa e Subterrânea, Itaipu 50 e 60 Hz, Itiquira I e II, Anta e Simplício)."""
    out: dict[str, dict[str, pd.DataFrame]] = {}
    for (ceg, nome), g in units.groupby(["ceg", "nom_usina"], dropna=False):
        out.setdefault(str(ceg), {})[str(nome)] = g
    return out


def pick_plant(groups: dict[str, pd.DataFrame] | None, name: object) -> pd.DataFrame | None:
    """As unidades da usina `name` entre as do mesmo CEG (pelo nome); CEG de uma usina só: as dele.
    Nome ambíguo: todas as do CEG (o comportamento antigo, sem separar)."""
    if not groups:
        return None
    if len(groups) == 1:
        return next(iter(groups.values()))
    q = tokens(key(name))
    hits = [g for n, g in groups.items() if same_place(q, tokens(key(n)))]
    return hits[0] if len(hits) == 1 else pd.concat(groups.values())


def map_plants(gen: pd.DataFrame, units: pd.DataFrame, modality: pd.DataFrame, clusters: pd.DataFrame, index: BusIndex) -> pd.DataFrame:
    """Uma linha por usina da geração horária com a barra e o método (ou o motivo de não casar)."""
    plants = gen.groupby(["ceg", "id_ons", "nom_usina", "nom_tipousina", "id_subsistema", "id_estado", "cod_modalidadeoperacao"], dropna=False)["val_geracao"].sum().reset_index()
    groups = unit_groups(units)

    def unit_codes(ceg: object, name: object) -> list[str]:
        u = pick_plant(groups.get(str(ceg)), name)
        return [] if u is None else u["cod_equipamento"].astype(str).tolist()
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
        for code in unit_codes(r.ceg, r.nom_usina):
            b = index.by_code(code)
            if b is not None:
                return b, "codigo"
        pk, pkv = parse_point(points.get(r.ceg))
        # estação com o nome exato da usina no estado, na tensão do ponto de conexão: é a da própria usina
        # (Foz do Chapecó tem a sua, e o ponto do cadastro ainda cita Xanxerê, cujas linhas foram desativadas)
        b = index.exact(key(r.nom_usina), r.id_estado, pkv)
        if b is not None:
            return b, "estacao"
        b = index.find(pk, pkv, uf=r.id_estado)
        if b is None and pk and re.search(r" [A-Z]$", pk):
            # "SE 230 kV Jorge Lacerda C": o pátio C não está no cadastro de subestações; vale o complexo
            b = index.find(pk[:-2], pkv, uf=r.id_estado)
        if b is not None:
            return b, "ponto"
        b = index.find(key(r.nom_usina), None, uf=r.id_estado, full=True)
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
