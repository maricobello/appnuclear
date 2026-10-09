"use client";

import { useCallback, useState } from "react";
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, type Abi, type Address, type Hash, type TransactionReceipt } from "viem";
import type { Config } from "wagmi";
import { useT } from "@/i18n/client";
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
  RecommitAfterWithdrawal: "Você desistiu desta oferta e não pode aportar novamente nela.",
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

/** Textos de erro no idioma da interface (padrão: português). */
export type TxTexts = { cancelled: string; refused: string; gas: string; e: Record<string, string> };

export function humanizeError(e: unknown, tx?: TxTexts): string {
  const cancelled = tx?.cancelled ?? "Você cancelou a assinatura na carteira.";
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return cancelled;
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      const known = name ? (tx?.e[name] ?? errorText[name]) : undefined;
      if (known) return known;
      if (name) return tx ? tx.refused.replace("{n}", name) : `O contrato recusou a operação (${name}).`;
      if (revert.reason) return tx ? tx.refused.replace("{n}", revert.reason) : `O contrato recusou a operação: ${revert.reason}`;
    }
    if (/insufficient funds/i.test(e.message)) return tx?.gas ?? "Saldo de BNB insuficiente para pagar o gás.";
    return e.shortMessage || e.message;
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(msg)) return cancelled;
  return msg;
}

/** Parâmetros de uma escrita (os ABIs vêm de lib/web3/abi.ts e os endereços de deployments.json) */
export type TxParams = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };
type SimulateArgs = Parameters<typeof simulateContract>[1];
type WriteArgs = Parameters<typeof writeContract>[1];

export function useTx() {
  const [state, setState] = useState<TxState>({ step: "idle" });
  const { d } = useT();
  const texts = d.tx;

  const run = useCallback(async (label: string, params: TxParams): Promise<TransactionReceipt | null> => {
    try {
      const conn = getConnection(wagmiConfig);
      if (!conn.address) throw new Error(d.wal.connect);
      if (conn.chainId !== TARGET_CHAIN_ID) {
        setState({ step: "switching", label });
        await switchChain(wagmiConfig, { chainId: TARGET_CHAIN_ID });
      }
      setState({ step: "simulating", label });
      const { request } = await simulateContract(wagmiConfig as Config, { ...params, account: conn.address, chainId: TARGET_CHAIN_ID } as unknown as SimulateArgs);
      setState({ step: "signing", label });
      const hash = await writeContract(wagmiConfig as Config, request as unknown as WriteArgs);
      setState({ step: "pending", label, hash });
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: TARGET_CHAIN_ID, confirmations: 1 });
      if (receipt.status !== "success") throw new Error(texts.reverted);
      setState({ step: "done", label, hash });
      return receipt;
    } catch (e) {
      setState((s) => ({ step: "error", label, hash: s.hash, error: humanizeError(e, texts) }));
      return null;
    }
  }, [texts, d.wal.connect]);

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
