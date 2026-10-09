"use client";

import Link from "next/link";
import { useState } from "react";
import { useConnection, useReadContract } from "wagmi";
import { ChevronDown, Download, ExternalLink, FileText, KeyRound, ShieldCheck } from "lucide-react";
import { useT } from "@/i18n/client";
import { identityRegistryAbi } from "@/lib/web3/abi";
import { chainName, explorerUrl, TARGET_CHAIN_ID } from "@/lib/web3/chains";
import { networkDeployment } from "@/lib/web3/deployments";
import { useSiwe } from "@/components/wallet/useSiwe";
import { KycForm } from "@/components/wallet/KycForm";
import { InterestDialog } from "@/components/aferi/InterestDialog";
import { Badge, buttonClass, Card, cx } from "@/components/ui";
import { usePortfolio, type Tx } from "./data";
import { RequireWallet } from "./Shell";

const KIND: Record<Tx["kind"], { sign: 1 | -1 | 0; tone: string }> = {
  aporte: { sign: -1, tone: "text-ink" },
  distribuicao: { sign: 1, tone: "text-good" },
  resgate: { sign: 1, tone: "text-good" },
  desistencia: { sign: 1, tone: "text-ink" },
  reembolso: { sign: 1, tone: "text-ink" },
  entrega: { sign: 0, tone: "text-ink" },
};

function Title({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <h1 className="text-[22px] font-bold text-ink">{title}</h1>
      <p className="mb-4 text-[13px] text-muted">{sub}</p>
    </>
  );
}

