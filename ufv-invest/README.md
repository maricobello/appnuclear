# UFV Invest — cotas tokenizadas de usinas solares na BNB Chain

Plataforma de investimento coletivo em **usinas fotovoltaicas (UFV)**: cada usina vira um token
de cotas na **BNB Smart Chain**; o investidor compra cotas em USDT com a própria carteira
(Binance Wallet, MetaMask, Rabby, Trust, WalletConnect), acompanha a geração e recebe a receita
líquida da usina em USDT, distribuída pro-rata pelo contrato.

O diferencial é a **confiança verificável**: cada usina tem um modelo de geração P50/P90 com
dados de satélite reais, uma análise econômica completa (TIR, VPL, payback, LCOE, Monte Carlo,
sensibilidade, comparação com CDI/Poupança/Tesouro) e um **relatório de auditoria em PDF** com os
dados de origem anexados e hash SHA-256 que pode ser registrado no contrato e conferido por
qualquer pessoa em `/verificar`.

> **Demonstração.** As três usinas do catálogo são projetos ilustrativos (local, regras e recurso
> solar reais; engenharia, CAPEX e tokenização hipotéticos) e o app roda na **testnet**. Ofertas
> públicas de valores mobiliários no Brasil exigem registro ou dispensa na CVM (ex.: plataforma
> de investimento participativo autorizada — Resolução CVM 88). Veja "Caminho para produção".

```
ufv-invest/
├── web/         Next.js 16 (App Router) + wagmi/viem — site, APIs, modelos, PDF
└── contracts/   Solidity 0.8.28 + OpenZeppelin v5 + Hardhat — token, KYC, oferta, distribuição
```

## Como a equipe dividiu o trabalho

| Papel | Entrega | Onde |
|---|---|---|
| Arquiteto / líder | tipos do domínio, orquestração, integração, CSP, SIWE | `web/src/lib/types.ts`, `web/src/lib/analysis.ts`, `web/src/proxy.ts`, `web/src/lib/auth` |
| Engenheiro de smart contracts | token de cotas restrito, registro KYC, oferta com escrow, distribuição de receita, deploy | `contracts/` |
| Engenheiro solar + analista quant | geometria solar, decomposição, transposição HDKR, tracker, temperatura, perdas, P50/P90; fluxo de caixa, TIR, Monte Carlo, sensibilidade | `web/src/lib/solar`, `web/src/lib/finance` |
| Engenheiro de dados | NASA POWER, PVGIS, Open-Meteo, IBGE, Banco Central (SGS + Focus), Binance/CoinGecko, com validação, cache e fallback | `web/src/lib/sources` |
| Engenheiro de relatórios | PDF de auditoria (pdf-lib), gráficos vetoriais, QR code, JSON canônico anexado | `web/src/lib/report` |
| Frontend Web3 | páginas, gráficos, conexão de carteira EIP-6963, fluxo de investimento, carteira do investidor, verificação | `web/src/app`, `web/src/components` |
| Auditor de segurança | revisão dos contratos e do dApp | relatório no PR |

## Rodando localmente

```bash
# site
cd ufv-invest/web
cp .env.example .env.local      # opcional: tudo funciona sem chaves
npm install
npm run dev                     # http://localhost:3000
npm test                        # modelos, fontes, PDF, auth
npm run typecheck && npm run lint && npm run build

# contratos
cd ../contracts
npm install
npm test                        # suíte Hardhat
```

## Implantar na BNB Chain Testnet

1. Crie uma carteira só para deploy e pegue tBNB no faucet oficial da BNB Chain.
2. `cd contracts && cp .env.example .env` e preencha `DEPLOYER_PRIVATE_KEY` (nunca versionar) e, de
   preferência, `ADMIN_ADDRESS` = um **Safe (multisig)**.
3. `npm run deploy:testnet` — publica o registro KYC, o USDT de teste, os tokens e as ofertas, e grava
   `web/src/data/deployments.json` (a única fonte de endereços que o site usa).
4. Aprove sua carteira no KYC com o script de admin (ver `contracts/README.md`), abra o site e invista
   com USDT de teste (botão "faucet" na tela de investimento).
