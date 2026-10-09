# UFV Invest — contratos inteligentes (BNB Smart Chain)

Tokenização de usinas fotovoltaicas (UFV) em **cotas**: cada usina tem um token ERC-20 próprio
(1 token = 1 cota), vendido numa oferta primária com escrow, meta mínima e direito de desistência
(inspirada na Resolução CVM 88), e que distribui a receita líquida da SPE em USDT aos cotistas.

> ⚠ **Estes contratos ainda não passaram por auditoria externa.** Não implante na mainnet nem
> capte recursos reais antes de uma auditoria independente (ver [Auditoria](#auditoria-externa)).

- Solidity **0.8.28** (pragma fixo), OpenZeppelin Contracts **5.6.1**, otimizador 200 runs, `evmVersion: cancun`.
- Hardhat 2 + ethers v6 + chai. Compilação **offline** via `solc` npm (solcjs/WASM) — ver [Compilador](#compilador-offline).
- Sem proxies: contratos **imutáveis** (mais simples de auditar e de confiar).
- Redes: BSC mainnet (`56`) e BSC testnet (`97`).

## Sumário

1. [Arquitetura](#arquitetura)
2. [Contratos e funções públicas](#contratos-e-funções-públicas)
3. [Papéis e pressupostos de confiança](#papéis-e-pressupostos-de-confiança)
4. [Ciclo de vida da oferta](#ciclo-de-vida-da-oferta)
5. [Matemática da distribuição de receita](#matemática-da-distribuição-de-receita)
6. [Desenvolvimento e testes](#desenvolvimento-e-testes)
7. [Deploy na BSC (testnet e mainnet)](#deploy-na-bsc)
8. [Verificação no BscScan](#verificação-no-bscscan)
9. [Operação (scripts de admin)](#operação-scripts-de-admin)
10. [Integração com o front (ABI e endereços)](#integração-com-o-front)
11. [Checklist de segurança](#checklist-de-segurança)
12. [Análise estática (Slither)](#análise-estática-slither)
13. [Limitações conhecidas](#limitações-conhecidas)
14. [Auditoria externa](#auditoria-externa)
15. [Correções da auditoria independente](#correções-da-auditoria-independente)

## Arquitetura

```
                         ┌───────────────────────────────┐
     backend de KYC ───► │ IdentityRegistry              │  carteira → (país, validade do KYC)
     (COMPLIANCE_ROLE)   │  isVerified(wallet)           │
                         └──────────────┬────────────────┘
                                        │ consulta (view)
            ┌───────────────────────────┼───────────────────────────────┐
            │                           │                               │
            ▼                           ▼                               ▼
  ┌───────────────────┐  mint   ┌───────────────────┐         ┌───────────────────┐
  │ UFVOffering       │───────► │ UFVPlantToken     │  ...    │ UFVPlantToken     │  (1 por usina)
  │  (1 por usina)    │ (MINTER)│  "UFVJAN1"        │         │  "UFVPET1"        │
  │  escrow de USDT   │         │  receita (USDT)   │         └───────────────────┘
  └──┬─────────▲──────┘         │  documentos       │
     │         │ commit/        └──────▲─────┬──────┘
     │         │ withdraw/refund       │     │ claim()
     │finalize │                       │     ▼
     ▼         │                distribute   investidores (KYC)
  tesouraria  investidores      (DISTRIBUTOR = tesouraria/Safe da SPE)
  da SPE      (KYC + USDT)

  Token de pagamento: USDT BEP-20 0x55d398326f99059fF775485246999027B3197955 (mainnet, 18 casas)
                      MockUSDT com faucet (somente testnet)
```

| Contrato | Arquivo | Papel |
|---|---|---|
| `IdentityRegistry` | `src/IdentityRegistry.sol` | Lista de carteiras com KYC/AML válido (sem dados pessoais on-chain). |
| `UFVPlantToken` | `src/UFVPlantToken.sol` | Cotas da usina (decimals 0), transferência restrita a KYC, distribuição de receita (ERC-2222), documentos (ERC-1643), recuperação de carteira. |
| `UFVOffering` | `src/UFVOffering.sol` | Oferta primária: escrow, softcap/hardcap, desistência em 5 dias, reembolso, finalização e entrega das cotas. |
| `MockUSDT` | `src/testnet/MockUSDT.sol` | **Somente testnet**: USDT de teste com faucet limitado. |
| mocks | `src/mocks/*` | **Somente testes**: token com taxa na transferência e token reentrante (ataques simulados). |

## Contratos e funções públicas

Funções herdadas de `AccessControlDefaultAdminRules` (todos os 3 contratos principais):
`hasRole`, `grantRole`, `revokeRole`, `renounceRole`, `getRoleAdmin`, `defaultAdmin`, `owner`,
`pendingDefaultAdmin`, `defaultAdminDelay`, `beginDefaultAdminTransfer`, `acceptDefaultAdminTransfer`,
`cancelDefaultAdminTransfer`, `changeDefaultAdminDelay`, `rollbackDefaultAdminDelay`, `supportsInterface`.

### IdentityRegistry

```solidity
constructor(address admin)
function setInvestor(address wallet, uint16 country, uint64 expiresAt) external          // COMPLIANCE_ROLE
function setInvestors(address[] wallets, uint16[] countries, uint64[] expiries) external // COMPLIANCE_ROLE
function removeInvestor(address wallet) external                                         // COMPLIANCE_ROLE
function isVerified(address wallet) external view returns (bool)          // registrado && block.timestamp < expiresAt
function investorOf(address wallet) external view returns (bool registered, uint16 country, uint64 expiresAt)
function COMPLIANCE_ROLE() / ADMIN_TRANSFER_DELAY()
// eventos: InvestorSet(wallet, country, expiresAt, operator), InvestorRemoved(wallet, operator)
```

### UFVPlantToken

```solidity
constructor(string name_, string symbol_, uint256 maxSupply_, IIdentityRegistry registry_, IERC20 payoutToken_, address admin_)
// ERC-20 (decimals() == 0): name, symbol, decimals, totalSupply, balanceOf, transfer, transferFrom, approve, allowance
function maxSupply() / identityRegistry() / payoutToken() / mintingFinished() external view
function setMinter(address minter_) external                             // DEFAULT_ADMIN, UMA ÚNICA VEZ (a oferta)
function minter() external view returns (address)                        // emissor definido (0 até setMinter)
function mint(address to, uint256 amount) external                       // MINTER_ROLE (a oferta)
function finishMinting() external                                        // MINTER_ROLE, irreversível
function distribute(uint256 amount, bytes32 periodRef) external          // DISTRIBUTOR_ROLE
function claim() external returns (uint256 amount)                       // investidor com KYC vigente
function claimable(address) / claimed(address) / accumulativeRevenueOf(address) external view returns (uint256)
function totalDistributed() / totalClaimed() / magnifiedRevenuePerShare() external view returns (uint256)
function revenueByPeriod(bytes32 periodRef) external view returns (uint256)
function setDocument(bytes32 name, string uri, bytes32 documentHash) external   // DOCUMENT_ROLE (só a Safe)
function removeDocument(bytes32 name) external                                   // DOCUMENT_ROLE (só a Safe)
function getDocument(bytes32 name) external view returns (string uri, bytes32 documentHash, uint256 timestamp)
function getAllDocuments() external view returns (bytes32[])
function recover(address lostWallet, address newWallet) external returns (uint256 balance, uint256 pendingRevenue) // DEFAULT_ADMIN
function rescueTokens(IERC20 asset, address to, uint256 amount) external  // DEFAULT_ADMIN (USDT: só excedente)
function pause() / unpause() external                                      // PAUSER_ROLE
// papéis: MINTER_ROLE (administrado por MINTER_ADMIN_ROLE, que ninguém tem), DISTRIBUTOR_ROLE, PAUSER_ROLE, DOCUMENT_ROLE
// eventos: RevenueDistributed(distributor, periodRef, amount, magnifiedRevenuePerShare), RevenueClaimed, MinterSet,
//          MintingFinished, DocumentUpdated, DocumentRemoved, WalletRecovered, TokensRescued, Transfer, Approval
// erros novos: MinterAlreadySet(address minter)
```

### UFVOffering

```solidity
struct Config { IUFVPlantToken token; IERC20 paymentToken; address treasury; uint256 pricePerCota;
                uint256 minCotas; uint256 maxCotasPerInvestor; uint256 softCapCotas; uint256 hardCapCotas;
                uint64 startTime; uint64 endTime; uint64 withdrawalWindow; address admin; }
constructor(Config cfg)
enum State { Pending, Active, Succeeded, Failed, Finalized, Cancelled }   // state() retorna uint8 nesta ordem

// investidor
function commit(uint256 cotas) external          // Active, KYC, approve de cotas × pricePerCota; cada aporte = 1 tranche
function withdraw() external                     // desistência das tranches com < withdrawalWindow; depois disso não reaporta
function refund() external                       // Failed ou Cancelled
function refundFor(address investor) external    // qualquer um dispara; o dinheiro vai ao investidor
function claimTokens() external                  // após Finalized, recebe as próprias cotas
// encerramento
function finalize() external                     // admin (ou qualquer um após 30 dias de carência)
function settle(uint256 maxInvestors) external returns (uint256 delivered) // livre, em lotes
function cancel() external                       // DEFAULT_ADMIN, antes de finalizar
function pause() / unpause() external            // PAUSER_ROLE (só bloqueia commit)
function rescueTokens(IERC20 asset, address to, uint256 amount) external // DEFAULT_ADMIN (USDT: só excedente)
// leitura
function state() external view returns (uint8)
function token() / paymentToken() / identityRegistry() / treasury() external view returns (address)
function pricePerCota() / minCotas() / maxCotasPerInvestor() / softCapCotas() / hardCapCotas() external view returns (uint256)
function startTime() / endTime() / withdrawalWindow() / latestCommitAt() external view returns (uint64)
function cotasSold() / totalRaised() / investorCount() / cotasDelivered() / settleCursor() / remainingCotas() external view returns (uint256)
function commitmentOf(address) external view returns (uint256 cotas, uint256 paid, uint64 lastCommitAt, bool settled, bool refunded)
function withdrawableOf(address) external view returns (uint256 cotas, uint256 amount, uint256 deadline) // o que withdraw() devolveria agora
function tranchesOf(address) external view returns ((uint64 committedAt, uint128 cotas)[])               // aportes da posição atual
function hasWithdrawn(address) external view returns (bool)             // true → commit reverte RecommitAfterWithdrawal
function withdrawalDeadline(address) external view returns (uint256)   // prazo da tranche mais recente (0 se sem posição)
function withdrawalsCloseAt() external view returns (uint256)          // finalize só quando block.timestamp > isto
function finalizeDeadline() external view returns (uint256)            // não finalizada até aqui → state() = Failed
function investorsLength() / investorAt(uint256) / finalized() / cancelled() / settlementCompleted()
// eventos: Committed, Withdrawn(investor, cotas, amount) (agora só das tranches desistidas), Refunded,
//          OfferingFinalized, OfferingCancelled, TokensDelivered, SettlementCompleted, TokensRescued, Paused, Unpaused
// erros novos: RecommitAfterWithdrawal()
```

### MockUSDT (somente testnet)

`faucet()` entrega 10 000 tUSDT a cada 24 h, até 100 000 por carteira; `mint(to, amount)` só do owner;
`faucetAvailableAt(account)`; 18 casas.

## Papéis e pressupostos de confiança

| Contrato | Papel | Quem deve ter | O que pode fazer |
|---|---|---|---|
| todos | `DEFAULT_ADMIN_ROLE` | **Safe multisig** (ex.: 3 de 5) | conceder/revogar papéis (exceto `MINTER_ROLE`); no token: `setMinter` (uma vez), `recover`, `rescueTokens` (só excedente); na oferta: `cancel`, `finalize`, `rescueTokens` |
| Registry | `COMPLIANCE_ROLE` | backend de KYC (hot wallet dedicada) | habilitar/remover carteiras — **nenhum papel nos tokens** |
| Token | `MINTER_ROLE` | **somente** o contrato da oferta, fixado por `setMinter` | emitir até `maxSupply`, encerrar a emissão. Imutável: administrado por `MINTER_ADMIN_ROLE`, que ninguém possui |
| Token | `DISTRIBUTOR_ROLE` | tesouraria/Safe da SPE | depositar receita (`distribute`) |
| Token | `PAUSER_ROLE` | Safe (ou um "guardian" com resposta rápida) | pausar transferências, distribuição e saques |
| Token | `DOCUMENT_ROLE` | **somente a Safe** do admin | publicar/remover relatórios (hash SHA-256) |
| Oferta | `PAUSER_ROLE` | Safe/guardian | pausar novos aportes |

**Pressupostos explícitos (o investidor precisa confiar nisto):**

- **Admin é uma Safe multisig.** O `recover` move o saldo e a receita pendente de qualquer carteira
  para outra carteira verificada — é exigido para valores mobiliários (perda de chave), mas é uma
  permissão de custódia. Recomendação forte: colocar o admin atrás de um **timelock**
  (ex.: `TimelockController` de 48 h com a Safe como proposer) para que investidores vejam um
  `recover`/troca de papéis antes de acontecer.
- A troca de admin é em **2 etapas com atraso de 2 dias** (`AccessControlDefaultAdminRules`); `grantRole(DEFAULT_ADMIN_ROLE)` direto é bloqueado.
- **O `IdentityRegistry` é confiável:** quem controla o `COMPLIANCE_ROLE` decide quem transfere,
  aporta e saca receita. Uma chave de compliance comprometida pode habilitar/desabilitar carteiras,
  mas **não** move tokens nem dinheiro, **não** emite cotas e **não** altera documentos/hashes de
  relatórios (esses são `DOCUMENT_ROLE`, só da Safe). O admin deve monitorar `InvestorSet/InvestorRemoved`.
- **Emissor único e imutável.** O `MINTER_ROLE` do token é concedido uma única vez, por
  `setMinter(oferta)`, e o papel que o administra (`MINTER_ADMIN_ROLE`) não pertence a ninguém e só
  administra a si mesmo: **nem o admin** consegue se conceder `MINTER_ROLE`, emitir o supply não
  vendido para si, revogar o emissor ou encerrar a emissão antes da entrega das cotas. O `finalize`
  ainda confere que a oferta é a emissora antes de liberar o dinheiro.
- **Documentos só pela Safe.** Os hashes dos relatórios de auditoria que o investidor confere em
  `/verificar` só mudam via `DOCUMENT_ROLE` (concedido pelo deploy apenas ao `ADMIN_ADDRESS`).
- **A tesouraria é imutável** por oferta; o dinheiro só sai do escrow para ela (no `finalize`) ou de
  volta ao próprio investidor (desistência/reembolso). Nenhum papel consegue sacar o escrow, e ele
  nunca congela: se a oferta bem-sucedida não puder ser finalizada até `finalizeDeadline()`
  (`endTime + 5 dias + 60 dias`), ela vira `Failed` e todos podem pedir reembolso.
- **A receita reservada é intocável:** `rescueTokens` no token só retira USDT acima de
  `totalDistributed − totalClaimed`; na oferta, só acima de `totalRaised` antes de finalizar.
- O deployer é admin temporário até a Safe aceitar a transferência (≥ 2 dias). Use uma carteira de
  deploy nova e descarte a chave depois.

## Ciclo de vida da oferta

```
            startTime                    endTime                 endTime + 5 dias
  Pending ─────────► Active ──────────────────┬──────────────────────────┬──────────────► 
                       │  commit / withdraw    │ vendido ≥ softcap        │ janelas fechadas
                       │                       ├─► Succeeded ─────────────┴─► finalize() ─► Finalized
                       │ hardcap atingido      │     ▲  (desistência pode     (USDT → tesouraria)   │
                       └──► Succeeded ─────────┘     │   derrubar p/ Failed)                       │ settle()/claimTokens()
                            (desistência volta       │                                              ▼
                             para Active)            │ vendido < softcap                    cotas emitidas,
                                                     └─► Failed ──► refund()               finishMinting()
  cancel() (admin) em qualquer estado antes de Finalized ──► Cancelled ──► refund()
```

1. **Pending** → antes de `startTime`.
2. **Active** → `startTime ≤ agora ≤ endTime` e abaixo do hardcap. `commit(cotas)` exige KYC vigente,
   que o endereço **nunca tenha desistido** nesta oferta, `cotas ≥ minCotas` (exceto para completar
   exatamente o hardcap), posição total ≤ `maxCotasPerInvestor` e não passar do hardcap; puxa
   `cotas × pricePerCota` em USDT (valor recebido conferido — tokens com taxa são rejeitados). Cada
   aporte vira uma **tranche** com a sua própria janela de desistência.
3. **Desistência (`withdraw`)** → devolve as tranches com menos de `withdrawalWindow` (5 dias) de
   idade; as mais antigas continuam em escrow como qualquer aporte (uma recarga **não** reabre a
   desistência da posição antiga). Depois de desistir, o endereço **não pode aportar de novo** nesta
   oferta (`RecommitAfterWithdrawal`). `withdrawableOf(investidor)` mostra o que seria devolvido agora.
   Nunca é pausável.
4. **Succeeded** → hardcap atingido, ou fim com `cotasSold ≥ softCapCotas`. Desistências dentro da
   janela ainda valem (podem levar a oferta de volta a Active ou para Failed).
5. **finalize()** → só quando ninguém mais pode desistir: `agora > withdrawalsCloseAt()` =
   `endTime + 5 dias` (ou `último aporte + 5 dias` se o hardcap foi atingido — encerramento antecipado).
   Confere que a oferta é MINTER, a emissão está aberta e há supply; envia `totalRaised` à tesouraria
   **uma única vez**. Admin a qualquer momento após isso; **qualquer pessoa após mais 30 dias**
   (o dinheiro nunca fica preso se o admin sumir). Se mesmo assim ninguém conseguir finalizar
   (ex.: tesouraria bloqueada pelo emissor do USDT) até `finalizeDeadline()` =
   `endTime + withdrawalWindow + 60 dias`, o estado passa a **Failed** e os reembolsos são liberados.
6. **Entrega das cotas** → `settle(n)` (permissionless, lotes com cursor) e/ou `claimTokens()`.
   Cada investidor é marcado `settled` antes do mint (sem dupla emissão). O mint **não exige KYC
   vigente** (KYC vencido depois do aporte não trava a liquidação; o investidor só não transfere nem
   saca receita até renovar). Ao entregar a última cota, a oferta chama `token.finishMinting()` e a
   distribuição de receita fica liberada.
7. **Failed / Cancelled** → `refund()` / `refundFor(investor)` devolvem 100 % do valor em escrow, uma vez.

`cotasSold`, `totalRaised` e `investorCount` refletem o que está em escrow: caem com desistências e
reembolsos e ficam fixos após `Finalized`.

## Matemática da distribuição de receita

Modelo "funds-distribution token" (ERC-2222 / "dividend-paying token"), O(1) por operação:

```
M = 2^128
a cada distribute(amount):
    mRPS      += (amount·M + resto) / totalSupply        (divisão inteira)
    resto      = (amount·M + resto) % totalSupply        (carregado para a próxima: nada se perde)

acumulado(conta) = ( mRPS · saldo(conta) + correção(conta) ) / M
claimable(conta) = acumulado(conta) − sacado(conta)

em todo mint/transferência de v cotas de A para B (ajuste para a receita passada não acompanhar o saldo):
    correção(A) += mRPS · v
    correção(B) −= mRPS · v
```

- **Receita acumulada antes de uma transferência fica com quem transferiu** (o termo `mRPS·saldo`
  muda, a correção compensa exatamente).
- Distribuições só depois de `finishMinting` (ninguém que ainda vá receber cotas da oferta perde
  receita) e com `totalSupply > 0`; não há queima, então o supply é constante após a emissão.
- **Arredondamento sempre para baixo:** `Σ sacado + Σ claimable ≤ totalDistributed`. A diferença
  ("poeira") é de no máximo 1 unidade mínima do USDT (10⁻¹⁸) por titular e fica no contrato
  (reservada, não sacável por `rescueTokens`).
- `recover(perdida, nova)`: move o saldo (a receita até ali fica na carteira perdida) e em seguida
  transfere a correção magnificada de modo que a carteira perdida fique com `acumulado == sacado`
  (histórico preservado) e todo o pendente vá para a nova — a soma das correções não muda, então o
  invariante continua valendo.
- Overflow: `amount·M` reverte acima de 2¹²⁸ unidades por distribuição (≈ 3,4·10²⁰ USDT); correções usam `SafeCast`.

O teste `Revenue.test.ts › invariante` compara, a cada passo de uma sequência aleatória
(determinística) de transferências, distribuições (de 1 wei a 250 mil USDT), saques e recuperações,
cada conta com um modelo racional exato e verifica `Σ sacado + Σ claimable + poeira == totalDistributed`,
`0 ≤ poeira ≤ nº de contas` e `saldo de USDT do contrato == totalDistributed − totalClaimed`.

## Desenvolvimento e testes

```bash
cd ufv-invest/contracts
npm install
npm run compile        # solc 0.8.28 (solcjs/WASM, offline)
npm test               # 137 testes
npm run test:gas       # relatório de gás
npm run coverage       # solidity-coverage
npm run typecheck      # TypeScript dos scripts/testes
npm run export:abi     # gera ../web/src/lib/web3/abi.ts
```

Cobertura atual: **100 % de linhas, statements e funções; ~95 % de branches** nos contratos principais
(os ramos não cobertos são checagens de defesa em profundidade do `finalize` que ficaram inalcançáveis
com o emissor imutável).

Gás médio (BSC, 200 runs): `commit` ~237k (1º aporte ~344k — inclui a tranche), `withdraw` ~96k,
`refund` ~64k, `finalize` ~80k, `claimTokens` ~103k, `settle` ~101k + ~60k por investidor, `distribute` ~87k,
`claim` ~87k, `transfer` ~59k. Deploy: token ~3,05M, oferta ~3,23M, registry ~1,2M.

### Compilador offline

`binaries.soliditylang.org` não é acessível no nosso ambiente, então `hardhat.config.ts` substitui a
subtask `TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD` para usar `solc/soljson.js` do pacote npm `solc@0.8.28`
(fixado). O bytecode é o mesmo do solc nativo `0.8.28+commit.7893614a` (gravado como `longVersion`),
então a verificação no BscScan funciona normalmente.

## Deploy na BSC

1. `cp .env.example .env` e preencha (nunca versione o `.env`):
   - `DEPLOYER_PRIVATE_KEY` — carteira **nova**, só com o BNB do gás.
   - `BSC_TESTNET_RPC_URL` / `BSC_RPC_URL` — de preferência um provedor dedicado.
   - `ADMIN_ADDRESS` — **Safe multisig** (obrigatório na mainnet; o script recusa endereço sem código, salvo `ALLOW_EOA_ADMIN=true`).
   - `TREASURY_ADDRESS` — tesouraria da SPE (obrigatório na mainnet; `treasury` por usina em `config/plants.json` sobrepõe).
   - `DISTRIBUTOR_ADDRESS`, `COMPLIANCE_ADDRESS` — padrão: `ADMIN_ADDRESS`. O `COMPLIANCE_ADDRESS`
     recebe só o `COMPLIANCE_ROLE` do `IdentityRegistry` (nenhum papel nos tokens).
   - `PAYMENT_TOKEN_ADDRESS` — vazio = MockUSDT (testnet) / USDT oficial `0x55d3…7955` (mainnet; o script confere `symbol == USDT` e 18 casas). Na mainnet, qualquer endereço diferente do USDT oficial é recusado, salvo `ALLOW_CUSTOM_PAYMENT_TOKEN=true`.
2. Revise `config/plants.json` (preço em USDT, caps, datas ISO ou relativas `+1d`/`+60d`).
3. Ensaie localmente: `npm run deploy:local` (rede in-process; não grava no front).
4. Testnet: `npm run deploy:testnet`. Mainnet: `npm run deploy:mainnet`.

O script:
- implanta `IdentityRegistry`, o token de pagamento (MockUSDT só fora da mainnet) e, por usina,
  `UFVPlantToken` + `UFVOffering`;
- fixa o emissor do token com `setMinter(oferta)` (uma única vez, imutável) e concede `DISTRIBUTOR_ROLE`,
  `PAUSER_ROLE` e `DOCUMENT_ROLE` (este **só** ao `ADMIN_ADDRESS`), além do `COMPLIANCE_ROLE` do registro;
- se `ADMIN_ADDRESS` ≠ deployer, inicia `beginDefaultAdminTransfer(ADMIN_ADDRESS)` em todos os
  contratos (o deployer nunca recebe papéis operacionais);
- grava `deployments/<chainId>.json` (endereços, argumentos de construtor, txs — **versione** para 97/56)
  e mescla `../web/src/data/deployments.json` (formato do front, preservando outras redes);
- é **retomável**: se cair no meio, rode de novo — o que já está no registro é reaproveitado
  (`FORCE_REDEPLOY=true` refaz tudo; `PLANTS=slug1,slug2` limita as usinas).

5. **Entregar o admin à Safe:** após 2 dias, `npm run admin:accept -- --network bsc` gera
   `deployments/56-accept-admin.json`; importe em *Safe{Wallet} → Apps → Transaction Builder* e execute
   (chama `acceptDefaultAdminTransfer()` em cada contrato). Confira com `npm run admin:status`.

## Verificação no BscScan

```bash
ETHERSCAN_API_KEY=... npm run verify -- --network bscTestnet   # ou --network bsc
```

Usa a API v2 do Etherscan (multichain — uma chave serve para BSC e BSC testnet) e os argumentos de
construtor gravados em `deployments/<chainId>.json`. Para verificar um contrato manualmente:
`npx hardhat verify --network bsc <endereço> <args…>` (a oferta recebe uma struct: use o script).
Configuração do compilador para verificação manual: `v0.8.28+commit.7893614a`, otimização 200 runs,
EVM `cancun`, licença conforme o SPDX dos arquivos.

## Operação (scripts de admin)

Todos leem endereços de `deployments/<chainId>.json` (ou do `deployments.json` do front) e recebem
parâmetros por variáveis de ambiente (`hardhat run` não aceita argumentos):

| Comando | Para quê | Papel exigido |
|---|---|---|
| `ADDRESSES=0x..,0x.. COUNTRY=76 DAYS=365 npm run admin:kyc -- --network bscTestnet` | aprovar KYC (`REMOVE=true` remove) | COMPLIANCE |
| `PLANT=ufv-janauba-1 AMOUNT=31234.56 PERIOD=2027-03 npm run admin:distribute -- --network …` | depositar receita do mês (recusa período repetido sem `ALLOW_DUPLICATE_PERIOD=true`) | DISTRIBUTOR |
| `PLANT=… NAME=AUDIT-2027-Q1 URI=ipfs://… FILE=./relatorio.pdf npm run admin:document -- --network …` | publicar relatório com SHA-256 do PDF (se a chave local não tiver `DOCUMENT_ROLE`, o script recusa e imprime o hash para a Safe) | DOCUMENT_ROLE (Safe) |
| `PLANT=… BATCH=100 npm run admin:finalize -- --network …` | finalizar e entregar as cotas em lotes | admin (finalize) |
| `npm run admin:accept -- --network …` | lote do Transaction Builder para a Safe aceitar o admin | — |
| `npm run admin:status -- --network …` | resumo on-chain das ofertas/tokens | — |
| `ADDRESSES=… AMOUNT=500000 npm run admin:mock-mint -- --network bscTestnet` | tUSDT para testadores | owner do MockUSDT |

Quando o papel está numa Safe, faça a mesma chamada pelo Transaction Builder (ABI em `artifacts/`).
Recomenda-se nomear cada relatório de auditoria com um `name` distinto (`AUDIT-2027-Q1`, …) para manter
o histórico consultável on-chain; o investidor confere o PDF com `sha256sum relatorio.pdf`.

## Integração com o front

- `npm run export:abi` gera **`../web/src/lib/web3/abi.ts`** a partir dos artefatos:
  `identityRegistryAbi`, `plantTokenAbi`, `offeringAbi`, `erc20Abi` (balanceOf, allowance, approve,
  decimals, symbol, transfer + eventos/erros ERC-20), `mockUsdtAbi`, além de `offeringStates`
  (ordem do enum) e `roles` (hashes). Tudo `as const` para viem/wagmi. `offeringAbi` inclui os erros
  que podem vir de chamadas internas (token, ERC-20 do pagamento) para o viem decodificar o motivo.
- O deploy grava **`../web/src/data/deployments.json`** no formato
  `{ "<chainId>": { identityRegistry, paymentToken, paymentTokenDecimals, plants: { <slug>: { token, offering } } } }`.
  Deploys em `31337` não são gravados ali (a menos que `WRITE_WEB_DEPLOYMENTS=true`).
- Valores: `pricePerCota`/`totalRaised`/receita em unidades mínimas do USDT (18 casas na BSC — leia
  `paymentTokenDecimals`); cotas são inteiros (decimals 0); tempos em segundos Unix.

## Checklist de segurança

- [x] Solidity 0.8.28 fixo (aritmética checada), OpenZeppelin 5.6.1, sem `delegatecall`, sem proxies, sem `selfdestruct`.
- [x] Erros customizados e eventos em toda mudança de estado.
- [x] `ReentrancyGuard` em toda função que move fundos; checks-effects-interactions (inclusive `settle`, que marca tudo antes de emitir).
- [x] `SafeERC20` em todas as transferências; valor recebido conferido (rejeita fee-on-transfer) em `commit` e `distribute`.
- [x] Escrow: dinheiro só sai para o próprio investidor ou para a tesouraria imutável, uma vez; `finalize` só após fechar todas as janelas de desistência.
- [x] Desistência, reembolso e entrega de cotas não são pausáveis; `finalize` vira permissionless após 30 dias; sem finalização até `finalizeDeadline()` a oferta vira `Failed` (escrow nunca congela).
- [x] Desistência por tranche e sem reaporte após desistir: segurar o hardcap de graça com carteiras KYC não funciona.
- [x] Emissor do token fixado uma única vez e imutável (`setMinter`); documentos só com `DOCUMENT_ROLE` (Safe).
- [x] Deploy na mainnet só com o USDT BEP-20 oficial (salvo opt-in explícito).
- [x] Sem dupla emissão (`settled`), sem duplo reembolso (`paid = 0`), sem duplo `finalize`.
- [x] KYC vencido após o aporte não trava a liquidação.
- [x] Arredondamento a favor da solvência (Σ saques ≤ distribuído), testado com invariante aleatório.
- [x] Admin com transferência em 2 etapas + atraso; deploy entrega o admin à Safe; deployer sem papéis operacionais.
- [x] Testes de controle de acesso em todas as funções privilegiadas; ataques de reentrância simulados com token malicioso.
- [ ] **Auditoria externa** antes da mainnet.
- [ ] Timelock na frente da Safe para `recover`/papéis.
- [ ] Monitoramento (ex.: OpenZeppelin Defender/Forta/Tenderly) de `RoleGranted`, `WalletRecovered`, `Paused`, `InvestorSet` e `DefaultAdminTransferScheduled`.
- [ ] Revisão jurídica do fluxo (CVM 88: limites por investidor, plataforma registrada, informações essenciais).

## Análise estática (Slither)

`slither . --compile-force-framework hardhat --hardhat-ignore-compile --filter-paths "node_modules|src/mocks"`
(Slither 0.11.6 sobre o build-info do Hardhat; rode `npx hardhat compile --force` antes para não
misturar build-infos antigos). Resultado após as correções da auditoria: **0 alta/média**; 16
informativos, todos aceitos:

- `timestamp` — comparações com `block.timestamp` (janelas de dias; desvio de segundos dos validadores é irrelevante);
- `calls-loop` — `settle` emite em loop para o token (contrato confiável e imutável; o mint não checa
  KYC nem chama hooks, então nenhum investidor consegue travar o lote; lotes limitados por `maxInvestors`);
- `incorrect-equality` — checagens `cotas == 0` (posição vazia) em `withdrawableOf`/`tranchesOf` e a
  sentinela `== 0` no `MockUSDT` (testnet);
- `cyclomatic-complexity` (validação do construtor da oferta) e `naming-convention` (`MINTER_ROLE()` segue o padrão OZ).

## Limitações conhecidas

- **Quem desiste não reaporta:** um endereço que exerceu a desistência (mesmo parcial) não pode
  aportar de novo na mesma oferta. É o preço de impedir o ataque de reciclagem do hardcap (M-01);
  o investidor que mudar de ideia de novo precisa de outra oferta.
- **Desistência por tranche:** cada aporte tem a sua janela de 5 dias; o custo de `withdraw` cresce
  com o número de tranches ainda na janela do próprio investidor (só ele paga).
- **Mínimo por aporte** (`minCotas`), não por posição; exceção para completar exatamente o hardcap.
- **Cotas não vendidas não existem:** se a oferta vender menos que `maxSupply`, a receita é dividida
  só entre as cotas vendidas. Se a SPE/patrocinador deve reter parte, ela precisa aportar como
  investidora (ou o desenho do token precisa mudar antes do deploy).
- **Uma carteira = uma identidade**; não há agrupamento de várias carteiras por investidor (ERC-3643
  completo tem), então limites por investidor podem ser contornados com várias carteiras KYC — o
  backend de KYC deve aprovar uma carteira por CPF/CNPJ.
- **Sem congelamento parcial / transferência forçada** além do `recover`; sem limite de número de titulares.
- **Reembolso de investidor sancionado** após o aporte: não há função para expulsar um investidor
  específico; a alternativa é `cancel()` (reembolsa todos) ou tratar fora da cadeia antes de finalizar.
- **`setMinter` é irreversível:** se for chamado com o endereço errado, o token nunca poderá ser
  emitido por aquela oferta (ela não finaliza e o escrow volta por `cancel` ou após `finalizeDeadline`);
  é preciso implantar um token novo. O script de deploy faz isso automaticamente e confere na retomada.
- `claim` exige KYC vigente e é pausável — a receita nunca se perde, mas fica retida enquanto isso.
- Poeira de arredondamento (≤ 10⁻¹⁸ USDT por titular por evento) fica no contrato.
- Deploy na mainnet depende de a Safe aceitar o admin; até lá (≥ 2 dias) o deployer é admin.
- O USDT na BSC (Binance-Peg BSC-USD) é um token custodial de terceiros (emissor pode pausar/alterar) —
  risco de contraparte fora do controle destes contratos.

## Auditoria externa

Antes de qualquer captação real: contratar **auditoria independente** (ex.: OpenZeppelin, Trail of Bits,
ConsenSys Diligence, Spearbit/Cantina ou um concurso Code4rena/Sherlock), com escopo
`src/IdentityRegistry.sol`, `src/UFVPlantToken.sol`, `src/UFVOffering.sol` e os scripts de deploy;
congelar o código no commit auditado, publicar o relatório (e o hash dele via `setDocument`) e
verificar os contratos no BscScan. Considerar também verificação formal do invariante de receita e um
programa de bug bounty (ex.: Immunefi) após o lançamento.

## Correções da auditoria independente

Provas em `test/Audit.test.ts` (cada ataque é reproduzido e agora falha):

| ID | Achado | Correção |
|---|---|---|
| M-01 | Carteiras KYC enchiam o hardcap na abertura, desistiam e reaportavam no mesmo bloco antes de cada janela fechar (oferta presa em `Succeeded`, captação bloqueada) e saíam em massa após o fim, de graça; uma recarga de 1 cota reabria a desistência da posição inteira. | Desistência **por tranche** (só aportes com < 5 dias voltam; os antigos ficam em escrow) e **sem reaporte após desistir** (`RecommitAfterWithdrawal`). Views `withdrawableOf`, `tranchesOf`, `hasWithdrawn`. |
| M-02 | O admin podia se conceder `MINTER_ROLE`, emitir o supply não vendido para si (diluição) ou impedir a entrega depois de o dinheiro ir à tesouraria. | `setMinter` uma única vez; `MINTER_ROLE` administrado por `MINTER_ADMIN_ROLE`, que ninguém possui. `grantRole`/`revokeRole` de `MINTER_ROLE` são impossíveis. |
| M-03 | A hot wallet de KYC (COMPLIANCE no token) podia trocar/apagar o hash dos relatórios de auditoria. | `DOCUMENT_ROLE` dedicado, concedido só ao admin (Safe); o token não tem mais `COMPLIANCE_ROLE`. |
| M-04 | Retomar um deploy interrompido no hand-off deixava o deployer como admin. | `handOff` idempotente também para usinas já implantadas. |
| L-01 | Oferta `Succeeded` impossível de finalizar congelava o escrow (só o `cancel` do admin destravava). | Após `finalizeDeadline()` (`endTime + janela + 2 × 30 dias`) sem finalizar, `state()` = `Failed` → `refund`. Ancorado em `endTime` para o estado ser monotônico. |
| I-03 | Deploy na mainnet aceitava qualquer `PAYMENT_TOKEN_ADDRESS`. | Só o USDT BEP-20 oficial, salvo `ALLOW_CUSTOM_PAYMENT_TOKEN=true`. |

