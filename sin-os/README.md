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
| **ONS — Dados Abertos** (CKAN + S3) | CMO semi-horário (DESSEM), EAR, ENA, carga horária | formação do preço, fallback e auditoria do PLD, drivers hidrológicos |
| **Energy-Charts** (Fraunhofer ISE) | preços day-ahead de 12 zonas europeias | arbitragem de bateria e de fronteira |
| **Elexon BMRS** | Market Index Price e System Buy/Sell Price (GB) | preço de curto prazo e escassez |
| **NESO Carbon Intensity** | gCO₂/kWh e mix de geração (GB) | contexto de mercado |
| **Open-Meteo** | previsão horária e ensemble ECMWF IFS 0,25° | vento, sol, temperatura, chuva nas bacias |
| **Banco Central (SGS)** | USD, EUR, GBP | conversão para R$/MWh |
| **U.S. EIA** (opcional) | Henry Hub, Brent | custo marginal térmico |

Resiliência do PLD: **CCEE → CMO do ONS limitado ao piso/teto** (mesma regra de formação) **→ histórico
no Firestore → simulação sinalizada**. Qualquer dado simulado aparece com alerta amarelo na tela.

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
| Armazenamento: DP + LSMC | Longstaff & Schwartz (2001); Boogert & de Jong (2008) | QuantLib |
| CVaR / Expected Shortfall | Rockafellar & Uryasev (2000) | — |

`npm test` roda 30 testes: recuperação de parâmetros em dados simulados (LASSO/LARS, HMM, GARCH, MRJD,
regressão quantílica), valores críticos de MacKinnon, cobertura do conformal, DP contra força bruta,
LEAR superando o benchmark ingênuo com Diebold–Mariano significativo, contratos de payload de cada API
e o caminho completo previsão → arbitragem.

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

1. Coloque o projeto num repositório próprio (veja abaixo) ou use este mesmo repositório.
2. Em [vercel.com/new](https://vercel.com/new), importe o repositório.
   - Se o projeto estiver na pasta `sin-os/` de outro repositório, defina **Root Directory = `sin-os`**.
3. Framework: Next.js (detectado). Não precisa mudar build/output.
4. Variáveis de ambiente (Settings → Environment Variables) — todas opcionais, veja `.env.example`:
   `CRON_SECRET`, `ADMIN_KEY`, `ANTHROPIC_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `EIA_API_KEY`.
5. Deploy. A região das funções é `gru1` (São Paulo), perto da CCEE e do ONS.
6. Abra **Agente auditor → Rodar auditoria** para a primeira execução.
7. (Opcional) No GitHub do projeto: variável `SIN_OS_URL` e segredo `CRON_SECRET` para auditoria a cada 15 min.

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
também usado como fallback se a CCEE cair). O plano gratuito (Spark) cobre com folga: 50 mil leituras e
20 mil gravações por dia, 1 GiB de armazenamento; auditoria a cada 15 min grava ~100 documentos/dia.

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

## Mover para um repositório próprio

```bash
# a partir do repositório atual
git subtree split --prefix sin-os -b sin-os-only
git push git@github.com:<usuario>/sin-os.git sin-os-only:main
```

## Desenvolvimento

```bash
npm install
cp .env.example .env.local   # opcional
npm run dev                  # http://localhost:3000
npm test && npm run lint && npm run typecheck && npm run build
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
