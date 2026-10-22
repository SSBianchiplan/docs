import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDateTime, relTime, STATUS } from "@/lib/format";
import type { Dashboard as D, RevisionStatus } from "@/lib/types";
import { useUi } from "@/store/ui";
import { useSession } from "@/store/session";
import { useProjects } from "@/lib/hooks";
import { FolderPlus, Plus, UserPlus } from "lucide-react";
import { Empty, ErrorBox, PageHeader, RevDelta, Skeleton, StatusBadge } from "@/components/ui";

function Metric({ label, value, to, alert }: { label: string; value: number | undefined; to?: string; alert?: boolean }) {
  const body = (
    <div className={`panel px-4 py-3 h-full ${alert && value ? "border-delta/50" : ""}`}>
      <div className="text-[13px] text-muted">{label}</div>
      <div className={`text-[28px] font-semibold tnum leading-tight ${alert && value ? "text-delta" : ""}`}>{value ?? "—"}</div>
    </div>
  );
  return to ? <Link to={to} className="block hover:brightness-[0.98]">{body}</Link> : body;
}

function Bars({ data }: { data: D["emissions"] }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <div className="flex items-end gap-1.5 h-40" role="img" aria-label="Emissões por semana nas últimas 12 semanas">
      {data.map((d) => (
        <div key={d.week} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <span className="text-[11px] tnum text-muted">{d.n || ""}</span>
          <div className="w-full rounded-t bg-accent/80" style={{ height: `${(d.n / max) * 100}%`, minHeight: d.n ? 3 : 1, opacity: d.n ? 1 : 0.25 }} />
          <span className="text-[10px] text-muted truncate w-full text-center">{d.week.slice(-3)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const projectId = useUi((s) => s.projectId);
  const q = useQuery({ queryKey: ["dashboard", projectId], queryFn: () => api.get<D>(`/dashboard${projectId ? `?project_id=${projectId}` : ""}`) });
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  const c = d?.counters;
  const total = d?.by_status.reduce((a, b) => a + b.n, 0) ?? 0;
  const me = useSession((st) => st.user);
  const projects = useProjects();
  const noProjects = projects.data?.length === 0;

  return (
    <>
      <PageHeader title="Painel" sub={d ? `Atualizado ${fmtDateTime(new Date().toISOString())}` : "Carregando…"} />
      {noProjects && (
        <section className="panel p-5 sm:p-6 mb-5 border-accent/40 bg-accent-soft/40 flex flex-col md:flex-row md:items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-accent text-accent-ink flex items-center justify-center shrink-0"><FolderPlus size={24} /></div>
          <div className="flex-1">
            <h2 className="font-semibold text-lg">{me?.is_admin ? "Comece criando o primeiro projeto" : "Você ainda não participa de nenhum projeto"}</h2>
            <p className="text-sm text-ink-2 mt-0.5">{me?.is_admin
              ? "Em poucos passos você define a codificação dos documentos, as áreas, as disciplinas, o fluxo de aprovação e a equipe. Depois importe a lista de documentos por planilha."
              : "Peça ao administrador para incluí-lo na equipe de um projeto."}</p>
          </div>
          {me?.is_admin && <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <Link className="btn btn-primary h-10 px-4" to="/projetos/novo"><Plus size={16} /> Criar projeto</Link>
            <Link className="btn h-10 px-4" to="/usuarios"><UserPlus size={16} /> Cadastrar equipe</Link>
          </div>}
        </section>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Metric label="Minhas pendências" value={c?.my_tasks} to="/pendencias" />
        <Metric label="Pendências vencidas" value={c?.my_overdue} to="/pendencias" alert />
        <Metric label="Comentários obrigatórios abertos" value={c?.mandatory_open} alert />
        <Metric label="GRD aguardando recebimento" value={c?.grds_awaiting_receipt} to="/grd" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="panel p-4 lg:col-span-2">
          <h2 className="font-semibold mb-3">Emissões por semana</h2>
          {!d ? <Skeleton className="h-40" /> : d.emissions.some((e) => e.n > 0) ? <Bars data={d.emissions} />
            : <Empty title="Nenhuma emissão nas últimas 12 semanas">Revisões passam a contar aqui quando saem em uma GRD emitida.</Empty>}
        </section>

        <section className="panel p-4">
          <h2 className="font-semibold mb-3">Situação da revisão vigente</h2>
          {!d ? <Skeleton className="h-40" /> : total === 0 ? <Empty title="Nenhum documento ainda" /> : (
            <ul className="space-y-2">
              {d.by_status.map((s) => (
                <li key={s.status}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{STATUS[s.status as RevisionStatus]?.label ?? "Sem revisão"}</span>
                    <span className="tnum text-muted">{s.n}</span>
                  </div>
                  <div className="h-1.5 rounded bg-surface-2 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${(s.n / total) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel lg:col-span-2 overflow-hidden">
          <h2 className="font-semibold px-4 pt-4 pb-2">Revisões recentes</h2>
          {!d ? <Skeleton className="m-4 h-40" /> : d.recent.length === 0 ? <Empty title="Sem revisões ainda">Crie um documento na lista mestra para começar.</Empty> : (
            <ul className="divide-y divide-line">
              {d.recent.map((r) => (
                <li key={r.document_id + r.label}>
                  <Link to={`/documentos/${r.document_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <RevDelta label={r.label} size="sm" />
                    <span className="code text-ink-2 shrink-0">{r.code}</span>
                    <span className="truncate flex-1">{r.title}</span>
                    <StatusBadge status={r.status} />
                    <span className="text-[12px] text-muted hidden sm:inline w-24 text-right">{relTime(r.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel p-4 space-y-4">
          <div>
            <h2 className="font-semibold mb-2">Tarefas vencidas da equipe</h2>
            {!d ? <Skeleton className="h-20" /> : d.overdue.length === 0 ? <p className="text-sm text-muted">Nenhuma tarefa fora do prazo.</p> : (
              <ul className="space-y-2">
                {d.overdue.map((t) => (
                  <li key={t.id} className="text-sm">
                    <Link to={`/documentos/${t.document_id}`} className="hover:underline code">{t.code}</Link>
                    <span className="text-muted"> rev. {t.revision_label} · {t.step_name}</span>
                    <div className="text-[12px] text-delta">{t.assignee} · venceu {relTime(t.due_at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-line pt-3 grid grid-cols-3 gap-2 text-center">
            <div><div className="text-[12px] text-muted">Fila de OCR</div><div className="font-semibold tnum">{c?.ocr_queue ?? "—"}</div></div>
            <div><div className="text-[12px] text-muted">OCR com falha</div><div className={`font-semibold tnum ${c?.ocr_failed ? "text-bad" : ""}`}>{c?.ocr_failed ?? "—"}</div></div>
            <Link to="/ia"><div className="text-[12px] text-muted">Propostas da IA</div><div className="font-semibold tnum">{c?.ai_pending ?? "—"}</div></Link>
          </div>
        </section>
      </div>
    </>
  );
}
