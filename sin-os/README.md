# SIN OS — terminal de arbitragem e previsão do setor elétrico

Terminal web (Next.js 16, pronto para a Vercel) que junta **APIs públicas do setor de energia**, **modelos
quantitativos validados pela literatura** e um **agente de IA que audita as APIs**, com foco em
arbitragem no **SIN (Sistema Interligado Nacional)** e comparação com mercados globais.

> Não é recomendação de investimento. Os valores de arbitragem são estimativas de modelos.

> **Software proprietário.** Código, modelos, calibrações e dados derivados são de uso restrito; nenhuma
> licença é concedida (veja [`LICENSE`](LICENSE)). A plataforma só abre com código de acesso.

## Acesso restrito

Todas as telas e APIs exigem login (`src/proxy.ts`); sem sessão, a página vai para `/entrar` e a API
responde 401. Em produção, sem configuração, tudo fica fechado.

- **Dono:** entra com a `ADMIN_KEY` que já está na Vercel.
- **Convidados:** `node scripts/novo-acesso.mjs nome` gera um código só para a pessoa e a linha
  `nome:hash` para a variável `ACCESS_CODES` na Vercel (separe pessoas com vírgula). A Vercel guarda só
  o hash. Para tirar o acesso, apague a entrada e faça redeploy: a sessão da pessoa cai na hora.
- **Sessão:** cookie HttpOnly assinado (HMAC-SHA256), 7 dias. `SESSION_SECRET` (opcional) assina as
  sessões; trocá-lo derruba todas.
- **Limites:** 5 tentativas erradas de código por IP a cada 15 min; 400 requisições de API por usuário
  a cada 10 min (uso normal fica muito abaixo; varrer as APIs para copiar dados, não).
- **Robôs** (GitHub Actions, coletor da CCEE, cron da Vercel) entram pelos próprios segredos
  (`Authorization: Bearer ADMIN_KEY/CRON_SECRET`, `x-coletor-key`).
- Nenhum buscador ou robô de IA indexa a plataforma (`robots.txt` e `X-Robots-Tag`).

## O que tem

| Tela | O que faz |
|---|---|
| **Sala de Comando** | PLD agora nos 4 submercados (com amanhã quando publicado), PLD horário 24 h/7 dias/30 dias com ponta e modo previsão, resumo do dia gerado dos dados, indicadores do sistema (CMO, carga, reservatórios, vento, sol, corte), oportunidades (bateria, ponta, deslocamento, corte→armazenamento, spreads, exterior) e atalhos para previsão, bateria e reservatórios |
| **BESS** | Ativo configurável (potência, energia, eficiência, degradação, LCOS + premissas): despacho ótimo diário (HiGHS) em até 12 meses de PLD real, fluxo de energia e SOC, margem de arbitragem, receita, CAPEX implícito, VPL, TIR, payback, ROI, LCOS de equilíbrio, cenários e sensibilidade — tudo recalculado no "Recalcular" |
| **SIN · Brasil** | Mapa de calor do PLD dia×hora, médias diárias, CMO (ONS) × PLD (CCEE), EAR, ENA, carga |
| **Previsão** | LEAR + conformal adaptativo (ACI) + QRA + Monte Carlo MRJD + regimes HMM + GARCH, com backtest e testes estatísticos |
| **Arbitragem** | Bateria (BESS) no PLD: DP (valor intrínseco) + LSMC (opcionalidade), P&L e CVaR; spreads entre submercados (ADF, cointegração, meia-vida); bateria por zona europeia e valor de congestionamento (FTR); lente global em R$/MWh |
| **Mercados globais** | Europa (SDAC, 15 min), Reino Unido (Elexon, NESO), câmbio (BCB), combustíveis (EIA) |
| **Clima & hidrologia** | Vento, sol e temperatura nos polos do SIN; chuva nas bacias pelo ensemble ECMWF (51 membros) |
| **Carteira** | Contratos como swap sobre o PLD mensal: liquidação de curto prazo, exposição líquida por submercado, exposição a termo dos meses em aberto e MtM contra uma curva a termo **informada pelo usuário** (ex.: cotação BBCE); editar, backup/importação JSON e CSV mês a mês |
| **Rede elétrica** | Intercâmbio medido × programado nas 4 interligações (ONS, hora a hora) com a diferença de PLD entre os dois lados (quando a rede separou os preços); fluxo de potência AC diário do SIN montado só com dados do ONS: mapa de carregamento das linhas, as mais carregadas, N-1 e a validação contra o intercâmbio medido |
| **Planejamento (SDDP)** | O NovoModelo — o SDDP aberto de ONS, CCEE e EPE — rodado todo dia num caso do SIN montado só com dados abertos do ONS, com a aversão a risco calibrada pelo CMO recente do DESSEM: PLD esperado mês a mês com a ponta horária e faixa P10–P90 calibrada por horizonte, armazenamento contra o envelope que o ONS já operou, risco de déficit, valor da água, sensibilidades e a retroanálise de 21 meses contra o realizado, a persistência e o SDDP sem calibração |
| **Térmicas & encargos** | Geração de cada térmica por motivo do despacho (ONS), pilha de mérito com o CMO da hora (térmica marginal e quanto o CMO precisa subir para ligar a próxima) e o ESS estimado pela regra de ressarcimento da CCEE, em R$ e em R$/MWh consumido, conferido com os boletins InfoPLD |
| **Renováveis & corte** | Corte de eólica e solar do ONS por dia, hora, submercado e motivo, cruzado com o PLD; histórico de 12 meses com revisões; curva do pato |
| **Agente auditor** | Auditoria determinística de todas as APIs, SLO por fonte (disponibilidade, conformidade, latência p50/p95), **auditoria dos modelos no PLD real** (nota 0–100 com cada critério e alvo), alertas push + relatório do agente (Groq) com causa provável e ação |
| **Modelos & APIs** | Equações, referências acadêmicas e implementações de referência no GitHub |
| **Metodologia** | Dicionário de dados de cada fonte (arquivo, colunas, unidade, fuso, versão), política de dados faltantes e de invalidação de séries e todas as regras do auditor, lidos das constantes do código; também em JSON (`/api/metodologia`) |
| **Iara** (botão no topo, ⌘J) | Assistente de voz e texto opcional: consulta PLD, previsão, planejamento de médio prazo (SDDP), estudo BESS, oportunidades, reservatórios e saúde das fontes pelas mesmas funções das telas, responde falando, abre telas e configura o ativo |

"Tempo real": as telas atualizam sozinhas (polling de 30 s a 10 min conforme a fonte) e cada painel
mostra a idade do dado. O painel **APIs conectadas** (Sala de Comando) e a barra do modo Terminal mostram,
a cada minuto, o estado de cada uma das 18 fontes — ao vivo, fonte alternativa, atrasada, fora do ar ou
desligada (sem chave) — calculado dos mesmos dados em cache que as telas usam (`GET /api/fontes`). As fontes brasileiras são publicadas em D−1/D+1 (PLD de amanhã sai à tarde); as
europeias e britânicas têm resolução de 15–30 min.

## APIs públicas integradas

Todas gratuitas e sem cadastro, exceto a EIA (chave gratuita, opcional).

