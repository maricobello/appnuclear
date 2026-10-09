"use client";

import { useState } from "react";
import { buttonClass, cx } from "@/components/ui";
import { InterestDialog } from "./InterestDialog";
import { useT } from "@/i18n/client";

export function ContactButton({ label, className }: { label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const { d } = useT();
  return (
    <>
      <button className={className ?? cx(buttonClass.outline)} onClick={() => setOpen(true)}>
        {label ?? d.int.titleSupport}
      </button>
      <InterestDialog open={open} onClose={() => setOpen(false)} tipo="suporte" />
    </>
  );
}
