import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarRange, FolderKanban, MapPin, Plus, Users as UsersIcon } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, ROLE_LABEL } from "@/lib/format";
import type { Project } from "@/lib/types";
import { useSession } from "@/store/session";
import { Badge, Empty, ErrorBox, PageHeader, Skeleton } from "@/components/ui";

export function ProgressBar({ value, planned, label }: { value: number; planned?: number; label?: string }) {
  return (
    <div className="relative h-2 rounded-full bg-surface-2 overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label ?? "Avanço"}>
      <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.min(100, value)}%` }} />
      {planned !== undefined && planned > 0 && <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${Math.min(100, planned)}%` }} title={`Planejado ${planned}%`} />}
    </div>
  );
}

export default function Projects() {
  const me = useSession((s) => s.user);
  const [archived, setArchived] = useState(false);
  const q = useQuery({ queryKey: ["projects", "list", archived], queryFn: () => api.get<Project[]>(`/projects${archived ? "?archived=true" : ""}`) });

  return (
    <>
      <PageHeader title="Projetos" sub={q.data ? `${q.data.filter((p) => p.active).length} ativo(s)` : " "} actions={<>
        <label className="flex items-center gap-2 text-sm text-ink-2 px-2"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Mostrar arquivados</label>
        {me?.is_admin && <Link className="btn btn-primary" to="/projetos/novo"><Plus size={16} /> Novo projeto</Link>}
      </>} />
      {q.error ? <ErrorBox error={q.error} /> : q.isLoading ? <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3"><Skeleton className="h-44" /><Skeleton className="h-44" /><Skeleton className="h-44" /></div>
        : q.data!.length === 0 ? (
          <div className="panel">
            <Empty title={me?.is_admin ? "Crie o primeiro projeto" : "Você ainda não participa de projetos"} icon={<FolderKanban size={28} />}>
              {me?.is_admin ? <>
                <p>O projeto define a codificação dos documentos, as áreas, as disciplinas e o fluxo de aprovação.</p>
                <Link className="btn btn-primary mt-4" to="/projetos/novo"><Plus size={16} /> Novo projeto</Link>
              </> : "Peça ao administrador para incluí-lo na equipe de um projeto."}
            </Empty>
          </div>
        ) : (
          <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {q.data!.map((p) => (
              <li key={p.id}>
                <Link to={`/projetos/${p.id}`} className={`panel p-4 block h-full hover:border-line-strong transition-colors ${p.active ? "" : "opacity-60"}`}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="code text-[13px] text-accent">{p.code}</div>
                      <div className="font-semibold leading-snug truncate">{p.name}</div>
                      <div className="text-[13px] text-muted truncate">{p.client ?? "Sem cliente"}</div>
                    </div>
                    {!p.active ? <Badge>arquivado</Badge> : p.late > 0 && <Badge tone="bad"><AlertTriangle size={12} /> {p.late} atrasado(s)</Badge>}
                  </div>
                  <div className="mt-4 mb-1.5 flex items-baseline justify-between text-[13px]">
                    <span className="text-muted">Avanço da documentação</span><span className="font-semibold tnum">{p.progress_pct.toFixed(1)}%</span>
                  </div>
                  <ProgressBar value={p.progress_pct} />
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
                    <span className="tnum">{p.documents} doc. · {p.issued} emitido(s)</span>
                    <span className="inline-flex items-center gap-1"><UsersIcon size={13} /> {p.members}</span>
                    {(p.start_date || p.end_date) && <span className="inline-flex items-center gap-1"><CalendarRange size={13} /> {fmtDate(p.start_date)} – {fmtDate(p.end_date)}</span>}
                    {p.location && <span className="inline-flex items-center gap-1"><MapPin size={13} /> {p.location}</span>}
                  </div>
                  <div className="mt-2 text-[12px] text-muted">Seu perfil: {ROLE_LABEL[p.my_role ?? ""] ?? "—"}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </>
  );
}
