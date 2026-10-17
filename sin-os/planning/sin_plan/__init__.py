"""Planejamento da operação do SIN com o NovoModelo (SDDP aberto de ONS, CCEE e EPE).

O pacote baixa os dados abertos do ONS (ENA por subsistema e por REE, EAR, balanço, vertimento,
despacho térmico, CVU, intercâmbio), monta um caso de reservatórios equivalentes por subsistema com
as calibrações medidas (aproveitamento da ENA, fio d'água, configuração atual, envelope operativo,
limites conjuntos de intercâmbio), roda o SDDP e devolve CMO/PLD por mês civil com faixas, EAR, risco
de déficit e valor da água. A retroanálise compara o caso de cada mês passado com o realizado.
"""

__all__ = ["ons", "inputs", "case", "build", "solve", "results", "observed"]
