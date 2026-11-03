"use client";

import { FileUp, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Badge, Button, Disclosure, Empty, PageHeader, Panel, Table, type Level } from "@/components/ui";
import { useIara } from "@/lib/assistant/settings";
import { conferirLote, enqDe, type Severidade } from "@/lib/gd/bill";
import { GD_TEMAS, type GdTema } from "@/lib/gd/rules";
import { clearCarteira, lerFaturas, lerTexto, removeFatura, useCarteira, type LeituraResultado } from "@/lib/gd/workspace";
import { Simulador } from "./Simulador";

const rs = (v: number | undefined) => (v === undefined ? "—" : `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const kwh = (v: number | undefined) => (v === undefined ? "—" : `${Math.round(v).toLocaleString("pt-BR")}`);
const SEV: Record<Severidade, Level> = { alta: "critical", media: "warning", baixa: "neutral" };
const TEMA_TITULO: Record<GdTema, string> = {
  enquadramento: "Enquadramento GD I, II e III",
  fio_b: "Fio B e a transição até 2029",
  custo_disponibilidade: "Custo de disponibilidade (sem cobrança dupla)",
  creditos: "Créditos de energia",
  modalidades: "Modalidades e limites",
  garantia: "Garantia de fiel cumprimento",
  icms: "ICMS sobre a energia compensada",
  pis_cofins: "PIS/Cofins sobre a energia compensada",
  bandeiras: "Bandeiras tarifárias",
  grupo_a: "Grupo A (demanda, postos, reativo)",
  contratos: "Contratos: locação, assinatura, consórcio",
  encargos: "Encargos e componentes da tarifa",
  conexao: "Conexão e inversão de fluxo",
};

export default function GdPage() {
  const carteira = useCarteira();
  const cfg = useIara();
  const fileRef = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState<{ done: number; total: number } | null>(null);
  const [ultimas, setUltimas] = useState<LeituraResultado[]>([]);
  const [texto, setTexto] = useState("");
  const lote = useMemo(() => conferirLote(carteira.faturas, carteira.ucs), [carteira]);
  const faturas = useMemo(() => [...carteira.faturas].sort((a, b) => (a.uc ?? "").localeCompare(b.uc ?? "") || (a.ref ?? "").localeCompare(b.ref ?? "")), [carteira.faturas]);
  const headers = (): Record<string, string> => (cfg.code ? { "x-assistente-code": cfg.code } : {});

  const enviar = async (list: FileList | null) => {
    const files = [...(list ?? [])].slice(0, 120);
    if (fileRef.current) fileRef.current.value = "";
    if (!files.length) return;
    setLendo({ done: 0, total: files.length });
    setUltimas(await lerFaturas(files, headers(), (done, total) => setLendo({ done, total })));
    setLendo(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Geração distribuída"
        subtitle="Leitura e conferência de faturas, enquadramento GD I/II/III, Fio B, viabilidade, contratos e encargos. Tudo calculado sem IA; a Iara só explica o resultado."
        right={
          <Button variant="secondary" onClick={() => window.dispatchEvent(new Event("iara:abrir"))}>
            Perguntar à Iara
          </Button>
        }
      />

      <Panel
        title="Faturas"
        subtitle="PDF original da distribuidora (com texto). Energia em kWh. As faturas ficam só neste navegador; o servidor lê e descarta o arquivo."
        right={
          <>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf,.txt" multiple hidden onChange={(e) => void enviar(e.target.files)} />
            <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={!!lendo}>
              <FileUp size={15} aria-hidden />
              {lendo ? `Lendo ${lendo.done}/${lendo.total}…` : "Enviar PDFs"}
            </Button>
            {carteira.faturas.length ? (
              <Button
                variant="ghost"
                onClick={() => {
                  if (window.confirm("Apagar todas as faturas e UCs deste navegador?")) clearCarteira();
                }}
              >
                Limpar
              </Button>
            ) : null}
          </>
        }
      >
        {ultimas.some((u) => u.erro) ? (
          <ul className="mb-3 flex flex-col gap-1 text-[13px] text-critical" role="alert">
            {ultimas
              .filter((u) => u.erro)
              .map((u, i) => (
                <li key={i}>
                  {u.nome}: {u.erro}
                </li>
              ))}
          </ul>
        ) : null}
        {faturas.length ? (
          <Table
            label="Faturas lidas"
            head={["UC", "Mês", "Enq.", "Consumo", "Injetada", "Compensada", "Saldo", "Total", "Leitura", ""]}
            align={["left", "left", "left", "right", "right", "right", "right", "right", "right", "right"]}
            rows={faturas.map((f) => [
              <span key="u" className="flex flex-col leading-tight">
                <span>{f.uc ?? "—"}</span>
                {f.distribuidora ? <span className="text-[11px] text-muted">{f.distribuidora}</span> : null}
              </span>,
              f.ref ?? "—",
              enqDe(f, carteira.ucs.find((u) => u.uc === f.uc)),
              kwh(f.consumoKwh),
              kwh(f.injetadaKwh),
              kwh(f.compensadaKwh),
              kwh(f.saldoKwh),
              rs(f.totalRs),
              <span key="c" title={f.faltando.length ? `faltando: ${f.faltando.join(", ")}` : "todos os campos-chave lidos"} className={f.confianca < 0.6 ? "text-warning" : ""}>
                {Math.round(f.confianca * 100)}%
              </span>,
              <button key="x" onClick={() => removeFatura(f.id)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink" aria-label={`Remover fatura ${f.uc ?? ""} ${f.ref ?? ""}`}>
                <Trash2 size={14} />
              </button>,
            ])}
          />
        ) : (
          <Empty label="Nenhuma fatura ainda. Envie os PDFs ou cole o texto de uma fatura abaixo." />
        )}
        <Disclosure title="Colar o texto de uma fatura" hint="quando o PDF não tem texto selecionável">
          <form
            className="flex flex-col gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!texto.trim()) return;
              const r = await lerTexto(texto);
              setUltimas([r]);
              if (r.fatura) setTexto("");
            }}
          >
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={6} className="w-full rounded-xl bg-surface-2 p-3 text-[13px] text-ink" placeholder="Cole aqui o texto copiado da fatura" aria-label="Texto da fatura" />
            <div>
              <Button type="submit" disabled={!texto.trim()}>
                Ler texto
              </Button>
            </div>
          </form>
        </Disclosure>
      </Panel>

      <Panel title="Conferência" subtitle="Indícios para revisar com a distribuidora — não é erro confirmado. Impacto em R$ estimado pelo preço médio da própria fatura.">
        {lote.faturas ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Faturas", String(lote.faturas)],
                ["Alertas altos", String(lote.totais.alta)],
                ["Alertas médios", String(lote.totais.media)],
                ["Impacto estimado", rs(lote.totais.impactoRs)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-2xl bg-surface-2/60 p-3">
                  <div className="text-[12px] text-muted">{k}</div>
                  <div className="tnum text-[20px] font-semibold text-ink">{v}</div>
                </div>
              ))}
            </div>
            {lote.alertas.length ? (
              <ul className="flex flex-col gap-2">
                {lote.alertas.slice(0, 40).map((a, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-surface-2/40 px-3 py-2 text-[13px]">
                    <Badge level={SEV[a.sev]}>{a.sev}</Badge>
                    <span className="text-muted">
                      UC {a.uc} · {a.ref}
                    </span>
                    {a.impactoRs ? <span className="tnum ml-auto font-medium text-ink sm:order-last">{rs(a.impactoRs)}</span> : null}
                    <span className="w-full text-ink-2 sm:w-auto sm:min-w-0 sm:flex-1">{a.msg}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-good">Nenhum indício encontrado nas faturas lidas.</p>
            )}
            {lote.ucs.some((u) => u.demanda) ? (
              <div className="text-[13px] text-ink-2">
                {lote.ucs
                  .filter((u) => u.demanda)
                  .map((u) => (
                    <p key={u.uc}>
                      UC {u.uc}: demanda contratada ótima <strong>{u.demanda!.otimaKw} kW</strong>
                      {u.demanda!.economiaAnoRs ? ` — economia de ${rs(u.demanda!.economiaAnoRs)} por ano frente aos ${u.demanda!.atualKw} kW atuais` : ""}.
                    </p>
                  ))}
              </div>
            ) : null}
          </div>
        ) : (
          <Empty label="A conferência aparece quando houver faturas." />
        )}
      </Panel>

      <Simulador />

      <Panel title="Regras de bolso" subtitle="Lei 14.300/2022, REN ANEEL 1.059/2023 e normas tributárias. Triagem: confirme a redação vigente e a prática da distribuidora.">
        <div className="flex flex-col">
          {(Object.keys(GD_TEMAS) as GdTema[]).map((t) => (
            <Disclosure key={t} title={TEMA_TITULO[t]}>
              <p className="max-w-3xl text-[13.5px] leading-relaxed text-ink-2">{GD_TEMAS[t]}</p>
            </Disclosure>
          ))}
        </div>
      </Panel>
    </div>
  );
}
