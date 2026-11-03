/**
 * Regras da geração distribuída (Lei 14.300/2022 e REN ANEEL 1.059/2023) em forma de
 * funções puras: enquadramento GD I/II/III, percentual do Fio B por ano, custo de
 * disponibilidade, limites de potência e garantia de fiel cumprimento. É triagem de
 * consultoria — os pontos marcados "conferir" dependem de leitura da norma vigente ou da
 * prática da distribuidora.
 */

export type Enquadramento = "GD I" | "GD II" | "GD III" | "sem GD";
export type Modalidade = "local" | "remoto" | "compartilhada" | "emuc";
export type Ligacao = "mono" | "bi" | "tri";

/** Publicação da Lei 14.300 (DOU 07/01/2022) e os marcos de 12 e 18 meses. */
export const LEI_14300 = "2022-01-07";
export const FIM_GD1_PROTOCOLO = "2023-01-07";
export const FIM_JANELA_18M = "2023-07-07";
export const GD1_ATE = 2045;

/** Fio B cobrado sobre a energia compensada no GD II (art. 27, caput). */
export const FIO_B_GD2: Record<number, number> = { 2023: 0.15, 2024: 0.3, 2025: 0.45, 2026: 0.6, 2027: 0.75, 2028: 0.9 };

/** Custo de disponibilidade (valor mínimo faturável do grupo B, em kWh). */
export const CUSTO_DISPONIBILIDADE: Record<Ligacao, number> = { mono: 30, bi: 50, tri: 100 };

export const MICRO_MAX_KW = 75;
export const MINI_MAX_KW_DESPACHAVEL = 5000;
export const MINI_MAX_KW_NAO_DESPACHAVEL = 3000;
export const CREDITO_VALIDADE_MESES = 60;

const NAO_DESPACHAVEIS = /solar|fotovolt|e[óo]lic|vento/i;

export interface EnquadramentoEntrada {
  /** Data do protocolo da solicitação de acesso (AAAA-MM-DD). Sem data ⇒ assume hoje. */
  dataProtocolo?: string | null;
  potenciaKw?: number | null;
  fonte?: string | null;
  /** Fonte com armazenamento que a torne despachável (conferir o critério na REN 1.059). */
  despachavel?: boolean | null;
  modalidade?: Modalidade | null;
  /** Maior participação de um único titular no excedente (geração compartilhada), em %. */
  maiorTitularPct?: number | null;
  /** Sistema já conectado antes da lei (07/01/2022). */
  existenteAntesDaLei?: boolean | null;
}

export interface EnquadramentoResultado {
  enquadramento: Exclude<Enquadramento, "sem GD">;
  porte: "micro" | "mini" | "acima do limite";
  /** Fim da regra de transição: ano a partir do qual vale o art. 17 (valoração da ANEEL). */
  transicaoAte: number;
  motivo: string;
  avisos: string[];
}

export function porte(potenciaKw: number | null | undefined, despachavel: boolean): EnquadramentoResultado["porte"] {
  if (!potenciaKw || potenciaKw <= MICRO_MAX_KW) return "micro";
  return potenciaKw <= (despachavel ? MINI_MAX_KW_DESPACHAVEL : MINI_MAX_KW_NAO_DESPACHAVEL) ? "mini" : "acima do limite";
}

export function enquadrar(e: EnquadramentoEntrada, hoje = new Date().toISOString().slice(0, 10)): EnquadramentoResultado {
  const data = e.dataProtocolo && /^\d{4}-\d{2}-\d{2}$/.test(e.dataProtocolo) ? e.dataProtocolo : hoje;
  const despachavel = e.despachavel ?? (e.fonte ? !NAO_DESPACHAVEIS.test(e.fonte) : false);
  const p = porte(e.potenciaKw, despachavel);
  const avisos: string[] = [];
  if (!e.dataProtocolo) avisos.push("sem data de protocolo: considerei um pedido de acesso feito hoje");
  if (p === "acima do limite")
    avisos.push(`potência acima do teto de minigeração (${despachavel ? "5 MW despachável" : "3 MW não despachável"} para pedidos após a lei; quem tinha parecer até 12 meses da lei manteve 5 MW — conferir)`);
  if (e.existenteAntesDaLei || data <= FIM_GD1_PROTOCOLO) {
    if (!e.existenteAntesDaLei)
      avisos.push("GD I por protocolo até 07/01/2023 exige começar a injetar no prazo do parecer (120 dias micro; 12 meses mini solar; 30 meses demais fontes) — conferir na distribuidora");
    return { enquadramento: "GD I", porte: p, transicaoAte: GD1_ATE + 1, motivo: e.existenteAntesDaLei ? "sistema existente antes da Lei 14.300" : "solicitação de acesso até 07/01/2023 (art. 26)", avisos };
  }
  const gd3 = (e.potenciaKw ?? 0) > 500 && !despachavel && (e.modalidade === "remoto" || (e.modalidade === "compartilhada" && (e.maiorTitularPct ?? 0) >= 25));
  if (gd3) return { enquadramento: "GD III", porte: p, transicaoAte: 2029, motivo: "minigeração > 500 kW não despachável em autoconsumo remoto ou compartilhada com titular ≥ 25% (art. 27, § 1º)", avisos };
  const janela18 = data <= FIM_JANELA_18M;
  if (janela18) avisos.push("protocolo entre o 13º e o 18º mês da lei: transição do Fio B estendida até 2030 (art. 27 — conferir a redação vigente)");
  return { enquadramento: "GD II", porte: p, transicaoAte: janela18 ? 2031 : 2029, motivo: "solicitação de acesso após 07/01/2023 (art. 27)", avisos };
}

