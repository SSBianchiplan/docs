import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot, Check, Download, FileLock2, FileText, GitBranch, History, Lock, LockOpen, MessageSquare, Play, RefreshCw, ScanText, Send, X,
} from "lucide-react";
import { api, fileUrl } from "@/lib/api";
import { fmtBytes, fmtDate, fmtDateTime, PURPOSE, relTime, STATUS } from "@/lib/format";
import { useCatalog, useMembers, useProjects } from "@/lib/hooks";
import type { AuditRow, Comment, DocumentDetail as DD, FileInfo, Revision, Suggestion } from "@/lib/types";
import { useSession } from "@/store/session";
import { abrirNoDrawings, abrirNoSheets, abrirNoWriter } from "@/lib/integracao";
import { Dropzone } from "@/components/Dropzone";
import { PdfViewer, type Rect } from "@/components/PdfViewer";
import { Badge, Drawer, Empty, ErrorBox, Field, RevDelta, Skeleton, StatusBadge, toast } from "@/components/ui";

const WRITE = ["ADMIN", "CONTROLADOR", "AUTOR"];
const CONTROL = ["ADMIN", "CONTROLADOR"];
const CAT_LABEL: Record<Comment["category"], string> = { GERAL: "Geral", TECNICO: "Técnico", EDITORIAL: "Editorial", OBRIGATORIO: "Obrigatório" };

function Planning({ doc, canWrite }: { doc: DD["document"]; canWrite: boolean }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(doc.planned_issue_date ?? "");
  const [weight, setWeight] = useState(String(doc.weight ?? 1));
  useEffect(() => { setDate(doc.planned_issue_date ?? ""); setWeight(String(doc.weight ?? 1)); }, [doc.planned_issue_date, doc.weight]);
  const save = useMutation({
    mutationFn: (b: Record<string, unknown>) => api.patch(`/documents/${doc.id}`, b),
    onSuccess: () => { toast.ok("Planejamento atualizado"); void qc.invalidateQueries(); }, onError: toast.err,
  });
  const late = doc.planned_issue_date && doc.planned_issue_date < new Date().toISOString().slice(0, 10);
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 divide-x divide-line border-t border-line">
      <Cell label="Área">{doc.area ?? "—"}</Cell>
      <Cell label="Emissor">{doc.originator ?? "—"}</Cell>
      <Cell label="Confidencialidade">{doc.confidentiality.toLowerCase()}</Cell>
      <Cell label="Retenção até">{fmtDate(doc.retention_until)}</Cell>
      <div className="px-3 py-2 min-w-0">
        <div className="text-[11px] text-muted">Emissão prevista</div>
        {canWrite ? <input type="date" className={`input h-7 px-1.5 ${late ? "text-bad" : ""}`} value={date} aria-label="Data prevista de emissão"
          onChange={(e) => setDate(e.target.value)} onBlur={() => date !== (doc.planned_issue_date ?? "") && save.mutate({ planned_issue_date: date || null })} />
          : <div className="text-sm">{fmtDate(doc.planned_issue_date)}</div>}
      </div>
      <div className="px-3 py-2 min-w-0">
        <div className="text-[11px] text-muted">Peso no avanço</div>
        {canWrite ? <input className="input h-7 px-1.5 w-20 tnum" inputMode="decimal" value={weight} aria-label="Peso"
          onChange={(e) => setWeight(e.target.value)} onBlur={() => { const w = Number(weight.replace(",", ".")); if (w > 0 && w !== doc.weight) save.mutate({ weight: w }); }} />
          : <div className="text-sm tnum">{doc.weight}</div>}
      </div>
    </div>
  );
}

function Cell({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`px-3 py-2 border-line min-w-0 ${className}`}>
      <div className="text-[11px] text-muted">{label}</div>
      <div className="text-sm truncate">{children}</div>
    </div>
  );
}

function OcrBadge({ f }: { f: FileInfo }) {
  switch (f.ocr_status) {
    case "CONCLUIDO": return <Badge tone="ok" title={f.ocr_engine ?? ""}>{f.ocr_engine === "texto-nativo" ? "Texto nativo" : `OCR ${f.confidence ? `${Math.round(f.confidence)}%` : ""}`}</Badge>;
    case "PROCESSANDO": return <Badge tone="info">Processando OCR</Badge>;
    case "PENDENTE": return <Badge tone="warn">Na fila de OCR</Badge>;
    case "FALHOU": return <Badge tone="bad" title={f.ocr_error ?? ""}>OCR falhou</Badge>;
    case "IGNORADO": return <Badge title={f.ocr_error ?? ""}>Sem extração</Badge>;
    default: return null;
  }
}

