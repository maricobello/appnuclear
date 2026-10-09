// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDT — SOMENTE PARA TESTNET
 * @notice ⚠ TOKEN DE TESTE, SEM VALOR. Nunca use na mainnet. Imita o USDT BEP-20 (18 casas) para
 *         demonstrações na BSC testnet. Qualquer carteira pode pegar `FAUCET_AMOUNT` via
 *         `faucet()` a cada `FAUCET_COOLDOWN`, até `FAUCET_MAX_PER_ADDRESS` no total; o `owner`
 *         pode emitir livremente com `mint`.
 */
contract MockUSDT is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 10_000 ether;
    uint256 public constant FAUCET_COOLDOWN = 1 days;
    uint256 public constant FAUCET_MAX_PER_ADDRESS = 100_000 ether;

    mapping(address account => uint256) public lastFaucetAt;
    mapping(address account => uint256) public faucetMinted;

    event FaucetUsed(address indexed account, uint256 amount);

    error FaucetCooldown(uint256 availableAt);
    error FaucetCapReached(uint256 cap);

    constructor(address initialOwner) ERC20("Mock USDT (somente testnet)", "tUSDT") Ownable(initialOwner) {}

    /// @notice 18 casas, como o USDT BEP-20 da BSC.
    function decimals() public pure override returns (uint8) {
        return 18;
    }

    /// @notice Recebe tUSDT de teste (limitado por tempo e por carteira).
    function faucet() external returns (uint256 amount) {
        uint256 availableAt = faucetAvailableAt(msg.sender);
        if (block.timestamp < availableAt) revert FaucetCooldown(availableAt);
        uint256 minted = faucetMinted[msg.sender];
        if (minted >= FAUCET_MAX_PER_ADDRESS) revert FaucetCapReached(FAUCET_MAX_PER_ADDRESS);

        amount = FAUCET_MAX_PER_ADDRESS - minted;
        if (amount > FAUCET_AMOUNT) amount = FAUCET_AMOUNT;
        lastFaucetAt[msg.sender] = block.timestamp;
        faucetMinted[msg.sender] = minted + amount;
        _mint(msg.sender, amount);
        emit FaucetUsed(msg.sender, amount);
    }

    /// @notice Quando `account` pode usar o faucet de novo (0 = já pode).
    function faucetAvailableAt(address account) public view returns (uint256) {
        uint256 last = lastFaucetAt[account];
        return last == 0 ? 0 : last + FAUCET_COOLDOWN;
    }

    /// @notice Emissão livre pelo owner (para abastecer testes).
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
