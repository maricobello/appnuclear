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
| **Agente auditor** | Auditoria determinística de todas as APIs + relatório do Claude com causa provável e ação |
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
| Difusão com reversão e saltos (MRJD) | Cartea & Figueroa (2005); Schwartz (1997) | — |
| HMM / Markov-switching (3 regimes) | Hamilton (1989); Janczura & Weron (2010) | [hmmlearn](https://github.com/hmmlearn/hmmlearn) |
| GARCH(1,1) | Bollerslev (1986) | [arch](https://github.com/bashtage/arch) |
| ADF, Engle–Granger, meia-vida | MacKinnon (2010); Engle & Granger (1987) | statsmodels |
| Diebold–Mariano, Kupiec, CRPS | DM (1995), HLN (1997), Gneiting & Raftery (2007) | epftoolbox |
| Armazenamento: LP/MILP exato (HiGHS) + LSMC, rolling intrinsic no D+1 | Huangfu & Hall (2018); Longstaff & Schwartz (2001); Boogert & de Jong (2008) | [ERGO-Code/HiGHS](https://github.com/ERGO-Code/HiGHS), QuantLib |
| CVaR / Expected Shortfall | Rockafellar & Uryasev (2000) | — |

`npm test` roda 45 testes: recuperação de parâmetros em dados simulados (LASSO/LARS, HMM, GARCH, MRJD,
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

**2. Calibração da incerteza** — a previsão completa rodada em 20 datas passadas só com os dados
disponíveis em cada uma; cobertura das faixas contra o PLD realizado (alvo 90%):

| Horizonte | D+1 | D+2 | D+3 | D+4 | D+5 | D+6 | D+7 |
|---|---|---|---|---|---|---|---|
| Banda conformal (SE) | 0,90 | 0,92 | 0,91 | 0,90 | 0,89 | 0,90 | 0,91 |
| Monte Carlo 5–95% (SE) | 0,90 | 0,89 | 0,90 | 0,91 | 0,89 | 0,90 | 0,89 |
| Banda conformal (N) | 0,91 | 0,91 | 0,91 | 0,91 | 0,91 | 0,90 | 0,91 |
| Monte Carlo 5–95% (N) | 0,91 | 0,90 | 0,89 | 0,91 | 0,89 | 0,86 | 0,89 |

Para chegar aí: o erro de cada horizonte é medido num backtest multi-horizonte (em SE o MAE sobe de
~38 R$/MWh no D+1 para ~61 no D+7) e alarga a banda na proporção medida; o Monte Carlo (MRJD) é
calibrado nos erros reais do LEAR, com a largura 5–95% casada com a dos resíduos.

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

## Deploy na Vercel

1. Em [vercel.com/new](https://vercel.com/new), importe o repositório `maricobello/sinos`.
2. Framework: Next.js (detectado). Root Directory, build e output ficam no padrão.
3. Variáveis de ambiente (Settings → Environment Variables) — todas opcionais, veja `.env.example`:
   `CRON_SECRET`, `ADMIN_KEY`, `ANTHROPIC_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `EIA_API_KEY`.
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
src/app/api/        rotas: brasil, previsao, arbitragem, global, clima, auditoria, status
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
