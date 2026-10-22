import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, X } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { Suggestion } from "@/lib/types";
import { Badge, Empty, ErrorBox, PageHeader, Skeleton, toast } from "@/components/ui";

const KIND = { METADADOS_CARIMBO: "Leitura de carimbo", COMENTARIO_ATENDIDO: "Comentário atendido", CLASSIFICACAO: "Classificação" };

export default function Suggestions() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("PROPOSTA");
  const q = useQuery({ queryKey: ["suggestions", status], queryFn: () => api.get<Suggestion[]>(`/suggestions?status=${status}`) });
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: "APLICADA" | "REJEITADA" }) => api.post(`/suggestions/${v.id}/decide`, { decision: v.decision }),
    onSuccess: () => void qc.invalidateQueries(), onError: toast.err,
  });
  return (
    <>
      <PageHeader title="Sugestões da IA"
        sub="A IA propõe, o humano decide. Nenhuma proposta altera documento ou comentário sem a sua decisão — o banco recusa."
        actions={<select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
          <option value="PROPOSTA">Aguardando decisão</option><option value="APLICADA">Aplicadas</option><option value="REJEITADA">Rejeitadas</option>
        </select>} />
      {q.error ? <ErrorBox error={q.error} /> : q.isLoading ? <Skeleton className="h-60" /> : q.data!.length === 0 ? (
        <div className="panel"><Empty title="Nenhuma proposta" icon={<Bot size={26} />}>Propostas surgem após o OCR (leitura do carimbo) e ao comparar uma nova revisão com os comentários da anterior.</Empty></div>
      ) : (
        <ul className="grid md:grid-cols-2 gap-3">
          {q.data!.map((s) => (
            <li key={s.id} className="panel p-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge tone="info">{KIND[s.kind]}</Badge>
                <span className="text-[12px] text-muted">{s.engine}</span>
                <span className="ml-auto text-[12px] tnum text-muted">{s.confidence !== null ? `${Math.round(s.confidence * 100)}%` : ""}</span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                {Object.entries(s.payload).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="break-words">{String(v)}</dd></div>)}
              </dl>
              <div className="flex items-center gap-2 mt-3">
                {s.target_type === "document" && <Link className="text-[13px] text-accent hover:underline mr-auto" to={`/documentos/${s.target_id}`}>Abrir documento</Link>}
                <span className="text-[11px] text-muted mr-auto">{fmtDateTime(s.created_at)}</span>
                {s.status === "PROPOSTA" && <>
                  <button className="btn btn-sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: s.id, decision: "REJEITADA" })}><X size={14} /> Rejeitar</button>
                  <button className="btn btn-sm btn-primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: s.id, decision: "APLICADA" })}><Check size={14} /> Aplicar</button>
                </>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
