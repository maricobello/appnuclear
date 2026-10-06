// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev SOMENTE TESTES. ERC-20 com lista de bloqueio (como o USDT do emissor Tether): transferências
///      de/para endereços bloqueados revertem. Simula a tesouraria da SPE bloqueada pelo emissor.
contract BlockableERC20 is ERC20 {
    mapping(address account => bool) public blocked;

    error AccountBlocked(address account);

    constructor() ERC20("Blockable USD", "BUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address account, bool value) external {
        blocked[account] = value;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blocked[from]) revert AccountBlocked(from);
        if (blocked[to]) revert AccountBlocked(to);
        super._update(from, to, value);
    }
}
