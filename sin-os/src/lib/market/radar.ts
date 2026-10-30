/**
 * Radar regulatório: as mudanças recentes do mercado de energia que mexem com preço, risco ou
 * acesso ao mercado livre, cada uma com a fonte. Curado à mão (não há API oficial que junte isso);
 * quando as fontes divergem, a divergência fica escrita em `ressalva`.
 */

export type RadarTema = "abertura" | "dados" | "precos" | "leiloes" | "renovaveis" | "risco" | "modelos" | "tarifas";
export type RadarStatus = "vigente" | "em implantação" | "agendado" | "pendente";

export interface RadarItem {
  id: string;
  /** Data do ato ou da decisão: AAAA-MM-DD, ou AAAA-MM quando as fontes só dão o mês. */
  data: string;
  tema: RadarTema;
  titulo: string;
  status: RadarStatus;
  oQueMuda: string;
  quemAfeta: string;
  /** Próximas datas que importam. */
  marcos?: { data: string; descricao: string }[];
  /** Onde a plataforma usa ou mede isso. */
  naPlataforma?: { label: string; href: string };
  ressalva?: string;
  fontes: { nome: string; url: string }[];
}

export const TEMA_LABEL: Record<RadarTema, string> = {
  abertura: "Abertura do mercado",
  dados: "Dados e Open Energy",
  precos: "Preços",
  leiloes: "Leilões",
  renovaveis: "Renováveis",
  risco: "Risco de crédito",
  modelos: "Modelos oficiais",
  tarifas: "Tarifas",
};

/** Atualizado em 30/10/2026. */
export const RADAR_UPDATED = "2026-10-30";

