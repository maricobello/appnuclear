/* eslint-disable @typescript-eslint/no-explicit-any */
export function norm(s: unknown): string;
export function headerId(h: string): string;
export function slugify(s: string): string;
export function submercado(uf: string): string;
export function parseRow(raw: Record<string, unknown>, linha: number): { valores: Record<string, any>; erros: string[] };
export function buildPlant(v: Record<string, any>, o: { ibgeCode: number; fotos?: string[] }): unknown;