| Fonte | Dados | Uso |
|---|---|---|
| **CCEE — Dados Abertos** (CKAN) | PLD horário por submercado | preço de referência, alvo dos modelos |
| **ONS — Dados Abertos** (S3 direto + CKAN) | CMO semi-horário (DESSEM), EAR, ENA, carga horária, corte de eólica/solar, balanço, intercâmbio entre subsistemas, despacho térmico por motivo e CVU do PMO | formação do preço, fallback e auditoria do PLD, drivers hidrológicos, renováveis, rede, térmicas e ESS |
| **ONS — cadastros e operação** (S3, só no worker da rede) | linhas, subestações, transformadores, compensadores, unidades geradoras, geração por usina, fluxo programado dos elos CC | modelo e fluxo de potência AC do SIN |
| **Energy-Charts** (Fraunhofer ISE) | preços day-ahead de 12 zonas europeias (limite de 2 req/min: o app atualiza 2 zonas por vez e guarda no Firestore) | arbitragem de bateria e de fronteira |
| **Elexon BMRS** | Market Index Price e System Buy/Sell Price (GB) | preço de curto prazo e escassez |
| **NESO Carbon Intensity** | gCO₂/kWh e mix de geração (GB) | contexto de mercado |
| **Open-Meteo** | previsão horária e ensemble ECMWF IFS 0,25° | vento, sol, temperatura, chuva nas bacias |
| **Banco Central (SGS)** | USD, EUR, GBP | conversão para R$/MWh |
| **U.S. EIA** (opcional) | Henry Hub, Brent | custo marginal térmico |

Resiliência do PLD: **CCEE → CMO do ONS pela regra da ANEEL** (piso, teto horário e teto estrutural
na média diária) **→ histórico no Firestore → simulação sinalizada**. Qualquer dado simulado aparece com
alerta amarelo na tela.

**CCEE bloqueando o servidor (HTTP 403 "Acesso bloqueado")**: o portal de dados abertos da CCEE recusa
acessos que não atendem à política de segurança dela — em produção isso acontece com os IPs da nuvem
(Vercel e também GitHub Actions). O app **não tenta contornar o bloqueio** (sem troca de IP, sem
navegador forjado, sem burlar o WAF): ele segue com o PLD calculado a partir do **CMO do ONS**, lido
direto do **bucket público S3 do ONS** (CC-BY, sem bloqueio) com a API CKAN como reserva, e grava esse
histórico (fonte `ons-cmo`), substituído pelo oficial quando a CCEE é liberada. Para ter o número oficial
da CCEE de forma legítima: IP fixo (ex.: VM always-free da Oracle Cloud, ou Lightsail ~US$5/mês) + chamado
pedindo a liberação; ou a Plataforma de Integração CCEE (certificado ICP-Brasil); ou o download manual do
Painel de Preços. Para liberar, abra chamado na CCEE
(atendimento@ccee.org.br · 0800 591 4185) informando o código do erro e o IP que a página de bloqueio
mostra — o auditor exibe os dois na tela **Agente auditor**.

## Modelos (todos em TypeScript, testados)

