// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {AccessControlDefaultAdminRules} from
    "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/**
 * @title IdentityRegistry — lista de carteiras habilitadas (KYC/AML) da UFV Invest
 * @notice Registro on-chain e mínimo das carteiras que passaram pelo KYC/AML da plataforma.
 *         Nenhum dado pessoal vai para a blockchain: só a carteira, o país (ISO 3166-1 numérico)
 *         e a data de validade do KYC. O dossiê do investidor fica off-chain com a plataforma.
 *
 *         Uma carteira está "verificada" enquanto `block.timestamp < expiresAt`. Os tokens de
 *         cotas (`UFVPlantToken`) exigem as duas pontas verificadas em toda transferência, e a
 *         oferta (`UFVOffering`) exige o investidor verificado para aportar.
 *
 * @dev Papéis:
 *      - `DEFAULT_ADMIN_ROLE` (único, com regras de transferência em 2 etapas e atraso de
 *        `ADMIN_TRANSFER_DELAY`): concede/revoga `COMPLIANCE_ROLE`. Deve ser uma Safe multisig.
 *      - `COMPLIANCE_ROLE`: cadastra, atualiza e remove investidores. Pode ser a carteira do
 *        backend de KYC; uma chave comprometida permite habilitar/desabilitar carteiras (mas não
 *        mover tokens nem fundos), por isso o admin deve monitorar e revogar se necessário.
 *
 *      Contrato não atualizável (sem proxy) de propósito: mais simples de auditar e confiar.
 */
contract IdentityRegistry is IIdentityRegistry, AccessControlDefaultAdminRules {
    /// @notice Papel do time de compliance/KYC.
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    /// @notice Atraso inicial para trocar o `DEFAULT_ADMIN_ROLE` (pode ser alterado pelo admin, também com atraso).
    uint48 public constant ADMIN_TRANSFER_DELAY = 2 days;

    struct Investor {
        bool registered;
        uint16 country;
        uint64 expiresAt;
    }

    mapping(address wallet => Investor) private _investors;

    /// @notice Emitido ao cadastrar ou atualizar uma carteira.
    event InvestorSet(address indexed wallet, uint16 country, uint64 expiresAt, address indexed operator);
    /// @notice Emitido ao remover uma carteira.
    event InvestorRemoved(address indexed wallet, address indexed operator);

    error ZeroAddress();
    error InvalidCountry();
    /// @dev `expiresAt` precisa estar no futuro; para revogar use `removeInvestor`.
    error InvalidExpiry(uint64 expiresAt);
    error LengthMismatch();
    error EmptyBatch();
    error NotRegistered(address wallet);

    /**
     * @param admin Admin inicial (`DEFAULT_ADMIN_ROLE`). Em produção, uma Safe multisig — ou o
     *        deployer, que depois inicia a transferência para a Safe (ver README).
     */
    constructor(address admin) AccessControlDefaultAdminRules(ADMIN_TRANSFER_DELAY, admin) {}

    // ─── Escrita (COMPLIANCE_ROLE) ──────────────────────────────────────────────────────────

    /**
     * @notice Cadastra ou atualiza uma carteira habilitada.
     * @param wallet Carteira do investidor.
     * @param country Código ISO 3166-1 numérico (ex.: 76 = Brasil). Não pode ser 0.
     * @param expiresAt Validade do KYC (timestamp Unix, segundos); deve estar no futuro.
     */
    function setInvestor(address wallet, uint16 country, uint64 expiresAt) external onlyRole(COMPLIANCE_ROLE) {
        _setInvestor(wallet, country, expiresAt);
    }

    /// @notice Versão em lote de `setInvestor` (arrays do mesmo tamanho).
    function setInvestors(address[] calldata wallets, uint16[] calldata countries, uint64[] calldata expiries)
        external
        onlyRole(COMPLIANCE_ROLE)
    {
        uint256 n = wallets.length;
        if (n == 0) revert EmptyBatch();
        if (countries.length != n || expiries.length != n) revert LengthMismatch();
        for (uint256 i; i < n; ++i) {
            _setInvestor(wallets[i], countries[i], expiries[i]);
        }
    }

    /// @notice Remove uma carteira (revoga o KYC imediatamente).
    function removeInvestor(address wallet) external onlyRole(COMPLIANCE_ROLE) {
        if (!_investors[wallet].registered) revert NotRegistered(wallet);
        delete _investors[wallet];
        emit InvestorRemoved(wallet, msg.sender);
    }

    // ─── Leitura ────────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IIdentityRegistry
    function isVerified(address wallet) external view returns (bool) {
        Investor memory inv = _investors[wallet];
        return inv.registered && block.timestamp < inv.expiresAt;
    }

    /// @inheritdoc IIdentityRegistry
    function investorOf(address wallet) external view returns (bool registered, uint16 country, uint64 expiresAt) {
        Investor memory inv = _investors[wallet];
        return (inv.registered, inv.country, inv.expiresAt);
    }

    // ─── Interno ────────────────────────────────────────────────────────────────────────────

    function _setInvestor(address wallet, uint16 country, uint64 expiresAt) private {
        if (wallet == address(0)) revert ZeroAddress();
        if (country == 0) revert InvalidCountry();
        if (expiresAt <= block.timestamp) revert InvalidExpiry(expiresAt);
        _investors[wallet] = Investor({registered: true, country: country, expiresAt: expiresAt});
        emit InvestorSet(wallet, country, expiresAt, msg.sender);
    }
}
