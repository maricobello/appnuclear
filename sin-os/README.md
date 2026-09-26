> **Espelho** do repositório principal [maricobello/sinos](https://github.com/maricobello/sinos) — é de lá que a Vercel publica https://sinos-iota.vercel.app. Os workflows em `sin-os/.github/` só rodam no repositório principal.

# SIN OS — terminal de arbitragem e previsão do setor elétrico

Terminal web (Next.js 16, pronto para a Vercel) que junta **APIs públicas do setor de energia**, **modelos
quantitativos validados pela literatura** e um **agente de IA que audita as APIs**, com foco em
arbitragem no **SIN (Sistema Interligado Nacional)** e comparação com mercados globais.

> Não é recomendação de investimento. Os valores de arbitragem são estimativas de modelos.

## O que tem

| Tela | O que faz |
|---|---|
| **Sala de Comando** | PLD atual por submercado, D+1 publicado, EAR, saúde das APIs, oportunidades ranqueadas, previsão 7 dias |
| **SIN · Brasil** | Mapa de calor do PLD dia×hora, médias diárias, CMO (ONS) × PLD (CCEE), EAR, ENA, carga |
| **Previsão** | LEAR + conformal adaptativo (ACI) + QRA + Monte Carlo MRJD + regimes HMM + GARCH, com backtest e testes estatísticos |
| **Arbitragem** | Bateria (BESS) no PLD: DP (valor intrínseco) + LSMC (opcionalidade), P&L e CVaR; spreads entre submercados (ADF, cointegração, meia-vida); bateria por zona europeia e valor de congestionamento (FTR); lente global em R$/MWh |
| **Mercados globais** | Europa (SDAC, 15 min), Reino Unido (Elexon, NESO), câmbio (BCB), combustíveis (EIA) |
| **Clima & hidrologia** | Vento, sol e temperatura nos polos do SIN; chuva nas bacias pelo ensemble ECMWF (51 membros) |
| **Carteira** | Contratos como swap sobre o PLD mensal: liquidação de curto prazo, exposição líquida por submercado, exposição a termo dos meses em aberto e MtM contra uma curva a termo **informada pelo usuário** (ex.: cotação BBCE); editar, backup/importação JSON e CSV mês a mês |
| **Agente auditor** | Auditoria determinística de todas as APIs, SLO por fonte (disponibilidade, conformidade, latência p50/p95), alertas push + relatório do Claude com causa provável e ação |
| **Modelos & APIs** | Equações, referências acadêmicas e implementações de referência no GitHub |

"Tempo real": as telas atualizam sozinhas (polling de 30 s a 10 min conforme a fonte) e cada painel
mostra a idade do dado. As fontes brasileiras são publicadas em D−1/D+1 (PLD de amanhã sai à tarde); as
europeias e britânicas têm resolução de 15–30 min.

## APIs públicas integradas

Todas gratuitas e sem cadastro, exceto a EIA (chave gratuita, opcional).

| Fonte | Dados | Uso |
|---|---|---|
| **CCEE — Dados Abertos** (CKAN) | PLD horário por submercado | preço de referência, alvo dos modelos |
| **ONS — Dados Abertos** (S3 direto + CKAN) | CMO semi-horário (DESSEM), EAR, ENA, carga horária | formação do preço, fallback e auditoria do PLD, drivers hidrológicos |
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

## Agente auditor

1. **Camada determinística** (sempre ativa): para cada API mede disponibilidade, latência, frescor vs SLA,
   schema, completude (lacunas/duplicados), validade (faixas regulatórias) e outliers (Hampel). Checa a
   integridade cruzada **PLD (CCEE) = CMO (ONS) limitado** e a triangulação cambial. Score 0–100.
2. **Camada IA** (com `ANTHROPIC_API_KEY`): o Claude recebe o resultado e investiga com ferramentas —
   re-sonda endpoints, lê o histórico no Firestore, inspeciona amostras e checa integridade — e registra
   um relatório com evidência, causa provável e ação. É acionado quando algo degrada, na execução diária
   e manualmente (com `ADMIN_KEY`). Usa `claude-opus-5` com *server-side fallbacks* habilitados
   (`ANTHROPIC_MODEL` troca o modelo).
3. **Agendamento**: Vercel Cron diário (plano Hobby) + GitHub Actions a cada 15 min (`.github/workflows/audit.yml`).
4. **Saúde e alertas**: `/api/health` responde 200/503 pela mesma regra do alerta (score, fontes fora do ar
   ou vencidas, persistência, idade do último run — `HEALTH_MAX_AGE_MIN`, padrão 1500). Com
   `ALERT_WEBHOOK_URL`, cada mudança de saúde (degradou/recuperou) vira notificação. **Grátis e sem conta:**
   use `https://ntfy.sh/<um-tópico-longo-e-aleatório>` e assine o mesmo tópico no app ntfy (Android/iOS/web)
   — o app detecta o ntfy e manda texto com título e prioridade; Slack/Discord/Teams recebem JSON
   (`ALERT_WEBHOOK_FORMAT=json|ntfy` força o formato). **Agente auditor → Alertas → enviar teste**
   (`POST /api/auditoria/alert-test`, 1/h sem credencial) valida o destino.
5. **Self-eval**: `/api/auditoria/selfeval` injeta 10 falhas conhecidas e mede precisão/recall da camada determinística.

**Exportação CSV** (`?format=csv`): `/api/previsao?sub=SE` (curva horária, banda e quantis),
`/api/arbitragem?sub=SE` (despacho ótimo de 72 h) e `/api/pld-mensal` (PLD médio mês × submercado).

## Deploy na Vercel

1. Em [vercel.com/new](https://vercel.com/new), importe o repositório `maricobello/sinos`.
2. Framework: Next.js (detectado). Root Directory, build e output ficam no padrão.
3. Variáveis de ambiente (Settings → Environment Variables) — todas opcionais, veja `.env.example`:
   `CRON_SECRET`, `ADMIN_KEY`, `ANTHROPIC_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `EIA_API_KEY`,
   `ALERT_WEBHOOK_URL`.
   Dá para adicionar depois e fazer redeploy.
4. Deploy. A região das funções é `gru1` (São Paulo), perto da CCEE e do ONS.
5. Abra **Agente auditor → Rodar auditoria** para a primeira execução.
6. A auditoria a cada 15 min roda pelo GitHub Actions contra a produção. Se criar `CRON_SECRET` na Vercel,
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
também usado como fallback se a CCEE cair) e `eu_prices` (último download de cada zona europeia). O plano gratuito (Spark) cobre com folga: 50 mil leituras e
20 mil gravações por dia, 1 GiB de armazenamento; auditoria a cada 15 min grava ~100 documentos/dia.

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
src/lib/audit/      checagens, execução e agente Claude
src/lib/store.ts    Firestore (ou memória)
src/app/api/        rotas: brasil, previsao, arbitragem, pld-mensal, global, clima, auditoria (+run, selfeval, alert-test), health, status
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
