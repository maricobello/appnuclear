import { ExternalLink } from "lucide-react";
import { PageHeader, Panel } from "@/components/ui";
import { PLD_LIMITS } from "@/lib/market/brazil";
import { SOURCE_LIST } from "@/lib/sources/registry";

interface Model {
  name: string;
  role: string;
  math: string;
  refs: string[];
  code: { label: string; href: string }[];
  validation: string;
}

const MODELS: Model[] = [
  {
    name: "LEAR — LASSO Estimated AutoRegressive",
    role: "Previsão pontual horária do PLD (24 modelos, um por hora). A previsão PUBLICADA é a média simples LEAR ⊕ ingênuo semanal.",
    math: "p̃_{d,h} = asinh((p − mediana)/MAD·) ; p̃_{d,h} = β₀ + Σ_{L∈{1,2,3,7}} Σ_{h'} β_{L,h'} p̃_{d−L,h'} + Σ γ_k DoW_k ; β por LASSO (LARS) com λ escolhido por AICc ; ŷ limitado à faixa de p̃ vista no treino ; publicado = ½·LEAR + ½·ingênuo",
    refs: [
      "Lago, Marcjasz, De Schutter & Weron (2021), Applied Energy 293 — benchmark aberto de EPF",
      "Uniejewski, Nowotarski & Weron (2016), Energies 9(8)",
      "Efron, Hastie, Johnstone & Tibshirani (2004), Annals of Statistics — LARS",
      "Uniejewski, Weron & Ziel (2018), IEEE TPWRS — transformação asinh",
    ],
    code: [
      { label: "jeslago/epftoolbox", href: "https://github.com/jeslago/epftoolbox" },
      { label: "scikit-learn LassoLarsIC", href: "https://github.com/scikit-learn/scikit-learn" },
    ],
    validation: "Backtest rolante com re-estimação diária em 891 dias reais (abr/2024–set/2026): LEAR sozinho rMAE 1,04–1,12 (perde do ingênuo no período longo); média LEAR ⊕ ingênuo 0,95–0,99 nos 4 submercados, melhor que o LEAR com DM (Newey–West) t ≈ −3,9 a −4,5. Em produção: rMAE e DM (HAC de Bartlett, HLN) nos últimos 28 dias.",
  },
  {
    name: "Adaptive Conformal Inference (ACI)",
    role: "Intervalo de 90% com cobertura garantida sem supor distribuição, adaptado a mudanças de regime.",
    math: "α_{t+1} = α_t + γ(α − 𝟙{y_t ∉ Ĉ_t}) ; Ĉ_t = ŷ_t ± Q_{⌈(n+1)(1−α_t)⌉/n}(|resíduos|)",
    refs: ["Gibbs & Candès (2021), NeurIPS", "Angelopoulos & Bates (2023), Found. & Trends in ML — introdução à predição conformal", "Kupiec (1995) — teste de cobertura"],
    code: [{ label: "scikit-learn-contrib/MAPIE", href: "https://github.com/scikit-learn-contrib/MAPIE" }],
    validation: "Teste unitário: cobertura empírica entre 87% e 93% para alvo de 90%. Escore normalizado pelo fator da hora (a cobertura é a da banda publicada). Em produção: Kupiec com efeito de desenho diário (violações se agrupam no dia) e independência de Christoffersen na mesma hora de dias consecutivos. A faixa da média diária é conformal nos erros diários por horizonte.",
  },
  {
    name: "Quantile Regression Averaging (QRA)",
    role: "Distribuição do PLD de D+1 combinando previsões pontuais (LEAR + ingênuo).",
    math: "q_τ(y | f) = β_τ' [1, f_LEAR, f_naive] ; min Σ ρ_τ(y − β'x) via MM (Hunter & Lange) ; rearranjo monotônico",
    refs: ["Nowotarski & Weron (2015), Computational Statistics 30(3)", "Hunter & Lange (2000), JCGS 9(1)", "Chernozhukov, Fernández-Val & Galichon (2010), Econometrica"],
    code: [{ label: "statsmodels QuantReg", href: "https://github.com/statsmodels/statsmodels" }],
    validation: "Teste unitário recupera inclinação e quantil 90% de DGP conhecido. Avaliação por CRPS (Gneiting & Raftery, 2007).",
  },
  {
    name: "Monte Carlo: cópula empírica + dois fatores (nível diário + MRJD intradiário)",
    role: "Cenários estocásticos (1.000 trajetórias) em torno da previsão publicada — base do Monte Carlo, do CVaR e do LSMC.",
    math: "r_{d,h} = m_d + u_{d,h} ; m_d = φ m_{d−1} + η_d ; du = −κu dt + σ dW + J dN ; κ pelo AR(1) within com correção de Nickell ; saltos no resíduo do AR(1) (limiar 4,5·MAD) ; postos simulados → quantis empíricos dos erros reais por horizonte (y = ŷ + s_h·Q_k(u)) ; fator diário e κ calibrados em grade (dispersão da média do dia e variação intradiária)",
    refs: ["Schwartz (1997), Journal of Finance 52(3)", "Cartea & Figueroa (2005), Applied Mathematical Finance 12(4)", "Nickell (1981), Econometrica 49(6)", "Weron (2014), Int. J. Forecasting — revisão de EPF"],
    code: [{ label: "statsmodels (AR/OU)", href: "https://github.com/statsmodels/statsmodels" }],
    validation: "Testes unitários: recupera κ, a variância e o AR(1) do nível diário de painéis sintéticos, inclusive com saltos. Em dados reais (56 origens por submercado): cobertura 5–95% horária 0,93 em D+1 e 0,85–0,91 em D+2–D+7; média diária realizada abaixo do p05 simulado em 2–7% dos dias (antes 14–24%). Em aberto: variação intradiária simulada ~1,3× a real.",
  },
  {
    name: "Markov-switching / HMM gaussiano (3 regimes)",
    role: "Probabilidade de estar em regime de piso/excedente, base ou estresse — e projeção 24 h / 7 dias.",
    math: "P(S_t=j | S_{t−1}=i) = A_ij ; y_t | S_t=k ~ N(μ_k, σ_k²) ; EM (Baum–Welch) com forward–backward escalonado ; Viterbi",
    refs: ["Hamilton (1989), Econometrica 57(2)", "Janczura & Weron (2010), Energy Economics 32(5)", "Rabiner (1989), Proc. IEEE 77(2)"],
    code: [{ label: "hmmlearn/hmmlearn", href: "https://github.com/hmmlearn/hmmlearn" }],
    validation: "Teste unitário: recupera médias e persistência de dois regimes simulados.",
  },
  {
    name: "GARCH(1,1)",
    role: "Volatilidade condicional do PLD médio diário e sua projeção.",
    math: "σ²_t = ω + α ε²_{t−1} + β σ²_{t−1} ; MLE gaussiana (Nelder–Mead) com α+β<1",
    refs: ["Bollerslev (1986), Journal of Econometrics 31(3)"],
    code: [{ label: "bashtage/arch", href: "https://github.com/bashtage/arch" }],
    validation: "Teste unitário: estima persistência de série GARCH simulada.",
  },
  {
    name: "ADF, Engle–Granger e meia-vida",
    role: "Spreads entre submercados: estacionariedade, cointegração e velocidade de convergência.",
    math: "Δs_t = a + γ s_{t−1} + Σ δ_i Δs_{t−i} ; p-valor MacKinnon ; y = a + b x + u, ADF(û) ; t½ = −ln2 / ln(1+b)",
    refs: ["Said & Dickey (1984), Biometrika", "Engle & Granger (1987), Econometrica 55(2)", "MacKinnon (2010), Queen's Econ. WP 1227"],
    code: [{ label: "statsmodels adfuller/coint", href: "https://github.com/statsmodels/statsmodels" }],
    validation: "Testes unitários: p-valores nos valores críticos de MacKinnon, continuidade da superfície, distinção passeio aleatório × AR(1), detecção de cointegração.",
  },
  {
    name: "Armazenamento: LP/MILP exato (HiGHS) + Least-Squares Monte Carlo",
    role: "Despacho ótimo de bateria (BESS), valor da opcionalidade sob incerteza de preço e despacho de D+1 com o SoC final valorizado pela previsão (rolling intrinsic).",
    math: "max Σ p_t(d_t − c_t)Δt − κ(η_c c_t + d_t/η_d)Δt + V(e_T) s.a. e_t = e_{t−1} + η_c c_tΔt − d_tΔt/η_d, 0 ≤ c,d ≤ P, E_min ≤ e ≤ E_max (binária u_t se p < 0) ; intrínseco na curva E[p] ; extrínseco = LSMC − DP na mesma grade: V_t(s) = max_{s'} [CF + E(V_{t+1}(s') | p_t)]",
    refs: ["Huangfu & Hall (2018), Math. Programming Computation 10 — HiGHS", "Bellman (1957)", "Longstaff & Schwartz (2001), Review of Financial Studies 14(1)", "Boogert & de Jong (2008), Journal of Derivatives 15(3)"],
    code: [{ label: "HiGHS", href: "https://github.com/ERGO-Code/HiGHS" }, { label: "highs-js (WASM)", href: "https://github.com/lovasoa/highs-js" }, { label: "QuantLib (LSMC)", href: "https://github.com/lballabio/QuantLib" }],
    validation: "Testes unitários: LP ≥ DP e converge para ela com grade fina; balanço de energia, potência, SoC, rampa e ciclos respeitados; MILP sem carga/descarga simultâneas com preço negativo; intrínseco ≤ com opcionalidade ≤ informação perfeita (LP por trajetória).",
  },
  {
    name: "Risco: VaR, CVaR (Expected Shortfall) e Ômega",
    role: "Cauda de perdas da estratégia de armazenamento.",
    math: "CVaR_α = E[−P&L | P&L ≤ q_{1−α}] ; Ω = E[(P&L)⁺] / E[(−P&L)⁺]",
    refs: ["Rockafellar & Uryasev (2000), Journal of Risk 2(3)", "Artzner et al. (1999), Mathematical Finance", "Keating & Shadwick (2002)"],
    code: [{ label: "PyPortfolioOpt (CVaR)", href: "https://github.com/robertmartin8/PyPortfolioOpt" }],
    validation: "Teste unitário: VaR normal analítico e CVaR ≥ VaR.",
  },
];

