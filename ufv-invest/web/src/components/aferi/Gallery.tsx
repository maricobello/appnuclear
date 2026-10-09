"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Images, X } from "lucide-react";
import { PhotoPlaceholder } from "./PhotoPlaceholder";

/** Galeria da usina: foto principal + miniaturas, com visualização ampliada (teclado e toque). */
export function Gallery({ images, name }: { images: string[]; name: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const n = images.length;
  const go = useCallback((d: number) => setOpen((i) => (i === null ? i : (i + d + n) % n)), [n]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open !== null && !d.open) d.showModal();
    if (open === null && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (open === null) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, go]);

  const thumbs = images.slice(1, 4);
  if (n === 0)
    return (
      <div className="h-[220px] overflow-hidden rounded-xl sm:h-[300px]">
        <PhotoPlaceholder label="Fotos da usina em breve" />
      </div>
    );
  const alt = (i: number) => `${name} — foto ${i + 1} de ${n}`;

  return (
    <>
      <div className={thumbs.length ? "grid gap-2 sm:grid-cols-[1fr_190px] sm:gap-3" : ""}>
        <button className="relative aspect-[16/9] overflow-hidden rounded-xl bg-surface-3 sm:aspect-auto sm:h-[340px]" onClick={() => setOpen(0)} aria-label="Ampliar foto principal">
          <Image src={images[0]} alt={alt(0)} fill priority sizes="(min-width:1280px) 900px, 100vw" className="object-cover" />
        </button>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-1 sm:grid-rows-3 sm:gap-3">
          {thumbs.map((src, k) => {
            const i = k + 1;
            const last = k === thumbs.length - 1;
            return (
              <button key={src} className="relative aspect-[16/10] overflow-hidden rounded-lg bg-surface-3 sm:aspect-auto" onClick={() => setOpen(i)} aria-label={`Ampliar foto ${i + 1}`}>
                <Image src={src} alt={alt(i)} fill sizes="190px" className="object-cover transition hover:scale-105" />
                {last && (
                  <span className="absolute inset-0 flex items-center justify-center gap-1.5 bg-navy/45 text-[12px] font-semibold text-white">
                    <Images className="size-4" /> Ver todas ({n})
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <dialog
        ref={dialog}
        onClose={() => setOpen(null)}
        onClick={(e) => e.target === dialog.current && setOpen(null)}
        className="m-auto w-[min(1100px,94vw)] rounded-2xl bg-black p-0 backdrop:bg-black/80"
        aria-label={`Fotos da ${name}`}
      >
        {open !== null && (
          <div className="relative">
            <div className="relative aspect-[16/9]">
              <Image src={images[open]} alt={alt(open)} fill sizes="1100px" className="object-contain" />
            </div>
            <button onClick={() => setOpen(null)} className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-white hover:bg-black" aria-label="Fechar">
              <X className="size-5" />
            </button>
            <button onClick={() => go(-1)} className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black" aria-label="Foto anterior">
              <ChevronLeft className="size-6" />
            </button>
            <button onClick={() => go(1)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black" aria-label="Próxima foto">
              <ChevronRight className="size-6" />
            </button>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[12px] text-white tnum">
              {open + 1} / {n}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