export interface ParcelaNaoCompensada {
  /** Fração do Fio B paga sobre cada kWh compensado. */
  fioB: number;
  /** Fração do Fio A (só GD III). */
  fioA: number;
  /** P&D/EE e TFSEE pagos integralmente (só GD III). */
  encargos: boolean;
  /** O ano já cai na regra do art. 17 (ainda sem valoração publicada: hipótese 100% do Fio B). */
  pendenteArt17: boolean;
}

/** Quanto da tarifa NÃO é compensado em cada kWh de crédito, por enquadramento e ano. */
export function parcelaNaoCompensada(enq: Enquadramento, ano: number, transicaoAte = 2029): ParcelaNaoCompensada {
  if (enq === "GD I" || enq === "sem GD") return { fioB: 0, fioA: 0, encargos: false, pendenteArt17: enq === "GD I" && ano > GD1_ATE };
  if (enq === "GD III") return { fioB: 1, fioA: 0.4, encargos: true, pendenteArt17: ano >= 2029 };
  if (ano < 2023) return { fioB: 0, fioA: 0, encargos: false, pendenteArt17: false };
  if (ano < transicaoAte) return { fioB: FIO_B_GD2[Math.min(ano, 2028)] ?? 0.9, fioA: 0, encargos: false, pendenteArt17: false };
  return { fioB: 1, fioA: 0, encargos: false, pendenteArt17: true };
}

/** Garantia de fiel cumprimento (art. 4º): % do investimento para minigeração > 500 kW. */
export function garantiaFielCumprimento(potenciaKw: number, modalidade?: Modalidade | null): { pct: number; motivo: string } {
  if (modalidade === "compartilhada" || modalidade === "emuc") return { pct: 0, motivo: "dispensada para geração compartilhada por consórcio/cooperativa e para múltiplas unidades (conferir a modalidade exata)" };
  if (potenciaKw <= 500) return { pct: 0, motivo: "não exigida até 500 kW" };
  return potenciaKw < 1000 ? { pct: 2.5, motivo: "entre 500 kW e 1 MW: 2,5% do investimento" } : { pct: 5, motivo: "a partir de 1 MW: 5% do investimento" };
}

/** Cronograma do Fio B de um enquadramento, ano a ano. */
export function cronogramaFioB(enq: Enquadramento, de: number, ate: number, transicaoAte = 2029): { ano: number; fioBPct: number; pendente: boolean }[] {
  const out: { ano: number; fioBPct: number; pendente: boolean }[] = [];
  for (let a = de; a <= ate; a++) {
    const p = parcelaNaoCompensada(enq, a, transicaoAte);
    out.push({ ano: a, fioBPct: Math.round(p.fioB * 100), pendente: p.pendenteArt17 });
  }
  return out;
}

/**
 * Base de conhecimento curta (playbook) por tema: a Iara pede só o tema de que precisa,
 * em vez de carregar tudo no prompt. Cada texto cita a norma; "conferir" = depende da
 * redação vigente ou da distribuidora.
 */
