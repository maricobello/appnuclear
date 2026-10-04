"use client";

import { useCallback, useState } from "react";
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, type Hash, type TransactionReceipt } from "viem";
import { getConnection, simulateContract, switchChain, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { wagmiConfig } from "./config";
import { TARGET_CHAIN_ID } from "./chains";

/**
 * Executor de transações seguro: confere a rede → simula (eth_call) → pede a assinatura →
 * aguarda a confirmação. Se a simulação reverter, a carteira nem abre e a pessoa vê o motivo
 * em português (erros customizados dos contratos traduzidos abaixo).
 */

export type TxStep = "idle" | "switching" | "simulating" | "signing" | "pending" | "done" | "error";
export type TxState = { step: TxStep; label?: string; hash?: Hash; error?: string };

const errorText: Record<string, string> = {
  NotVerified: "Carteira sem KYC válido no registro de investidores.",
  InvalidState: "A oferta não está na fase certa para esta operação.",
  BelowMinimum: "Quantidade abaixo do mínimo por aporte.",
  ExceedsInvestorCap: "Acima do limite de cotas por investidor.",
  ExceedsHardCap: "Não há cotas suficientes disponíveis na oferta.",
  TransferAmountMismatch: "Token de pagamento incompatível (taxa na transferência).",
  NoCommitment: "Você não tem aporte nesta oferta.",
  WithdrawalWindowClosed: "O prazo de desistência (5 dias) já passou.",
  WithdrawalPeriodOpen: "Ainda há prazo de desistência aberto; o encerramento só ocorre depois dele.",
  NothingToRefund: "Não há valor a ser devolvido.",
  NotFinalized: "A oferta ainda não foi encerrada.",
  AlreadySettled: "Suas cotas já foram entregues.",
  MaxSupplyExceeded: "Limite de cotas da usina atingido.",
  MintingNotFinished: "A distribuição só começa após a entrega de todas as cotas.",
  NothingToClaim: "Não há rendimento disponível para resgate.",
  FaucetCooldown: "Faucet já usado hoje — tente novamente mais tarde.",
  FaucetCapReached: "Limite do faucet de teste atingido para esta carteira.",
  EnforcedPause: "Operação pausada temporariamente pelo administrador.",
  ERC20InsufficientBalance: "Saldo de USDT insuficiente.",
  ERC20InsufficientAllowance: "Aprovação de USDT insuficiente — aprove o valor antes.",
  AccessControlUnauthorizedAccount: "Esta carteira não tem permissão para esta operação.",
};

export function humanizeError(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return "Você cancelou a assinatura na carteira.";
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && errorText[name]) return errorText[name];
      if (name) return `O contrato recusou a operação (${name}).`;
      if (revert.reason) return `O contrato recusou a operação: ${revert.reason}`;
    }
    if (/insufficient funds/i.test(e.message)) return "Saldo de BNB insuficiente para pagar o gás.";
    return e.shortMessage || e.message;
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(msg)) return "Você cancelou a assinatura na carteira.";
  return msg;
}

type SimParams = Parameters<typeof simulateContract<typeof wagmiConfig>>[1];

export function useTx() {
  const [state, setState] = useState<TxState>({ step: "idle" });

  const run = useCallback(async (label: string, params: SimParams): Promise<TransactionReceipt | null> => {
    try {
      const conn = getConnection(wagmiConfig);
      if (!conn.address) throw new Error("Conecte a carteira primeiro.");
      if (conn.chainId !== TARGET_CHAIN_ID) {
        setState({ step: "switching", label });
        await switchChain(wagmiConfig, { chainId: TARGET_CHAIN_ID });
      }
      setState({ step: "simulating", label });
      const { request } = await simulateContract(wagmiConfig, { ...params, account: conn.address, chainId: TARGET_CHAIN_ID } as SimParams);
      setState({ step: "signing", label });
      const hash = await writeContract(wagmiConfig, request);
      setState({ step: "pending", label, hash });
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: TARGET_CHAIN_ID, confirmations: 1 });
      if (receipt.status !== "success") throw new Error("A transação foi revertida na rede.");
      setState({ step: "done", label, hash });
      return receipt;
    } catch (e) {
      setState((s) => ({ step: "error", label, hash: s.hash, error: humanizeError(e) }));
      return null;
    }
  }, []);

  const reset = useCallback(() => setState({ step: "idle" }), []);
  const busy = state.step === "switching" || state.step === "simulating" || state.step === "signing" || state.step === "pending";
  return { state, run, reset, busy };
}

export const stepText: Record<TxStep, string> = {
  idle: "",
  switching: "Trocando de rede na carteira…",
  simulating: "Simulando a transação…",
  signing: "Confirme na sua carteira…",
  pending: "Aguardando confirmação na BNB Chain…",
  done: "Confirmado na BNB Chain.",
  error: "",
};
