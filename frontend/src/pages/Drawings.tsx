import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, DraftingCompass, MessageSquare } from "lucide-react";
import { api, fileUrl, qs } from "@/lib/api";
import { abrirNoDrawings } from "@/lib/integracao";
import { PURPOSE, relTime } from "@/lib/format";
import type { Purpose, RevisionStatus } from "@/lib/types";
import { useUi } from "@/store/ui";
import { Badge, Empty, ErrorBox, PageHeader, RevDelta, Skeleton, StatusBadge } from "@/components/ui";

interface Linha {
  id: string; code: string; title: string; discipline_code: string; doc_type_code: string;
  project_code: string; project_name: string; updated_at: string; drawing_id: string | null; drawing_versao: string | null;
  enviado_por: string | null; enviado_em: string | null; folha: string | null; escala: string | null; formato: string | null;
  revision_label: string | null; revision_status: RevisionStatus | null; purpose: Purpose | null; open_comments: number;
  thumb_file_id: string | null;
}

function Miniatura({ fileId }: { fileId: string | null }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { if (fileId) fileUrl(fileId, { thumb: true }).then(setSrc).catch(() => setSrc(null)); }, [fileId]);
  return (
    <div className="aspect-[16/10] bg-surface-2 border-b border-line grid place-items-center overflow-hidden">
      {src ? <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" /> : <DraftingCompass size={28} className="text-muted" />}
    </div>
  );
}

/** Área separada para os arquivos que vêm do GPlanSiS|Drawings. */
export default function Drawings() {
  const projectId = useUi((s) => s.projectId);
  const [busca, setBusca] = useState("");
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ["integracao-desenhos", projectId, busca],
    queryFn: () => api.get<{ items: Linha[] }>(`/integracao/desenhos${qs({ project_id: projectId, q: busca })}`),
    refetchInterval: 30_000,
  });
  const itens = q.data?.items ?? [];
  const pendentes = itens.reduce((n, d) => n + (d.open_comments || 0), 0);
  return (
    <>
      <PageHeader title="Drawings"
        sub={`Folhas enviadas pelo GPlanSiS|Drawings · ${itens.length} documento(s)${pendentes ? ` · ${pendentes} comentário(s) aberto(s)` : ""}`}
        actions={<>
          <input className="input w-56" placeholder="Buscar código ou título" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <button className="btn btn-primary" onClick={() => abrirNoDrawings("")}><DraftingCompass size={16} /> Abrir o Drawings</button>
        </>} />
      {q.error ? <ErrorBox error={q.error} /> : q.isLoading ? <Skeleton className="h-60" /> : itens.length === 0 ? (
        <div className="panel"><Empty title="Nenhuma folha do Drawings ainda" icon={<DraftingCompass size={26} />}>
          No GPlanSiS|Drawings, abra um desenho salvo e use <b>Enviar ao Docs</b>. A folha aparece aqui com PDF vetorial, DXF e o arquivo nativo,
          pronta para verificação. Revisões e comentários feitos aqui voltam para o desenho.</Empty></div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))" }}>
          {itens.map((d) => (
            <article key={d.id} className="panel overflow-hidden flex flex-col">
              <button className="text-left" onClick={() => nav(`/documentos/${d.id}`)} aria-label={`Abrir ${d.code}`}><Miniatura fileId={d.thumb_file_id} /></button>
              <div className="p-3 flex flex-col gap-1.5 min-w-0">
                <div className="flex items-start gap-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    <Link to={`/documentos/${d.id}`} className="code text-[13px] text-ink-2 hover:underline">{d.code}</Link>
                    <div className="font-medium truncate" title={d.title}>{d.title}</div>
                  </div>
                  <RevDelta label={d.revision_label} size="sm" />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={d.revision_status} />
                  {d.purpose && <Badge tone="neutral">{d.purpose} · {PURPOSE[d.purpose]}</Badge>}
                  {d.open_comments > 0 && <Badge tone="warn"><MessageSquare size={12} /> {d.open_comments}</Badge>}
                </div>
                <div className="text-[12px] text-muted truncate">{d.project_code} · {d.discipline_code}{d.formato ? ` · ${d.formato}` : ""}{d.escala ? ` · ${d.escala}` : ""}{d.folha ? ` · folha ${d.folha}` : ""}</div>
                <div className="text-[12px] text-muted truncate">enviado {d.enviado_em ? relTime(d.enviado_em) : relTime(d.updated_at)}{d.enviado_por ? ` por ${d.enviado_por}` : ""}{d.drawing_versao ? ` · versão ${d.drawing_versao} do desenho` : ""}</div>
                <div className="flex gap-1.5 mt-1">
                  <Link to={`/documentos/${d.id}`} className="btn flex-1 justify-center">Abrir no Docs</Link>
                  {d.drawing_id && <button className="btn flex-1 justify-center" onClick={() => abrirNoDrawings(`#d${d.drawing_id}`)}>No Drawings <ArrowUpRight size={14} /></button>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
