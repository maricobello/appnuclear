// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControlDefaultAdminRules} from
    "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";
import {IUFVPlantToken} from "./interfaces/IUFVPlantToken.sol";

/**
 * @title UFVOffering — oferta primária de cotas com escrow, meta mínima e direito de desistência
 * @notice Inspirada na Resolução CVM 88 (crowdfunding de investimento):
 *         - o dinheiro dos investidores fica em escrow neste contrato até o encerramento;
 *         - o investidor pode desistir (`withdraw`) em até `withdrawalWindow` (ex.: 5 dias) após o
 *           seu aporte MAIS RECENTE, recebendo de volta TODA a sua posição (simplificação: não há
 *           desistência parcial por aporte);
 *         - se a meta mínima (`softCapCotas`) não for atingida, ou se a oferta for cancelada, cada
 *           investidor saca o valor integral (`refund`);
 *         - se a oferta tiver sucesso, `finalize` envia os recursos à tesouraria da SPE e as cotas
 *           são entregues (`settle` em lotes, permissionless, ou `claimTokens` individual).
 *
 *         Estados (`state()`), derivados de tempo, vendas e flags:
 *         - `Pending`: antes de `startTime`;
 *         - `Active`: entre `startTime` e `endTime` (inclusive) e abaixo do hardcap — aceita aportes;
 *         - `Succeeded`: hardcap atingido, ou `endTime` passou com `cotasSold ≥ softCapCotas`;
 *           ainda não finalizada. Desistências dentro da janela continuam possíveis e podem levar a
 *           oferta de volta para `Active` (antes do fim) ou para `Failed` (depois do fim);
 *         - `Failed`: `endTime` passou com `cotasSold < softCapCotas` — reembolsos liberados;
 *         - `Finalized`: recursos enviados à tesouraria; cotas sendo/entregues;
 *         - `Cancelled`: cancelada pelo admin antes de finalizar — reembolsos liberados.
 *
 * @dev Regra de finalização: só quando NENHUM investidor ainda pode desistir, isto é,
 *      `block.timestamp > withdrawalsCloseAt()`, onde `withdrawalsCloseAt()` é
 *      `endTime + withdrawalWindow`, ou `latestCommitAt + withdrawalWindow` se o hardcap foi atingido
 *      (encerramento antecipado). Antes de liberar o dinheiro, verifica que esta oferta consegue
 *      emitir as cotas (tem `MINTER_ROLE`, emissão aberta e `maxSupply` suficiente).
 *
 *      `finalize` é do admin; se o admin não agir em `FINALIZE_GRACE_PERIOD` após o fim das
 *      desistências, qualquer pessoa pode finalizar (o dinheiro nunca fica preso em escrow).
 *
 *      Pausa (`PAUSER_ROLE`) bloqueia só novos aportes. Desistência, reembolso, finalização e
 *      entrega de cotas nunca são pausáveis — são direitos do investidor.
 *
 *      `cotasSold`, `totalRaised` e `investorCount` refletem as posições em escrow: caem com
 *      desistências e reembolsos (após falha/cancelamento caem até zero à medida que os
 *      investidores sacam). Depois de `Finalized` ficam fixos como registro.
 *
 *      O token de pagamento não pode cobrar taxa na transferência (o valor recebido é conferido).
 */
