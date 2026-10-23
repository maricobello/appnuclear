import type { MetadataRoute } from "next";

/** Plataforma fechada: nenhum buscador, arquivador ou robô de treino de IA indexa nada. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