function SuggestionCard({ s, onDecide, busy }: { s: Suggestion; onDecide: (d: "APLICADA" | "REJEITADA") => void; busy: boolean }) {
  const pl = s.payload;
  return (
    <div className="panel p-3 border-l-4 border-l-info">
      <div className="flex items-center gap-2 text-sm font-medium mb-1">
        <Bot size={16} className="text-info" />
        {s.kind === "METADADOS_CARIMBO" ? "A IA leu o carimbo e propõe atualizar metadados" : "A IA encontrou evidência de comentário atendido"}
        <span className="ml-auto text-[12px] text-muted tnum">{s.confidence !== null ? `confiança ${Math.round(s.confidence * 100)}%` : ""}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px] mb-2">
        {Object.entries(pl).filter(([k]) => !["revision_id", "source_file"].includes(k)).map(([k, v]) => (
          <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="truncate">{String(v)}</dd></div>
        ))}
      </dl>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted mr-auto">{s.engine} · a decisão é sua</span>
        <button className="btn btn-sm" disabled={busy} onClick={() => onDecide("REJEITADA")}><X size={14} /> Rejeitar</button>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => onDecide("APLICADA")}><Check size={14} /> Aplicar</button>
      </div>
    </div>
  );
}

function WorkflowDrawer({ open, onClose, projectId, revisionId }: { open: boolean; onClose: () => void; projectId: string; revisionId: string }) {
  const cat = useCatalog();
  const members = useMembers(projectId);
  const qc = useQueryClient();
  const [tpl, setTpl] = useState("");
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  const projects = useProjects();
  const defaultTpl = projects.data?.find((p) => p.id === projectId)?.default_template_id;
  // só os fluxos globais e os deste projeto; o padrão do projeto vem pré-selecionado
  const templates = (cat.data?.workflow_templates ?? []).filter((t) => !t.project_id || t.project_id === projectId);
  const template = templates.find((t) => t.id === tpl) ?? templates.find((t) => t.id === defaultTpl) ?? templates[0];
  const m = useMutation({
    mutationFn: () => api.post(`/revisions/${revisionId}/workflow`, { template_id: template?.id, assignees }),
    onSuccess: () => { toast.ok("Workflow iniciado — revisão em verificação"); void qc.invalidateQueries(); onClose(); },
    onError: toast.err,
  });
  const complete = template?.steps.every((s) => assignees[String(s.step_order)]);
  return (
    <Drawer open={open} onClose={onClose} title="Enviar para verificação" footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary" disabled={!complete || m.isPending} onClick={() => m.mutate()}><Play size={15} /> Iniciar workflow</button>
    </>}>
      <Field label="Modelo de fluxo">
        <select className="input" value={template?.id ?? ""} onChange={(e) => { setTpl(e.target.value); setAssignees({}); }}>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === defaultTpl ? " (padrão do projeto)" : ""}</option>)}
        </select>
      </Field>
      <ol className="space-y-3 mt-2">
        {template?.steps.map((s) => (
          <li key={s.step_order} className="panel p-3">
            <div className="text-sm font-medium">Etapa {s.step_order} · {s.name}</div>
            <div className="text-[12px] text-muted mb-2">Perfil exigido: {s.role_required} · prazo {s.sla_hours} h</div>
            <select className="input" aria-label={`Responsável da etapa ${s.step_order}`} value={assignees[String(s.step_order)] ?? ""}
              onChange={(e) => setAssignees({ ...assignees, [String(s.step_order)]: e.target.value })}>
              <option value="">Selecione o responsável</option>
              {members.data?.filter((u) => u.role === s.role_required || u.role === "ADMIN" || (s.role_required === "REVISOR" && u.role === "CONTROLADOR"))
                .map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </select>
          </li>
        ))}
      </ol>
      <p className="text-[12px] text-muted mt-3">O autor da revisão não pode aprová-la; o banco recusa essa combinação.</p>
    </Drawer>
  );
}