contract UFVOffering is AccessControlDefaultAdminRules, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        Pending,
        Active,
        Succeeded,
        Failed,
        Finalized,
        Cancelled
    }

    /// @notice Parâmetros de construção.
    struct Config {
        IUFVPlantToken token;
        IERC20 paymentToken;
        address treasury;
        /// @dev em unidades mínimas do token de pagamento (USDT BEP-20 tem 18 casas)
        uint256 pricePerCota;
        uint256 minCotas;
        uint256 maxCotasPerInvestor;
        uint256 softCapCotas;
        uint256 hardCapCotas;
        uint64 startTime;
        uint64 endTime;
        uint64 withdrawalWindow;
        address admin;
    }

    struct Commitment {
        uint256 cotas;
        uint256 paid;
        uint64 lastCommitAt;
        bool settled;
        bool refunded;
    }

    // ─── Constantes ─────────────────────────────────────────────────────────────────────────

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint48 public constant ADMIN_TRANSFER_DELAY = 2 days;
    uint64 public constant MAX_WITHDRAWAL_WINDOW = 30 days;
    /// @notice Prazo após o fim das desistências a partir do qual qualquer um pode finalizar.
    uint64 public constant FINALIZE_GRACE_PERIOD = 30 days;

    // ─── Configuração imutável ──────────────────────────────────────────────────────────────

    IUFVPlantToken public immutable token;
    IERC20 public immutable paymentToken;
    IIdentityRegistry public immutable identityRegistry;
    address public immutable treasury;
    uint256 public immutable pricePerCota;
    uint256 public immutable minCotas;
    uint256 public immutable maxCotasPerInvestor;
    uint256 public immutable softCapCotas;
    uint256 public immutable hardCapCotas;
    uint64 public immutable startTime;
    uint64 public immutable endTime;
    uint64 public immutable withdrawalWindow;

    // ─── Estado ─────────────────────────────────────────────────────────────────────────────

    /// @notice Cotas em escrow (aportadas e não desistidas/reembolsadas).
    uint256 public cotasSold;
    /// @notice Valor em escrow, em unidades do token de pagamento.
    uint256 public totalRaised;
    /// @notice Investidores com posição ativa (cotas > 0).
    uint256 public investorCount;
    /// @notice Cotas já entregues (emitidas) após a finalização.
    uint256 public cotasDelivered;
    /// @notice Próximo índice da lista de investidores a ser processado por `settle`.
    uint256 public settleCursor;
    /// @notice Timestamp do aporte mais recente de qualquer investidor.
    uint64 public latestCommitAt;
    bool public finalized;
    bool public cancelled;
    /// @notice `true` quando todas as cotas foram entregues e a emissão do token foi encerrada.
    bool public settlementCompleted;

    mapping(address investor => Commitment) private _commitments;
    address[] private _investors;
    mapping(address investor => bool) private _listed;

    // ─── Eventos ────────────────────────────────────────────────────────────────────────────

    event Committed(address indexed investor, uint256 cotas, uint256 amount, uint256 totalCotas, uint256 totalPaid);
    event Withdrawn(address indexed investor, uint256 cotas, uint256 amount);
    event Refunded(address indexed investor, uint256 cotas, uint256 amount);
    event OfferingFinalized(address indexed treasury, uint256 amount, uint256 cotasSold, address indexed operator);
    event OfferingCancelled(address indexed operator);
    event TokensDelivered(address indexed investor, uint256 cotas);
    event SettlementCompleted(uint256 totalCotas);
    event TokensRescued(address indexed asset, address indexed to, uint256 amount);

    // ─── Erros ──────────────────────────────────────────────────────────────────────────────

    error ZeroAddress();
    error ZeroAmount();
    error InvalidConfig(string reason);
    error InvalidState(State current);
    error NotVerified(address account);
    error BelowMinimum(uint256 cotas, uint256 minCotas);
    error ExceedsInvestorCap(uint256 totalCotas, uint256 maxCotasPerInvestor);
    error ExceedsHardCap(uint256 cotas, uint256 remaining);
    error TransferAmountMismatch(uint256 expected, uint256 received);
    error NoCommitment();
    error WithdrawalWindowClosed(uint256 deadline);
    error WithdrawalPeriodOpen(uint256 closesAt);
    error NothingToRefund();
    error NotFinalized();
    error AlreadySettled();
    error SettlementAlreadyCompleted();
    error OfferingNotMinter();
    error TokenMintingFinished();
    error TokenSupplyInsufficient(uint256 available, uint256 required);
    error InsufficientSurplus(uint256 requested, uint256 available);

    // ─── Construtor ─────────────────────────────────────────────────────────────────────────

    constructor(Config memory cfg) AccessControlDefaultAdminRules(ADMIN_TRANSFER_DELAY, cfg.admin) {
        if (address(cfg.token) == address(0) || address(cfg.paymentToken) == address(0) || cfg.treasury == address(0))
        {
            revert ZeroAddress();
        }
        if (address(cfg.paymentToken) == address(cfg.token)) revert InvalidConfig("paymentToken == token");
        if (cfg.pricePerCota == 0) revert InvalidConfig("pricePerCota");
        if (cfg.minCotas == 0 || cfg.minCotas > cfg.maxCotasPerInvestor) revert InvalidConfig("minCotas");
        if (cfg.softCapCotas == 0 || cfg.softCapCotas > cfg.hardCapCotas) revert InvalidConfig("softCap");
        if (cfg.maxCotasPerInvestor > cfg.hardCapCotas) revert InvalidConfig("maxCotasPerInvestor");
        if (cfg.hardCapCotas > cfg.token.maxSupply()) revert InvalidConfig("hardCap > maxSupply");
        // garante que hardCap × preço não estoura (reverte por overflow checado)
        if (cfg.hardCapCotas * cfg.pricePerCota == 0) revert InvalidConfig("hardCap");
        if (cfg.startTime >= cfg.endTime) revert InvalidConfig("startTime >= endTime");
        if (cfg.endTime <= block.timestamp) revert InvalidConfig("endTime in the past");
        if (cfg.withdrawalWindow > MAX_WITHDRAWAL_WINDOW) revert InvalidConfig("withdrawalWindow");

        IIdentityRegistry registry = cfg.token.identityRegistry();
        if (address(registry) == address(0)) revert ZeroAddress();

        token = cfg.token;
        paymentToken = cfg.paymentToken;
        identityRegistry = registry;
        treasury = cfg.treasury;
        pricePerCota = cfg.pricePerCota;
        minCotas = cfg.minCotas;
        maxCotasPerInvestor = cfg.maxCotasPerInvestor;
        softCapCotas = cfg.softCapCotas;
        hardCapCotas = cfg.hardCapCotas;
        startTime = cfg.startTime;
        endTime = cfg.endTime;
        withdrawalWindow = cfg.withdrawalWindow;
    }

    // ─── Estado derivado ────────────────────────────────────────────────────────────────────

    /// @notice Estado atual da oferta (ver cabeçalho).
    function state() public view returns (State) {
        if (cancelled) return State.Cancelled;
        if (finalized) return State.Finalized;
        if (block.timestamp < startTime) return State.Pending;
        if (cotasSold >= hardCapCotas) return State.Succeeded;
        if (block.timestamp <= endTime) return State.Active;
        return cotasSold >= softCapCotas ? State.Succeeded : State.Failed;
    }

    /**
     * @notice Último instante em que alguém ainda pode desistir. `finalize` só é possível depois
     *         dele (estritamente maior).
     */
    function withdrawalsCloseAt() public view returns (uint256) {
        uint256 base = cotasSold >= hardCapCotas ? latestCommitAt : endTime;
        return base + withdrawalWindow;
    }

    /// @notice Prazo de desistência de `investor` (0 se não tem posição).
    function withdrawalDeadline(address investor) external view returns (uint256) {
        Commitment storage c = _commitments[investor];
        if (c.cotas == 0) return 0;
        return uint256(c.lastCommitAt) + withdrawalWindow;
    }

    /// @notice Cotas ainda disponíveis até o hardcap.
    function remainingCotas() external view returns (uint256) {
        return hardCapCotas - cotasSold;
    }

    /// @notice Posição de `investor`.
    function commitmentOf(address investor)
        external
        view
        returns (uint256 cotas, uint256 paid, uint64 lastCommitAt, bool settled, bool refunded)
    {
        Commitment storage c = _commitments[investor];
        return (c.cotas, c.paid, c.lastCommitAt, c.settled, c.refunded);
    }

    /// @notice Tamanho da lista de investidores (inclui quem desistiu; usada por `settle`).
    function investorsLength() external view returns (uint256) {
        return _investors.length;
    }

    /// @notice Investidor na posição `index` da lista.
    function investorAt(uint256 index) external view returns (address) {
        return _investors[index];
    }

    // ─── Investidor ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Aporta em `cotas` cotas, pagando `cotas × pricePerCota` do token de pagamento
     *         (exige `approve` prévio). Requer KYC vigente.
     * @dev `cotas ≥ minCotas`, exceto quando completa exatamente o hardcap restante (evita sobra
     *      invendável). A posição total do investidor não pode passar de `maxCotasPerInvestor`.
     *      Cada aporte reinicia o prazo de desistência de TODA a posição do investidor.
     */
    function commit(uint256 cotas) external nonReentrant whenNotPaused {
        State current = state();
        if (current != State.Active) revert InvalidState(current);
        if (!identityRegistry.isVerified(msg.sender)) revert NotVerified(msg.sender);
        if (cotas == 0) revert ZeroAmount();

        uint256 remaining = hardCapCotas - cotasSold;
        if (cotas > remaining) revert ExceedsHardCap(cotas, remaining);
        if (cotas < minCotas && cotas != remaining) revert BelowMinimum(cotas, minCotas);

        Commitment storage c = _commitments[msg.sender];
        uint256 newCotas = c.cotas + cotas;
        if (newCotas > maxCotasPerInvestor) revert ExceedsInvestorCap(newCotas, maxCotasPerInvestor);

        uint256 cost = cotas * pricePerCota;

        // efeitos
        if (c.cotas == 0) investorCount += 1;
        if (!_listed[msg.sender]) {
            _listed[msg.sender] = true;
            _investors.push(msg.sender);
        }
        uint256 newPaid = c.paid + cost;
        c.cotas = newCotas;
        c.paid = newPaid;
        c.lastCommitAt = uint64(block.timestamp);
        cotasSold += cotas;
        totalRaised += cost;
        latestCommitAt = uint64(block.timestamp);

        // interação (com conferência do valor recebido)
        uint256 balanceBefore = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(msg.sender, address(this), cost);
        uint256 received = paymentToken.balanceOf(address(this)) - balanceBefore;
        if (received != cost) revert TransferAmountMismatch(cost, received);

        emit Committed(msg.sender, cotas, cost, newCotas, newPaid);
    }

    /**
     * @notice Desistência: devolve TODA a posição de `msg.sender` se ainda estiver dentro de
     *         `withdrawalWindow` contado do seu aporte mais recente. Não é pausável.
     */
    function withdraw() external nonReentrant {
        State current = state();
        if (current == State.Finalized || current == State.Cancelled) revert InvalidState(current);

        Commitment storage c = _commitments[msg.sender];
        uint256 cotas = c.cotas;
        if (cotas == 0) revert NoCommitment();
        uint256 deadline = uint256(c.lastCommitAt) + withdrawalWindow;
        if (block.timestamp > deadline) revert WithdrawalWindowClosed(deadline);

        uint256 paid = c.paid;
        c.cotas = 0;
        c.paid = 0;
        cotasSold -= cotas;
        totalRaised -= paid;
        investorCount -= 1;

        paymentToken.safeTransfer(msg.sender, paid);
        emit Withdrawn(msg.sender, cotas, paid);
    }

    /// @notice Reembolso integral quando a oferta falhou (`Failed`) ou foi cancelada (`Cancelled`).
    function refund() external nonReentrant {
        _refund(msg.sender);
    }

    /**
     * @notice Igual a `refund`, mas iniciado por qualquer pessoa em nome de `investor` (o valor
     *         sempre vai para o próprio `investor`). Permite à plataforma devolver a todos em lote.
     */
    function refundFor(address investor) external nonReentrant {
        _refund(investor);
    }

    /// @notice Recebe as próprias cotas após a finalização (alternativa a esperar o `settle`).
    function claimTokens() external nonReentrant {
        if (!finalized) revert NotFinalized();
        Commitment storage c = _commitments[msg.sender];
        if (c.cotas == 0) revert NoCommitment();
        if (c.settled) revert AlreadySettled();

        // efeitos
        uint256 cotas = _markDelivered(msg.sender);
        cotasDelivered += cotas;
        bool completes = _markSettlementCompletedIfDone();
        // interações
        token.mint(msg.sender, cotas);
        if (completes) token.finishMinting();
    }

    // ─── Encerramento ───────────────────────────────────────────────────────────────────────

    /**
     * @notice Encerra a oferta com sucesso: envia `totalRaised` à tesouraria (uma única vez) e
     *         libera a entrega das cotas.
     * @dev Exige `Succeeded` e `block.timestamp > withdrawalsCloseAt()`. Admin a qualquer momento
     *      depois disso; qualquer pessoa após `withdrawalsCloseAt() + FINALIZE_GRACE_PERIOD`.
     */
    function finalize() external nonReentrant {
        State current = state();
        if (current != State.Succeeded) revert InvalidState(current);
        uint256 closesAt = withdrawalsCloseAt();
        if (block.timestamp <= closesAt) revert WithdrawalPeriodOpen(closesAt);
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender) && block.timestamp <= closesAt + FINALIZE_GRACE_PERIOD) {
            revert AccessControlUnauthorizedAccount(msg.sender, DEFAULT_ADMIN_ROLE);
        }

        // só libera o dinheiro se as cotas puderem ser entregues
        if (!token.hasRole(token.MINTER_ROLE(), address(this))) revert OfferingNotMinter();
        if (token.mintingFinished()) revert TokenMintingFinished();
        uint256 available = token.maxSupply() - token.totalSupply();
        if (cotasSold > available) revert TokenSupplyInsufficient(available, cotasSold);

        finalized = true;
        uint256 amount = totalRaised;
        paymentToken.safeTransfer(treasury, amount);
        emit OfferingFinalized(treasury, amount, cotasSold, msg.sender);
    }

    /**
     * @notice Entrega as cotas a até `maxInvestors` investidores da lista, a partir de
     *         `settleCursor`. Permissionless; quem já recebeu (inclusive via `claimTokens`) é pulado.
     *         Ao entregar a última cota, encerra a emissão do token (`finishMinting`).
     * @return delivered Cotas entregues nesta chamada.
     */
    function settle(uint256 maxInvestors) external nonReentrant returns (uint256 delivered) {
        if (!finalized) revert NotFinalized();
        if (settlementCompleted) revert SettlementAlreadyCompleted();
        if (maxInvestors == 0) revert ZeroAmount();

        uint256 cursor = settleCursor;
        uint256 end = cursor + maxInvestors;
        uint256 length = _investors.length;
        if (end > length) end = length;
        uint256 n = end - cursor;

        // efeitos (checks-effects-interactions estrito: nada de estado depois dos mints)
        settleCursor = end;
        address[] memory recipients = new address[](n);
        uint256[] memory amounts = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            address investor = _investors[cursor + i];
            uint256 cotas = _markDelivered(investor);
            recipients[i] = investor;
            amounts[i] = cotas;
            delivered += cotas;
        }
        cotasDelivered += delivered;
        bool completes = _markSettlementCompletedIfDone();

        // interações: só emite para o token (contrato confiável, imutável); o mint não checa KYC,
        // então nenhum investidor consegue travar o lote
        for (uint256 i; i < n; ++i) {
            if (amounts[i] > 0) token.mint(recipients[i], amounts[i]);
        }
        if (completes) token.finishMinting();
    }

    /// @notice Cancela a oferta (antes de finalizar). Libera reembolso integral a todos.
    function cancel() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (finalized) revert InvalidState(State.Finalized);
        if (cancelled) revert InvalidState(State.Cancelled);
        cancelled = true;
        emit OfferingCancelled(msg.sender);
    }

    /// @notice Pausa novos aportes.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @notice Retira tokens enviados por engano. Para o token de pagamento, só o excedente acima
     *         do valor em escrow (antes de finalizar, `totalRaised` é intocável).
     */
    function rescueTokens(IERC20 asset, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (address(asset) == address(paymentToken)) {
            uint256 reserved = finalized ? 0 : totalRaised;
            uint256 balance = paymentToken.balanceOf(address(this));
            uint256 surplus = balance > reserved ? balance - reserved : 0;
            if (amount > surplus) revert InsufficientSurplus(amount, surplus);
        }
        asset.safeTransfer(to, amount);
        emit TokensRescued(address(asset), to, amount);
    }

    // ─── Interno ────────────────────────────────────────────────────────────────────────────

    function _refund(address investor) private {
        State current = state();
        if (current != State.Failed && current != State.Cancelled) revert InvalidState(current);

        Commitment storage c = _commitments[investor];
        uint256 paid = c.paid;
        if (paid == 0) revert NothingToRefund();
        uint256 cotas = c.cotas;

        c.cotas = 0;
        c.paid = 0;
        c.refunded = true;
        cotasSold -= cotas;
        totalRaised -= paid;
        investorCount -= 1;

        paymentToken.safeTransfer(investor, paid);
        emit Refunded(investor, cotas, paid);
    }

    /// @dev Marca a entrega das cotas de `investor` (uma única vez) e retorna quantas emitir.
    function _markDelivered(address investor) private returns (uint256 cotas) {
        Commitment storage c = _commitments[investor];
        cotas = c.cotas;
        if (cotas == 0 || c.settled) return 0;
        c.settled = true;
        emit TokensDelivered(investor, cotas);
    }

    /// @dev Marca a liquidação como concluída quando todas as cotas vendidas foram entregues.
    function _markSettlementCompletedIfDone() private returns (bool completes) {
        if (!settlementCompleted && cotasDelivered == cotasSold) {
            settlementCompleted = true;
            emit SettlementCompleted(cotasDelivered);
            return true;
        }
        return false;
    }
}
