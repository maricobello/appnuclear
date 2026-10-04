"use client";

import { useState } from "react";
import { useReadContracts } from "wagmi";
import type { Hex } from "viem";
import { CheckCircle2, FileSearch, XCircle } from "lucide-react";
import { plants } from "@/data/plants";
import { plantTokenAbi } from "@/lib/web3/abi";
import { TARGET_CHAIN_ID } from "@/lib/web3/chains";
import { plantContracts } from "@/lib/web3/deployments";
import { extractAttachments, readPdfInfo, sha256HexBrowser } from "@/lib/pdfAttachment";
import { dateBR } from "@/lib/fmt";
import { Card, cx, Notice } from "@/components/ui";
import { docName } from "@/components/plant/OnChainPanel";

type Result = {
  fileName: string;
  fileHash: string;
  title?: string;
  embeddedHash?: string;
  declaredHash?: string;
  jsonOk?: boolean;
};

const tokens = plants.map((p) => ({ plant: p, token: plantContracts(p.slug)?.token })).filter((x) => x.token);

export function VerifyReport() {
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  const lists = useReadContracts({
    allowFailure: true,
    query: { enabled: tokens.length > 0 },
    contracts: tokens.map((t) => ({ address: t.token!, abi: plantTokenAbi, functionName: "getAllDocuments", chainId: TARGET_CHAIN_ID }) as const),
  });
  const pairs = tokens.flatMap((t, i) => {
    const r = lists.data?.[i];
    const names = r?.status === "success" ? (r.result as readonly Hex[]) : [];
    return names.map((n) => ({ ...t, name: n }));
  });
  const docs = useReadContracts({
    allowFailure: true,
    query: { enabled: pairs.length > 0 },
    contracts: pairs.map((p) => ({ address: p.token!, abi: plantTokenAbi, functionName: "getDocument", args: [p.name], chainId: TARGET_CHAIN_ID }) as const),
  });
  const registry = pairs.map((p, i) => {
    const r = docs.data?.[i];
    const d = r?.status === "success" ? (r.result as readonly [string, Hex, bigint]) : undefined;
    return { plant: p.plant.name, name: docName(p.name), hash: d?.[1]?.slice(2).toLowerCase(), ts: d ? Number(d[2]) : undefined };
  });

  async function handle(file: File) {
    setErr(null);
    setBusy(true);
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("Arquivo grande demais (máx. 20 MB).");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const fileHash = await sha256HexBrowser(bytes);
      let title: string | undefined;
      let declaredHash: string | undefined;
      let embeddedHash: string | undefined;
      let jsonOk: boolean | undefined;
      try {
        const info = await readPdfInfo(bytes);
        title = info.title;
        declaredHash = (info.keywords ?? "").match(/[a-f0-9]{64}/i)?.[0]?.toLowerCase();
        const att = (await extractAttachments(bytes)).find((a) => a.name.endsWith(".json"));
        if (att) {
          embeddedHash = await sha256HexBrowser(att.data);
          jsonOk = declaredHash ? embeddedHash === declaredHash : undefined;
        }
      } catch {
        // PDF ilegível: segue só com o hash do arquivo
      }
      setRes({ fileName: file.name, fileHash, title, declaredHash, embeddedHash, jsonOk });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const match = res ? registry.find((r) => r.hash === res.fileHash) : undefined;

  return (
    <div className="space-y-6">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handle(f);
        }}
        className={cx("flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition", drag ? "border-brand bg-brand-soft" : "border-line-strong bg-surface hover:border-brand/50")}
      >
        <FileSearch className="size-10 text-brand" />
        <span className="mt-3 text-[15px] font-medium">{busy ? "Calculando…" : "Arraste o PDF do relatório ou clique para escolher"}</span>
        <span className="mt-1 text-[13px] text-muted">O arquivo não sai do seu computador.</span>
        <input type="file" accept="application/pdf" className="sr-only" onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} />
      </label>

      {err && <Notice tone="critical">{err}</Notice>}

      {res && (
        <Card>
          <div className="space-y-4 p-5 text-[14px]">
            <div>
              <div className="text-[12px] text-muted">Arquivo</div>
              <div>{res.title ?? res.fileName}</div>
              <div className="mt-1 break-all font-mono text-[12px] text-ink-2">SHA-256 {res.fileHash}</div>
            </div>
            {match ? (
              <div className="flex gap-3 rounded-xl border border-good/30 bg-good/5 p-3 text-good">
                <CheckCircle2 className="size-5 shrink-0" />
                <div className="text-ink-2">
                  <b className="text-ink">Autêntico.</b> Este arquivo é exatamente o documento “{match.name}” registrado no contrato da {match.plant}
                  {match.ts ? ` em ${dateBR(match.ts * 1000, true)}` : ""}.
                </div>
              </div>
            ) : (
              <div className="flex gap-3 rounded-xl border border-line bg-surface-2 p-3">
                <XCircle className="size-5 shrink-0 text-muted" />
                <div className="text-ink-2">
                  Este arquivo não corresponde a nenhum documento registrado on-chain{registry.length === 0 ? " (nenhum documento registrado ainda nesta rede)" : ""}. Relatórios baixados agora
                  são gerados com dados ao vivo; só a versão oficial publicada pela SPE é registrada no contrato.
                </div>
              </div>
            )}
            {res.embeddedHash && (
              <div className={cx("flex gap-3 rounded-xl border p-3", res.jsonOk ? "border-good/30 bg-good/5" : "border-warning/30 bg-warning/5")}>
                {res.jsonOk ? <CheckCircle2 className="size-5 shrink-0 text-good" /> : <XCircle className="size-5 shrink-0 text-warning" />}
                <div className="text-ink-2">
                  {res.jsonOk ? (
                    <>
                      <b className="text-ink">Dados íntegros.</b> O JSON anexado ao PDF reproduz a impressão digital declarada no relatório.
                    </>
                  ) : (
                    <>Os dados anexados não reproduzem a impressão digital declarada — o PDF pode ter sido alterado.</>
                  )}
                  <div className="mt-1 break-all font-mono text-[11px] text-muted">dados {res.embeddedHash}</div>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
