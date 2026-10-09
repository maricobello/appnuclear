# Gera src/i18n/dict/*.ts a partir das tabelas textos_*.py (chave | pt | en | es | fr | de | zh | ja).
import glob, json, sys, os
LOC = ["pt","en","es","fr","de","zh","ja"]
OUT = sys.argv[1]
rows = {}
order = []
for f in sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), "textos_*.py"))):
    ns = {}
    exec(open(f).read(), ns)
    for ln in ns["S"].strip("\n").split("\n"):
        if not ln.strip(): continue
        parts = ln.split("|")
        if len(parts) != 8:
            sys.exit(f"{f}: {len(parts)} colunas: {ln[:80]}")
        k = parts[0].strip()
        if k in rows: sys.exit(f"chave duplicada {k}")
        rows[k] = parts[1:]
        order.append(k)
def tree(i):
    t = {}
    for k in order:
        cur = t
        ps = k.split(".")
        for p in ps[:-1]:
            nxt = cur.setdefault(p, {})
            if not isinstance(nxt, dict): sys.exit(f"conflito em {k}")
            cur = nxt
        if ps[-1] in cur: sys.exit(f"conflito folha {k}")
        cur[ps[-1]] = rows[k][i]
    return t
os.makedirs(OUT, exist_ok=True)
for i, l in enumerate(LOC):
    body = json.dumps(tree(i), ensure_ascii=False, indent=2)
    if l == "pt":
        src = f"/* Gerado por scripts/i18n/gerar.py a partir de scripts/i18n/textos_*.py — edite lá e rode npm run i18n. */\nexport const pt = {body};\n\ntype Widen<T> = {{ [K in keyof T]: T[K] extends string ? string : Widen<T[K]> }};\nexport type Dict = Widen<typeof pt>;\n"
    else:
        src = f"/* Gerado por scripts/i18n/gerar.py a partir de scripts/i18n/textos_*.py — edite lá e rode npm run i18n. */\nimport type {{ Dict }} from \"./pt\";\n\nexport const {l}: Dict = {body};\n"
    open(os.path.join(OUT, f"{l}.ts"), "w").write(src)
print(len(order), "chaves")
