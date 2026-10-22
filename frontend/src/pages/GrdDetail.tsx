import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, Send, Trash2 } from "lucide-react";
import { api, qs } from "@/lib/api";
import { fmtDateTime, PURPOSE } from "@/lib/format";
import type { GrdDetail as G, MasterRow, Page } from "@/lib/types";
import { Badge, Empty, ErrorBox, PageHeader, RevDelta, Skeleton, StatusBadge, toast } from "@/components/ui";
import { GRD_TONE } from "./Grds";

export default function GrdDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [sel, setSel] = useState<string[]>([]);
  const [receiver, setReceiver] = useState("");
  const q = useQuery({ queryKey: ["grd", id], queryFn: () => api.get<G>(`/grds/${id}`) });
  const g = q.data?.grd;
  const draft = g?.status === "RASCUNHO";
  const eligible = useQuery({
    queryKey: ["eligible", g?.project_id], enabled: !!draft,
    queryFn: () => api.get<Page<MasterRow>>(`/documents${qs({ project_id: g!.project_id, status: "APROVADA_INTERNA,EMITIDA,APROVADA,APROVADA_COM_COMENTARIOS", size: 500 })}`),
  });
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { setSel([]); void qc.invalidateQueries(); },
    onError: toast.err,
  });
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data || !g) return <Skeleton className="h-96" />;
  const inGrd = new Set(q.data.items.map((i) => i.revision_id));
  const candidates = (eligible.data?.items ?? []).filter((r) => r.revision_id && !inGrd.has(r.revision_id));

  return (
    <>
      <nav className="text-[13px] text-muted mb-2 print:hidden"><Link to="/grd" className="hover:underline">GRD</Link> / {g.code ?? "Rascunho"}</nav>
      <PageHeader
        title={<span className="flex items-center gap-3"><span className="code">{g.code ?? "GRD em rascunho"}</span><Badge tone={GRD_TONE[g.status]}>{g.status.toLowerCase()}</Badge></span>}
        sub={`${g.project_code} · ${g.project_name}${g.client ? ` · cliente ${g.client}` : ""}`}
        actions={<div className="flex gap-2 print:hidden">
          {g.status !== "RASCUNHO" && <button className="btn" onClick={() => window.print()}><Printer size={15} /> Imprimir guia</button>}
          {draft && <button className="btn btn-primary" disabled={q.data.items.length === 0 || act.isPending}
            onClick={() => confirm(`Emitir a GRD com ${q.data!.items.length} item(ns)? A numeração é definitiva, os itens ficam congelados e as revisões aprovadas passam a EMITIDA.`) && act.mutate(() => api.post(`/grds/${id}/issue`))}>
            <Send size={15} /> Emitir GRD</button>}
          {draft && <button className="btn btn-danger" onClick={() => confirm("Cancelar este rascunho?") && act.mutate(() => api.post(`/grds/${id}/cancel`))}>Cancelar</button>}
        </div>} />

      <section className="panel mb-4 grid grid-cols-2 md:grid-cols-4 divide-x divide-line">
        <div className="px-4 py-3"><div className="text-[11px] text-muted">Destinatário</div><div className="text-sm">{g.recipient}</div><div className="text-[12px] text-muted">{g.recipient_email}</div></div>
        <div className="px-4 py-3"><div className="text-[11px] text-muted">Finalidade</div><div className="text-sm">{g.purpose} · {PURPOSE[g.purpose]}</div></div>
        <div className="px-4 py-3"><div className="text-[11px] text-muted">Emitida</div><div className="text-sm">{fmtDateTime(g.issued_at)}</div><div className="text-[12px] text-muted">{g.issued_by_name}</div></div>
        <div className="px-4 py-3"><div className="text-[11px] text-muted">Recebida</div><div className="text-sm">{fmtDateTime(g.received_at)}</div><div className="text-[12px] text-muted">{g.received_by}</div></div>
      </section>
      {g.manifest_sha256 && <p className="text-[12px] text-muted mb-4">Manifesto SHA-256 <span className="code break-all">{g.manifest_sha256}</span> — prova do conteúdo remetido (códigos, revisões e hashes dos arquivos).</p>}

      <section className="panel overflow-x-auto mb-4">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-line bg-surface-2/60"><tr>
            <th className="th">Código</th><th className="th">Rev.</th><th className="th">Título</th><th className="th">Situação</th><th className="th">Arquivos</th><th className="th">Mídia</th>{draft && <th className="th" />}
          </tr></thead>
          <tbody className="divide-y divide-line">
            {q.data.items.length === 0 && <tr><td colSpan={7}><Empty title="GRD sem itens">Selecione abaixo as revisões a remeter.</Empty></td></tr>}
            {q.data.items.map((i) => (
              <tr key={i.revision_id}>
                <td className="td code"><Link to={`/documentos/${i.document_id}`} className="hover:underline">{i.code}</Link></td>
                <td className="td"><RevDelta label={i.label} size="sm" /></td>
                <td className="td">{i.title}</td>
                <td className="td"><StatusBadge status={i.status} /></td>
                <td className="td text-[13px] text-ink-2 max-w-60 truncate" title={i.files ?? ""}>{i.files ?? "—"}</td>
                <td className="td text-[13px]">{i.media.toLowerCase()}</td>
                {draft && <td className="td"><button className="btn btn-ghost btn-sm" aria-label={`Remover ${i.code}`} onClick={() => act.mutate(() => api.del(`/grds/${id}/items/${i.revision_id}`))}><Trash2 size={15} /></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {draft && (
        <section className="panel p-4 print:hidden">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Revisões disponíveis para remessa</h2>
            <button className="btn btn-primary btn-sm" disabled={!sel.length} onClick={() => act.mutate(() => api.post(`/grds/${id}/items`, { revision_ids: sel }))}>Incluir {sel.length || ""} selecionada(s)</button>
          </div>
          {eligible.isLoading ? <Skeleton className="h-32" /> : candidates.length === 0 ? <p className="text-sm text-muted">Nenhuma revisão aprovada internamente ou emitida disponível neste projeto.</p> : (
            <ul className="divide-y divide-line max-h-96 overflow-y-auto">
              {candidates.map((r) => (
                <li key={r.revision_id}>
                  <label className="flex items-center gap-3 py-2 cursor-pointer">
                    <input type="checkbox" checked={sel.includes(r.revision_id!)} onChange={(e) => setSel(e.target.checked ? [...sel, r.revision_id!] : sel.filter((x) => x !== r.revision_id))} />
                    <RevDelta label={r.revision_label} size="sm" />
                    <span className="code text-[13px] w-48 shrink-0 truncate">{r.code}</span>
                    <span className="truncate flex-1 text-sm">{r.title}</span>
                    <StatusBadge status={r.revision_status} />
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {g.status === "EMITIDA" && (
        <section className="panel p-4 flex flex-col sm:flex-row gap-2 items-stretch sm:items-end print:hidden">
          <label className="flex-1"><span className="label">Registrar protocolo de recebimento</span>
            <input className="input" value={receiver} onChange={(e) => setReceiver(e.target.value)} placeholder="Nome de quem recebeu" /></label>
          <button className="btn btn-primary" disabled={receiver.length < 2} onClick={() => act.mutate(() => api.post(`/grds/${id}/receive`, { received_by: receiver }))}>Confirmar recebimento</button>
        </section>
      )}
    </>
  );
}
