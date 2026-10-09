import { ImageIcon } from "lucide-react";
import { cx } from "@/components/ui";

/** Espaço reservado enquanto a usina não tem fotos reais publicadas */
export function PhotoPlaceholder({ className, label = "Fotos em breve", compact = false }: { className?: string; label?: string; compact?: boolean }) {
  return (
    <div
      className={cx(
        "flex size-full flex-col items-center justify-center gap-1.5 bg-[linear-gradient(135deg,#eef6f1_0%,#f4f7f6_55%,#e9f1f8_100%)] text-muted",
        className,
      )}
      role="img"
      aria-label={label}
    >
      <ImageIcon className={compact ? "size-5" : "size-7"} strokeWidth={1.5} aria-hidden />
      {!compact && <span className="text-[12px] font-medium">{label}</span>}
    </div>
  );
}
