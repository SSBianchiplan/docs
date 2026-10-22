import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Send } from "lucide-react";
import { api, qs } from "@/lib/api";
import { fmtDate, PURPOSE } from "@/lib/format";
import { useProjects } from "@/lib/hooks";
import type { GrdRow, Purpose } from "@/lib/types";
import { useUi } from "@/store/ui";
import { Badge, Drawer, Empty, ErrorBox, Field, PageHeader, Skeleton, toast } from "@/components/ui";

export const GRD_TONE = { RASCUNHO: "neutral", EMITIDA: "accent", RECEBIDA: "ok", CANCELADA: "neutral" } as const;

export default function Grds() {
  const projectId = useUi((s) => s.projectId);
  const projects = useProjects();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ project_id: projectId ?? "", recipient: "", recipient_email: "", purpose: "PA" as Purpose, notes: "" });
  const q = useQuery({ queryKey: ["grds", projectId], queryFn: () => api.get<GrdRow[]>(`/grds${qs({ project_id: projectId })}`) });
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>("/grds", { ...f, recipient_email: f.recipient_email || null, notes: f.notes || null }),
    onSuccess: (r) => nav(`/grd/${r.id}`), onError: toast.err,
  });
  const control = projects.data?.filter((p) => p.my_role === "ADMIN" || p.my_role === "CONTROLADOR") ?? [];
  return (
    <>
      <PageHeader title="Guias de remessa (GRD)" sub="Numeração sequencial por projeto, atribuída só na emissão"
        actions={control.length > 0 && <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Nova GRD</button>} />
      {q.error ? <ErrorBox error={q.error} /> : q.isLoading ? <Skeleton className="h-60" /> : q.data!.length === 0 ? (
        <div className="panel"><Empty title="Nenhuma GRD" icon={<Send size={26} />}>Crie uma GRD e inclua revisões aprovadas internamente para emiti-las ao cliente.</Empty></div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-line bg-surface-2/60"><tr>
              <th className="th">Número</th><th className="th">Destinatário</th><th className="th">Finalidade</th><th className="th text-right">Itens</th>
              <th className="th">Situação</th><th className="th">Emissão</th><th className="th">Recebimento</th></tr></thead>
            <tbody className="divide-y divide-line">
              {q.data!.map((g) => (
                <tr key={g.id} className="hover:bg-surface-2 cursor-pointer" onClick={() => nav(`/grd/${g.id}`)}>
                  <td className="td code"><Link to={`/grd/${g.id}`} onClick={(e) => e.stopPropagation()}>{g.code ?? `Rascunho · ${g.project_code}`}</Link></td>
                  <td className="td">{g.recipient}</td>
                  <td className="td text-ink-2">{PURPOSE[g.purpose]}</td>
                  <td className="td tnum text-right">{g.items}</td>
                  <td className="td"><Badge tone={GRD_TONE[g.status]}>{g.status.toLowerCase()}</Badge></td>
                  <td className="td tnum">{fmtDate(g.issued_at)}</td>
                  <td className="td tnum">{fmtDate(g.received_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Drawer open={open} onClose={() => setOpen(false)} title="Nova GRD" footer={<>
        <button className="btn" onClick={() => setOpen(false)}>Cancelar</button>
        <button className="btn btn-primary" disabled={!f.project_id || f.recipient.length < 2 || create.isPending} onClick={() => create.mutate()}>Criar rascunho</button>
      </>}>
        <Field label="Projeto">
          <select className="input" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>
            <option value="">Selecione</option>{control.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select>
        </Field>
        <Field label="Destinatário"><input className="input" value={f.recipient} onChange={(e) => setF({ ...f, recipient: e.target.value })} placeholder="Empresa / setor" /></Field>
        <Field label="E-mail do destinatário"><input className="input" type="email" value={f.recipient_email} onChange={(e) => setF({ ...f, recipient_email: e.target.value })} /></Field>
        <Field label="Finalidade de emissão">
          <select className="input" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value as Purpose })}>
            {(Object.keys(PURPOSE) as Purpose[]).map((p) => <option key={p} value={p}>{p} · {PURPOSE[p]}</option>)}
          </select>
        </Field>
        <Field label="Observações"><textarea className="input h-20 py-2" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </Drawer>
    </>
  );
}
