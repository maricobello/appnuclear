import { describe, expect, it } from "vitest";
import { isValidCpf, maskCpf } from "@/lib/cpf";

describe("CPF", () => {
  it("aceita CPFs válidos (com e sem máscara)", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
  });
  it("rejeita dígitos errados, repetidos e tamanho inválido", () => {
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("123")).toBe(false);
  });
  it("mascara sem expor os dígitos verificadores", () => {
    expect(maskCpf("529.982.247-25")).toBe("***.982.247-**");
  });
});
