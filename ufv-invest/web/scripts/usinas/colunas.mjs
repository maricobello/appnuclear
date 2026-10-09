/**
 * Colunas da planilha de usinas (uma linha por usina). Fonte única para o importador,
 * para a planilha-modelo e para a aba de instruções.
 *   obrig: obrigatória · tipo: texto | numero | data | simnao | lista
 */
export const COLUNAS = [
  // identificação e local
  { id: "nome", obrig: true, tipo: "texto", desc: "Nome comercial da usina", ex: "Usina Horizonte Azul" },
  { id: "slug", tipo: "texto", desc: "Identificador na URL (gerado do nome se vazio)", ex: "ufv-horizonte-azul" },
  { id: "status", obrig: true, tipo: "lista", valores: ["operacao", "implantacao", "encerrada"], desc: "operacao | implantacao | encerrada (oferta concluída)", ex: "operacao" },
  { id: "municipio", obrig: true, tipo: "texto", desc: "Município", ex: "Patos de Minas" },
  { id: "uf", obrig: true, tipo: "texto", desc: "UF (2 letras)", ex: "MG" },
  { id: "codigo_ibge", tipo: "numero", desc: "Código IBGE do município (7 dígitos). Vazio = buscado na API do IBGE pelo nome", ex: 3148004 },
  { id: "latitude", obrig: true, tipo: "numero", desc: "Latitude em graus decimais (negativa no hemisfério sul)", ex: -18.578 },
  { id: "longitude", obrig: true, tipo: "numero", desc: "Longitude em graus decimais (negativa a oeste)", ex: -46.518 },
  { id: "distribuidora", obrig: true, tipo: "texto", desc: "Distribuidora de energia", ex: "CEMIG Distribuição" },

  // técnico / equipamento / tamanho
  { id: "potencia_kwp", obrig: true, tipo: "numero", desc: "Potência instalada em corrente contínua (kWp)", ex: 1228.5 },
  { id: "potencia_kw_ca", obrig: true, tipo: "numero", desc: "Potência dos inversores em corrente alternada (kW)", ex: 1000 },
  { id: "escala", tipo: "texto", desc: "Escala (Microgeração, Minigeração, Grande porte). Vazio = derivada da potência CA", ex: "Minigeração" },
  { id: "modulo_modelo", tipo: "texto", desc: "Modelo do módulo fotovoltaico", ex: "Módulo TOPCon bifacial 585 Wp (Tier 1)" },
  { id: "modulo_wp", tipo: "numero", desc: "Potência do módulo (Wp)", ex: 585 },
  { id: "modulo_qtd", tipo: "numero", desc: "Quantidade de módulos (vazio = kWp ÷ Wp)", ex: 2100 },
  { id: "modulo_bifacial", tipo: "simnao", desc: "Módulo bifacial? (sim/não)", ex: "sim" },
  { id: "inversor_modelo", tipo: "texto", desc: "Modelo do inversor", ex: "Inversor string 250 kW" },
  { id: "inversor_kw", tipo: "numero", desc: "Potência de cada inversor (kW)", ex: 250 },
  { id: "inversor_qtd", tipo: "numero", desc: "Quantidade de inversores", ex: 4 },
  { id: "estrutura", tipo: "lista", valores: ["fixa", "seguidor"], desc: "fixa | seguidor (seguidor solar de um eixo)", ex: "fixa" },
  { id: "inclinacao_graus", tipo: "numero", desc: "Inclinação da estrutura fixa (graus)", ex: 18 },
  { id: "area_ha", tipo: "numero", desc: "Área do terreno (hectares)", ex: 2.6 },
  { id: "comissionamento", tipo: "data", desc: "Data de entrada em operação (real ou prevista)", ex: "2025-04-10" },
  { id: "equipamentos_obs", tipo: "texto", desc: "Observações sobre equipamentos, garantias, O&M", ex: "Garantia de 12 anos nos inversores; O&M contratado" },

  // comercial
  { id: "preco_venda_rs", tipo: "numero", desc: "Preço de venda do ativo (R$). Define a captação se valor_cota/total_cotas ficarem vazios", ex: 5000000 },
  { id: "ppa_ativo", obrig: true, tipo: "simnao", desc: "Há contrato de venda de energia (PPA/locação/assinatura) vigente? (sim/não)", ex: "sim" },
  { id: "ppa_contraparte", tipo: "texto", desc: "Comprador da energia", ex: "Rede de farmácias regional" },
  { id: "ppa_preco_mwh", tipo: "numero", desc: "Preço do PPA em R$/MWh (se a receita for por PPA)", ex: "" },
  { id: "ppa_fim", tipo: "data", desc: "Fim da vigência do PPA", ex: "2035-04-30" },
  { id: "modelo_receita", tipo: "lista", valores: ["gd", "ppa"], desc: "gd (geração compartilhada / assinatura) | ppa (preço fixo por MWh)", ex: "gd" },
  { id: "tarifa_kwh", tipo: "numero", desc: "Tarifa B1 da distribuidora com impostos (R$/kWh) — modelo gd", ex: 0.95 },
  { id: "fio_b_kwh", tipo: "numero", desc: "TUSD Fio B (R$/kWh) — modelo gd", ex: 0.3 },
  { id: "ano_solicitacao_acesso", tipo: "numero", desc: "Ano da solicitação de acesso (≤ 2022 = isento do Fio B até 2045)", ex: 2023 },
  { id: "desconto_cliente_pct", tipo: "numero", desc: "Desconto ao assinante (%)", ex: 20 },
  { id: "om_rs_kwp_ano", tipo: "numero", desc: "Custo de O&M (R$/kWp/ano)", ex: 55 },
  { id: "arrendamento_rs_ano", tipo: "numero", desc: "Arrendamento do terreno (R$/ano)", ex: 16000 },

  // oferta de cotas
  { id: "valor_cota_rs", tipo: "numero", desc: "Valor de cada cota (R$). Vazio = R$ 1.000", ex: 1000 },
  { id: "total_cotas", tipo: "numero", desc: "Total de cotas. Vazio = preço de venda ÷ valor da cota", ex: 5000 },
  { id: "cota_minima", tipo: "numero", desc: "Quantidade mínima de cotas por investidor", ex: 1 },
  { id: "meta_minima_pct", tipo: "numero", desc: "Meta mínima da captação (% das cotas). Vazio = 70", ex: 70 },
  { id: "inicio_oferta", tipo: "data", desc: "Início da oferta", ex: "2026-09-01" },
  { id: "fim_oferta", tipo: "data", desc: "Fim da oferta", ex: "2026-12-15" },
  { id: "cotas_vendidas", tipo: "numero", desc: "Cotas já vendidas fora da blockchain (opcional)", ex: "" },

  // textos e fotos
  { id: "descricao", tipo: "texto", desc: "Descrição curta (aparece no topo da usina)", ex: "Minigeração compartilhada conectada à CEMIG." },
  { id: "sobre", tipo: "texto", desc: "Texto “Sobre o ativo”", ex: "A Usina Horizonte Azul fica em Patos de Minas (MG)..." },
  { id: "fotos", tipo: "texto", desc: "Arquivos das fotos separados por ; (em public/images/usinas/<slug>/). Vazio = todas as fotos da pasta", ex: "aerea.jpg; inversores.jpg" },
];
