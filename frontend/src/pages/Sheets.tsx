import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, FileSpreadsheet, MessageSquare } from "lucide-react";
import { api, fileUrl, qs } from "@/lib/api";
import { abrirNoSheets } from "@/lib/integracao";
import { PURPOSE, relTime } from "@/lib/format";
import type { Purpose, RevisionStatus } from "@/lib/types";
import { useUi } from "@/store/ui";
import { Badge, Empty, ErrorBox, PageHeader, RevDelta, Skeleton, StatusBadge } from "@/components/ui";

interface Linha {
  id: string; code: string; title: string; discipline_code: string; doc_type_code: string;
  project_code: string; project_name: string; updated_at: string; sheets_book_id: string | null; sheets_versao: string | null;
  enviado_por: string | null; enviado_em: string | null; planilhas: string | null; com_bi: string | null;
  revision_label: string | null; revision_status: RevisionStatus | null; purpose: Purpose | null; open_comments: number;
  thumb_file_id: string | null;
}

function Miniatura({ fileId }: { fileId: string | null }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { if (fileId) fileUrl(fileId, { thumb: true }).then(setSrc).catch(() => setSrc(null)); }, [fileId]);
  return (
    <div className="aspect-[16/10] bg-surface-2 border-b border-line grid place-items-center overflow-hidden">
      {src ? <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" /> : <FileSpreadsheet size={28} className="text-muted" />}
    </div>
  );
}

/** Área separada para as pastas de planilhas que vêm do GPlanSiS|Sheets. */
export default function Sheets() {
  const projectId = useUi((s) => s.projectId);
  const [busca, setBusca] = useState("");
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ["integracao-planilhas", projectId, busca],
    queryFn: () => api.get<{ items: Linha[] }>(`/integracao/planilhas${qs({ project_id: projectId, q: busca })}`),
    refetchInterval: 30_000,
  });
  const itens = q.data?.items ?? [];
  const pendentes = itens.reduce((n, d) => n + (d.open_comments || 0), 0);
  return (
    <>
      <PageHeader title="Sheets"
        sub={`Pastas enviadas pelo GPlanSiS|Sheets · ${itens.length} documento(s)${pendentes ? ` · ${pendentes} comentário(s) aberto(s)` : ""}`}
        actions={<>
          <input className="input w-56" placeholder="Buscar código ou título" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <button className="btn btn-primary" onClick={() => abrirNoSheets("")}><FileSpreadsheet size={16} /> Abrir o Sheets</button>
        </>} />
      {q.error ? <ErrorBox error={q.error} /> : q.isLoading ? <Skeleton className="h-60" /> : itens.length === 0 ? (
        <div className="panel"><Empty title="Nenhuma pasta do Sheets ainda" icon={<FileSpreadsheet size={26} />}>
          No GPlanSiS|Sheets, abra uma pasta e use <b>Arquivo › Enviar ao GPlanSiS|Docs</b>. Ela aparece aqui com o PDF das planilhas, o Excel (.xlsx)
          e o arquivo nativo (com o BI), pronta para verificação. Revisões e comentários feitos aqui voltam para a pasta no Sheets.</Empty></div>
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
                <div className="text-[12px] text-muted truncate">{d.project_code} · {d.discipline_code} · {d.doc_type_code}{d.planilhas ? ` · ${d.planilhas} planilha(s)` : ""}{d.com_bi === "sim" ? " · BI" : ""}</div>
                <div className="text-[12px] text-muted truncate">enviado {d.enviado_em ? relTime(d.enviado_em) : relTime(d.updated_at)}{d.enviado_por ? ` por ${d.enviado_por}` : ""}{d.sheets_versao ? ` · versão ${d.sheets_versao} da pasta` : ""}</div>
                <div className="flex gap-1.5 mt-1">
                  <Link to={`/documentos/${d.id}`} className="btn flex-1 justify-center">Abrir no Docs</Link>
                  {d.sheets_book_id && <button className="btn flex-1 justify-center" onClick={() => abrirNoSheets(`#s${d.sheets_book_id}`)}>No Sheets <ArrowUpRight size={14} /></button>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
