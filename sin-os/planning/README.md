# Planejamento da operação — NovoModelo sobre dados abertos do ONS

O [NovoModelo](https://github.com/ONS-CCEE-EPE/NovoModelo) é o SDDP aberto de ONS, CCEE e EPE. O
caso oficial depende do deck do PMO; aqui o caso do SIN é montado todo dia só com os arquivos
públicos do ONS (bucket `ons-aws-prod-opendata`), rodado sem modificação no solver e publicado em
`/planejamento` (e na Iara, a ferramenta `planejamento_sddp`).

```
python planning/run.py --out planejamento.json [--post https://sinos-iota.vercel.app]   # caso do dia
python planning/hindcast.py --from 2025-01 --to 2026-09 --out planning/validacao.json  # retroanálise
python -m pytest -q planning/tests                                                     # testes (inclui um caso resolvido de ponta a ponta)
```

## O caso

| Peça | De onde vem |
|---|---|
| Reservatório equivalente por subsistema | EAR máxima e atual (EAR diária do ONS); 1 MWmês = 2,6298 hm³ com produtividade 1 MW/(m³/s) |
| Água utilizável | Só a ENA **armazenável**: a diferença para a bruta é o vertimento não turbinável das usinas a fio d'água (correlação mensal de 0,95 a 0,997 com o vertimento medido usina a usina) |
| Fio d'água | REEs com EAR máxima abaixo de 1 mês da afluência média (Belo Monte, Itaipu, Madeira, Teles Pires), pela ENA por REE desde 2018; a soma por REE é conferida contra a do subsistema |
| Configuração atual | A ENA publicada usa as usinas de cada época (MLT do N 6 → 14 GW, SE 28 → 43 GW): cada dia desde 2000 entra pela % da MLT × MLT atual do mês |
| Aproveitamento k | (geração + vertimento turbinável + ΔEAR) ÷ ENA armazenável, usina a usina, 24 meses |
| Defluência mínima | S e NE (sem fio d'água): quantil de 1% da geração hidráulica diária do último ano — no NE ≈ 2,5 GW, a defluência mínima de Sobradinho e Xingó; abaixo dela só com penalidade de R$ 500/MWh |
| Afluências | PAR(p)-A até ordem 6 estimado pelo próprio NovoModelo; se não estacionário, PAR(p) clássico (tentativas no relatório) |
| Envelope operativo | Teto por mês = maior EAR já operada desde 2000 (+1 p.p.); piso flexível = menor EAR já operada, com penalidade igual ao CVU mais caro |
| Térmicas | Usina a usina, 28 dias do despacho do ONS: disponibilidade programada, inflexibilidade, CVU da semana do PMO |
| Carga e renováveis | Média de 12 meses × índice sazonal de 3 anos × crescimento; eólica e solar como fontes não controláveis com corte |
| Interligações | Quantil 99,5% do fluxo medido em cada sentido + limites conjuntos de recebimento/exportação |
| Estágios | 60 mensais ancorados no dia de início (sem estágio parcial), 3 patamares pela carga líquida do SIN, CVaR α 15%, desconto 12% a.a., déficit R$ 7.643,82/MWh |
| Aversão a risco | **Implícita** (`sin_plan/calibrate.py`): o λ do CVaR e, se ele satura, a elevação do piso do SE que fazem o CMO do 1º estágio (mediana, SE) reproduzir o CMO médio do DESSEM nos 14 dias anteriores; o SDDP no λ padrão (0,40) sai ao lado |
| PLD com ponta | CMO de cada cenário + desvios horários do CMO do DESSEM dos 30 dias anteriores, depois piso, teto horário e teto estrutural |
| PLD publicado | Combinação, por horizonte, do P50 do SDDP calibrado com o CMO do DESSEM das 2 semanas anteriores (com a ponta) congelado, nos pesos que mais acertaram na retroanálise; faixa P10–P90 pelos quantis do erro dessa combinação no mesmo horizonte |

## Por que calibrar a aversão a risco

O caso aberto é mais folgado que o deck oficial: não tem os volumes mínimos operativos, as
restrições usina a usina, a produtividade que cai com a queda nem a previsão de vazões do DECOMP.
Em jun/2025, com o mesmo caso, o CMO do 1º estágio sai **R$ 18** no λ padrão e **R$ 222** no λ
0,93 — o DESSEM das duas semanas anteriores estava em R$ 212 e o PLD do mês fechou em R$ 227.
Inventar as peças que faltam seria chute; em vez disso, a aversão a risco vira o parâmetro que lê o
valor da água oficial do preço observado, como a volatilidade implícita de uma opção, e o SDDP leva
essa leitura para o resto do horizonte com a física do caso (armazenamento, afluências, térmicas,
rede).

O parâmetro é um índice com duas etapas. Primeiro o λ do CVaR, até 0,99, num eixo v = −ln(1 − λ) em
que a curva CMO × λ é quase reta. Em alguns meses nem o CVaR extremo cria escassez no caso aberto
(dez/2025: CMO ≈ 0 com λ 0,99 e o DESSEM a R$ 300; estender o horizonte para 84 meses também não
ajuda); então o piso operativo do SE sobe até 40 p.p., o análogo do volume mínimo operativo dos
modelos oficiais. O λ vem antes porque, onde os dois chegam ao alvo, ele erra menos o resto do
horizonte e o armazenamento (jun/2025: λ 0,93 → PLD do SE de R$ 223 a 182 até nov e EAR de jun a
69,9%; piso +35 p.p. com λ 0,40 → R$ 264 a 135 e 71,8%; realizado R$ 227 a 296 e 66,5%).

A busca parte do ponto da rodada anterior (a de 16/10/2026 fechou em 3 rodadas do SDDP: λ 0,51, CMO
R$ 50 contra R$ 48). Na retroanálise, com um mês entre um ponto e o seguinte, foram 5,5 rodadas em
média e 15 dos 21 meses ficaram dentro da tolerância; nos outros 6 o CMO do caso salta entre degraus
de CVU e a busca para no ponto mais próximo (R$ 25 do alvo, em média). O λ implícito ficou entre 0 e
0,56 no período úmido de 2025, subiu a 0,93 em jun/2025 e ficou em 0,99 com o piso do SE elevado
(+3 a +30 p.p.) de jul/2025 a jan/2026 e em mar–abr/2026 — meses de preço alto com os reservatórios
em nível médio, em que o valor da água oficial ficou muito acima do que o caso aberto enxerga.

## Por que o publicado é uma combinação

A calibração acerta o nível do mês seguinte, mas a trajetória do SDDP depois dele não acompanhou o
preço de 2025–26: o caso aberto guarda água a mais quando a aversão a risco sobe e projeta preços
caindo, enquanto o oficial ficou alto por mais de um ano. A retroanálise mede isso horizonte a
horizonte e escolhe o peso do SDDP contra a âncora mais simples que existe — o CMO do DESSEM das duas
semanas anteriores, com a ponta, repetido — sem deixar o peso crescer com o horizonte. O resultado é
honesto: o SDDP pesa 0,30 no mês seguinte, 0,25 no outro e 0,09 do 3º mês em diante, e a tela mostra
as duas curvas. A física do caso (armazenamento, risco de déficit, valor da água, sensibilidades)
segue vindo só do SDDP.

## O que a auditoria encontrou e corrigiu

1. **Água fantasma.** A primeira versão dava à usina fio d'água a diferença bruta − armazenável; como
   essa diferença é vertimento obrigatório, o caso tinha ~9 GW médios de energia que não existe e o
   CMO caía ao piso nos meses secos de 2025 (o DECOMP marcava R$ 250).
2. **Fio d'água armazenável.** Madeira, Itaipu, Teles Pires e Belo Monte (um terço da água do SE e
   quase metade da do N) eram tratados como estoque.
3. **Série não estacionária.** A ENA de 2005 do Norte não tem Belo Monte; sem a correção pela MLT o
   PAR subestimava o nível atual.
4. **PLD da média ≠ média do PLD.** Com o CMO mensal realizado, o PLD "plano" erra 11,5 R$/MWh em
   média (viés −11); somando os desvios horários do DESSEM do mês anterior, 6,0 R$/MWh e viés ~0.
5. **Disponibilidade térmica antes de 2026.** O arquivo do ONS só traz a disponibilidade programada
   desde jan/2026; na retroanálise ela vem do cadastro × fator medido nos meses que têm as duas.
6. **Valor da água do caso aberto ≠ o oficial.** Mesmo com a física certa (EAR do fim do mês e
   afluência do 1º mês batendo com o realizado), o SDDP no λ padrão errou o PLD do mês seguinte do SE
   em R$ 131 em média de jan a nov/2025 (persistência: R$ 55), para os dois lados — caro demais no
   começo do período úmido, barato demais no seco. Daí a aversão a risco implícita.
7. **NE sem defluência mínima.** O reservatório equivalente do NE guardava toda a afluência e zerava a
   geração (jan/2025: 0 × 3,3 GW medidos); agora respeita o piso do São Francisco.

## Validação

A retroanálise (`hindcast.py`) monta o caso no dia 1º de cada mês só com o que estava publicado na
véspera, roda o SDDP no λ padrão e calibrado, e compara o PLD dos 6 meses seguintes com o realizado
(PLD horário pelo CMO do DESSEM, piso, teto e teto estrutural), com a persistência (o PLD do mês
anterior), com o CMO do DESSEM de 14 dias com a ponta e com o CMO semanal do DECOMP publicado
durante o mês. A cobertura da faixa é medida deixando cada mês de fora da calibração.

21 meses, de jan/2025 a set/2026. Erro médio absoluto do PLD do mês seguinte (R$/MWh):

| | SE | S | NE | N |
|---|---|---|---|---|
| **Publicado** (combinação, pesos e faixa fora da amostra) | **40,8** | **52,9** | **25,7** | **26,3** |
| SDDP calibrado (P50 com ponta) | 43,5 | 47,1 | 35,5 | 31,0 |
| NovoModelo sem calibração (λ 0,40) | 128,2 | 147,6 | 107,8 | 116,3 |
| Persistência (PLD do mês anterior) | 47,4 | 59,9 | 38,8 | 39,7 |
| DESSEM de 14 dias com ponta | 39,6 | 55,8 | 24,8 | 28,0 |
| DECOMP publicado durante o mês¹ | 27,5 | 18,6 | 35,4 | 112,2 |
| Cobertura da faixa P10–P90 publicada (nominal 80%) | 76% | 76% | 71% | 71% |

¹ Não é previsão: sai ao longo do próprio mês, com revisões semanais; fica como referência.

No SE, por horizonte:

| SE | 1º mês | 2º | 3º | 4º | 5º | 6º |
|---|---|---|---|---|---|---|
| Publicado | 40,8 | 72,5 | 76,9 | 85,5 | 91,7 | 101,9 |
| SDDP calibrado | 43,5 | 79,2 | 119,2 | 137,7 | 141,6 | 149,3 |
| Sem calibração | 128,2 | 133,3 | 140,7 | 133,9 | 134,5 | 133,3 |
| Persistência | 47,4 | 68,3 | 74,8 | 84,2 | 92,8 | 100,2 |
| DESSEM de 14 dias | 39,6 | 67,4 | 74,3 | 83,9 | 89,9 | 99,1 |
| Cobertura publicada | 76% | 80% | 68% | 72% | 76% | 63% |

O que os números dizem:

* **A calibração é o que torna o SDDP útil.** No mês seguinte ela corta o erro do NovoModelo sobre o
  caso aberto em 66% a 73%, e o SDDP calibrado sozinho já erra menos que a persistência nos quatro
  submercados. Exemplos: jan/2025 saiu R$ 65,7 contra R$ 63,5 realizados (sem calibração, R$ 164,9);
  jun/2025, R$ 222,9 contra R$ 226,9 (sem calibração, R$ 92,2).
* **O publicado fica 12% a 34% abaixo da persistência no mês seguinte e no nível do DESSEM de 14
  dias** (de 6% melhor a 4% pior conforme o submercado — com 21 meses, empate). Do 2º ao 6º mês o
  publicado fica perto da persistência (de R$ 8 melhor a R$ 4,5 pior) e ninguém a bate com folga.
* **A trajetória do SDDP depois do 1º mês cai rápido demais** (viés de −37 R$/MWh no 2º mês a −102 no
  6º, no SE): com a aversão a risco alta o caso guarda água e projeta preços em queda, enquanto o
  oficial ficou alto por mais de um ano. Por isso o peso dele no publicado cai para 0,09.
* **Armazenamento.** A EAR do fim do mês erra 4,7 p.p. no SE (viés +4,3: o caso guarda mais que a
  operação real), 4,3 no NE, 8,7 no N e 14,0 no S, cujo reservatório equivalente é pequeno e oscila
  muito.
* **Faixa.** 71% a 76% de cobertura contra 80% nominais: com o mês avaliado fora, sobram no máximo
  20 para calibrar cada um e os quantis do erro saem estreitos; refazer a retroanálise com mais meses
  é o caminho para chegar aos 80%.

A rodada diária lê de `validacao.json` (gerado por `hindcast.py`) as métricas, os pesos da
combinação e os quantis do erro por horizonte. Para refazer a retroanálise em paralelo, um job por
mês, há `.github/workflows/planejamento-retro.yml` (o resultado sai como artefato).

## Limitações

Subsistemas agregados (sem cascata usina a usina nem produtividade com a queda), frota térmica dos
últimos 28 dias, sem restrições elétricas internas e sem as vazões mínimas usina a usina fora do
São Francisco; o λ implícito é um só para o SIN (ancorado no SE), então descolamentos entre
submercados vêm só da rede do caso.
