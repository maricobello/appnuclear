// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControlDefaultAdminRules} from
    "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/**
 * @title UFVPlantToken — cotas de uma usina fotovoltaica (1 token = 1 cota)
 * @notice Token ERC-20 com transferência restrita a carteiras com KYC válido (inspirado no
 *         ERC-3643, versão enxuta), distribuição de receita em USDT proporcional às cotas
 *         (modelo "funds-distribution token", ERC-2222), registro de documentos (ERC-1643) para
 *         publicar o hash SHA-256 dos relatórios de auditoria, e recuperação de carteira perdida.
 *
 *         - `decimals() == 0`: cota é indivisível.
 *         - Toda transferência entre endereços não nulos exige `isVerified(from)` e
 *           `isVerified(to)` no `IdentityRegistry`. A emissão (mint) feita pela oferta NÃO exige KYC
 *           vigente do destinatário: o investidor foi verificado no aporte e a liquidação da oferta
 *           não pode travar se o KYC dele vencer depois (ele só não consegue transferir nem sacar
 *           receita até renovar o KYC).
 *         - Receita: o `DISTRIBUTOR_ROLE` deposita USDT com `distribute`; cada carteira acumula
 *           `saldo × receitaPorCota` e saca quando quiser com `claim`. A receita acumulada ANTES de
 *           uma transferência fica com quem transferiu.
 *
 * @dev PRESSUPOSTOS DE CONFIANÇA (leia antes de investir/auditar):
 *      - `DEFAULT_ADMIN_ROLE` é poderoso: concede/revoga papéis (exceto `MINTER_ROLE`), pode
 *        `recover` (mover saldo e receita pendente de qualquer carteira para outra carteira
 *        verificada — exigido para valores mobiliários, mas é uma permissão de custódia) e retirar
 *        tokens enviados por engano (`rescueTokens`, que NUNCA toca a receita reservada aos
 *        investidores). Por isso o admin
 *        DEVE ser uma Safe multisig (recomendado: ≥ 3 de 5, signatários independentes) e, de
 *        preferência, atrás de um timelock para `recover`. A troca de admin é em 2 etapas com
 *        atraso (`AccessControlDefaultAdminRules`).
 *      - EMISSOR ÚNICO E IMUTÁVEL: o `MINTER_ROLE` é definido uma única vez com `setMinter` (a
 *        oferta) e é administrado por `MINTER_ADMIN_ROLE`, que ninguém possui nem pode receber —
 *        portanto nem o admin consegue conceder, revogar ou trocar o emissor depois. Ninguém além
 *        da oferta emite cotas, e ninguém impede a oferta de entregá-las.
 *      - DOCUMENTOS: só `DOCUMENT_ROLE` (a Safe) publica/remove relatórios; a carteira de KYC não.
 *      - O `IdentityRegistry` é confiável: quem controla o `COMPLIANCE_ROLE` de lá decide quem
 *        pode transferir e sacar receita.
 *      - `PAUSER_ROLE` pode pausar transferências, distribuições e saques de receita (não pausa
 *        emissão pela oferta nem `recover`). A receita nunca se perde durante a pausa: só fica
 *        acumulada.
 *      - Contrato imutável (sem proxy). Sem função de queima.
 *
 *      MATEMÁTICA DA RECEITA (ver README): `magnifiedRevenuePerShare` acumula
 *      `amount × 2^128 / totalSupply` a cada distribuição (o resto da divisão é carregado para a
 *      próxima). Cada conta tem uma correção `int256` ajustada em todo mint/transferência para que
 *      `acumulado(conta) = (mRPS × saldo + correção) / 2^128` não mude com a movimentação de saldo.
 *      Arredondamento é sempre para baixo, então `Σ sacado + Σ sacável ≤ totalDistributed`; a
 *      sobra ("poeira") é < 1 unidade mínima do USDT por titular e permanece no contrato.
 */