export const RADAR: RadarItem[] = [
  {
    id: "open-energy",
    data: "2026-10-27",
    tema: "dados",
    titulo: "ANEEL institui o Open Energy e simplifica a migração do Grupo A",
    status: "em implantação",
    oQueMuda:
      "O consumidor passa a acessar de forma padronizada os próprios dados de consumo, faturamento e medição e pode autorizar o compartilhamento com quem escolher (comercializadoras, gestoras, bancos). A CCEE vai operar um comparador de produtos e preços, acessível pelo site da ANEEL. Na migração para o mercado livre, o contrato regulado só termina quando a migração é concluída, e o prazo regular cai de 180 para 90 dias para a maior parte das unidades AS e A4 no procedimento simplificado.",
    quemAfeta: "Consumidores do Grupo A (média e alta tensão) primeiro; comercializadoras, varejistas e quem oferece gestão de energia.",
    marcos: [
      { data: "2027-10", descricao: "Até 12 meses após a publicação: página do Open Energy, acesso padronizado aos próprios dados e comparador de ofertas" },
      { data: "2028-10", descricao: "Até 24 meses: APIs de compartilhamento entre instituições" },
    ],
    naPlataforma: { label: "Simulador de migração com a curva de carga", href: "/mercado-livre#simulador" },
    ressalva: "As fontes divergem sobre o alcance dos 90 dias (subgrupos AS e A4 no procedimento simplificado, ou todo o Grupo A). Confira a resolução publicada.",
    fontes: [
      { nome: "ANEEL", url: "https://www.gov.br/aneel/pt-br/assuntos/noticias/2026/aneel-avanca-com-abertura-do-mercado-e-institui-open-energy" },
      { nome: "Canal Solar", url: "https://canalsolar.com.br/aneel-aprova-open-energy/" },
      { nome: "Cenário Energia", url: "https://cenarioenergia.com.br/2026/10/28/aneel-aprova-open-energy-e-simplifica-migracao-para-o-mercado-livre/" },
      { nome: "LawInfra", url: "https://www.lawinfra.com.br/noticias/aneel-open-energy-migracao-90-dias-mercado-livre-2026" },
    ],
  },
  {
    id: "decreto-baixa-tensao",
    data: "2026-08",
    tema: "abertura",
    titulo: "Decreto 13.097/2026 abre o mercado livre para a baixa tensão",
    status: "agendado",
    oQueMuda:
      "Consumidores de baixa tensão (Grupo B) poderão escolher o fornecedor de energia: comerciais e industriais a partir de 25/11/2027; residenciais e demais a partir de 25/11/2028. A regulamentação da ANEEL para o Grupo B segue em processo próprio.",
    quemAfeta: "Comércio, pequenas indústrias e residências; distribuidoras (perdem mercado cativo) e varejistas (ganham clientes).",
    marcos: [
      { data: "2027-11-25", descricao: "Baixa tensão comercial e industrial pode migrar" },
      { data: "2028-11-25", descricao: "Residências e demais consumidores de baixa tensão podem migrar" },
    ],
    naPlataforma: { label: "Quando posso migrar?", href: "/mercado-livre#migrar" },
    fontes: [
      { nome: "Mayer Brown", url: "https://www.mayerbrown.com/pt/insights/publications/2026/08/decree-no-13097-2026-opening-of-the-free-electricity-market" },
      { nome: "DGABC", url: "https://www.dgabc.com.br/Noticia/4340921/lula-publica-decreto-que-regulamenta-mercado-livre-de-energia-na-baixa-tensao" },
      { nome: "Cenário Energia (Abraceel)", url: "https://cenarioenergia.com.br/2026/08/13/regulamentacao-da-baixa-tensao-e-do-open-energy-consolida-avanco-do-mercado-livre-avalia-abraceel/" },
    ],
  },
  {
    id: "lei-15269",
    data: "2025-11-24",
    tema: "abertura",
    titulo: "Lei 15.269/2025: a reforma do setor elétrico",
    status: "vigente",
    oQueMuda:
      "Põe em lei o cronograma de abertura total do mercado livre e cria o Supridor de Última Instância (os custos do déficit involuntário dele são rateados entre os consumidores do mercado livre). Também realoca encargos e a CDE, cria incentivos para baterias e uma compensação por cortes de geração eólica e solar, que não cobre cortes por razão energética. Vários pontos dependem de regulamentação.",
    quemAfeta: "Todo o setor: consumidores livres (rateio do supridor de última instância), geradores renováveis, investidores em armazenamento.",
    naPlataforma: { label: "Risco de contraparte no simulador", href: "/mercado-livre#contraparte" },
    fontes: [
      { nome: "Texto da lei (MME)", url: "https://www.gov.br/mme/pt-br/acesso-a-informacao/legislacao/leis/lei-n-15-269-2025.pdf" },
      { nome: "Mayer Brown", url: "https://www.mayerbrown.com/pt/insights/publications/2025/12/lei-n-15-269-2025-novo-guia-da-reforma-do-setor-eletrico" },
      { nome: "Cenário Energia", url: "https://cenarioenergia.com.br/2026/01/20/reforma-do-setor-eletrico-lei-15-269-2025-redesenha-o-mercado-e-impoe-novos-desafios-regulatorios/" },
    ],
  },
  {
    id: "lrcap-baterias",
    data: "2026-06",
    tema: "leiloes",
    titulo: "Leilões de baterias em 2 e 4 de dezembro de 2026",
    status: "agendado",
    oQueMuda:
      "A Portaria Normativa MME 136/2026 criou dois leilões de reserva de capacidade para armazenamento: um com conteúdo nacional (02/12/2026) e outro aberto (04/12/2026). A bateria recebe por potência disponível; a energia de carga e descarga é liquidada ao PLD.",
    quemAfeta: "Desenvolvedores e investidores em baterias; fabricantes nacionais.",
    marcos: [
      { data: "2026-12-02", descricao: "LRCAP 2026 — Armazenamento Nacional" },
      { data: "2026-12-04", descricao: "LRCAP 2026 — Armazenamento" },
    ],
    naPlataforma: { label: "Estudo de BESS com receita de capacidade", href: "/bess" },
    ressalva: "Contrato de 10 anos com suprimento a partir de agosto de 2028 vem da consulta pública de nov/2025; confira a portaria final.",
    fontes: [
      { nome: "Portaria MME 136/2026 (CCEE)", url: "https://www.ccee.org.br/documents/80415/35700715/portaria_2026_136_diretriz_sistematica.pdf/6827d39b-af40-7f5b-86bc-cc24414cb4c7" },
      { nome: "Atlas Público", url: "https://atlaspublico.com.br/noticias/portaria-mme-n-136-define-regras-para-leiloes-de-baterias-52824" },
      { nome: "Agência iNFRA", url: "https://agenciainfra.com/blog/mme-publica-consulta-publica-sobre-as-diretrizes-do-leilao-de-baterias/" },
    ],
  },
  {
    id: "lrcap-4",
    data: "2026-03-18",
    tema: "leiloes",
    titulo: "4º Leilão de Reserva de Capacidade (geração)",
    status: "vigente",
    oQueMuda: "100 usinas vencedoras a um preço médio de R$ 2.334.731,34 por MW·ano: a referência mais recente de quanto o sistema paga por potência firme.",
    quemAfeta: "Térmicas e hidrelétricas contratadas; o custo vai para o encargo de reserva de capacidade, pago por todos os consumidores.",
    naPlataforma: { label: "Receita de capacidade no estudo de BESS", href: "/bess" },
    fontes: [{ nome: "CCEE — InfoLeilão", url: "https://www.ccee.org.br/documents/80415/31088149/InfoLeil%C3%A3o_expresso_04LRCAP_2026.pdf/ec548418-5998-43a6-a93b-e21516fcf0cc" }],
  },
  {
    id: "curtailment",
    data: "2026-07-21",
    tema: "renovaveis",
    titulo: "Portaria MME 140/2026: ressarcimento de cortes de eólicas e solares",
    status: "em implantação",
    oQueMuda:
      "Regulamenta o ressarcimento dos cortes de geração eólica e solar entre 01/09/2023 e 25/11/2025; os valores ainda serão apurados. Cortes por razão energética (sobra de geração) não são ressarcidos. Em janeiro a ANEEL tinha suspendido os ressarcimentos da REN 1.030/2022 por 90 dias, prorrogados por mais 60.",
    quemAfeta: "Geradores eólicos e solares; consumidores, que pagam o ressarcimento.",
    naPlataforma: { label: "Corte por razão, mês a mês", href: "/renovaveis" },
    fontes: [
      { nome: "Cenário Energia (Portaria 140)", url: "https://cenarioenergia.com.br/2026/07/22/mme-portaria-140-2026-ressarcimento-curtailment-eolica-solar/" },
      { nome: "Cenário Energia (suspensão)", url: "https://cenarioenergia.com.br/2026/01/20/aneel-suspende-ressarcimento-de-curtailment-por-90-dias-e-aguarda-nova-regulamentacao/" },
      { nome: "Canal Solar", url: "https://canalsolar.com.br/aneel-suspende-ressarcimentos-cortes-de-geracao/" },
    ],
  },
  {
    id: "inadimplencia",
    data: "2026-07-28",
    tema: "risco",
    titulo: "Cerco à inadimplência no mercado livre",
    status: "vigente",
    oQueMuda:
      "Comercializadoras inadimplentes desligadas da CCEE (2W, Diferencial) e autorização revogada (Minas Geração); medidas de controle e supervisão aprovadas em maio e transição para um modelo prudencial de garantias. Na liquidação de março, R$ 531,65 milhões ficaram sem pagamento, parte suspensa por despacho da ANEEL. A ANEEL consulta novas regras de segurança das transações.",
    quemAfeta: "Quem compra de comercializadora: se ela quebra, o volume contratado volta a ser comprado ao PLD.",
    naPlataforma: { label: "Exposição se a comercializadora quebrar", href: "/mercado-livre#contraparte" },
    fontes: [
      { nome: "Cenário Energia (desligamento 2W)", url: "https://cenarioenergia.com.br/2026/07/28/aneel-nega-efeito-suspensivo-e-mantem-desligamento-da-2w-comercializadora-da-ccee/" },
      { nome: "Cenário Energia (governança)", url: "https://cenarioenergia.com.br/2026/05/15/ccee-endurece-governanca-no-acl-amplia-adesoes-e-reforca-controle-sobre-inadimplencia-no-mercado-de-energia/" },
      { nome: "Cenário Energia (modelo prudencial)", url: "https://cenarioenergia.com.br/2026/06/11/ccee-registra-queda-de-39-na-inadimplencia-documental-e-prepara-transicao-para-modelo-prudencial-no-mercado-livre/" },
      { nome: "Agência iNFRA", url: "https://agenciainfra.com/blog/?p=41075" },
    ],
  },
  {
    id: "novomodelo",
    data: "2026-10-09",
    tema: "modelos",
    titulo: "NovoModelo: o SDDP aberto que deve formar o PLD a partir de 2028",
    status: "em implantação",
    oQueMuda:
      "ONS, CCEE e EPE abriram o código do NovoModelo, que deve substituir NEWAVE e DECOMP na formação do PLD em 2028, depois de um período sombra em 2027 e da homologação da ANEEL; o DESSEM continua no curto prazo. O código está em versão alpha.",
    quemAfeta: "Todo o mercado: é o modelo que vai calcular o valor da água e o preço.",
    marcos: [
      { data: "2027", descricao: "Período sombra (roda em paralelo com o oficial)" },
      { data: "2028", descricao: "Previsão de entrada na formação do PLD" },
    ],
    naPlataforma: { label: "Planejamento com o NovoModelo", href: "/planejamento" },
    fontes: [
      { nome: "Agência iNFRA", url: "https://agenciainfra.com/blog/novo-modelo-de-precificacao-da-energia-deve-estrear-em-2028-diz-ccee/" },
      { nome: "Cenário Energia (consulta)", url: "https://cenarioenergia.com.br/2026/08/24/ccee-ons-consulta-publica-novo-modelo-substituto-newave-decomp/" },
      { nome: "Código (GitHub)", url: "https://github.com/ons-ccee-epe/novomodelo" },
    ],
  },
  {
    id: "pld-2026",
    data: "2025-12",
    tema: "precos",
    titulo: "Limites do PLD em 2026",
    status: "vigente",
    oQueMuda:
      "Mínimo de R$ 57,31/MWh (TEO Itaipu), máximo horário de R$ 1.611,04/MWh e máximo estrutural de R$ 785,27/MWh (em 2025: R$ 58,60, R$ 1.542,23 e R$ 751,73). Os limites de 2027 costumam sair em dezembro.",
    quemAfeta: "Todo contrato e toda exposição ao mercado de curto prazo.",
    naPlataforma: { label: "PLD em tempo real", href: "/sin" },
    fontes: [
      { nome: "Cenário Energia", url: "https://cenarioenergia.com.br/2025/12/26/aneel-define-tarifas-de-otimizacao-servicos-ancilares-e-pld-para-2026-e-reforca-previsibilidade-ao-setor-eletrico/" },
      { nome: "Canal Solar", url: "https://canalsolar.com.br/aneel-define-limite-pld-2026/" },
    ],
  },
  {
    id: "bandeiras-2026",
    data: "2026-01-07",
    tema: "tarifas",
    titulo: "Bandeiras tarifárias: valores e calendário de 2026",
    status: "vigente",
    oQueMuda:
      "Acréscimo por 100 kWh na conta do mercado regulado: amarela R$ 1,885; vermelha patamar 1 R$ 4,463; vermelha patamar 2 R$ 7,877 (verde sem acréscimo). A bandeira de cada mês sai pelo calendário da ANEEL: a de novembro em 30/10/2026 e a de dezembro em 27/11/2026.",
    quemAfeta: "Consumidores do mercado regulado (cativos); entra na comparação com o mercado livre.",
    marcos: [{ data: "2026-11-27", descricao: "Anúncio da bandeira de dezembro" }],
    naPlataforma: { label: "Comparação mercado regulado × livre", href: "/mercado-livre#comparacao" },
    ressalva: "A ANEEL pode reajustar os valores no ciclo anual; confira a tabela vigente.",
    fontes: [
      { nome: "Cenário Energia (calendário)", url: "https://cenarioenergia.com.br/2026/01/07/aneel-divulga-calendario-das-bandeiras-tarifarias-para-2026-e-reforca-previsibilidade-para-consumidores-e-agentes-do-setor-eletrico/" },
      { nome: "Selectra (valores)", url: "https://selectra.net.br/energia/bandeira-tarifaria" },
    ],
  },
];