function ReturnDrawer({ open, onClose, revisionId }: { open: boolean; onClose: () => void; revisionId: string }) {
  const qc = useQueryClient();
  const [to, setTo] = useState<"APROVADA" | "APROVADA_COM_COMENTARIOS" | "REPROVADA">("APROVADA");
  const m = useMutation({
    mutationFn: () => api.post(`/revisions/${revisionId}/transition`, { to }),
    onSuccess: () => { toast.ok("Retorno do cliente registrado"); void qc.invalidateQueries(); onClose(); },
    onError: toast.err,
  });
  const opts = [
    { v: "APROVADA", code: "A", t: "Aprovado", d: "Sem comentários. Liberado para a finalidade de emissão." },
    { v: "APROVADA_COM_COMENTARIOS", code: "B", t: "Aprovado com comentários", d: "Incorporar comentários na próxima revisão." },
    { v: "REPROVADA", code: "C", t: "Reprovado", d: "Revisar e reemitir." },
  ] as const;
  return (
    <Drawer open={open} onClose={onClose} title="Registrar retorno do cliente" footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary" disabled={m.isPending} onClick={() => m.mutate()}>Registrar retorno</button>
    </>}>
      <div className="space-y-2" role="radiogroup">
        {opts.map((o) => (
          <label key={o.v} className={`panel p-3 flex gap-3 cursor-pointer ${to === o.v ? "border-accent ring-1 ring-accent" : ""}`}>
            <input type="radio" name="ret" className="mt-1" checked={to === o.v} onChange={() => setTo(o.v)} />
            <span className="code font-semibold text-lg w-6">{o.code}</span>
            <span><span className="font-medium block">{o.t}</span><span className="text-[13px] text-muted">{o.d}</span></span>
          </label>
        ))}
      </div>
    </Drawer>
  );
}