export function TransactionsPage() {
  const d = usePortfolio();
  const { d: L, f } = useT();
  const x = L.txp;
  const [filter, setFilter] = useState<"todas" | Tx["kind"]>("todas");
  const rows = d.txs.filter((t) => filter === "todas" || t.kind === filter);
  return (
    <RequireWallet>
      <Title title={x.title} sub={x.sub} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
          {(["todas", "aporte", "distribuicao", "resgate"] as const).map((k) => (
            <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={cx("rounded-full px-3 py-1 text-[12px] font-medium", filter === k ? "bg-brand text-brand-ink" : "border border-line-strong text-ink-2 hover:border-brand")}>
              {k === "todas" ? x.all : x.k[k]}
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-[14px] text-muted">{d.loading ? x.loading : x.none}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="text-left text-[12px] text-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-2.5 font-medium">{x.col.date}</th>
                  <th className="py-2.5 font-medium">{x.col.type}</th>
                  <th className="py-2.5 font-medium">{x.col.plant}</th>
                  <th className="py-2.5 text-right font-medium">{x.col.cotas}</th>
                  <th className="py-2.5 text-right font-medium">{x.col.amount}</th>
                  <th className="px-5 py-2.5 text-right font-medium">{x.col.receipt}</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {rows.map((t, i) => (
                  <tr key={`${t.at}-${i}`} className="border-b border-line/60 last:border-0">
                    <td className="px-5 py-3 text-ink-2">{f.date(t.at)}</td>
                    <td className="py-3 font-medium text-ink">{x.k[t.kind]}</td>
                    <td className="py-3 text-ink-2">{t.plant}</td>
                    <td className="py-3 text-right">{t.cotas ? f.num(t.cotas) : "—"}</td>
                    <td className={cx("py-3 text-right font-semibold", KIND[t.kind].tone)}>
                      {KIND[t.kind].sign === 0 ? "—" : `${KIND[t.kind].sign > 0 ? "+" : "−"} ${f.brl(t.amountBRL, 2)}`}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {t.hash ? (
                        <a href={explorerUrl("tx", t.hash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-good hover:underline">
                          BscScan <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="text-muted">{d.mode === "demo" ? x.demo : "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d.logsNote && <p className="border-t border-line px-5 py-3 text-[12px] text-muted">{L.pf.series[d.logsNote]}</p>}
      </Card>
    </RequireWallet>
  );
}

export function DocumentsPage() {
  const d = usePortfolio();
  const { d: L, t, f, locale } = useT();
  const x = L.docp;
  return (
    <RequireWallet>
      <Title title={x.title} sub={x.sub} />
      {d.positions.length === 0 ? (
        <Card className="p-8 text-center text-[14px] text-muted">
          {x.empty}{" "}
          <Link href="/usinas" className="font-semibold text-good hover:underline">
            {x.emptyLink}
          </Link>
          .
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {d.positions.map((p) => (
            <Card key={p.slug} className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-[15px] font-semibold text-ink">{p.name}</h2>
                  <p className="text-[12px] text-muted">
                    {t(x.cotasLine, { n: f.num(p.cotas + p.pendingCotas), city: p.municipio, uf: p.uf })}
                  </p>
                </div>
              </div>
              <ul className="mt-3 divide-y divide-line text-[13px]">
                {[
                  { href: `/api/usinas/${p.slug}/relatorio`, label: locale === "pt" ? x.reportPt : x.report },
                  { href: `/api/usinas/${p.slug}/relatorio?versao=completa`, label: x.audit },
                  { href: `/usinas/${p.slug}#riscos`, label: x.risks },
                ].map((doc) => (
                  <li key={doc.href}>
                    <a href={doc.href} className="group flex items-center gap-3 py-2.5">
                      <FileText className="size-4 text-critical" />
                      <span className="flex-1 text-ink-2 group-hover:text-good">{doc.label}</span>
                      <Download className="size-4 text-muted group-hover:text-good" />
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-4 text-[12px] text-muted">
        {x.verify}{" "}
        <Link href="/verificar" className="font-semibold text-good hover:underline">
          {x.verifyLink}
        </Link>
        .
      </p>
    </RequireWallet>
  );
}

export function ProfilePage() {
  const { address } = useConnection();
  const siwe = useSiwe();
  const reg = networkDeployment().identityRegistry;
  const { d: L } = useT();
  const x = L.prof;
  const kyc = useReadContract({
    address: reg,
    abi: identityRegistryAbi,
    functionName: "isVerified",
    args: address ? [address] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: Boolean(reg && address) },
  });
  return (
    <RequireWallet allowDemo={false}>
      <Title title={x.title} sub={x.sub} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-ink">{x.wallet}</h2>
          <dl className="mt-3 space-y-3 text-[14px]">
            <div>
              <dt className="text-[12px] text-muted">{x.address}</dt>
              <dd className="break-all font-mono text-[13px] text-ink">{address}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted">{x.network}</dt>
              <dd className="text-ink">{chainName}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted">{x.session}</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {siwe.isSignedIn ? <Badge tone="good">{x.sessionOk}</Badge> : <Badge tone="warning">{x.sessionNo}</Badge>}
                {!siwe.isSignedIn && (
                  <button className={cx(buttonClass.outline, "py-1")} onClick={() => siwe.signIn()}>
                    <KeyRound className="size-3.5" /> {siwe.status === "signing" ? L.wal.signing : x.confirm}
                  </button>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted">{x.kyc}</dt>
              <dd>{!reg ? <Badge>{x.kycNoReg}</Badge> : kyc.data ? <Badge tone="good">{x.kycOk}</Badge> : <Badge tone="warning">{x.kycPending}</Badge>}</dd>
            </div>
          </dl>
          {address && (
            <a href={explorerUrl("address", address)} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-good hover:underline">
              {x.bscscan} <ExternalLink className="size-3.5" />
            </a>
          )}
          <div className="mt-5 flex items-start gap-2 rounded-lg bg-surface-2 p-3 text-[12px] text-ink-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-good" />
            {x.safety}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-ink">{x.kycTitle}</h2>
          <p className="mb-4 text-[12px] text-muted">{x.kycSub}</p>
          <KycForm verifiedOnChain={reg ? Boolean(kyc.data) : undefined} />
        </Card>
      </div>
    </RequireWallet>
  );
}

const FAQ = ["1", "2", "3", "4", "5"] as const;

export function SupportPage() {
  const [open, setOpen] = useState(false);
  const { d: L } = useT();
  const x = L.sup;
  return (
    <div>
      <Title title={x.title} sub={x.sub} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="divide-y divide-line">
          {FAQ.map((n) => [x[`q${n}`], x[`a${n}`]] as const).map(([q, a]) => (
            <details key={q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14px] font-medium text-ink">
                {q} <ChevronDown className="size-4 text-muted transition group-open:rotate-180" />
              </summary>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{a}</p>
            </details>
          ))}
        </Card>
        <Card className="self-start bg-brand-soft/60 p-5">
          <h2 className="text-[15px] font-semibold text-ink">{x.questions}</h2>
          <p className="mt-1 text-[13px] text-ink-2">{x.team}</p>
          <button className={cx(buttonClass.primary, "mt-4 w-full")} onClick={() => setOpen(true)}>
            {L.int.titleSupport}
          </button>
          <Link href="/seguranca" className="mt-3 block text-center text-[13px] font-semibold text-good hover:underline">
            {x.security}
          </Link>
        </Card>
      </div>
      <InterestDialog open={open} onClose={() => setOpen(false)} tipo="suporte" />
    </div>
  );
}