export const GD_TEMAS = {
  enquadramento:
    "GD I: sistemas existentes em 07/01/2022 ou com solicitação de acesso até 07/01/2023 (Lei 14.300, art. 26) — regras antigas (compensação integral) até 31/12/2045. GD II: pedidos depois disso — paga parte do Fio B sobre a energia compensada (art. 27). GD III: minigeração > 500 kW de fonte não despachável em autoconsumo remoto ou geração compartilhada com um titular ≥ 25% — 100% do Fio B, 40% do Fio A, P&D/EE e TFSEE (art. 27, § 1º). Aumentar a potência de um GD I leva só o acréscimo para a regra nova (conferir).",
  fio_b:
    "Fio B = parcela da TUSD que remunera a distribuidora (ativos, depreciação e O&M). GD II paga sobre cada kWh compensado: 15% (2023), 30% (2024), 45% (2025), 60% (2026), 75% (2027), 90% (2028); a partir de 2029 vale o art. 17 (valoração de custos e benefícios pela ANEEL, ainda pendente — o app supõe 100%). Pedidos entre 08/01/2023 e 07/07/2023 têm a transição até 2030 (conferir). Energia consumida no instante da geração (simultânea) não passa pelo medidor e não paga Fio B.",
  custo_disponibilidade:
    "Grupo B paga no mínimo 30 kWh (monofásico), 50 kWh (bifásico) ou 100 kWh (trifásico). GD I: a compensação para no mínimo — sempre se paga o custo de disponibilidade. GD II: a ANEEL disse que não há cobrança dupla — paga-se o MAIOR entre o custo de disponibilidade e a energia faturada com o Fio B sobre a compensada; a compensação para quando a fatura chega ao mínimo (créditos guardados). Há relatos de distribuidoras cobrando os dois: é ponto clássico de conferência.",
  creditos:
    "Crédito de energia vale 60 meses. Ordem de uso: primeiro a energia injetada no mês, depois o saldo mais antigo. O excedente pode ir para outras UCs do mesmo titular (autoconsumo remoto) ou dos participantes (compartilhada), na mesma área de concessão, pelo percentual de rateio informado à distribuidora. Créditos não podem ser vendidos.",
  modalidades:
    "Junto à carga (local); autoconsumo remoto (mesmo titular CPF/CNPJ, outra UC na mesma distribuidora); geração compartilhada (consórcio, cooperativa, condomínio civil voluntário ou edilício, ou associação civil); múltiplas unidades consumidoras (EMUC, condomínios). Micro: até 75 kW. Mini: até 5 MW despachável e 3 MW não despachável para pedidos após a lei.",
  garantia:
    "Garantia de fiel cumprimento (art. 4º) para minigeração > 500 kW: 2,5% do investimento (500 kW a 1 MW) e 5% (≥ 1 MW). Dispensada para geração compartilhada por consórcio/cooperativa e para EMUC (conferir). Sem conexão no prazo, a garantia pode ser executada.",
  icms:
    "Convênio ICMS 16/2015: isenção do ICMS sobre a energia compensada, adotada pelos estados com regras próprias (limites de potência, modalidades e se a TUSD da energia compensada também fica isenta). Há estados que cobram ICMS sobre a TUSD da compensada. Conferir o regulamento do estado e a fatura linha a linha.",
  pis_cofins:
    "Lei 13.169/2015, art. 8º: PIS/Pasep e Cofins com alíquota zero sobre a energia fornecida na quantidade da energia injetada e dos créditos da própria UC ou de outra UC do mesmo titular. Em geração compartilhada com titular diferente (consórcio/cooperativa) a aplicação é discutida — conferir. Cobrança de PIS/Cofins sobre toda a energia, sem descontar a compensada, é erro comum.",
  bandeiras:
    "Adicional de bandeira incide sobre a energia faturada. Na GD, a energia compensada abate o consumo antes da bandeira; cobrar bandeira sobre a energia que foi compensada é indício de erro (conferir a regra da distribuidora).",
  grupo_a:
    "Grupo A (média/alta tensão): fatura por demanda (kW) e energia por posto (ponta e fora ponta). A compensação abate energia; créditos de um posto usados em outro são ajustados pela razão das tarifas de energia (TE). Demanda medida acima de 105% da contratada gera ultrapassagem (2× a tarifa sobre o excedente). Reativo excedente (fator de potência < 0,92) é cobrado à parte. Minigeração > 75 kW contrata demanda de injeção (TUSDg).",
  contratos:
    "Modelos: usina própria (EPC + O&M); locação de usina/equipamento (aluguel fixo — o mais aderente à proibição de vender créditos); assinatura com desconto sobre a tarifa (comum no mercado; cobrança por kWh tem risco de ser lida como venda de crédito); consórcio/cooperativa (quotas). Cláusulas críticas: quem absorve o aumento do Fio B até 2028 e o art. 17 depois; base do desconto (tarifa cheia ou líquida de Fio B e tributos); reajuste; garantia de geração mínima; O&M e seguro; mudança de rateio; multa de saída; tributos (ICMS); LGPD.",
  encargos:
    "TUSD = Fio A (transmissão) + Fio B (distribuição) + encargos (CDE, PROINFA, TFSEE, P&D/EE) + perdas. TE = energia + encargos (ESS/EER etc.). Bandeiras somam à TE. Tributos: ICMS (estadual, cobrado 'por dentro'), PIS/Cofins (federais, alíquota efetiva varia mês a mês) e CIP/COSIP (municipal, fora da compensação).",
  conexao:
    "Inversão de fluxo e falta de capacidade viraram o principal motivo de negativa ou exigência de obras em novos pedidos de GD; a ANEEL discute regras para o excesso de MMGD (consulta pública e notas técnicas de 2026). O parecer de acesso define prazos; perder o prazo de conexão pode tirar o enquadramento GD I.",
} as const;
export type GdTema = keyof typeof GD_TEMAS;
export const GD_TEMA_LIST = Object.keys(GD_TEMAS) as GdTema[];
