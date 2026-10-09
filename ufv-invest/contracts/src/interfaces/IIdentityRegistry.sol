// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

/**
 * @title IIdentityRegistry
 * @notice Interface mínima do registro de investidores habilitados (KYC/AML) consultada pelos
 *         tokens de cotas e pelas ofertas da UFV Invest.
 */
interface IIdentityRegistry {
    /// @notice `true` se `wallet` está cadastrada e o KYC ainda não expirou (`block.timestamp < expiresAt`).
    function isVerified(address wallet) external view returns (bool);

    /**
     * @notice Dados de cadastro de uma carteira.
     * @return registered `true` se a carteira está cadastrada (mesmo que o KYC esteja vencido).
     * @return country Código numérico ISO 3166-1 do país do investidor (Brasil = 76).
     * @return expiresAt Timestamp Unix (segundos) a partir do qual o KYC deixa de valer.
     */
    function investorOf(address wallet) external view returns (bool registered, uint16 country, uint64 expiresAt);
}