function CommentsPanel({ rev, comments, draft, setDraft, activeId, setActive, canComment, canResolve }: {
  rev: Revision; comments: Comment[]; draft: { page: number; r: Rect } | null; setDraft: (d: null) => void;
  activeId: string | null; setActive: (id: string) => void; canComment: boolean; canResolve: boolean;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [cat, setCat] = useState<Comment["category"]>("TECNICO");
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");
  const add = useMutation({
    mutationFn: () => api.post(`/revisions/${rev.id}/comments`, { body, category: cat, ...(draft ? { page: draft.page, ...draft.r } : {}) }),
    onSuccess: () => { setBody(""); setDraft(null); void qc.invalidateQueries({ queryKey: ["comments", rev.id] }); void qc.invalidateQueries({ queryKey: ["doc"] }); },
    onError: toast.err,
  });
  const resolve = useMutation({
    mutationFn: (v: { id: string; status: "RESOLVIDO" | "NAO_APLICAVEL" }) => api.post(`/comments/${v.id}/resolve`, { status: v.status, resolution }),
    onSuccess: () => { setResolving(null); setResolution(""); void qc.invalidateQueries({ queryKey: ["comments", rev.id] }); void qc.invalidateQueries({ queryKey: ["doc"] }); },
    onError: toast.err,
  });
  let n = 0;
  return (
    <div className="flex flex-col gap-3">
      {canComment && (
        <div className={`panel p-3 ${draft ? "border-delta/60" : ""}`}>
          <div className="text-[12px] text-muted mb-1.5">
            {draft ? `Comentário na folha ${draft.page}, área marcada` : "Comentário geral · use “Comentar área” no visualizador para marcar a folha"}
            {draft && <button className="ml-2 underline" onClick={() => setDraft(null)}>descartar área</button>}
          </div>
          <textarea className="input h-20 py-2 resize-y" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Descreva a alteração solicitada" aria-label="Texto do comentário" />
          <div className="flex gap-2 mt-2">
            <select className="input w-auto" value={cat} onChange={(e) => setCat(e.target.value as Comment["category"])} aria-label="Categoria">
              {Object.entries(CAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button className="btn btn-primary ml-auto" disabled={body.trim().length < 2 || add.isPending} onClick={() => add.mutate()}>Comentar</button>
          </div>
        </div>
      )}
      {comments.length === 0 ? <Empty title="Sem comentários nesta revisão" icon={<MessageSquare size={24} />} /> : (
        <ul className="space-y-2">
          {comments.map((c) => {
            const idx = c.x !== null ? ++n : null;
            return (
              <li key={c.id} className={`panel p-3 ${activeId === c.id ? "ring-2 ring-warn/50" : ""}`} onClick={() => setActive(c.id)}>
                <div className="flex items-center gap-2 text-[12px] mb-1">
                  {idx && <span className="w-5 h-5 rounded-full bg-surface-2 border border-line inline-flex items-center justify-center font-semibold">{idx}</span>}
                  <Badge tone={c.category === "OBRIGATORIO" ? "bad" : c.category === "TECNICO" ? "warn" : "neutral"}>{CAT_LABEL[c.category]}</Badge>
                  {c.page && <span className="text-muted">folha {c.page}</span>}
                  <span className="ml-auto text-muted">{c.author} · {relTime(c.created_at)}</span>
                </div>
                <p className={`text-sm whitespace-pre-wrap ${c.status !== "ABERTO" ? "text-muted" : ""}`}>{c.body}</p>
                {c.status !== "ABERTO" ? (
                  <p className="text-[12px] text-ok mt-1.5"><Check size={12} className="inline" /> {c.status === "RESOLVIDO" ? "Resolvido" : "Não aplicável"} por {c.resolved_by_name}{c.resolved_in_label ? ` na rev. ${c.resolved_in_label}` : ""}: {c.resolution}</p>
                ) : canResolve && (resolving === c.id ? (
                  <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                    <input className="input" value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Como foi tratado" aria-label="Resolução" />
                    <div className="flex gap-2 justify-end">
                      <button className="btn btn-sm" onClick={() => setResolving(null)}>Cancelar</button>
                      <button className="btn btn-sm" disabled={resolution.length < 3} onClick={() => resolve.mutate({ id: c.id, status: "NAO_APLICAVEL" })}>Não aplicável</button>
                      <button className="btn btn-sm btn-primary" disabled={resolution.length < 3} onClick={() => resolve.mutate({ id: c.id, status: "RESOLVIDO" })}>Resolver</button>
                    </div>
                  </div>
                ) : <button className="text-[12px] text-accent mt-1.5 hover:underline" onClick={(e) => { e.stopPropagation(); setResolving(c.id); }}>Registrar tratamento</button>)}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function DocumentDetail() {
  const { id } = useParams();
  const me = useSession((s) => s.user);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["doc", id], queryFn: () => api.get<DD>(`/documents/${id}`),
    // enquanto houver OCR em andamento, acompanha a fila
    refetchInterval: (query) => query.state.data?.revisions.some((r) => r.files?.some((f) => f.ocr_status === "PENDENTE" || f.ocr_status === "PROCESSANDO")) ? 4000 : false,
  });
  const [revId, setRevId] = useState<string | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [variant, setVariant] = useState<"original" | "archive">("original");
  const [tab, setTab] = useState<"comentarios" | "arquivos" | "workflow" | "texto" | "historico">("comentarios");
  const [draft, setDraft] = useState<{ page: number; r: Rect } | null>(null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [wfOpen, setWfOpen] = useState(false);
  const [retOpen, setRetOpen] = useState(false);

  const data = q.data;
  const rev = data?.revisions.find((r) => r.id === revId) ?? data?.revisions.find((r) => r.is_current) ?? data?.revisions[0];
  const pdfs = useMemo(() => rev?.files?.filter((f) => f.mime === "application/pdf" || f.has_archive) ?? [], [rev]);
  const file = pdfs.find((f) => f.id === fileId) ?? pdfs[0];
  useEffect(() => { setFileId(null); setDraft(null); }, [rev?.id]);

  const url = useQuery({
    queryKey: ["fileurl", file?.id, variant, file?.has_archive],
    enabled: !!file, staleTime: 7 * 60_000,
    queryFn: () => fileUrl(file!.id, { variant: file!.mime === "application/pdf" && variant === "original" ? "original" : "archive" }),
  });
  const comments = useQuery({ queryKey: ["comments", rev?.id], enabled: !!rev, queryFn: () => api.get<Comment[]>(`/revisions/${rev!.id}/comments`) });
  const text = useQuery({ queryKey: ["ocrtext", file?.id], enabled: tab === "texto" && !!file, queryFn: () => api.get<{ meta: unknown; pages: { page: number; text: string; confidence: number | null }[] }>(`/files/${file!.id}/text`) });
  const audit = useQuery({ queryKey: ["audit", id], enabled: tab === "historico", queryFn: () => api.get<AuditRow[]>(`/audit?entity_id=${id}&limit=200`) });

  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => void qc.invalidateQueries(),
    onError: toast.err,
  });
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) { const fd = new FormData(); fd.append("file", f); await api.upload(`/revisions/${rev!.id}/files`, fd); }
    },
    onSuccess: () => { toast.ok("Arquivos enviados — OCR em andamento"); void qc.invalidateQueries({ queryKey: ["doc", id] }); },
    onError: toast.err,
  });
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: "APLICADA" | "REJEITADA" }) => api.post(`/suggestions/${v.id}/decide`, { decision: v.decision }),
    onSuccess: (_, v) => { toast.ok(v.decision === "APLICADA" ? "Sugestão aplicada" : "Sugestão rejeitada"); void qc.invalidateQueries(); },
    onError: toast.err,
  });

  if (q.error) return <ErrorBox error={q.error} />;
  if (!data || !rev) return <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-[60vh]" /></div>;

  const d = data.document;
  const role = data.my_role;
  const canWrite = WRITE.includes(role);
  const canControl = CONTROL.includes(role);
  const lockedByOther = !!data.checkout && data.checkout.user_id !== me?.id;
  const editable = rev.status === "EM_ELABORACAO" && canWrite && !lockedByOther;
  const openRevision = data.revisions.some((r) => ["EM_ELABORACAO", "EM_VERIFICACAO", "APROVADA_INTERNA"].includes(r.status));
  const tabs = [
    { k: "comentarios", l: "Comentários", icon: <MessageSquare size={15} />, n: rev.open_comments },
    { k: "arquivos", l: "Arquivos", icon: <FileText size={15} />, n: rev.files?.length ?? 0 },
    { k: "workflow", l: "Workflow", icon: <GitBranch size={15} /> },
    { k: "texto", l: "Texto OCR", icon: <ScanText size={15} /> },
    { k: "historico", l: "Histórico", icon: <History size={15} /> },
  ] as const;

  return (
    <>
      <nav className="text-[13px] text-muted mb-2">{d.metadata?.origem === "drawings"
        ? <Link to="/drawings" className="hover:underline">Drawings</Link>
        : d.metadata?.origem === "writer"
        ? <Link to="/writer" className="hover:underline">Writer</Link>
        : d.metadata?.origem === "sheets"
        ? <Link to="/sheets" className="hover:underline">Sheets</Link>
        : <Link to="/documentos" className="hover:underline">Lista mestra</Link>} / <span className="code">{d.code}</span></nav>

      {d.metadata?.origem === "writer" && (
        <section className="panel mb-3 px-4 py-3 flex flex-wrap items-center gap-3 border-accent/40">
          <div className="min-w-0 flex-1 text-sm">
            <b>Controlado pelo GPlanSiS|Writer</b>
            <span className="text-ink-2">{d.metadata.writer_versao ? ` · versão ${String(d.metadata.writer_versao)} do documento` : ""}
              {d.metadata.enviado_por ? ` · enviado por ${String(d.metadata.enviado_por)}` : ""}</span>
            <div className="text-[12px] text-muted">Revise e comente aqui no PDF; as correções são feitas no Writer e reenviadas para esta revisão. Status e comentários aparecem lá automaticamente.</div>
          </div>
          {!!d.metadata.writer_doc_id && <button className="btn btn-primary" onClick={() => abrirNoWriter(`#w${String(d.metadata.writer_doc_id)}`)}>Abrir no Writer</button>}
        </section>
      )}

      {d.metadata?.origem === "sheets" && (
        <section className="panel mb-3 px-4 py-3 flex flex-wrap items-center gap-3 border-accent/40">
          <div className="min-w-0 flex-1 text-sm">
            <b>Controlado pelo GPlanSiS|Sheets</b>
            <span className="text-ink-2">{d.metadata.sheets_versao ? ` · versão ${String(d.metadata.sheets_versao)} da pasta` : ""}
              {d.metadata.planilhas ? ` · ${String(d.metadata.planilhas)} planilha(s)` : ""}{d.metadata.com_bi === "sim" ? " · com relatório BI" : ""}
              {d.metadata.enviado_por ? ` · enviado por ${String(d.metadata.enviado_por)}` : ""}</span>
            <div className="text-[12px] text-muted">Revise e comente aqui no PDF; as correções são feitas no Sheets e reenviadas para esta revisão. O Excel (.xlsx) e o arquivo nativo (.json, com o BI) seguem como anexos. Status e comentários aparecem lá automaticamente.</div>
          </div>
          {!!d.metadata.sheets_book_id && <button className="btn btn-primary" onClick={() => abrirNoSheets(`#s${String(d.metadata.sheets_book_id)}`)}>Abrir no Sheets</button>}
        </section>
      )}

      {d.metadata?.origem === "drawings" && (
        <section className="panel mb-3 px-4 py-3 flex flex-wrap items-center gap-3 border-accent/40">
          <div className="min-w-0 flex-1 text-sm">
            <b>Controlado pelo GPlanSiS|Drawings</b>
            <span className="text-ink-2"> · desenho #{String(d.metadata.drawing_id ?? "")}{d.metadata.drawing_versao ? `, versão ${String(d.metadata.drawing_versao)}` : ""}
              {d.metadata.enviado_por ? ` · enviado por ${String(d.metadata.enviado_por)}` : ""}</span>
            <div className="text-[12px] text-muted">Revise e comente aqui no PDF; as correções são feitas no Drawings e reenviadas para esta revisão. Status e comentários aparecem lá automaticamente.</div>
          </div>
          {!!d.metadata.drawing_id && <button className="btn btn-primary" onClick={() => abrirNoDrawings(`#d${String(d.metadata.drawing_id)}`)}>Abrir no Drawings</button>}
        </section>
      )}

      {/* Carimbo — o cabeçalho reproduz o title block da prancha */}
      <section className="panel mb-4 overflow-hidden">
        <div className="grid grid-cols-[1fr_auto] border-b border-line">
          <div className="px-4 py-3 min-w-0">
            <div className="code text-ink-2 text-[13px]">{d.code}</div>
            <h1 className="text-xl font-semibold leading-snug">{d.title}</h1>
          </div>
          <div className="px-5 py-3 border-l border-line flex flex-col items-center justify-center gap-1">
            <RevDelta label={rev.label} size="lg" muted={!rev.is_current} />
            <span className="text-[11px] text-muted">{rev.is_current ? "vigente" : "histórica"}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 divide-x divide-line [&>*]:border-b md:[&>*]:border-b-0">
          <Cell label="Projeto">{d.project_code} · {d.project_name}</Cell>
          <Cell label="Disciplina">{d.discipline_code} · {d.discipline_name}</Cell>
          <Cell label="Tipo">{d.doc_type_code} · {d.doc_type_name}</Cell>
          <Cell label="Situação"><StatusBadge status={rev.status} /></Cell>
          <Cell label="Finalidade">{rev.purpose ? PURPOSE[rev.purpose] : "—"}</Cell>
          <Cell label="Emitida em">{fmtDate(rev.issued_at)}</Cell>
        </div>
        <Planning doc={d} canWrite={canWrite} />
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-line bg-surface-2/50">
          {data.checkout ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-info mr-2"><FileLock2 size={15} /> Em check-out com {data.checkout.name} desde {fmtDateTime(data.checkout.checked_out_at)}</span>
          ) : null}
          {canWrite && (data.checkout
            ? (data.checkout.user_id === me?.id || canControl) && <button className="btn btn-sm" onClick={() => act.mutate(() => api.post(`/documents/${id}/checkin`))}><LockOpen size={15} /> Check-in</button>
            : <button className="btn btn-sm" onClick={() => act.mutate(() => api.post(`/documents/${id}/checkout`))}><Lock size={15} /> Check-out</button>)}
          {canWrite && !openRevision && !lockedByOther && (
            <button className="btn btn-sm" onClick={() => act.mutate(() => api.post(`/documents/${id}/revisions`, {}))}><GitBranch size={15} /> Nova revisão</button>
          )}
          {editable && rev.is_current && <button className="btn btn-sm btn-primary" onClick={() => setWfOpen(true)}><Send size={15} /> Enviar para verificação</button>}
          {rev.status === "EMITIDA" && canControl && <button className="btn btn-sm btn-primary" onClick={() => setRetOpen(true)}>Registrar retorno do cliente</button>}
          {rev.status === "APROVADA_INTERNA" && canControl && <Link to="/grd" className="btn btn-sm">Incluir em GRD</Link>}
          {data.revisions.length > 1 && rev.is_current && (
            <button className="btn btn-sm btn-ghost" onClick={() => act.mutate(() => api.post(`/revisions/${rev.id}/check-comments`))} title="Verificar se os comentários da revisão anterior foram atendidos">
              <Bot size={15} /> Verificar comentários anteriores
            </button>
          )}
          {["EM_ELABORACAO", "EM_VERIFICACAO", "APROVADA_INTERNA"].includes(rev.status) && canWrite && (
            <button className="btn btn-sm btn-danger ml-auto" onClick={() => {
              if (confirm(`Cancelar a revisão ${rev.label}? Ela deixa de poder ser emitida e o workflow ativo perde efeito.`))
                act.mutate(() => api.post(`/revisions/${rev.id}/transition`, { to: "CANCELADA" }));
            }}>Cancelar revisão</button>
          )}
        </div>
      </section>

      {data.suggestions.length > 0 && (
        <section className="grid md:grid-cols-2 gap-3 mb-4" aria-label="Propostas da IA">
          {data.suggestions.map((s) => <SuggestionCard key={s.id} s={s} busy={decide.isPending} onDecide={(dd) => decide.mutate({ id: s.id, decision: dd })} />)}
        </section>
      )}

      {/* linha do tempo das revisões */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3" role="tablist" aria-label="Revisões">
        {data.revisions.map((r) => (
          <button key={r.id} role="tab" aria-selected={r.id === rev.id} onClick={() => setRevId(r.id)}
            className={`shrink-0 flex items-center gap-2 h-11 pl-2 pr-3 rounded-md border ${r.id === rev.id ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-surface-2"}`}>
            <RevDelta label={r.label} size="sm" muted={!r.is_current} />
            <span className="text-left leading-tight">
              <span className="block text-[12px] font-medium">{STATUS[r.status].label}</span>
              <span className="block text-[11px] text-muted">{fmtDate(r.issued_at ?? r.created_at)}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_420px] gap-4">
        <section className="panel overflow-hidden flex flex-col min-h-[70vh]">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line">
            {pdfs.length > 1 && (
              <select className="input h-8 w-auto max-w-72" value={file?.id} onChange={(e) => setFileId(e.target.value)} aria-label="Arquivo">
                {pdfs.map((f) => <option key={f.id} value={f.id}>{f.filename}</option>)}
              </select>
            )}
            {pdfs.length === 1 && <span className="text-sm truncate">{file?.filename}</span>}
            {file?.has_archive && file.mime === "application/pdf" && (
              <div className="inline-flex rounded-md border border-line p-0.5 ml-auto" role="radiogroup" aria-label="Variante">
                {(["original", "archive"] as const).map((v) => (
                  <button key={v} role="radio" aria-checked={variant === v} onClick={() => setVariant(v)}
                    className={`h-7 px-2.5 text-[12px] rounded ${variant === v ? "bg-surface-2 font-medium" : "text-muted"}`}>
                    {v === "original" ? "Original" : "PDF/A pesquisável"}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1">
            {file && url.data ? (
              <PdfViewer url={url.data} comments={comments.data ?? []} activeId={activeComment} onSelect={(cid) => { setActiveComment(cid); setTab("comentarios"); }}
                onDraw={role !== "LEITOR" ? (page, r) => { setDraft({ page, r }); setTab("comentarios"); } : undefined} />
            ) : (
              <div className="p-4">
                {editable ? (
                  <Dropzone onFiles={(fs) => upload.mutate(fs)} />
                ) : (
                  <Empty title="Nenhum PDF nesta revisão" icon={<FileText size={26} />}>
                    {rev.files?.length ? "Há arquivos nativos; anexe o PDF de plotagem para visualizar e comentar." : "Esta revisão ainda não tem arquivos."}
                  </Empty>
                )}
                {upload.isPending && <p className="text-sm text-muted mt-2">Enviando…</p>}
              </div>
            )}
          </div>
        </section>

        <aside className="panel flex flex-col min-h-[50vh] xl:max-h-[calc(100vh-120px)] xl:sticky xl:top-4">
          <div className="flex overflow-x-auto border-b border-line" role="tablist">
            {tabs.map((t) => (
              <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)}
                className={`shrink-0 flex items-center gap-1.5 h-11 px-3 text-[13px] border-b-2 -mb-px ${tab === t.k ? "border-accent text-ink font-medium" : "border-transparent text-muted hover:text-ink"}`}>
                {t.icon}{t.l}{"n" in t && t.n ? <span className="tnum text-[11px] bg-surface-2 rounded-full px-1.5">{t.n}</span> : null}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {tab === "comentarios" && (
              comments.isLoading ? <Skeleton className="h-40" /> :
                <CommentsPanel rev={rev} comments={comments.data ?? []} draft={draft} setDraft={setDraft}
                  activeId={activeComment} setActive={setActiveComment} canComment={role !== "LEITOR"} canResolve={canWrite || role === "REVISOR"} />
            )}

            {tab === "arquivos" && (
              <div className="space-y-2">
                {editable && <Dropzone onFiles={(fs) => upload.mutate(fs)} compact />}
                {!editable && rev.status !== "EM_ELABORACAO" && <p className="text-[12px] text-muted flex items-center gap-1"><Lock size={12} /> Arquivos congelados: a revisão saiu de elaboração.</p>}
                {(rev.files ?? []).length === 0 ? <Empty title="Sem arquivos" /> : rev.files!.map((f) => (
                  <div key={f.id} className="panel p-3">
                    <div className="flex items-start gap-2">
                      <FileText size={18} className="text-muted mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate" title={f.filename}>{f.filename}</div>
                        <div className="text-[12px] text-muted tnum">{f.role} · {fmtBytes(f.size)}{f.pages ? ` · ${f.pages} pág.` : ""}</div>
                        <div className="code text-[11px] text-muted truncate" title={`SHA-256 ${f.sha256}`}>sha256 {f.sha256.slice(0, 16)}…</div>
                      </div>
                      <OcrBadge f={f} />
                    </div>
                    <div className="flex gap-2 mt-2">
                      <button className="btn btn-sm" onClick={async () => window.open(await fileUrl(f.id, { download: true }), "_blank")}><Download size={14} /> Original</button>
                      {f.has_archive && <button className="btn btn-sm" onClick={async () => window.open(await fileUrl(f.id, { variant: "archive", download: true }), "_blank")}><Download size={14} /> PDF/A</button>}
                      {canWrite && (f.ocr_status === "FALHOU" || f.ocr_status === "CONCLUIDO") && (
                        <button className="btn btn-sm btn-ghost ml-auto" onClick={() => act.mutate(() => api.post(`/files/${f.id}/reprocess`))}><RefreshCw size={14} /> Reprocessar</button>
                      )}
                    </div>
                    {f.ocr_error && <p className="text-[12px] text-muted mt-2">{f.ocr_error}</p>}
                  </div>
                ))}
              </div>
            )}

            {tab === "workflow" && (
              data.workflows.filter((w) => w.revision_id === rev.id).length === 0 ? (
                <Empty title="Nenhum workflow nesta revisão" icon={<GitBranch size={24} />}>
                  {editable ? "Use “Enviar para verificação” para iniciar." : null}
                </Empty>
              ) : data.workflows.filter((w) => w.revision_id === rev.id).map((w) => (
                <div key={w.id} className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium text-sm">{w.template_name}</span>
                    <Badge tone={w.status === "CONCLUIDO" ? "ok" : w.status === "REPROVADO" ? "bad" : "warn"}>{w.status.toLowerCase()}</Badge>
                    <span className="text-[12px] text-muted ml-auto">{fmtDateTime(w.started_at)}</span>
                  </div>
                  <ol className="relative border-l border-line ml-2 space-y-3">
                    {w.tasks?.map((t) => (
                      <li key={t.id} className="pl-4 relative">
                        <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ${t.status === "APROVADA" ? "bg-ok" : t.status === "REPROVADA" ? "bg-bad" : "bg-warn"}`} />
                        <div className="text-sm"><span className="font-medium">{t.step_name}</span> · {t.assignee}</div>
                        <div className="text-[12px] text-muted">
                          {t.status === "PENDENTE" ? `Prazo ${fmtDateTime(t.due_at)}${new Date(t.due_at) < new Date() ? " · vencida" : ""}` : `${t.status.toLowerCase()} em ${fmtDateTime(t.decided_at)}`}
                        </div>
                        {t.note && <p className="text-[13px] mt-0.5">“{t.note}”</p>}
                      </li>
                    ))}
                  </ol>
                </div>
              ))
            )}

            {tab === "texto" && (
              !file ? <Empty title="Sem arquivo PDF selecionado" /> : text.isLoading ? <Skeleton className="h-60" /> :
                (text.data?.pages.length ?? 0) === 0 ? <Empty title="Texto ainda não extraído" icon={<ScanText size={24} />}>O OCR roda em segundo plano logo após o envio.</Empty> : (
                  <div className="space-y-3">
                    {text.data!.pages.map((p) => (
                      <div key={p.page}>
                        <div className="text-[12px] text-muted mb-1">Folha {p.page}{p.confidence !== null ? ` · confiança ${Math.round(p.confidence)}%` : " · texto nativo"}</div>
                        <pre className="code text-[12px] whitespace-pre-wrap bg-surface-2 rounded p-2 max-h-80 overflow-auto">{p.text || "(sem texto)"}</pre>
                      </div>
                    ))}
                  </div>
                )
            )}

            {tab === "historico" && (
              audit.isLoading ? <Skeleton className="h-40" /> : audit.error ? <ErrorBox error={audit.error} /> : (
                <ul className="space-y-2">
                  {audit.data?.map((a) => (
                    <li key={a.id} className="text-[13px] border-b border-line pb-2">
                      <div><span className="font-medium">{a.actor ?? "sistema"}</span> <span className="text-muted">{a.action.toLowerCase()} {a.entity}</span></div>
                      <div className="text-[11px] text-muted">{fmtDateTime(a.at)} · <span className="code" title={a.hash}>#{a.hash.slice(0, 10)}</span></div>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        </aside>
      </div>

      <WorkflowDrawer open={wfOpen} onClose={() => setWfOpen(false)} projectId={d.project_id} revisionId={rev.id} />
      <ReturnDrawer open={retOpen} onClose={() => setRetOpen(false)} revisionId={rev.id} />
    </>
  );
}
