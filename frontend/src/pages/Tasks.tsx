import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardCheck, X } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDateTime, relTime } from "@/lib/format";
import type { Task } from "@/lib/types";
import { Badge, Empty, ErrorBox, PageHeader, RevDelta, Skeleton, toast } from "@/components/ui";

export default function Tasks() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("PENDENTE");
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const q = useQuery({ queryKey: ["tasks", status], queryFn: () => api.get<Task[]>(`/tasks/mine?status=${status}`) });
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: "APROVADA" | "REPROVADA"; note?: string }) => api.post(`/tasks/${v.id}/decide`, v),
    onSuccess: (_, v) => { toast.ok(v.decision === "APROVADA" ? "Etapa aprovada" : "Revisão devolvida ao autor"); setRejecting(null); setNote(""); void qc.invalidateQueries(); },
    onError: toast.err,
  });
  return (
    <>
      <PageHeader title="Minhas pendências" sub="Etapas de workflow atribuídas a você, pela ordem do prazo"
        actions={<select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
          <option value="PENDENTE">Pendentes</option><option value="APROVADA">Aprovadas por mim</option><option value="REPROVADA">Reprovadas por mim</option>
        </select>} />
      {q.error ? <ErrorBox error={q.error} /> : q.isLoading ? <Skeleton className="h-60" /> : q.data!.length === 0 ? (
        <div className="panel"><Empty title={status === "PENDENTE" ? "Nada pendente com você" : "Sem registros"} icon={<ClipboardCheck size={26} />}>Quando alguém enviar uma revisão para sua verificação, ela aparece aqui.</Empty></div>
      ) : (
        <ul className="space-y-2">
          {q.data!.map((t) => (
            <li key={t.id} className={`panel p-3 sm:p-4 ${t.overdue && t.status === "PENDENTE" ? "border-l-4 border-l-delta" : ""}`}>
              <div className="flex flex-wrap items-center gap-3">
                <RevDelta label={t.revision_label} />
                <div className="min-w-0 flex-1">
                  <Link to={`/documentos/${t.document_id}`} className="code text-[13px] text-ink-2 hover:underline">{t.code}</Link>
                  <div className="font-medium truncate">{t.title}</div>
                  <div className="text-[12px] text-muted">{t.project_code} · {t.template_name} · etapa {t.step_order}: {t.step_name}</div>
                </div>
                <div className="text-right">
                  {t.status === "PENDENTE" ? (
                    <>
                      {t.overdue ? <Badge tone="bad">Vencida {relTime(t.due_at)}</Badge> : <Badge tone="warn">Vence {relTime(t.due_at)}</Badge>}
                      <div className="text-[11px] text-muted mt-1 tnum">{fmtDateTime(t.due_at)}</div>
                    </>
                  ) : <Badge tone={t.status === "APROVADA" ? "ok" : "bad"}>{t.status.toLowerCase()}</Badge>}
                </div>
              </div>
              {t.status === "PENDENTE" && (rejecting === t.id ? (
                <div className="mt-3 flex flex-col sm:flex-row gap-2">
                  <input className="input" autoFocus placeholder="Motivo da reprovação (obrigatório)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Motivo" />
                  <button className="btn" onClick={() => setRejecting(null)}>Cancelar</button>
                  <button className="btn btn-danger" disabled={note.trim().length < 5 || decide.isPending} onClick={() => decide.mutate({ id: t.id, decision: "REPROVADA", note })}>Devolver ao autor</button>
                </div>
              ) : (
                <div className="mt-3 flex gap-2 justify-end">
                  <Link to={`/documentos/${t.document_id}`} className="btn btn-sm mr-auto">Abrir e comentar</Link>
                  <button className="btn btn-sm btn-danger" onClick={() => setRejecting(t.id)}><X size={14} /> Reprovar</button>
                  <button className="btn btn-sm btn-primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: t.id, decision: "APROVADA" })}><Check size={14} /> Aprovar etapa</button>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
