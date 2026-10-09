import type { Metadata } from "next";
import { ExternalLink, KeyRound, Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import { plants } from "@/data/plants";
import { chainName, explorerUrl, TARGET_CHAIN_ID } from "@/lib/web3/chains";
import { networkDeployment, plantContracts } from "@/lib/web3/deployments";
import { Card, CardHeader, Container, Notice, SectionTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Segurança", description: "Como a Aferi Capital protege sua carteira, seus fundos e os dados das usinas." };

const walletTiers = [
  {
    tier: "Máxima",
    tone: "text-good",
    items: ["Carteira de hardware (Ledger ou Trezor) conectada pela Rabby ou pela MetaMask", "Para tesouraria/SPE: Safe (multisig) com 2-de-3 ou 3-de-5 assinantes"],
  },
  {
    tier: "Alta",
    tone: "text-info",
    items: [
      "Rabby — mostra a simulação do que cada transação fará antes de você assinar",
      "Binance Wallet (extensão ou app, autocustódia MPC) — nativa da BNB Chain",
      "MetaMask — padrão de mercado",
    ],
  },
  {
    tier: "Evite para BNB Chain",
    tone: "text-warning",
    items: ["Phantom — excelente em Solana, mas não é a escolha natural para a BNB Chain", "Carteiras de corretora (custodiais) — os tokens precisam ficar numa carteira com KYC registrado no contrato"],
  },
];

const appControls = [
  ["Descoberta EIP-6963", "Cada extensão se identifica (nome, ícone, rdns). Você escolhe exatamente qual usar; nenhuma extensão “sequestra” o window.ethereum."],
  ["Login por assinatura (SIWE, EIP-4361)", "Prova de posse da carteira sem transação e sem custo: domínio, nonce de uso único, rede e expiração conferidos no servidor; sessão em cookie HttpOnly/SameSite=Strict."],
  ["Endereços em lista fixa", "O app só interage com os contratos do arquivo de implantação versionado no repositório. Nenhum endereço vem de URL ou de parâmetro."],
  ["Aprovação no valor exato", "Nunca pedimos aprovação ilimitada de USDT: aprova-se só o valor da compra, que o contrato consome em seguida."],
  ["Simulação antes de assinar", "Toda escrita é simulada (eth_call) antes de abrir a carteira; se fosse reverter, você vê o motivo sem gastar gás."],
  ["Rede travada", `Transações só na ${chainName} (chainId ${TARGET_CHAIN_ID}); em outra rede o app pede a troca antes.`],
  ["CSP com nonce e anti-clickjacking", "Content-Security-Policy estrita (scripts só do próprio site), frame-ancestors 'none', HSTS e demais cabeçalhos de segurança."],
  ["Sem chaves no servidor", "O servidor nunca guarda chave privada. Operações administrativas são feitas por multisig, fora do site."],
];

const contractControls = [
  ["Token restrito (ERC-3643-lite)", "A cota é um BEP-20 com 0 decimais que só transfere entre carteiras com KYC válido no IdentityRegistry."],
  ["Oferta com custódia (escrow)", "O USDT fica no contrato da oferta até o encerramento. Meta mínima não atingida ou oferta cancelada → cada investidor resgata 100% do valor."],
  ["Direito de desistência por aporte", "Cada aporte pode ser desistido em até 5 dias, com devolução integral (inspirado na Resolução CVM 88). Um novo aporte não reabre os anteriores, e quem desiste não pode aportar de novo na mesma oferta — isso impede que um grupo ocupe o teto da captação e desista no fim."],
  ["Reembolso garantido por prazo", "Se a oferta atingir a meta mas não for encerrada no prazo, ela passa automaticamente a “não concluída” e cada investidor resgata o valor — o dinheiro não fica preso."],
  ["Distribuição pro-rata on-chain", "Acumulador por cota (padrão ERC-2222): receitas anteriores a uma transferência ficam com quem vendeu; ninguém resgata mais do que foi distribuído."],
  ["Imutáveis", "Sem proxy de atualização: o código que você audita é o código que roda para sempre."],
  ["Papéis separados", "Admin (com atraso de 2 dias na transferência), KYC, distribuidor, documentos e pausa são papéis distintos; o admin e o registro de documentos ficam só com o multisig (a carteira do servidor de KYC não pode alterar o hash dos relatórios)."],
  ["Emissão travada", "O contrato que pode emitir cotas é definido uma única vez no deploy (a oferta) e nunca mais pode ser trocado — nem o admin consegue emitir cotas para si."],
  ["Proteções padrão", "OpenZeppelin v5, ReentrancyGuard, SafeERC20 com checagem de saldo (rejeita tokens com taxa), checks-effects-interactions e erros customizados."],
];

export default function SegurancaPage() {
  const net = networkDeployment();
  const deployed = plants.map((p) => ({ p, c: plantContracts(p.slug) }));
  return (
    <Container className="py-12">
      <SectionTitle as="h1" eyebrow="Segurança" title="Seus fundos, sua chave, regras no código">
        A Aferi Capital é não-custodial: o dinheiro vai da sua carteira para contratos públicos e auditáveis na BNB Chain — nunca para uma conta da empresa durante a captação.
      </SectionTitle>

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {walletTiers.map((t) => (
          <Card key={t.tier}>
            <div className="p-5">
              <div className={`text-[13px] font-semibold uppercase tracking-wide ${t.tone}`}>Segurança {t.tier.toLowerCase()}</div>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-[14px] text-ink-2">
                {t.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-6">
        <Notice tone="warning" title="Regras de ouro">
          Ninguém da Aferi Capital vai pedir sua frase de recuperação (seed) ou chave privada — nunca. Confira se o endereço do site está correto antes de conectar,
          confira o endereço do contrato no BscScan antes de assinar e revise aprovações antigas periodicamente (ex.: revoke.cash).
        </Notice>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <Card as="section">
          <CardHeader title={<span className="inline-flex items-center gap-2"><Lock className="size-4 text-brand" /> Proteções do site</span>} />
          <dl className="divide-y divide-line px-5">
            {appControls.map(([k, v]) => (
              <div key={k} className="py-3">
                <dt className="text-[14px] font-medium">{k}</dt>
                <dd className="mt-1 text-[13px] text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card as="section">
          <CardHeader title={<span className="inline-flex items-center gap-2"><ShieldCheck className="size-4 text-brand" /> Proteções dos contratos</span>} />
          <dl className="divide-y divide-line px-5">
            {contractControls.map(([k, v]) => (
              <div key={k} className="py-3">
                <dt className="text-[14px] font-medium">{k}</dt>
                <dd className="mt-1 text-[13px] text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card as="section" className="mt-6">
        <CardHeader title={<span className="inline-flex items-center gap-2"><KeyRound className="size-4 text-brand" /> Contratos implantados — {chainName}</span>} subtitle="Confira estes endereços no BscScan; são os únicos com que o site interage." />
        <div className="overflow-x-auto p-5">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="py-2 text-left font-medium">Contrato</th>
                <th className="py-2 text-left font-medium">Endereço</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[12px]">
              {[
                ["IdentityRegistry (KYC)", net.identityRegistry],
                [`Token de pagamento (USDT${TARGET_CHAIN_ID === 97 ? " de teste" : " BEP-20"})`, net.paymentToken],
                ...deployed.flatMap(({ p, c }) => [
                  [`${p.token.symbol} — token`, c?.token],
                  [`${p.token.symbol} — oferta`, c?.offering],
                ]),
              ].map(([k, v]) => (
                <tr key={k as string} className="border-b border-line/50">
                  <td className="py-2 pr-4 font-sans text-ink-2">{k}</td>
                  <td className="py-2">
                    {v ? (
                      <a href={explorerUrl("address", v as string)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-ink hover:text-brand">
                        {v} <ExternalLink className="size-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="font-sans text-muted">ainda não implantado</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card as="section" className="mt-6">
        <CardHeader title={<span className="inline-flex items-center gap-2"><ShieldAlert className="size-4 text-warning" /> Premissas de confiança (o que o código não resolve sozinho)</span>} />
        <ul className="list-disc space-y-2 px-10 py-5 text-[14px] text-ink-2">
          <li>O administrador do token pode executar a recuperação de carteira perdida (exigência de valores mobiliários) — por isso deve ser um multisig com atraso, e cada uso emite um evento público.</li>
          <li>A distribuição depende da SPE repassar a receita real da usina; o relatório de auditoria e os registros do documento on-chain dão transparência, mas a governança da SPE é jurídica, não só técnica.</li>
          <li>Antes da mainnet, os contratos devem passar por auditoria externa independente; esta versão roda na testnet.</li>
          <li>O preço da cota é em USDT e a receita da usina é em reais: há risco cambial na conversão das distribuições.</li>
        </ul>
      </Card>
    </Container>
  );
}
