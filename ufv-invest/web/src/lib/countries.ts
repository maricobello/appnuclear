/**
 * Países aceitos no KYC: sigla ISO 3166-1 alfa-2 (formulário) → código numérico (on-chain).
 * O registro de investidores guarda só a carteira, o país numérico e a validade — nenhum dado pessoal.
 * Ordem: Brasil primeiro, depois os mercados mais comuns.
 */
export const KYC_COUNTRIES = {
  BR: 76, US: 840, PT: 620, ES: 724, FR: 250, DE: 276, IT: 380, GB: 826, CH: 756, NL: 528, BE: 56,
  IE: 372, CA: 124, MX: 484, AR: 32, CL: 152, CO: 170, UY: 858, PY: 600, PE: 604, CN: 156, JP: 392,
  KR: 410, SG: 702, HK: 344, AE: 784, SA: 682, IL: 376, IN: 356, AU: 36, NZ: 554, ZA: 710,
} as const;

export type KycCountry = keyof typeof KYC_COUNTRIES;
export const KYC_COUNTRY_CODES = Object.keys(KYC_COUNTRIES) as KycCountry[];

export function isKycCountry(v: unknown): v is KycCountry {
  return typeof v === "string" && Object.hasOwn(KYC_COUNTRIES, v);
}