5. Para registrar o relatório oficial: baixe o PDF, calcule `sha256sum relatorio.pdf` e chame
   `setDocument` (script de admin). A página `/verificar` passa a reconhecê-lo como autêntico.

## Deploy do site (Vercel)

- Root directory: `ufv-invest/web`; região `gru1` (São Paulo) — também evita o bloqueio regional da API
  da Binance.
- Variáveis: `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_SITE_URL`, `SESSION_SECRET` (Sensitive, ≥ 32 chars),
  opcionalmente `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, RPCs próprios e `KYC_WEBHOOK_URL`.

## Segurança (resumo)

**Carteira:** descoberta EIP-6963 (sem disputa pelo `window.ethereum`), login SIWE (EIP-4361) com nonce
de uso único e cookie HttpOnly, rede travada, simulação de toda transação antes de assinar, aprovação
de USDT no valor exato, endereços de contrato só do arquivo de deploy versionado.
Recomendação ao investidor: carteira de hardware (Ledger/Trezor) via Rabby ou MetaMask; a Binance
Wallet é nativa da BNB Chain; a Phantom é focada em Solana.

**Site:** CSP com nonce por requisição, `frame-ancestors 'none'`, HSTS, rate limit nas APIs, nenhum
segredo no cliente, nenhuma chave privada no servidor.

**Contratos:** token BEP-20 com 0 decimais que só transfere entre carteiras com KYC; oferta com
custódia, meta mínima, reembolso e direito de desistência de 5 dias por aporte; distribuição de receita
por acumulador (padrão ERC-2222); registro de documentos (hash do relatório) só pelo multisig; emissor
de cotas definido uma única vez; sem proxy de atualização; papéis separados com atraso na troca do
admin. Detalhes e premissas de confiança em `contracts/README.md`.

### Auditoria interna (resultado)

Uma revisão independente da equipe (contratos + dApp) não encontrou falhas críticas ou altas; os seis
pontos médios foram corrigidos e cada ataque tem um teste que prova que ele falha
(`contracts/test/Audit.test.ts`, `web/tests/auth.siwe.test.ts`, `web/tests/pdfAttachment.test.ts`):

| Ponto | Correção |
|---|---|
| Grupo ocupava o teto da oferta e desistia no fim (sem custo) | desistência por aporte + quem desiste não aporta de novo |
| Admin podia virar emissor e emitir cotas não vendidas para si | emissor definido uma única vez (`setMinter`), papel travado |
| Carteira do servidor de KYC podia trocar o hash do relatório | `DOCUMENT_ROLE` exclusivo do multisig |
| Retomar um deploy interrompido podia deixar o deployer como admin | hand-off idempotente |
| Cookie de sessão reaproveitado como nonce no login SIWE | HMAC com propósito + formato de nonce validado |
| CSP quebrava o modal do WalletConnect | regras específicas quando o WalletConnect está ativo |

Pendências para a **mainnet**: auditoria externa, timelock na frente do Safe, rate limit e nonces em
armazenamento compartilhado (ex.: Vercel KV/Firewall), provedor de KYC certificado com política de
retenção (LGPD) e o enquadramento regulatório (Resolução CVM 88).

## Caminho para produção

1. **Regulatório:** estruturar a SPE e a oferta com assessoria jurídica; operar via plataforma de
   crowdfunding autorizada pela CVM (Res. 88) ou outro rito; KYC/PLD com provedor certificado; política
   de privacidade (LGPD).
2. **Auditoria externa** dos contratos (e bug bounty) antes da mainnet; admin em Safe multisig com
   timelock.
3. **Dados medidos:** integrar a API de monitoramento dos inversores para comparar geração medida × P50
   todo mês e publicar o relatório mensal com hash on-chain junto de cada distribuição.
4. **Dados de engenharia reais:** substituir as hipóteses do catálogo (`web/src/data/plants.ts`) pelo
   projeto executivo, contrato de EPC, parecer de acesso e tarifas homologadas pela ANEEL.
