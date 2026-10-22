import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { api, qs } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { AuditRow } from "@/lib/types";
import { ErrorBox, PageHeader, Skeleton } from "@/components/ui";

export default function Audit() {
  const [entity, setEntity] = useState("");
  const verify = useQuery({ queryKey: ["audit-verify"], queryFn: () => api.get<{ intact: boolean; n: number; last_id: number; broken: { broken_id: number; reason: string }[] }>("/audit/verify") });
  const q = useQuery({ queryKey: ["audit", entity], queryFn: () => api.get<AuditRow[]>(`/audit${qs({ entity, limit: 300 })}`) });
  const v = verify.data;
  return (
    <>
      <PageHeader title="Trilha de auditoria" sub="Append-only, encadeada por SHA-256. Nenhuma linha pode ser alterada ou apagada — nem pelo administrador do banco via aplicação." />
      <div className={`panel p-4 mb-4 flex items-center gap-3 ${v && !v.intact ? "border-bad" : ""}`}>
        {verify.isLoading ? <Skeleton className="h-8 w-80" /> : verify.error ? <ErrorBox error={verify.error} /> : v!.intact ? (
          <><ShieldCheck className="text-ok" /><div><div className="font-medium">Cadeia íntegra</div><div className="text-[13px] text-muted tnum">{v!.n} eventos verificados até o #{v!.last_id}</div></div></>
        ) : (
          <><ShieldAlert className="text-bad" /><div><div className="font-medium text-bad">Cadeia quebrada no evento #{v!.broken[0]?.broken_id}</div><div className="text-[13px]">{v!.broken[0]?.reason}. Trate como incidente de segurança.</div></div></>
        )}
        <button className="btn btn-sm ml-auto" onClick={() => void verify.refetch()}>Verificar novamente</button>
      </div>
      <select className="input w-auto mb-3" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Entidade">
        <option value="">Todas as entidades</option>
        {["document", "revision", "revision_file", "workflow_task", "revision_comment", "grd", "grd_item", "ai_suggestion", "document_checkout", "project_member", "app_user"].map((e) => <option key={e}>{e}</option>)}
      </select>
      {q.error ? <ErrorBox error={q.error} /> : q.isLoading ? <Skeleton className="h-80" /> : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead className="border-b border-line bg-surface-2/60"><tr>
              <th className="th">#</th><th className="th">Quando</th><th className="th">Quem</th><th className="th">Ação</th><th className="th">Entidade</th><th className="th">Dados</th><th className="th">Hash</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {q.data!.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="td tnum text-muted">{a.id}</td>
                  <td className="td tnum whitespace-nowrap">{fmtDateTime(a.at)}</td>
                  <td className="td">{a.actor ?? "sistema"}</td>
                  <td className="td code">{a.action}</td>
                  <td className="td code">{a.entity}</td>
                  <td className="td"><code className="code text-[11px] text-ink-2 line-clamp-2 break-all">{JSON.stringify(a.data)}</code></td>
                  <td className="td code text-[11px] text-muted" title={a.hash}>{a.hash.slice(0, 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
