"use client";

import { useState } from "react";
import { buttonClass, cx } from "@/components/ui";
import { InterestDialog } from "./InterestDialog";

export function ContactButton({ label = "Fale conosco", className }: { label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className ?? cx(buttonClass.outline)} onClick={() => setOpen(true)}>
        {label}
      </button>
      <InterestDialog open={open} onClose={() => setOpen(false)} tipo="suporte" />
    </>
  );
}
