// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IIdentityRegistry} from "./IIdentityRegistry.sol";

/**
 * @title IUFVPlantToken
 * @notice Funções do token de cotas usadas pela oferta primária (`UFVOffering`).
 */
interface IUFVPlantToken is IERC20 {
    function MINTER_ROLE() external view returns (bytes32);

    function hasRole(bytes32 role, address account) external view returns (bool);

    function identityRegistry() external view returns (IIdentityRegistry);

    function maxSupply() external view returns (uint256);

    function mintingFinished() external view returns (bool);

    function mint(address to, uint256 amount) external;

    function finishMinting() external;
}
