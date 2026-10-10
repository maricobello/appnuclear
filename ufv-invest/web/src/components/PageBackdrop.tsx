import Image, { type StaticImageData } from "next/image";

/**
 * Foto atrás do topo de uma página: fica esmaecida, escurece à esquerda (onde está o título)
 * e se dissolve na cor de fundo, sem competir com o conteúdo. Estática: nenhum custo de animação.
 */
export function PageBackdrop({ src, position = "100% 45%", opacity = 0.4 }: { src: StaticImageData | string; position?: string; opacity?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[400px] overflow-hidden sm:h-[460px]">
      {/* é o maior elemento do topo (LCP): carrega já, sem esperar o scroll */}
      <Image src={src} alt="" fill sizes="100vw" loading="eager" fetchPriority="high" className="object-cover" style={{ objectPosition: position, opacity }} />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,9,14,0.45)_0%,rgba(6,9,14,0.25)_45%,var(--page)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,var(--page)_0%,rgba(6,9,14,0.45)_35%,transparent_65%)]" />
    </div>
  );
}
