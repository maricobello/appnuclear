"use client";

import { useConnection } from "wagmi";
import { motion } from "motion/react";
import { ShieldCheck, Wallet } from "lucide-react";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { useMounted } from "@/lib/useNow";

/** Chegada na vitrine: conectar a carteira é o primeiro passo para investir */
export function WalletBanner() {
  const mounted = useMounted();
  const { isConnected } = useConnection();
  if (!mounted || isConnected) return <div className="h-0" />;
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-wrap items-center justify-between gap-4 glass relative overflow-hidden rounded-2xl px-5 py-4 text-ink sm:px-6"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-white/10">
          <Wallet className="size-5" />
        </span>
        <div>
          <div className="text-[15px] font-semibold">Conecte sua carteira para investir</div>
          <div className="flex items-center gap-1 text-[12px] text-muted">
            <ShieldCheck className="size-3.5" /> Binance Wallet, MetaMask, Rabby ou Trust · sem senha
          </div>
        </div>
      </div>
      <ConnectButton />
    </motion.div>
  );
}