const ROADMAP = [
  { name: "Foundation models de séries temporais (Chronos-Bolt, TimesFM 2.x, Moirai)", note: "exigem serviço Python/GPU — plugáveis via rota /api/previsao como regressor extra na QRA", href: "https://github.com/amazon-science/chronos-forecasting" },
  { name: "DNN do epftoolbox (hiperparâmetros por Optuna)", note: "benchmark de Lago et al. (2021) — combina bem com o LEAR em ensembles", href: "https://github.com/jeslago/epftoolbox" },
  { name: "SDDP (Pereira & Pinto, 1991) — lógica do NEWAVE/DECOMP/DESSEM (CEPEL)", note: "modelos oficiais que formam o CMO/PLD; reproduzir exige decks do ONS", href: "https://github.com/odow/SDDP.jl" },
];

export default function ModelosPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Modelos & APIs"
        subtitle="Tudo implementado em TypeScript puro (roda em qualquer runtime da Vercel), com testes que validam cada método contra resultados conhecidos da literatura. As referências de código apontam as implementações canônicas no GitHub usadas como base de comparação."
      />

      <Panel title="Como o PLD é formado" subtitle="Por que o CMO do ONS é o melhor preditor e o melhor auditor do PLD">
        <ol className="grid list-decimal grid-cols-1 gap-2 pl-5 text-xs leading-relaxed text-ink-2 md:grid-cols-2">
          <li>O NEWAVE (médio prazo, SDDP) e o DECOMP (curto prazo) — modelos oficiais do CEPEL — calculam o valor da água nos reservatórios.</li>
          <li>O DESSEM (programação diária) usa esse valor e calcula o CMO semi-horário por subsistema para o dia seguinte.</li>
          <li>A CCEE publica o PLD horário = CMO limitado ao piso (R$ {PLD_LIMITS.min.toLocaleString("pt-BR")}) e ao teto horário (R$ {PLD_LIMITS.maxHourly.toLocaleString("pt-BR")}) de {PLD_LIMITS.year} — {PLD_LIMITS.source}.</li>
          <li>Logo: EAR/ENA (hidrologia), carga, vento e sol explicam o nível; o CMO programado antecipa o PLD de D+1; e a divergência PLD × CMO é um teste de integridade de dados.</li>
        </ol>
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {MODELS.map((m) => (
          <Panel key={m.name} title={m.name} subtitle={m.role}>
            <pre className="scrollbar-thin mb-3 overflow-x-auto whitespace-pre-wrap rounded-md border border-line bg-surface-2 p-2.5 font-mono text-[11px] leading-relaxed text-ink-2">{m.math}</pre>
            <ul className="mb-3 flex flex-col gap-0.5 text-[11px] text-muted">
              {m.refs.map((r) => (
                <li key={r}>• {r}</li>
              ))}
            </ul>
            <div className="mb-2 flex flex-wrap gap-2">
              {m.code.map((c) => (
                <a key={c.href} href={c.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] text-accent hover:border-accent/50">
                  {c.label} <ExternalLink size={11} aria-hidden />
                </a>
              ))}
            </div>
            <p className="text-[11px] text-ink-2">
              <span className="text-muted">Validação: </span>
              {m.validation}
            </p>
          </Panel>
        ))}
      </div>

      <Panel title="Roadmap de modelos" subtitle="Próximos passos com maior retorno esperado">
        <ul className="flex flex-col gap-2 text-xs">
          {ROADMAP.map((r) => (
            <li key={r.name} className="flex flex-col">
              <a href={r.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink hover:text-accent">
                {r.name} <ExternalLink size={11} aria-hidden />
              </a>
              <span className="text-muted">{r.note}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="APIs públicas integradas" subtitle="Todas gratuitas; só a EIA exige chave (opcional)">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {SOURCE_LIST.map((s) => (
            <div key={s.id} className="rounded-md border border-line bg-surface-2 p-3 text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-ink">{s.name}</span>
                <span className="text-[10px] text-muted">{s.region}</span>
              </div>
              <div className="mt-0.5 text-muted">{s.provider}</div>
              <p className="mt-1.5 leading-relaxed text-ink-2">{s.description}</p>
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
                <span>{s.cadence}</span>
                <a href={s.docs} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                  docs <ExternalLink size={11} aria-hidden />
                </a>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
