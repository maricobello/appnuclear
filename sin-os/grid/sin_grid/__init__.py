"""Modelo elétrico do SIN montado só com dados abertos do ONS e resolvido com o p3s.

O pacote baixa os cadastros oficiais (linhas, transformadores, subestações, usinas), monta uma rede
pandapower, aplica o despacho real hora a hora (geração por usina, carga por subsistema, elos de
corrente contínua programados) e roda o fluxo de potência AC em lote com o solver C++ do p3s.
Cada etapa devolve números de auditoria: cobertura do casamento usina → barra, balanço, convergência
e o intercâmbio entre subsistemas calculado × o medido pelo ONS.
"""

__all__ = ["ons", "match", "model", "dispatch", "flows", "report"]
