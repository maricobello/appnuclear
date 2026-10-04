import type { PlantAnalysis } from "@/lib/types";

/**
 * Serialização JSON canônica: chaves de objetos ordenadas recursivamente (ordem de code units),
 * sem espaços; `undefined` e funções são omitidos em objetos e viram `null` em arrays; números
 * não finitos viram `null`; `bigint` vira string decimal. Pura (sem Node), reutilizável no cliente.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, true) ?? "null";
}

function serialize(value: unknown, inArray: boolean): string | undefined {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : "null";
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      return JSON.stringify(value.toString());
    case "undefined":
    case "function":
    case "symbol":
      return inArray ? "null" : undefined;
  }
  const obj = value as { toJSON?: () => unknown };
  if (typeof obj.toJSON === "function") return serialize(obj.toJSON(), inArray);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => serialize(v, true) ?? "null").join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const s = serialize(record[k], false);
    if (s !== undefined) parts.push(JSON.stringify(k) + ":" + s);
  }
  return "{" + parts.join(",") + "}";
}

/** Campos excluídos do hash: variam a cada execução sem alterar o mérito da análise. */
export const CANONICAL_EXCLUDED_KEYS = ["live", "generatedAt", "dataHash"] as const;

/**
 * JSON canônico (chaves ordenadas recursivamente, sem espaços) das partes estáveis da análise —
 * exclui `live`, `generatedAt` e `dataHash`. `dataHash = sha256(canonicalAnalysisJson(analysis))`.
 */
export function canonicalAnalysisJson(analysis: PlantAnalysis): string {
  const stable: Record<string, unknown> = { ...(analysis as unknown as Record<string, unknown>) };
  for (const k of CANONICAL_EXCLUDED_KEYS) delete stable[k];
  return canonicalJson(stable);
}