/** Acréscimo das bandeiras em R$/MWh (os valores oficiais são por 100 kWh). */
export const BANDEIRAS_RS_MWH = { verde: 0, amarela: 18.85, vermelha1: 44.63, vermelha2: 78.77 } as const;
export type Bandeira = keyof typeof BANDEIRAS_RS_MWH;
export const BANDEIRA_LABEL: Record<Bandeira, string> = { verde: "Verde", amarela: "Amarela", vermelha1: "Vermelha 1", vermelha2: "Vermelha 2" };

/** Quem pode migrar e quando (Portaria MME 50/2022 para o Grupo A; Decreto 13.097/2026 para a baixa tensão). */
export const MIGRACAO = [
  {
    key: "A",
    label: "Média e alta tensão (Grupo A)",
    desde: "2024-01-01",
    detalhe: "Já pode migrar; abaixo de 500 kW, representado por um comercializador varejista. Pelo Open Energy, o prazo regular cai para 90 dias na maior parte das unidades AS e A4.",
  },
  { key: "B-cn", label: "Baixa tensão comercial e industrial", desde: "2027-11-25", detalhe: "Decreto 13.097/2026." },
  { key: "B-res", label: "Residências e demais de baixa tensão", desde: "2028-11-25", detalhe: "Decreto 13.097/2026." },
] as const;

/** Itens do mais recente para o mais antigo (datas com só o mês contam como dia 1). */
export const radarSorted = (items: RadarItem[] = RADAR) => [...items].sort((a, b) => (a.data.length === 7 ? `${a.data}-01` : a.data) < (b.data.length === 7 ? `${b.data}-01` : b.data) ? 1 : -1);
