// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @dev SOMENTE TESTES. Token malicioso com "hook" (estilo ERC-777): a cada movimentação de saldo,
 *      se armado, chama `target` com `data` e propaga o revert. Usado para provar que as funções
 *      que movem fundos estão protegidas contra reentrância.
 */
contract ReentrantERC20 is ERC20 {
    address public target;
    bytes public data;
    bool public armed;
    bool private _inHook;

    constructor() ERC20("Reentrant Token", "REENT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata data_) external {
        target = target_;
        data = data_;
        armed = true;
    }

    function disarm() external {
        armed = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && !_inHook && from != address(0)) {
            _inHook = true;
            (bool ok, bytes memory ret) = target.call(data);
            _inHook = false;
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
    }
}
