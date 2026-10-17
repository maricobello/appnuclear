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
| Faixa publicada | A mais larga entre a P10–P90 dos cenários e a mediana mais os quantis do erro da retroanálise no mesmo horizonte (conformal) |

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
69,9%; piso +35 p.p. com λ 0,40 → R$ 264 a 135 e 71,8%; realizado R$ 227 a 296 e 66,5%). A busca
parte do ponto da rodada anterior e costuma fechar em 2–3 rodadas do SDDP.

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

| PLD do SE, mês seguinte | Calibrado | SDDP puro (λ 0,40) | DESSEM 14 dias | Realizado |
|---|---|---|---|---|
| jan/2025 | R$ 65,7 (λ 0,00) | R$ 164,9 | R$ 65,7 | R$ 63,5 |
| jun/2025 | R$ 222,9 (λ 0,93) | R$ 92,2 | R$ 215,0 | R$ 226,9 |

Em jun/2025 o S, o NE e o N também ficaram a menos de R$ 4 do realizado. Sem calibração, de jan a
nov/2025, o erro médio do PLD do mês seguinte foi de R$ 131 no SE, 146 no S, 109 no NE e 123 no N,
contra R$ 55, 57, 31 e 31 da persistência — com a EAR do fim do mês errando só 4 p.p. no SE. A
retroanálise completa com a calibração (jan/2025 a set/2026) fica no arquivo `validacao.json` desta
pasta (gerado por `hindcast.py`): a rodada diária lê dele as métricas e os quantis do erro por
horizonte que calibram a faixa.

## Limitações

Subsistemas agregados (sem cascata usina a usina nem produtividade com a queda), frota térmica dos
últimos 28 dias, sem restrições elétricas internas e sem as vazões mínimas usina a usina fora do
São Francisco; o λ implícito é um só para o SIN (ancorado no SE), então descolamentos entre
submercados vêm só da rede do caso.