contract UFVPlantToken is ERC20, AccessControlDefaultAdminRules, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;
    using SafeCast for int256;

    // ─── Papéis e constantes ────────────────────────────────────────────────────────────────

    /// @notice Emite cotas. Concedido uma única vez, via `setMinter`, ao contrato da oferta.
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    /// @notice Papel-administrador do `MINTER_ROLE`. NINGUÉM o possui e ele administra a si mesmo,
    ///         então `grantRole`/`revokeRole` de `MINTER_ROLE` são impossíveis para sempre.
    bytes32 public constant MINTER_ADMIN_ROLE = keccak256("MINTER_ADMIN_ROLE");
    /// @notice Deposita a receita da SPE para distribuição (tesouraria/multisig da SPE).
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    /// @notice Pausa/despausa transferências, distribuições e saques.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @notice Publica/remove documentos (relatórios de auditoria). Deve ficar só com a Safe do admin.
    bytes32 public constant DOCUMENT_ROLE = keccak256("DOCUMENT_ROLE");

    /// @notice Atraso inicial para trocar o `DEFAULT_ADMIN_ROLE`.
    uint48 public constant ADMIN_TRANSFER_DELAY = 2 days;
    /// @notice Fator de magnificação da receita por cota (precisão de 128 bits).
    uint256 public constant MAGNITUDE = 2 ** 128;

    // ─── Configuração imutável ──────────────────────────────────────────────────────────────

    /// @notice Número máximo de cotas que podem existir.
    uint256 public immutable maxSupply;
    /// @notice Registro de KYC consultado em toda transferência e saque de receita.
    IIdentityRegistry public immutable identityRegistry;
    /// @notice Token em que a receita é paga (USDT BEP-20).
    IERC20 public immutable payoutToken;

    // ─── Estado ─────────────────────────────────────────────────────────────────────────────

    /// @notice `true` depois de `finishMinting` (irreversível). Distribuições só depois disso.
    bool public mintingFinished;
    /// @notice Único emissor (a oferta), definido uma vez por `setMinter`; zero até lá.
    address public minter;

    /// @notice Total de `payoutToken` já depositado via `distribute`.
    uint256 public totalDistributed;
    /// @notice Total de `payoutToken` já sacado pelos investidores via `claim`.
    uint256 public totalClaimed;

    uint256 private _magnifiedRevenuePerShare;
    uint256 private _magnifiedRemainder;
    mapping(address account => int256) private _magnifiedCorrections;
    mapping(address account => uint256) private _claimed;
    mapping(bytes32 periodRef => uint256) private _revenueByPeriod;

    struct Document {
        string uri;
        bytes32 documentHash;
        uint64 timestamp;
    }

    mapping(bytes32 name => Document) private _documents;
    bytes32[] private _documentNames;
    /// @dev posição em `_documentNames` + 1 (0 = inexistente)
    mapping(bytes32 name => uint256) private _documentPosition;

    // ─── Eventos ────────────────────────────────────────────────────────────────────────────

    event MinterSet(address indexed minter, address indexed operator);
    event MintingFinished(uint256 totalSupply);
    event RevenueDistributed(
        address indexed distributor, bytes32 indexed periodRef, uint256 amount, uint256 magnifiedRevenuePerShare
    );
    event RevenueClaimed(address indexed account, uint256 amount);
    /// @dev Assinatura compatível com ERC-1643.
    event DocumentUpdated(bytes32 indexed name, string uri, bytes32 documentHash);
    /// @dev Assinatura compatível com ERC-1643.
    event DocumentRemoved(bytes32 indexed name, string uri, bytes32 documentHash);
    event WalletRecovered(
        address indexed lostWallet,
        address indexed newWallet,
        uint256 balance,
        uint256 pendingRevenue,
        address indexed operator
    );
    event TokensRescued(address indexed asset, address indexed to, uint256 amount);

    // ─── Erros ──────────────────────────────────────────────────────────────────────────────

    error ZeroAddress();
    error ZeroAmount();
    error InvalidMaxSupply();
    error NotVerified(address account);
    error MaxSupplyExceeded(uint256 requestedSupply, uint256 maxSupply);
    error MintingAlreadyFinished();
    error MinterAlreadySet(address minter);
    error MintingNotFinished();
    error NoSupply();
    error TransferAmountMismatch(uint256 expected, uint256 received);
    error NothingToClaim();
    error InvalidDocumentName();
    error EmptyDocumentUri();
    error DocumentNotFound(bytes32 name);
    error InvalidRecovery();
    error NothingToRecover();
    error InsufficientSurplus(uint256 requested, uint256 available);

    // ─── Construtor ─────────────────────────────────────────────────────────────────────────

    /**
     * @param name_ Nome do token (ex.: "Cota UFV Janaúba I").
     * @param symbol_ Símbolo (ex.: "UFVJAN1").
     * @param maxSupply_ Total de cotas da usina.
     * @param registry_ `IdentityRegistry` (KYC).
     * @param payoutToken_ Token da receita (USDT).
     * @param admin_ Admin inicial (`DEFAULT_ADMIN_ROLE`). Ver pressupostos de confiança.
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply_,
        IIdentityRegistry registry_,
        IERC20 payoutToken_,
        address admin_
    ) ERC20(name_, symbol_) AccessControlDefaultAdminRules(ADMIN_TRANSFER_DELAY, admin_) {
        if (maxSupply_ == 0) revert InvalidMaxSupply();
        if (address(registry_) == address(0) || address(payoutToken_) == address(0)) revert ZeroAddress();
        maxSupply = maxSupply_;
        identityRegistry = registry_;
        payoutToken = payoutToken_;
        // MINTER_ROLE fica sob um papel que ninguém tem e que só ele mesmo administra
        _setRoleAdmin(MINTER_ROLE, MINTER_ADMIN_ROLE);
        _setRoleAdmin(MINTER_ADMIN_ROLE, MINTER_ADMIN_ROLE);
    }

    /// @notice Cotas são indivisíveis.
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    // ─── Emissão ────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Define o emissor (o contrato da oferta). Só `DEFAULT_ADMIN_ROLE`, UMA ÚNICA VEZ:
     *         depois disso ninguém (nem o admin) concede, revoga ou troca o `MINTER_ROLE`.
     */
    function setMinter(address minter_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (minter != address(0)) revert MinterAlreadySet(minter);
        if (minter_ == address(0)) revert ZeroAddress();
        minter = minter_;
        _grantRole(MINTER_ROLE, minter_);
        emit MinterSet(minter_, msg.sender);
    }

    /**
     * @notice Emite `amount` cotas para `to`. Só `MINTER_ROLE`, respeitando `maxSupply`, e só
     *         enquanto `mintingFinished == false`. Não exige KYC vigente de `to` (ver cabeçalho).
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (mintingFinished) revert MintingAlreadyFinished();
        if (amount == 0) revert ZeroAmount();
        uint256 newSupply = totalSupply() + amount;
        if (newSupply > maxSupply) revert MaxSupplyExceeded(newSupply, maxSupply);
        _mint(to, amount);
    }

    /**
     * @notice Encerra a emissão para sempre. Chamado pela oferta ao terminar a liquidação.
     * @dev Só `MINTER_ROLE` (a oferta, imutável): o admin não consegue encerrar a emissão antes de
     *      a oferta entregar as cotas.
     */
    function finishMinting() external onlyRole(MINTER_ROLE) {
        if (mintingFinished) revert MintingAlreadyFinished();
        mintingFinished = true;
        emit MintingFinished(totalSupply());
    }

    // ─── Receita ────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Deposita `amount` de `payoutToken` (puxado de `msg.sender`, que precisa ter dado
     *         `approve`) para distribuição proporcional entre os detentores atuais.
     * @dev Exige `mintingFinished` (ninguém que ainda vá receber cotas perde receita) e
     *      `totalSupply() > 0`. Rejeita tokens com taxa na transferência (o recebido precisa ser
     *      exatamente `amount`).
     * @param periodRef Referência livre do período (ex.: `bytes32("2027-03")`), para auditoria.
     */
    function distribute(uint256 amount, bytes32 periodRef)
        external
        onlyRole(DISTRIBUTOR_ROLE)
        whenNotPaused
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        if (!mintingFinished) revert MintingNotFinished();
        uint256 supply = totalSupply();
        if (supply == 0) revert NoSupply();

        uint256 balanceBefore = payoutToken.balanceOf(address(this));
        payoutToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = payoutToken.balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert TransferAmountMismatch(amount, received);

        uint256 magnified = amount * MAGNITUDE + _magnifiedRemainder;
        uint256 newRevenuePerShare = _magnifiedRevenuePerShare + magnified / supply;
        _magnifiedRevenuePerShare = newRevenuePerShare;
        _magnifiedRemainder = magnified % supply;
        totalDistributed += amount;
        _revenueByPeriod[periodRef] += amount;

        emit RevenueDistributed(msg.sender, periodRef, amount, newRevenuePerShare);
    }

    /**
     * @notice Saca toda a receita disponível de `msg.sender`.
     * @dev Exige KYC vigente (não se paga receita a carteira sem KYC/AML válido; a receita continua
     *      acumulada e pode ser sacada após a renovação). Bloqueado durante pausa.
     */
    function claim() external nonReentrant whenNotPaused returns (uint256 amount) {
        if (!identityRegistry.isVerified(msg.sender)) revert NotVerified(msg.sender);
        amount = claimable(msg.sender);
        if (amount == 0) revert NothingToClaim();
        // efeitos antes da interação (CEI)
        _claimed[msg.sender] += amount;
        totalClaimed += amount;
        payoutToken.safeTransfer(msg.sender, amount);
        emit RevenueClaimed(msg.sender, amount);
    }

    /// @notice Receita disponível para saque por `account`.
    function claimable(address account) public view returns (uint256) {
        return accumulativeRevenueOf(account) - _claimed[account];
    }

    /// @notice Receita já sacada por `account`.
    function claimed(address account) external view returns (uint256) {
        return _claimed[account];
    }

    /// @notice Receita total atribuída a `account` desde sempre (sacada + disponível).
    function accumulativeRevenueOf(address account) public view returns (uint256) {
        int256 magnified = (_magnifiedRevenuePerShare * balanceOf(account)).toInt256() + _magnifiedCorrections[account];
        return magnified.toUint256() / MAGNITUDE;
    }

    /// @notice Receita acumulada por cota, multiplicada por `MAGNITUDE` (2^128).
    function magnifiedRevenuePerShare() external view returns (uint256) {
        return _magnifiedRevenuePerShare;
    }

    /// @notice Total distribuído com a referência de período `periodRef`.
    function revenueByPeriod(bytes32 periodRef) external view returns (uint256) {
        return _revenueByPeriod[periodRef];
    }

    // ─── Documentos (ERC-1643) ──────────────────────────────────────────────────────────────

    /**
     * @notice Publica ou atualiza um documento (ex.: relatório de auditoria em PDF). Só `DOCUMENT_ROLE`.
     * @param name Identificador (ex.: `bytes32("AUDIT-2027-Q1")`). Use nomes distintos por
     *        relatório para manter o histórico consultável sem depender de eventos.
     * @param uri Onde o arquivo está (https/ipfs).
     * @param documentHash SHA-256 do arquivo, para o investidor conferir a integridade.
     */
    function setDocument(bytes32 name, string calldata uri, bytes32 documentHash) external onlyRole(DOCUMENT_ROLE) {
        if (name == bytes32(0)) revert InvalidDocumentName();
        if (bytes(uri).length == 0) revert EmptyDocumentUri();
        if (_documentPosition[name] == 0) {
            _documentNames.push(name);
            _documentPosition[name] = _documentNames.length;
        }
        _documents[name] = Document({uri: uri, documentHash: documentHash, timestamp: uint64(block.timestamp)});
        emit DocumentUpdated(name, uri, documentHash);
    }

    /// @notice Remove um documento do índice.
    function removeDocument(bytes32 name) external onlyRole(DOCUMENT_ROLE) {
        uint256 position = _documentPosition[name];
        if (position == 0) revert DocumentNotFound(name);
        Document memory doc = _documents[name];

        uint256 lastIndex = _documentNames.length - 1;
        if (position - 1 != lastIndex) {
            bytes32 lastName = _documentNames[lastIndex];
            _documentNames[position - 1] = lastName;
            _documentPosition[lastName] = position;
        }
        _documentNames.pop();
        delete _documentPosition[name];
        delete _documents[name];

        emit DocumentRemoved(name, doc.uri, doc.documentHash);
    }

    /// @notice Documento `name`; `timestamp == 0` se não existir.
    function getDocument(bytes32 name)
        external
        view
        returns (string memory uri, bytes32 documentHash, uint256 timestamp)
    {
        Document storage doc = _documents[name];
        return (doc.uri, doc.documentHash, doc.timestamp);
    }

    /// @notice Nomes de todos os documentos publicados.
    function getAllDocuments() external view returns (bytes32[] memory) {
        return _documentNames;
    }

    // ─── Recuperação e administração ────────────────────────────────────────────────────────

    /**
     * @notice Recupera as cotas de uma carteira perdida (ex.: investidor perdeu a seed), movendo
     *         o saldo e a receita ainda não sacada para `newWallet`.
     * @dev Só `DEFAULT_ADMIN_ROLE` — PERMISSÃO DE CUSTÓDIA: o admin precisa ser uma Safe multisig
     *      e só deve agir após verificação off-chain da identidade do investidor (processo de
     *      compliance documentado). `newWallet` precisa estar verificada. Ignora pausa e a restrição
     *      de KYC de `lostWallet`. A receita já sacada continua registrada na carteira antiga.
     *      Recomenda-se remover `lostWallet` do `IdentityRegistry` em seguida.
     */
    function recover(address lostWallet, address newWallet)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (uint256 balance, uint256 pendingRevenue)
    {
        if (lostWallet == address(0) || newWallet == address(0)) revert ZeroAddress();
        if (lostWallet == newWallet) revert InvalidRecovery();
        if (!identityRegistry.isVerified(newWallet)) revert NotVerified(newWallet);

        balance = balanceOf(lostWallet);
        pendingRevenue = claimable(lostWallet);
        if (balance == 0 && pendingRevenue == 0) revert NothingToRecover();

        // 1) move o saldo sem as checagens de KYC/pausa; a receita acumulada fica, por enquanto,
        //    na carteira perdida (mesma regra de uma transferência comum).
        if (balance > 0) _updateWithCorrections(lostWallet, newWallet, balance);

        // 2) move a receita pendente: a carteira perdida (agora com saldo 0) fica com acumulado
        //    exatamente igual ao que já sacou; todo o resto vai para a nova carteira. A soma das
        //    correções é preservada, então o invariante Σ acumulado ≤ totalDistributed se mantém.
        int256 keep = (_claimed[lostWallet] * MAGNITUDE).toInt256();
        int256 moved = _magnifiedCorrections[lostWallet] - keep;
        _magnifiedCorrections[lostWallet] = keep;
        _magnifiedCorrections[newWallet] += moved;

        emit WalletRecovered(lostWallet, newWallet, balance, pendingRevenue, msg.sender);
    }

    /**
     * @notice Retira tokens enviados por engano ao contrato. Para o `payoutToken`, só o excedente
     *         acima da receita reservada aos investidores (`totalDistributed - totalClaimed`).
     */
    function rescueTokens(IERC20 asset, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (address(asset) == address(payoutToken)) {
            uint256 reserved = totalDistributed - totalClaimed;
            uint256 balance = payoutToken.balanceOf(address(this));
            uint256 surplus = balance > reserved ? balance - reserved : 0;
            if (amount > surplus) revert InsufficientSurplus(amount, surplus);
        }
        asset.safeTransfer(to, amount);
        emit TokensRescued(address(asset), to, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ─── Interno ────────────────────────────────────────────────────────────────────────────

    /**
     * @dev Ponto único de movimentação de saldo. Transferências (from e to não nulos) exigem
     *      contrato não pausado e KYC vigente nas duas pontas. Mint é controlado em `mint`.
     */
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            _requireNotPaused();
            if (!identityRegistry.isVerified(from)) revert NotVerified(from);
            if (!identityRegistry.isVerified(to)) revert NotVerified(to);
        }
        _updateWithCorrections(from, to, value);
    }

    /// @dev Move saldo e ajusta as correções para que a receita acumulada não acompanhe o saldo.
    function _updateWithCorrections(address from, address to, uint256 value) private {
        super._update(from, to, value);
        int256 correction = (_magnifiedRevenuePerShare * value).toInt256();
        if (from != address(0)) _magnifiedCorrections[from] += correction;
        if (to != address(0)) _magnifiedCorrections[to] -= correction;
    }
}