| Modelo | Referência | Implementação de referência |
|---|---|---|
| LEAR (LASSO por LARS, AICc, transformação asinh) | Lago et al. (2021) *Applied Energy*; Efron et al. (2004) | [jeslago/epftoolbox](https://github.com/jeslago/epftoolbox) |
| Adaptive Conformal Inference | Gibbs & Candès (2021) *NeurIPS* | [MAPIE](https://github.com/scikit-learn-contrib/MAPIE) |
| Quantile Regression Averaging | Nowotarski & Weron (2015) | statsmodels QuantReg |
| Monte Carlo: cópula empírica (marginais = erros reais) + dois fatores (nível diário AR(1) + MRJD intradiário, κ com correção de Nickell, saltos por MAD) | Cartea & Figueroa (2005); Schwartz (1997); Nickell (1981) | — |
| Combinação LEAR ⊕ ingênuo (média simples) | Smith & Wallis (2009); Lago et al. (2021) | epftoolbox |
| HMM / Markov-switching (3 regimes) | Hamilton (1989); Janczura & Weron (2010) | [hmmlearn](https://github.com/hmmlearn/hmmlearn) |
| GARCH(1,1) | Bollerslev (1986) | [arch](https://github.com/bashtage/arch) |
| ADF, Engle–Granger, meia-vida | MacKinnon (2010); Engle & Granger (1987) | statsmodels |
| Diebold–Mariano (HAC Newey–West), Kupiec com efeito de desenho diário, Christoffersen, CRPS | DM (1995), HLN (1997), Newey & West (1987), Christoffersen (1998), Gneiting & Raftery (2007) | epftoolbox, arch |
| Armazenamento: LP/MILP exato (HiGHS) + LSMC, rolling intrinsic no D+1 | Huangfu & Hall (2018); Longstaff & Schwartz (2001); Boogert & de Jong (2008) | [ERGO-Code/HiGHS](https://github.com/ERGO-Code/HiGHS), QuantLib |
| CVaR / Expected Shortfall | Rockafellar & Uryasev (2000) | — |

`npm test` roda mais de 60 testes: recuperação de parâmetros em dados simulados (LASSO/LARS, HMM, GARCH, MRJD,
regressão quantílica), valores críticos de MacKinnon, cobertura do conformal, DP contra força bruta,
LEAR superando o benchmark ingênuo com Diebold–Mariano significativo, contratos de payload de cada API
e o caminho completo previsão → arbitragem.

### Validação em dados reais (`npm run eval:real`)

O comando baixa do bucket público do ONS o CMO semi-horário (2024–2026) e o CMO semanal do DECOMP,
converte em PLD pela regra da ANEEL e roda duas avaliações fora da amostra, sem olhar o futuro:

**1. Variantes do LEAR** — 87 dias (28/06–25/09/2026, sem os dias ausentes na fonte), MAE em R$/MWh,
p-valor de Diebold–Mariano contra a configuração anterior:

| Variante | SE | S | NE | N |
|---|---|---|---|---|
| asinh global, janela 90 d (anterior) | 30,79 | 33,25 | 28,44 | 32,05 |
| **asinh por hora (epftoolbox) — adotada** | **29,72** (p=0,02) | **32,22** (p=0,04) | **28,08** (p=0,21) | **30,90** (p=0,02) |
| ensemble de janelas 56/84/182/364 d | 29,72 (p=0,08) | 33,21 | 28,41 | 31,83 |
| + CMO semanal do DECOMP (exógena) | 30,84 | 33,15 (p=0,02) | 28,33 | 32,35 |
| ingênuo semanal (referência) | 32,02 | 33,36 | 30,67 | 35,28 |

Ensemble de janelas e CMO semanal não trouxeram ganho consistente no D+1 e ficaram de fora. Em
janelas curtas (ex.: 10 dias) o ingênuo pode ganhar — só amostras longas sustentam conclusões.

**2. Calibração da incerteza** — a previsão completa rodada em 56 datas passadas por submercado
(abr–set/2026, passo de 5 dias) só com os dados disponíveis em cada uma; cobertura contra o PLD
realizado (alvo 90%, média dos 4 submercados):

| Horizonte | D+1 | D+2 | D+3 | D+4 | D+5 | D+6 | D+7 |
|---|---|---|---|---|---|---|---|
| Banda horária conformal | 0,92 | 0,88 | 0,88 | 0,89 | 0,88 | 0,88 | 0,87 |
| Monte Carlo 5–95% (horário) | 0,93 | 0,89 | 0,90 | 0,89 | 0,89 | 0,89 | 0,87 |
| Faixa da média diária (conformal) | 0,95 | 0,92 | 0,94 | 0,91 | 0,93 | 0,93 | 0,89 |

No D+1 a previsão publicada (LEAR ⊕ ingênuo) teve MAE 5–9% menor que o LEAR sozinho nos 4
submercados (SE 37,0 vs 39,1 R$/MWh). O Kupiec com efeito de desenho diário não rejeitou a cobertura
em nenhuma origem; o teste de Christoffersen na mesma hora de dias consecutivos rejeita em 34–50%
delas — as violações se repetem de um dia para o outro, sinal de que a banda reage devagar a mudança
de regime (limitação conhecida, exibida na tela; o teste agora é corrigido pelo efeito de desenho).

O Monte Carlo usa **marginais empíricas** por horizonte (erros reais da previsão publicada, pelo menos
tão largas quanto a banda conformal) e o modelo de dois fatores só para a **dependência** entre horas e
dias (cópula empírica). O fator diário e a persistência intradiária são calibrados em grade para
reproduzir a dispersão real da média do dia e a variação intradiária recente. Resultado em 136 dias
por submercado: a média diária realizada fica abaixo do p05 simulado em 2–7% dos dias (antes 14–24%,
trajetórias deslocadas para cima). Ainda em aberto: a variação intradiária simulada é ~1,3× a real
(dias colados no piso quase não variam; os voláteis variam muito) — o valor da bateria tende a sair
um pouco otimista.

### Auditoria matemática (set/2026)

Todos os modelos foram conferidos contra implementações de referência (scikit-learn, statsmodels, arch,
hmmlearn, scipy): LARS/LASSO, asinh, ADF/Engle–Granger, GARCH, DM, Kupiec e as distribuições batem até
1e-9. Correções aplicadas a partir dessa auditoria:
- intrínseco da bateria calculado na curva E[preço] (o LEAR em asinh estima a mediana) — a
  "opcionalidade" deixou de ser inflada; teto de informação perfeita por LP exato em cada trajetória;
- teto estrutural do PLD (média diária) aplicado às previsões e às trajetórias de Monte Carlo;
- grade de SoC que representa a potência nominal de carga e descarga (erro < 1%);
- ACI avaliado em blocos de 24 h (sem informação do próprio dia) e quantil conformal por estatística de ordem;
- CRPS pela regra do trapézio e QRA avaliado fora da amostra (com cobertura 5–95%);
- HMM com vários pontos de partida (evita ótimos locais) e emissões escalonadas em log;
- dias inteiros ausentes no arquivo do ONS (acontece) preenchidos por interpolação (até 3 dias) e
  excluídos das métricas — antes a previsão caía por falta de histórico contíguo;
- valor crítico de 1% de Engle–Granger (MacKinnon 2010) corrigido; dia de entrega europeu em CET/CEST.

### Segunda auditoria matemática (set/2026) — nota 66/100 e correções

Um agente revisor refez os modelos em dados reais (891 dias fora da amostra por submercado, 56 origens
completas, 3.996 dias de bateria no HiGHS) e apontou, com números, o que estava errado. Corrigido:

| Achado | Correção |
|---|---|
| LEAR sozinho perde do ingênuo no período longo (rMAE 1,04–1,12) | previsão publicada = ½ LEAR + ½ ingênuo: rMAE 0,95–0,99, melhor que o LEAR com DM t ≈ −4 |
| LEAR extrapolava em janela colada no piso (previu ~931 R$/MWh com realizado 72) | previsão limitada à faixa do alvo transformado vista no treino (rMAE NE úmido/2025: 3,88 → 1,28) |
| MRJD: κ ~4× menor que o real (nível do dia confundido com persistência horária) | modelo de dois fatores (nível diário AR(1) + OU intradiário), κ por AR(1) within com correção de Nickell e saltos no resíduo |
| Faixa da média diária = média dos quantis horários | faixa conformal nos erros da média diária do backtest, por horizonte |
| Kupiec horário rejeitava cobertura correta (violações agrupadas no dia, deff 6–8) | Kupiec com efeito de desenho diário + Christoffersen na mesma hora de dias consecutivos |
| DM ignorava autocorrelação da perda diária | variância de longo prazo Newey–West (Bartlett) |
| Banda horária: cobertura medida era da banda plana, não da publicada | ACI com escore normalizado pelo fator da hora |
| Carteira liquidava o mês corrente (parcial) como fechado | mês parcial vira estimativa, fora do resultado liquidado |
| Limites de 2026 aplicados ao PLD de 2024–25 | limites do próprio ano (2024: 61,07/716,80/1.470,57; 2025: 58,60/751,73/1.542,23) |
| Capture ratio sem sentido com PLD plano; LSMC abaixo do intrínseco escondido | "n/d" quando o teto é ~0; diagnóstico explícito quando o LSMC fica abaixo do intrínseco |

Validado sem problemas: bateria (0 dias com política simples acima do LP em 3.996), sinal e exatidão
da liquidação da carteira, teto estrutural, QRA, ACI em blocos de 24 h e CRPS. Ainda em aberto: fator
por tipo de dia (sábado sub-coberto, 0,74–0,84) e a faixa de D+5–D+7, que fica perto de 85%.

## Interface — sistema de design

Visual calmo no espírito das Human Interface Guidelines da Apple: **deferência** (o dado é o
protagonista; cartões sem borda, superfícies em camadas, sem enfeite), **clareza** (fonte do sistema —
SF Pro nos aparelhos Apple —, poucos tamanhos, título grande por tela, números tabulares, texto mínimo de
12 px) e **cor só com significado** (cores do sistema da Apple por submercado; verde/vermelho para
alta/baixa). Tema **claro e escuro** seguindo o sistema operacional, com escolha manual na barra lateral
(Automático · Claro · Escuro). Cada tela abre com o essencial; o detalhe técnico fica em seções
recolhíveis ("Mostrar detalhes"). Movimento com [Motion](https://motion.dev), curto e amortecido, sempre
desligado com "reduzir movimento".

**Dois visuais**, escolhidos na barra lateral (Moderno · Terminal) e lembrados no navegador:

- **Moderno** — o descrito acima.
- **Terminal** — o SIN OS clássico: sempre escuro, densidade maior, números em Geist Mono, cartões com
  borda, rótulos em caixa-alta e uma barra fixa no topo com o PLD da hora por submercado (variação contra
  a mesma hora de ontem), o estado das APIs, o ativo BESS e o relógio de Brasília (no celular, uma faixa
  curta com PLD e APIs). É o atributo `data-ui="terminal"` no `<html>`, aplicado antes da primeira pintura
  (`src/lib/theme-boot.ts`): troca só tokens e regras de CSS, os componentes são os mesmos.

Tokens em `src/app/globals.css` (claro e escuro); componentes em `src/components/ui.tsx` (Panel, Kpi,
Stat, Segmented, Table, MetricRow, Disclosure, ScrollX, StatusTag) e `EChart.tsx`. Os gráficos são
montados com a paleta escura de `src/lib/chart.ts` e convertidos para a variante clara no tema claro
(`themeOption`, inclusive o HTML dos tooltips); as marcas do eixo de tempo ficam na meia-noite de
Brasília qualquer que seja o fuso do navegador (`withBrtTicks`). Procedência do dado em linguagem simples:
Ao vivo · Fonte alternativa · Atrasado · Indisponível · Simulado, numa linha logo abaixo do título de cada
tela (`SimBanner`): discreta quando tudo está ao vivo ("PLD · Ao vivo · há 5 min"), em destaque quando há
fonte alternativa, falha ou simulação. A linha tem sempre a mesma altura, inclusive enquanto carrega, para
a página não pular quando os dados chegam.

O ECharts é carregado sob demanda e cada gráfico só é montado quando chega perto da tela: a página pinta
antes e o celular não processa gráficos que ninguém rolou até ver. No celular, tabela larga vira lista
(a 1ª coluna é o título; as demais, pares rótulo/valor) e matriz numérica continua rolando para o lado
com a 1ª coluna fixa (`Table` com `stack`); botões, campos e controles têm 44 px de altura no toque.

## PLD oficial "em tempo real" — CCEE Plataforma de Integração

O PLD é horário e sai **na véspera** (D+1), calculado pela CCEE a partir do DESSEM; não existe um PLD
que muda minuto a minuto. "Tempo real" aqui é ter o PLD de **hoje** desde 0h e o de **amanhã** assim
que publicado. Sem credencial, o app calcula o PLD pelo CMO do ONS (mesma regra da ANEEL), que o ONS
atualiza no fim da manhã do próprio dia — de madrugada o app ainda não tem o dia corrente.

Com acesso de **agente da CCEE** (ou consultoria com representação total), o app usa o web service
oficial `listarPLD` (PLDBSv1) da [Plataforma de Integração](https://github.com/devccee/postman-collections):

1. Na CCEE, habilite a Plataforma de Integração para o seu agente e cadastre o certificado digital
   ICP-Brasil (e-CNPJ A1, `.pfx`) — atendimento 0800 591 4185.
2. Na Vercel (Settings → Environment Variables, tipo **Sensitive**): `CCEE_PI_USERNAME`,
   `CCEE_PI_PASSWORD`, `CCEE_PI_PERFIL` (código do perfil do agente), `CCEE_PI_CERT_PFX`
   (`base64 -w0 certificado.pfx`) e `CCEE_PI_CERT_PASSPHRASE`. Redeploy.
3. O PLD oficial dos últimos 14 dias + D+1 passa a sobrepor o calculado pelo CMO; os dias oficiais
   ficam gravados no Firestore. A fonte `ccee_pi` entra no agente auditor e no `/api/status`.

**Aviso de publicação:** com `ALERT_WEBHOOK_URL` (ntfy), cada dia de PLD que aparece (hoje/amanhã)
gera uma notificação com média, mínimo, máximo e hora do pico por submercado. `PLD_ALERT_ABOVE=500`
marca submercados com máximo acima do valor; `PLD_ALERTS=off` desliga.

**Alertas de mercado** (mesmo `ALERT_WEBHOOK_URL`, um aviso por regra e por dia, prioridade alta):
pico de PLD acima de `ALERT_PLD_MAX` (padrão R$ 300), descolamento entre submercados na mesma hora acima
de `ALERT_SPREAD` (R$ 100), janela de bateria (máx − mín do dia) acima de `ALERT_INTRADAY` (R$ 200) e corte
de renováveis acima de `ALERT_CURTAIL_FACTOR` (1,5) × a mediana dos 7 dias anteriores e de
`ALERT_CURTAIL_MIN_GWH` (50). `MARKET_ALERTS=off` desliga. Os alertas ativos aparecem no "Resumo do dia" da
Sala de Comando e em `GET /api/alertas`. Para checar com frequência, um agendador externo chama
`/api/alertas/run` com `Authorization: Bearer <ADMIN_KEY>` — passo a passo em
[docs/agendador.md](docs/agendador.md).

## Iara — assistente de voz (Groq)

Botão **Iara** no cabeçalho (ou ⌘J / Ctrl+J). Fica **desligada** até o usuário ativar, e o microfone só abre
num toque. Fluxo: fala → gravação com detecção de fim de frase (VAD por energia) → transcrição Whisper
(`whisper-large-v3-turbo`) → agente com *tool calling* (`openai/gpt-oss-120b`, com fallback para outros
modelos se a Groq descontinuar o configurado) → resposta falada com a voz pt-BR do sistema. Também aceita
texto. "Conversa contínua" volta a ouvir depois de responder.

- **Só dado real:** a Iara não tem números próprios. Cada número vem de uma ferramenta que chama as mesmas
  funções das telas (`pld_agora`, `previsao_pld`, `estudo_bess`, `oportunidades`, `reservatorios`,
  `saude_dados`); dado simulado é recusado pela ferramenta. Ações: `navegar` (abre telas) e
  `configurar_ativo` (muda o ativo BESS e abre a tela BESS).
- **Chave:** `GROQ_API_KEY` só no servidor — crie em console.groq.com e cadastre na Vercel como
  **Sensitive**. Nunca no código nem no chat. `GET /api/assistente` confirma se a Groq está online
  (sonda de 5 min) e qual modelo responde; `/api/status` mostra se está configurada.
- **Proteção de custo (site público):** `ASSISTANT_ACCESS_CODE` exige um código (digitado uma vez nos
  ajustes da Iara); limite por IP; cota diária global no Firestore (`ASSISTANT_DAILY_LIMIT`, padrão 400
  perguntas; `ASSISTANT_STT_DAILY_LIMIT`, padrão 250 transcrições).
- **Privacidade:** o áudio vai direto para a transcrição e não é guardado; a conversa fica só na aba
  (sessionStorage).

## Confiança nos dados abertos

Origem: a comunidade de dados de energia relatou que bases públicas mudam em silêncio (o corte de
eólica/solar do ONS não reflete contestações, a ANEEL republica tarifas com vigência errada) e que quem
não guardou o histórico antigo nunca percebe. O auditor passa a guardar uma impressão digital (hash +
valores) de cada dia fechado do PLD, CMO, carga, EAR e ENA (últimos 10 dias, no Firestore) e, a cada
verificação (no máx. a cada 5 h), registra uma **revisão retroativa** quando o mesmo dia reaparece com
valores diferentes: pontos alterados, maior mudança, deslocamento da média. Também mede a completude
dos últimos 10 dias. O selo (alta/média/baixa) aparece na tela do auditor e em `GET /api/confianca`; a
Iara responde "essa base foi revisada?" pela ferramenta `confianca_dados`. O selo mostra que o dado
mudou, **não** qual versão está certa. Fonte sem dado real na leitura aparece como "sem dado".

## Renováveis: corte (curtailment) e carga líquida

Tela `/renovaveis` e `GET /api/renovaveis?dias=14` (3–31). Lê do bucket público do ONS os parquets de
restrição por constrained-off de eólicas e fotovoltaicas (meia hora, por conjunto) e o balanço de energia
por subsistema (horário), e cruza com o PLD da mesma hora. Mostra quanto foi cortado, por quê (sobra de
energia, rede, confiabilidade), em que hora, quanto vale a PLD, quantas horas de corte tiveram PLD no piso
e a curva do pato (carga × carga líquida, rampa da noite). O histórico de 12 meses (`GET
/api/renovaveis/historico?meses=12`) guarda o total de cada mês com a versão do arquivo do ONS e, quando o
ONS republica um mês com números diferentes, registra o total anterior. A Iara responde pela ferramenta
`renovaveis_corte`, e a oportunidade "Curtailment → Storage" da Sala de Comando passa a citar o corte medido.

Checagens feitas a cada leitura (e testadas com amostra real em `tests/fixtures/ons-renewables.json`):

- **Método da apurada:** a "geração não realizada apurada" do ONS é exatamente
  max(0, referência − geração) com a referência **bruta** (erro médio 0,00 MW).
- **Referência acima da disponibilidade:** a referência bruta passa da disponibilidade do conjunto em
  milhares de meias horas (≈ 5–11% do MWh oficial). O corte aparece como faixa: oficial (teto) e
  limitado à disponibilidade (piso).
- **Convenção de hora:** o instante marca o início da meia hora; validado contra o balanço (correlação
  0,9999 sem defasagem, ≈ 0,95 deslocando 1 h). Se o ONS mudar a convenção, a tela acusa.
- **Fuso:** o parquet grava o horário de Brasília como se fosse UTC; ler como UTC desloca 3 h.
- **Identidade do balanço:** hidro + térmica + eólica + solar − intercâmbio = carga em todas as horas.
- A flag de dado inválido do ONS não é usada (não é atualizada depois da contestação do agente).

## Rede elétrica: intercâmbio e fluxo de potência do SIN

Tela `/rede` e `GET /api/rede?dias=7` (2–14).

**Intercâmbio (ao vivo, D−1):** o arquivo `intercambio_nacional_ho` do ONS traz, hora a hora, o fluxo
medido e o programado em cada interligação (N–NE, N–SE, NE–SE, S–SE), no sentido em que a energia passou.
O app dá um sentido fixo a cada par (positivo = do primeiro para o segundo) e cruza com o PLD dos dois
lados: hora com diferença acima de R$ 1 é hora em que algum limite de transmissão separou os preços.
Conferência a cada leitura: somando as interligações, a exportação de N, NE e SE é exatamente o
intercâmbio do balanço de energia (diferença ≤ 0,002 MW em 155 horas de out/2026); no Sul a diferença,
quando existe, é o intercâmbio com Argentina e Uruguai (média de −405 MW em 2026 até 14/10).

**Fluxo de potência (diário):** `grid/` (Python) monta a rede básica só com os cadastros abertos do ONS
(linhas com R, X e B, subestações com coordenadas, transformadores, compensadores), coloca a geração
real de cada usina na sua barra, distribui a carga de cada subsistema e roda o fluxo AC das 24 horas no
[p3s](https://github.com/e2nIEE/parallel-pandapower-solver) (Fraunhofer IEE, C++/KLU), conferido com o
pandapower, mais o N-1 das linhas de 440 kV ou mais e das interligações. Roda no GitHub Actions
(`.github/workflows/rede.yml`, 16:47 e 23:47 UTC) e envia o relatório para `POST /api/rede/ingest`
(segredo `ADMIN_KEY`, o mesmo da Vercel, nos segredos do repositório no GitHub).

Resultado de 14/10/2026 (dia real): 1.667 barras, 1.841 linhas e 1.813 transformadores; 24/24 horas
convergem; p3s × pandapower dentro de 4,7·10⁻⁷ MW por linha; perdas de 2,62%; 95,9% da geração
despachada com barra; 607 contingências N-1 (606 resolvidas, nenhuma sobrecarga); 28 s no total.
Intercâmbio calculado × medido: Sul–Sudeste 0,9% de erro, Norte–Nordeste 12,5%, Nordeste–Sudeste 16,8% e
Norte–Sudeste 31,7%: a compensação série do corredor Norte–Sul não está no cadastro do ONS, o que
deixa esse corredor mais "pesado" no modelo; ele aparece como menos confiável na tela e reprova na
auditoria dos modelos até ser resolvido. Transformadores usam reatância presumida (12%), porque o
cadastro não publica a impedância.

```bash
python -m venv .venv && . .venv/bin/activate   # Python 3.12+
sudo apt-get install libsuitesparse-dev
pip install -r grid/requirements.txt
pip install "p3s-cpp @ git+https://github.com/e2nIEE/parallel-pandapower-solver.git@515cf75913955bf869eb182b3be4230a52d97fcc#subdirectory=p3s/cpp"
python -m pytest grid/tests
python grid/run.py --date auto --out rede.json        # --post https://sinos-iota.vercel.app para enviar
```

## Planejamento da operação: o NovoModelo (SDDP oficial) sobre dados abertos

Tela `/planejamento`, `GET /api/planejamento` e a ferramenta `planejamento_sddp` da Iara.

O [NovoModelo](https://github.com/ONS-CCEE-EPE/NovoModelo) é o SDDP aberto de ONS, CCEE e EPE. O caso
oficial depende do deck do PMO; aqui `planning/` monta todo dia um caso do SIN só com arquivos públicos
do ONS — um reservatório equivalente por subsistema com a ENA armazenável reconstruída na configuração
de usinas de hoje, os REEs sem estoque como fio d'água, o fator de aproveitamento que fecha o balanço
hídrico medido, a defluência mínima do São Francisco, o envelope de armazenamento que o ONS já operou,
térmicas usina a usina com o CVU do PMO, carga e renováveis com sazonalidade de 3 anos e as
interligações pelo fluxo medido — e roda o solver sem modificação (60 estágios mensais, 3 patamares,
CVaR, 200 cenários). Roda no GitHub Actions (`.github/workflows/planejamento.yml`, 23:17 UTC) e envia o
relatório para `POST /api/planejamento/ingest` (segredo `ADMIN_KEY`).

**O que vai além do modelo proposto.** (1) *Aversão a risco implícita:* o caso aberto é mais folgado
que o deck oficial e, no λ padrão, o SDDP errou o nível do preço de 2025–26 por centenas de reais; a
cada rodada a aversão a risco é calibrada para que o CMO do 1º estágio reproduza o CMO do DESSEM das
duas semanas anteriores (como a volatilidade implícita de uma opção) — o λ do CVaR e, quando ele
satura, o piso de armazenamento do SE, o análogo do volume mínimo operativo —, e o SDDP leva essa
leitura para o resto do horizonte com a física do caso. (2) *PLD com ponta:* o SDDP mensal não vê a ponta do fim da tarde;
os desvios horários recentes do DESSEM entram antes do piso e do teto. (3) *PLD publicado calibrado
fora da amostra:* uma combinação, por horizonte, do SDDP calibrado com o CMO do DESSEM das duas semanas
anteriores congelado, com os pesos e a faixa P10–P90 tirados dos erros da retroanálise (o peso não cresce
com o horizonte; a cobertura é medida deixando cada mês de fora). (4) *Retroanálise* contra o realizado,
a persistência, o DESSEM de 14 dias, o DECOMP e o próprio SDDP sem calibração.

**Por que calibrar e combinar.** No λ padrão, o NovoModelo sobre o caso aberto errou o PLD do mês
seguinte em R$ 108 a 148/MWh em média de jan/2025 a set/2026, conforme o submercado (a persistência,
repetir o mês anterior, errou R$ 39 a 60): a física bate — a EAR do fim do mês do SE erra 4,7 p.p. —,
mas o valor da água do caso aberto não é o oficial. Calibrado, o erro cai para R$ 31 a 47 (−66% a
−73%). O PLD publicado erra R$ 26 a 53 no mês seguinte: 12% a 34% abaixo da persistência em todos os
submercados e no nível do DESSEM de 14 dias, com a faixa P10–P90 cobrindo 71% a 76% dos meses. Depois
do 1º mês a trajetória do SDDP cai rápido demais (o caso aberto guarda água quando a aversão a risco
sobe) e o peso dele no publicado vai de 0,30 a 0,09; a tela mostra as duas curvas. A retroanálise
completa — 21 meses, seis horizontes — fica em `planning/validacao.json` e aparece na tela.

Detalhes, decisões e o que a auditoria encontrou em [`planning/README.md`](planning/README.md).

```bash
python -m venv .venv && . .venv/bin/activate   # Python 3.12+
pip install -r planning/requirements.txt
python -m pytest planning/tests
python planning/run.py --out planejamento.json   # --post https://sinos-iota.vercel.app para enviar
python planning/hindcast.py --from 2025-01 --to 2026-09 --out planning/validacao.json
```

## Térmicas & encargos (ESS)

Tela `/termicas` e `GET /api/termicas?dias=7` (3–31). O ONS publica, hora a hora e por usina, a
geração térmica classificada por motivo do despacho (ordem de mérito, inflexibilidade, unit
commitment, razão elétrica, segurança energética, GFOM, substituição, exportação, reposição de perdas,
reserva de potência) e o constrained-off; e o CVU de cada usina por semana operativa do PMO. Com isso:

- **Pilha de mérito** por submercado na hora de maior geração térmica: usinas por CVU com a
  disponibilidade declarada, o CMO da hora, a térmica marginal e quanto o CMO precisa subir para a
  próxima ligar por mérito.
- **ESS estimado** pela regra de ressarcimento da CCEE: max(0, CVU − PLD) × geração por unit
  commitment, razão elétrica ou segurança energética, mais max(0, PLD − CVU) × constrained-off, hora
  a hora, só para CVU > 0; e o mesmo valor por MWh consumido (carga do SIN nos mesmos dias).
- **Conferências a cada leitura:** os motivos somados dão a geração de cada usina (diferença de
  0,07% em out/2026) e toda a geração tem CVU da semana.

Conferência com a CCEE (boletins InfoPLD, estimativa semanal do ESS), com o modelo rodado nos
arquivos do ONS das mesmas semanas operativas e o PLD a partir do CMO limitado ao piso e ao teto:

| Semana | Unit commitment (modelo × CCEE) | Constrained-off (modelo × CCEE) |
|---|---|---|
| 14 a 20/06/2025 (InfoPLD 716) | R$ 2,62 × 2,57 mi (+2%) | R$ 1,83 × 1,37 mi (+34%) |
| 18 a 24/10/2025 (InfoPLD 734) | R$ 22,00 × 22,68 mi (−3%) | R$ 4,34 × 5,90 mi (−26%) |

Nessas semanas o ONS registrou zero de geração por razão elétrica e por segurança energética, e a
CCEE estimou R$ 1–3 mi nesses itens: vêm de componentes que o arquivo do ONS não mostra (deslocamento
hidráulico, por exemplo), então eles saem pela regra mas sem validação. Geração por mérito com CVU
acima do PLD fica fora (usinas com CCEAR por disponibilidade são cobertas pelo contrato). O teste
`tests/real/thermal-live.test.ts` (`npm run eval:real`) refaz a conta e confere os números.

## Metodologia pública

Tela `/metodologia` e `GET /api/metodologia` (JSON): para cada fonte, o arquivo ou rota lido, as colunas
com nome no app e unidade, como o instante é interpretado (fuso), as transformações, o SLA, a faixa válida
e como a versão é rastreada; e as regras do auditor (pesos, limites de passa/alerta/reprova, checagens
cruzadas, selo de confiança, checagens do corte, alertas de mercado e o método do backtest por regime).
Os números vêm das mesmas constantes que o código aplica (`AUDIT_THRESHOLDS`, `CHECK_WEIGHTS`,
`VALID_RANGES`, `TRUST_RULES`, `RENEWABLE_CHECKS`), então o publicado é o que roda, e a página mostra o
commit da versão.

## Previsão por regime

`GET /api/previsao/regimes?sub=SE` (painel "Erro por regime" na tela Previsão): walk-forward de 365 dias,
cada dia previsto só com o histórico anterior, comparando a previsão publicada (LEAR ⊕ ingênuo, com o
ajuste ao piso) com o ingênuo por período hidrológico (úmido dez–abr, seco mai–nov), nível do
reservatório do submercado (EAR abaixo de 40%, 40–60%, acima de 60%), piso recente (a hora ficou no piso
em 4+ dos 7 dias anteriores) e faixa do PLD realizado (piso, até R$ 150, R$ 150–300, acima de R$ 300), com
Diebold–Mariano (HAC) no período todo. Calculado uma vez por dia e guardado no Firestore.

Só estação, reservatório e piso recente são conhecidos antes de prever. A faixa do PLD realizado mostra
onde o erro mora, mas não julga o modelo: separar pelo resultado favorece quem aposta no extremo (no piso,
repetir o piso parece imbatível) — o "dilema do previsor" de Lerch, Thorarinsdottir, Ravazzolo & Gneiting
(2017, *Statistical Science*).

**Ajuste ao piso.** Com o PLD colado no piso, a mediana do preço é o próprio piso, e a mediana é a previsão
que minimiza o erro absoluto. Se a hora ficou no piso em pelo menos 4 dos últimos 7 dias e a previsão
combinada está a menos de R$ 50/MWh do piso, a previsão publicada é o piso (`FLOOR_SNAP` em
`src/lib/market/forecast.ts`). Grade testada antes de escolher (fração de dias no piso 3/7–6/7 × distância
R$ 25/50/100/∞), em 361 dias walk-forward no PLD real (out/2025–out/2026):

| Submercado | rMAE antes | rMAE com o ajuste | MAE | Horas de piso recente (rMAE) | DM p (1 ano) |
|---|---|---|---|---|---|
| SE | 0,941 | 0,922 | −2,1% | 1,02 | 0,0002 |
| S | 0,933 | 0,918 | −1,6% | 0,99 | 0,0001 |
| NE | 0,930 | 0,914 | −1,8% | 0,98 | 0,0001 |
| N | 0,923 | 0,910 | −1,4% | 1,03 | < 0,0001 |

O ganho aparece nas duas metades do período; ajustar sem o limite de distância piorou o MAE em 2–3%.

**Banda adaptativa à volatilidade (testada e não adotada).** Os erros fora da banda de 90% se agrupam
(Christoffersen reprova: depois de uma hora fora, a mesma hora do dia seguinte sai de novo em ~20% das
vezes, contra ~9%). Cinco variantes — escala EWMA do erro recente, sua raiz, escala pelo regime de piso da
semana, escala pelo estado da previsão e combinações — foram testadas em 365 dias: as que corrigem o
agrupamento pioram o *interval score* (regra de pontuação própria para intervalos) em 1–22%, porque alargam
demais a banda depois de dias voláteis. A banda publicada continua a ACI com fator por hora, que tem
cobertura de 90% e o melhor interval score; a auditoria mostra o agrupamento como reprovado.

### Validação fora da amostra das faixas e dos cenários (out/2026)

40 origens por submercado (06/09–16/10/2026), cada previsão refeita só com o PLD até a véspera e
comparada com o dia seguinte (`buildForecast` sobre o painel cortado):

| | SE | S | NE | N | Alvo |
|---|---|---|---|---|---|
| Banda horária publicada (ACI) | 0,904 | 0,904 | 0,907 | 0,898 | 0,90 |
| Faixa da média do dia publicada (conformal) | 0,93 | 0,93 | 0,90 | 0,90 | 0,90 |
| Monte Carlo, faixa 5–95% por hora | 0,926 | 0,925 | 0,929 | 0,917 | 0,90 |
| Monte Carlo, faixa 5–95% da média do dia (antes) | 0,80 (0,72) | 0,75 (0,63) | 0,80 (0,78) | 0,93 (0,90) | 0,90 |
| Oscilação no dia, trajetória ÷ real, mediana (antes) | 1,39 (2,15) | 1,97 (2,63) | 2,08 (2,37) | 1,69 (1,39) | 1 |
| CRPS da média do dia, R$/MWh (antes) | 21,8 (22,2) | 20,7 (21,5) | 17,5 (17,3) | 18,3 (18,3) | menor é melhor |

"Antes" = o código que estava em produção, nos mesmos 40 dias.

As faixas que a tela publica estão calibradas. Os cenários do Monte Carlo acertam hora a hora, mas a faixa
da média do dia é estreita em SE, S e NE (a média realizada fica abaixo dela em 13–15% dos dias, quase
sempre dias inteiros no piso em que os cenários ficam poucos reais acima dele) e as trajetórias oscilam mais
que o PLD real — por isso a opcionalidade (LSMC) e o teto por trajetória da bateria tendem a sair
otimistas, e a tela de arbitragem avisa quando isso acontece.

Nesta rodada a auditoria achou e corrigiu dois defeitos do Monte Carlo: as marginais misturavam horas com
previsão no piso (erro quase sempre 0) e fora dele, e metade das trajetórias saía sem incerteza até no pico
da noite; e o alvo de calibração usava a oscilação do PREÇO real, confundindo a forma da previsão com ruído.
Agora as marginais são separadas por estado e a cópula é calibrada no erro (dependência entre as horas do
dia e rugosidade).

**Registro das previsões publicadas.** A cada dia novo, a previsão do primeiro dia previsto é gravada
(Firestore, `forecast_log/{sub}`, últimos 90 dias) e depois conferida com o PLD que aconteceu: erro contra
o ingênuo e cobertura da banda horária, da faixa da média do dia e do Monte Carlo. Entra na nota da
auditoria a partir de 14 dias conferidos.

## Auditoria dos modelos

`GET /api/auditoria/modelos` (tela Agente auditor): roda todos os modelos sobre o PLD real e confere cada
um contra um alvo fixo — aprovado, atenção ou reprovado; a nota é 100 × (aprovados + ½ atenção) / total
(`src/lib/audit/models.ts`). Rodar tudo leva de 1 a 3 minutos, então a rota responde na hora com a última
auditoria guardada (memória + Firestore `model_audit/latest`) e, se ela tiver mais de 1 hora, refaz depois
da resposta (`after()`); só a primeira de todas espera o cálculo. O smoke test diário também a aciona.

| Modelo | Critério | Alvo |
|---|---|---|
| Previsão | erro contra o ingênuo nas últimas 4 semanas | rMAE < 1 (reprova se for significativamente pior, DM p > 0,95, ou > 15% pior) |
| Previsão | combinação contra o LEAR sozinho; erro cresce com o horizonte | combinação ≤ LEAR; D+7/D+1 ≥ 0,9 (sinal de vazamento) |
| Bandas | cobertura da banda de 90%, Kupiec (com efeito de desenho diário), Christoffersen | 90% ± 3 p.p.; p ≥ 0,05 |
| Quantis (QRA) | cobertura 5–95% fora da amostra | 90% ± 5 p.p. |
| GARCH | estacionário | α+β < 0,99 (α ≈ 0 = volatilidade constante, válido) |
| Cenários (MRJD) | dependência entre as horas do dia e rugosidade do erro, simuladas × reais | desvio ≤ 15% |
| Previsões publicadas | erro do que foi publicado contra o ingênuo; banda horária; faixa da média do dia (a partir de 14 dias) | rMAE < 1; 90% ± 5 p.p.; 90% ± 10 p.p. |
| HMM | probabilidades somam 1 | — |
| Dados | último dia completo; dias faltando na fonte (90 dias); PLD no piso/teto da ANEEL; horas faltando | ontem ou hoje; ≤ 3%; 0 fora; < 1% |
| Backtest de 1 ano | D+1 contra o ingênuo; pior regime conhecido antes de prever | rMAE < 1 e DM p < 0,05; ≤ 1,05 |
| Bateria (LP) | despacho ótimo ≥ regra simples todo dia; ciclos | 0 dias abaixo; ≤ limite |
| Térmicas e ESS | motivos do despacho somam a geração; geração com CVU da semana | ≤ 1%; ≥ 99% |
| Rede elétrica | retrato em dia; fluxo AC nas 24 h; p3s × pandapower; balanço na barra de referência; usinas com barra; intercâmbio calculado × medido por interligação; N-1 resolvido; tensões plausíveis | ≤ 2 dias; 24/24; < 1 MW; ≤ 2% da carga; ≥ 95%; erro ≤ 15% (≤ 30% atenção); ≥ 99%; ≥ 95% entre 0,90 e 1,10 pu |
| Arbitragem | captura da regra simples | entre 0% e 100% |
| Auditor de APIs | detecta falhas injetadas | ≥ 90% |

## Agente auditor

1. **Camada determinística** (sempre ativa): para cada API mede disponibilidade, latência, frescor vs SLA,
   schema, completude (lacunas/duplicados), validade (faixas regulatórias) e outliers (Hampel). Checa a
   integridade cruzada **PLD (CCEE) = CMO (ONS) limitado** e a triangulação cambial. Score 0–100.
2. **Camada IA** (com `GROQ_API_KEY`, a mesma chave da Iara): um LLM da Groq recebe o resultado e
   investiga com ferramentas — re-sonda endpoints, lê o histórico no Firestore, inspeciona amostras e
   checa integridade — e registra um relatório com evidência, causa provável e ação. É acionado quando
   algo degrada, na execução diária e manualmente, sempre com credencial (`CRON_SECRET` ou `ADMIN_KEY`);
   sem nenhuma delas o agente não roda. Modelo: `GROQ_MODEL` (padrão `openai/gpt-oss-120b`, com
   fallback para outros modelos da Groq se o configurado sair do catálogo).
3. **Agendamento**: Vercel Cron diário (plano Hobby) + GitHub Actions a cada 15 min (`.github/workflows/audit.yml`).
4. **Saúde e alertas**: `/api/health` responde 200/503 pela mesma regra do alerta (score, fontes fora do ar
   ou vencidas, persistência, idade do último run — `HEALTH_MAX_AGE_MIN`, padrão 1500). Com
   `ALERT_WEBHOOK_URL`, cada mudança de saúde (degradou/recuperou) vira notificação. **Grátis e sem conta:**
   use `https://ntfy.sh/<um-tópico-longo-e-aleatório>` e assine o mesmo tópico no app ntfy (Android/iOS/web)
   — o app detecta o ntfy e manda texto com título e prioridade; Slack/Discord/Teams recebem JSON
   (`ALERT_WEBHOOK_FORMAT=json|ntfy` força o formato). **Agente auditor → Alertas → enviar teste**
   (`POST /api/auditoria/alert-test`, 1/h sem credencial) valida o destino.
5. **Self-eval**: `/api/auditoria/selfeval` injeta 10 falhas conhecidas e mede precisão/recall da camada determinística.

**PLD atual em JSON** (`GET /api/pld`): por submercado, o valor da hora atual (ou o último
publicado), estatísticas de hoje, de amanhã (quando publicado) e do último dia completo; `?sub=SE`
(aceita SE, SUDESTE, CO, S, SUL, NE, NORDESTE, N, NORTE) e `?dias=7` (médias diárias, até 90). Usa a
mesma cadeia do app (CCEE Dados Abertos com identificação honesta → PLD *estimado* pelo CMO/DESSEM do ONS com o
piso/teto da ANEEL, que pode diferir do oficial → último dado bom) e informa a fonte em `fonte`; dado simulado nunca sai (503).

**PLD oficial pelo coletor** (`scripts/coletor-ccee.mjs`): a CCEE bloqueia servidores de nuvem
(a Vercel recebe 403), mas não quem usa o portal de Dados Abertos numa conexão comum. O coletor roda
no seu computador (Node 18+), lê a API pública do portal com identificação honesta — sem se passar
por navegador — e envia os registros para `POST /api/pld/coletor` (header `x-coletor-key` =
`PLD_INGEST_KEY`). A rota usa o mesmo parser da busca direta e só aceita dias completos, dentro do
piso/teto do ano e até D+1; eles ficam no Firestore como oficiais e substituem a estimativa pelo CMO
em todas as telas, na Iara e em `/api/pld`. `GET /api/pld/coletor` mostra os dias recebidos.

```powershell
$env:SIN_OS_URL="https://sinos-iota.vercel.app"; $env:PLD_INGEST_KEY="sua-chave"
node coletor-ccee.mjs --loop 60
```

Guia completo, passo a passo (chave na Vercel e coletor no PC): [docs/coletor-ccee.md](docs/coletor-ccee.md).

No Windows, `coletor-ccee.bat` (na mesma pasta do `.mjs`) faz tudo com duplo clique: pede a chave uma
vez (guarda em `chave.txt`, que o `.gitignore` já ignora) e coleta a cada 60 min. **Plano B** se a API
do portal falhar na sua conexão: baixe o CSV do PLD horário pelo navegador
(dadosabertos.ccee.org.br/dataset/pld_horario → recurso do ano → Baixar), salve como `pld.csv` na pasta
e rode o `.bat` (ou `node coletor-ccee.mjs --csv pld.csv`): ele envia só as linhas mais recentes.

**Exportação CSV** (`?format=csv`): `/api/previsao?sub=SE` (curva horária, banda e quantis),
`/api/arbitragem?sub=SE` (despacho ótimo de 72 h) e `/api/pld-mensal` (PLD médio mês × submercado).

## Radar semanal da comunidade

`node scripts/radar-comunidade.mjs "WhatsApp Chat - Comunidade.zip"` lê a exportação do grupo (o .zip ou o
`_chat.txt`) e grava em `docs/radar/AAAA-MM-DD.md` os temas da semana, os links compartilhados (marcando os
novos em relação aos radares anteriores) e as perguntas em aberto. O resumo é anônimo: tira nomes, telefones,
e-mails, menções, apresentações pessoais e links de redes sociais e reuniões. Roda só no seu computador; os
radares e as exportações ficam fora do git porque o repositório é público. `--desde AAAA-MM-DD` muda a janela
(padrão: 7 dias até a última mensagem).

## Deploy na Vercel

1. Em [vercel.com/new](https://vercel.com/new), importe o repositório `maricobello/sinos`.
2. Framework: Next.js (detectado). Root Directory, build e output ficam no padrão.
3. Variáveis de ambiente (Settings → Environment Variables) — todas opcionais, veja `.env.example`:
   `CRON_SECRET`, `ADMIN_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `EIA_API_KEY`,
   `ALERT_WEBHOOK_URL`, `GROQ_API_KEY` (Iara e agente auditor), `ASSISTANT_ACCESS_CODE`, `ACCESS_CODES` e
   `SESSION_SECRET` (acesso, acima). Sem `ADMIN_KEY` nem `ACCESS_CODES`, a produção fica fechada. `DATA_MODE=live` garante que
   nenhuma tela mostra dado simulado (fonte fora do ar aparece como erro).
   Dá para adicionar depois e fazer redeploy.
4. Deploy. A região das funções é `gru1` (São Paulo), perto da CCEE e do ONS.
5. Abra **Agente auditor → Rodar auditoria** para a primeira execução.
6. A auditoria a cada 2 h roda pelo GitHub Actions contra a produção. Se criar `CRON_SECRET` na Vercel,
   cadastre o mesmo valor como segredo `CRON_SECRET` no GitHub (e `SIN_OS_URL` se mudar o domínio).

## Firebase (Firestore) — passo a passo

1. [console.firebase.google.com](https://console.firebase.google.com) → **Adicionar projeto** (ex.: `sin-os`).
   Google Analytics pode ficar desligado.
2. **Build → Firestore Database → Criar banco de dados** → modo produção → região
   `southamerica-east1` (São Paulo).
3. **Regras**: cole o conteúdo de `firestore.rules` (nega acesso direto; o app usa o Admin SDK no servidor).
4. **Configurações do projeto → Contas de serviço → Gerar nova chave privada** (baixa um JSON).
5. Na Vercel, crie `FIREBASE_SERVICE_ACCOUNT` com o conteúdo do JSON (texto puro ou base64:
   `base64 -w0 chave.json`). Nunca faça commit desse arquivo.
6. Redeploy. A tela do auditor mostra "Firestore <projeto>" quando está conectado.

Coleções criadas: `audit_runs`, `agent_reports`, `pld_days` (histórico próprio de PLD por dia —
também usado como fallback se a CCEE cair) e `eu_prices` (último download de cada zona europeia). O plano gratuito (Spark) tem
cota diária de 50 mil leituras e 20 mil gravações, que zera à meia-noite do Pacífico (4h–5h de Brasília).

**Cota de leituras.** Cada aba aberta consulta as rotas a cada minuto, então nenhuma rota pode ler o
Firestore por requisição. As regras que mantêm o app dentro da cota:

- toda rota GET pública responde com `s-maxage` (a CDN da Vercel atende as abas; a função roda no
  máximo uma vez por minuto por URL), inclusive `/api/auditoria` e `/api/health`;
- o que se lê com frequência fica na memória da instância (`src/lib/store.ts`): execuções do auditor
  (2–10 min), relatórios, revisões (30 min), preços europeus (relidos a cada 15 min) e dias oficiais do
  PLD (só relidos quando a marca `meta/pld_official` muda, ou seja, quando o coletor grava);
- a gravação do PLD confere só os últimos 14 dias (30 no auditor), não os 120;
- se o Firestore responder **RESOURCE_EXHAUSTED** (cota esgotada), um disjuntor manda tudo para a memória
  por 10 min, as listas devolvem a última versão conhecida e o menu lateral diz "Firebase sem cota hoje"
  em vez de "Sem auditoria ainda". Os dados de mercado não dependem do Firestore e seguem ao vivo.

### Firebase MCP (Claude Code)

O repositório traz `.mcp.json` com o servidor MCP oficial do Firebase (`firebase-tools mcp`).
Na sua máquina, rode `npx firebase-tools@latest login` uma vez; ao abrir o Claude Code nesta pasta,
aprove o servidor `firebase` e o Claude passa a criar/consultar projeto, Firestore e regras direto.

### Firebase × Supabase

| | Firebase (Firestore) | Supabase |
|---|---|---|
| Banco | NoSQL de documentos (coleções/docs) | PostgreSQL (SQL, joins, views, extensões) |
| Consultas analíticas | limitadas (sem joins; agregações simples) | fortes — ideal para séries temporais e backtests |
| Tempo real | listeners nativos muito maduros | Realtime via replicação do Postgres |
| Plano grátis | Spark: cotas diárias, **não pausa projetos** | 500 MB, **2 projetos ativos**, pausa após 1 semana sem uso |
| Cobrança | por operação (leitura/gravação) | por recursos (instância, storage, egress) |
| Dono / lock-in | Google, proprietário | open source, pode ser auto-hospedado |
| Integração Vercel | via variáveis de ambiente (funciona bem) | integração nativa no marketplace |

Para este app o Firebase atende bem: o volume é pequeno, o acesso é só pelo servidor e o Spark não pausa.
Se no futuro quiser SQL para backtests pesados, dá para pausar um dos projetos do Supabase ou trocar a
camada `src/lib/store.ts` (é o único arquivo que fala com o banco).

## Desenvolvimento

```bash
npm install
cp .env.example .env.local   # opcional
npm run dev                  # http://localhost:3000
npm test && npm run lint && npm run typecheck && npm run build
npm run eval:real            # avaliação em dados reais do ONS (baixa ~7 MB; alguns minutos)
DATA_MODE=demo npm run dev   # tudo simulado (sem internet)
```

## Estrutura

```
src/lib/quant/      modelos (LARS/LASSO, LEAR, conformal, QRA, MRJD, HMM, GARCH, ADF/EG, DP/LSMC, risco)
src/lib/sources/    adaptadores das APIs + catálogo com SLAs + simulador sinalizado
src/lib/market/     previsão (ensemble) e arbitragem sobre dados reais
src/lib/audit/      checagens, execução e agente (Groq)
src/lib/store.ts    Firestore (ou memória)
src/app/api/        rotas: pld, confianca, renovaveis (+historico), rede (+ingest), planejamento (+ingest), termicas, brasil, previsao (+regimes), arbitragem, pld-mensal, global, clima, alertas, auditoria (+run, selfeval, alert-test, modelos), fontes, metodologia, health, status, assistente (+voz)
src/lib/methodology.ts  dicionário de dados e regras publicadas em /metodologia
src/lib/market/thermal.ts  despacho térmico por motivo, CVU por semana, ESS e pilha de mérito
src/lib/grid/       retrato do fluxo de potência (esquema, armazenamento e a resposta de /api/rede)
grid/               modelo da rede em Python (cadastros do ONS → pandapower → p3s), worker diário
planning/           caso do SIN para o NovoModelo (dados do ONS → JSON/Parquet → SDDP), retroanálise e worker diário
src/lib/planning/   relatório do planejamento (esquema, armazenamento e a resposta de /api/planejamento)
src/app/*/page.tsx  telas
tests/              testes de validação
```

## Limitações conhecidas

- O PLD é horário e publicado para D+1; "tempo real" no Brasil significa atualização assim que a CCEE/ONS
  publicam. O mercado de balcão (BBCE) e curvas forward não têm API pública gratuita.
- Plano Hobby da Vercel: cron só diário (por isso o workflow do GitHub) e funções até 300 s.
- `npm audit` aponta um aviso moderado em `uuid` dentro de `firebase-admin → @google-cloud/storage`
  (caminho não usado pelo app); resolve quando o Firebase atualizar a dependência.
- Os limites do PLD mudam todo ano (ANEEL); atualize `PLD_MIN`/`PLD_MAX_*` em janeiro.
- Modelo da rede: sem compensação série das linhas e sem impedância de transformadores nos cadastros
  públicos do ONS; o corredor Norte–Sudeste é o menos fiel ao medido. Tensões só como plausibilidade
  (o ONS não publica tensões medidas).
