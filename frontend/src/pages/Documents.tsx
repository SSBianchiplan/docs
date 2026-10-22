import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Download, FileLock2, MessageSquare, Plus, X } from "lucide-react";
import { api, download, qs } from "@/lib/api";
import { fmtDate, STATUS } from "@/lib/format";
import { useCatalog, useProjects } from "@/lib/hooks";
import type { MasterRow, Page, RevisionStatus } from "@/lib/types";
import { useUi } from "@/store/ui";
import { Dropzone } from "@/components/Dropzone";
import { Drawer, Empty, ErrorBox, Field, PageHeader, RevDelta, Skeleton, StatusBadge, toast } from "@/components/ui";

const COLS = "grid-cols-[minmax(190px,1.1fr)_52px_minmax(220px,2fr)_60px_56px_170px_92px_96px_56px]";

function NewDocument({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projects = useProjects();
  const cat = useCatalog();
  const nav = useNavigate();
  const qc = useQueryClient();
  const current = useUi((s) => s.projectId);
  const writable = projects.data?.filter((p) => ["ADMIN", "CONTROLADOR", "AUTOR"].includes(p.my_role ?? "")) ?? [];
  const [f, setF] = useState({ project_id: current ?? "", title: "", discipline_code: "", doc_type_code: "", area: "", originator: "", code: "", confidentiality: "", tags: "", planned_issue_date: "", weight: "1" });
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const m = useMutation({
    mutationFn: async () => {
      const doc = await api.post<{ id: string; code: string; revision: { id: string } }>("/documents", {
        ...f, code: f.code || null, area: f.area || null, originator: f.originator || null,
        confidentiality: f.confidentiality || null, planned_issue_date: f.planned_issue_date || null,
        weight: Number(f.weight.replace(",", ".")) || 1,
        tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      for (const [i, file] of files.entries()) {
        setProgress(`Enviando ${i + 1}/${files.length}: ${file.name}`);
        const fd = new FormData(); fd.append("file", file);
        await api.upload(`/revisions/${doc.revision.id}/files`, fd);
      }
      return doc;
    },
    onSuccess: (doc) => {
      toast.ok(`Documento ${doc.code} criado`);
      void qc.invalidateQueries({ queryKey: ["documents"] });
      onClose(); nav(`/documentos/${doc.id}`);
    },
    onError: toast.err,
    onSettled: () => setProgress(null),
  });

  const proj = projects.data?.find((p) => p.id === f.project_id);
  const projAreas = cat.data?.areas.filter((a) => a.project_id === f.project_id) ?? [];
  const enabled = new Set(cat.data?.project_disciplines.filter((d) => d.project_id === f.project_id).map((d) => d.code));
  const disciplines = cat.data?.disciplines.filter((d) => enabled.size === 0 || enabled.has(d.code)) ?? [];
  const needsArea = !!proj?.code_mask.includes("{AREA}") && !f.code;
  const missing = [!f.project_id && "projeto", f.title.trim().length < 3 && "título", !f.discipline_code && "disciplina", !f.doc_type_code && "tipo", needsArea && !f.area && "área"].filter(Boolean);
  return (
    <Drawer open={open} onClose={onClose} title="Novo documento" footer={<>
      {missing.length > 0 && <span className="text-[12px] text-muted mr-auto self-center">Falta: {missing.join(", ")}</span>}
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary" disabled={missing.length > 0 || m.isPending} onClick={() => m.mutate()}>
        {m.isPending ? progress ?? "Criando…" : "Criar documento"}
      </button>
    </>}>
      <Field label="Projeto">
        <select className="input" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value, area: "", discipline_code: "" })}>
          <option value="">Selecione</option>
          {writable.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
        </select>
      </Field>
      {writable.length === 0 && projects.data && <p className="text-[13px] text-muted -mt-2 mb-3">Nenhum projeto disponível. <Link to="/projetos" className="text-accent hover:underline">Crie ou peça acesso a um projeto</Link>.</p>}
      <Field label="Título"><input className="input" value={f.title} onChange={set("title")} placeholder="Ex.: Arranjo geral da casa de bombas" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Disciplina">
          <select className="input" value={f.discipline_code} onChange={set("discipline_code")}>
            <option value="">—</option>{disciplines.map((d) => <option key={d.code} value={d.code}>{d.code} · {d.name}</option>)}
          </select>
        </Field>
        <Field label="Tipo">
          <select className="input" value={f.doc_type_code} onChange={set("doc_type_code")}>
            <option value="">—</option>{cat.data?.doc_types.map((d) => <option key={d.code} value={d.code}>{d.code} · {d.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Código" hint={proj ? `Vazio = gerado pela máscara ${proj.code_mask}` : "Vazio = gerado pela máscara do projeto"}>
        <input className="input code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="Automático" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={needsArea ? "Área / unidade (obrigatória)" : "Área / unidade"}>
          {projAreas.length ? (
            <select className="input" value={f.area} onChange={set("area")}>
              <option value="">—</option>{projAreas.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
            </select>
          ) : <input className="input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value.toUpperCase() })} />}
        </Field>
        <Field label="Emissor"><input className="input" value={f.originator} onChange={set("originator")} placeholder="Empresa" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Confidencialidade">
          <select className="input" value={f.confidentiality} onChange={set("confidentiality")}>
            <option value="">Padrão do projeto{proj ? ` (${proj.default_confidentiality.toLowerCase()})` : ""}</option>
            <option value="PUBLICO">Público</option><option value="INTERNO">Interno</option>
            <option value="CONFIDENCIAL">Confidencial</option><option value="RESTRITO">Restrito</option>
          </select>
        </Field>
        <Field label="Tags" hint="Separadas por vírgula"><input className="input" value={f.tags} onChange={set("tags")} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data prevista de emissão" hint="Alimenta a curva S"><input className="input" type="date" value={f.planned_issue_date} onChange={set("planned_issue_date")} /></Field>
        <Field label="Peso" hint="Esforço relativo no avanço"><input className="input tnum" inputMode="decimal" value={f.weight} onChange={set("weight")} /></Field>
      </div>
      <span className="label">Arquivos da revisão {proj?.revision_scheme === "numeric" ? "0" : "A"}</span>
      <Dropzone onFiles={(fs) => setFiles([...files, ...fs])} compact />
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((file, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className="truncate flex-1">{file.name}</span>
              <button className="text-muted hover:text-bad" aria-label={`Remover ${file.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

export default function Documents() {
  const projectId = useUi((s) => s.projectId);
  const cat = useCatalog();
  const [sp, setSp] = useSearchParams();
  const [creating, setCreating] = useState(sp.get("novo") === "1");
  const [exporting, setExporting] = useState(false);
  const filters = {
    q: sp.get("q") ?? "", discipline: sp.get("disc") ?? "", doc_type: sp.get("tipo") ?? "",
    status: sp.get("status") ?? "", sort: sp.get("sort") ?? "code", desc: sp.get("desc") === "1",
    late: sp.get("atrasados") === "1",
  };
  const upd = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };

  const q = useQuery({
    queryKey: ["documents", projectId, filters],
    queryFn: () => api.get<Page<MasterRow>>(`/documents${qs({ project_id: projectId, ...filters, size: 500 })}`),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => q.data?.items ?? [], [q.data]);
  const parent = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => 44, overscan: 12 });

  const sortBtn = (key: string, label: string, right = false) => (
    <button className={`th flex items-center gap-1 hover:text-ink ${right ? "justify-end" : ""}`}
      onClick={() => { upd("sort", key); upd("desc", filters.sort === key && !filters.desc ? "1" : ""); }}>
      {label}{filters.sort === key && (filters.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
    </button>
  );

  return (
    <>
      <PageHeader title="Lista mestra" sub={q.data ? `${q.data.total} documento${q.data.total === 1 ? "" : "s"}${q.isFetching ? " · atualizando" : ""}` : " "}
        actions={<>
          <button className="btn" disabled={exporting || !q.data?.total} title="Exportar a lista filtrada para Excel (CSV)"
            onClick={() => { setExporting(true); download(`/documents/export.csv${qs({ project_id: projectId, ...filters, sort: undefined, desc: undefined })}`, "lista-mestra.csv").catch(toast.err).finally(() => setExporting(false)); }}>
            <Download size={16} /> {exporting ? "Exportando…" : "Exportar"}</button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> Novo documento</button>
        </>} />

      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 mb-3 [&>select]:sm:w-auto">
        <input className="input col-span-2 sm:max-w-xs" placeholder="Filtrar por código ou título" defaultValue={filters.q}
          onChange={(e) => upd("q", e.target.value)} aria-label="Filtrar por código ou título" />
        <select className="input" value={filters.discipline} onChange={(e) => upd("disc", e.target.value)} aria-label="Disciplina">
          <option value="">Todas as disciplinas</option>{cat.data?.disciplines.map((d) => <option key={d.code} value={d.code}>{d.code} · {d.name}</option>)}
        </select>
        <select className="input" value={filters.doc_type} onChange={(e) => upd("tipo", e.target.value)} aria-label="Tipo">
          <option value="">Todos os tipos</option>{cat.data?.doc_types.map((d) => <option key={d.code} value={d.code}>{d.code} · {d.name}</option>)}
        </select>
        <select className="input" value={filters.status} onChange={(e) => upd("status", e.target.value)} aria-label="Situação">
          <option value="">Todas as situações</option>
          {(Object.keys(STATUS) as RevisionStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
        </select>
        <label className={`inline-flex items-center gap-2 h-9 px-3 rounded-md border text-sm cursor-pointer whitespace-nowrap ${filters.late ? "border-bad/50 bg-bad-soft text-bad" : "border-line text-ink-2"}`}>
          <input type="checkbox" checked={filters.late} onChange={(e) => upd("atrasados", e.target.checked ? "1" : "")} /> Só atrasados
        </label>
      </div>

      {/* celular: cartões; desktop: tabela virtualizada */}
      {!q.error && (
        <ul className="md:hidden space-y-2">
          {q.isLoading && <Skeleton className="h-40" />}
          {!q.isLoading && rows.length === 0 && <div className="panel"><Empty title="Nenhum documento com esses filtros" /></div>}
          {rows.slice(0, 200).map((r) => (
            <li key={r.id}>
              <Link to={`/documentos/${r.id}`} className="panel p-3 flex gap-3 items-start">
                <RevDelta label={r.revision_label} />
                <div className="min-w-0 flex-1">
                  <div className="code text-[12px] text-ink-2 truncate">{r.code}</div>
                  <div className="font-medium leading-snug">{r.title}</div>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <StatusBadge status={r.revision_status} />
                    {r.open_comments > 0 && <span className="text-[12px] text-warn inline-flex items-center gap-0.5"><MessageSquare size={13} />{r.open_comments}</span>}
                    {r.checked_out_by && <FileLock2 size={14} className="text-info" aria-label="Em check-out" />}
                    {r.planned_issue_date && <span className={`text-[12px] tnum ${r.late ? "text-bad font-medium" : "text-muted"}`}>{r.late ? "Atrasado · " : "Previsto "}{fmtDate(r.planned_issue_date)}</span>}
                  </div>
                </div>
              </Link>
            </li>
          ))}
          {rows.length > 200 && <p className="text-[12px] text-muted text-center">Mostrando 200 de {rows.length}. Refine os filtros.</p>}
        </ul>
      )}
      {q.error ? <ErrorBox error={q.error} /> : (
        <div className="panel overflow-hidden hidden md:block">
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div className={`grid ${COLS} border-b border-line bg-surface-2/60 sticky top-0`}>
                {sortBtn("code", "Código")}<span className="th">Rev.</span>{sortBtn("title", "Título")}
                <span className="th">Disc.</span><span className="th">Tipo</span>{sortBtn("status", "Situação")}
                {sortBtn("issued", "Emissão")}{sortBtn("planned", "Previsto")}<span className="th" />
              </div>
              {q.isLoading ? (
                <div className="p-3 space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
              ) : rows.length === 0 ? (
                <Empty title="Nenhum documento com esses filtros">Limpe os filtros ou crie o primeiro documento do projeto.</Empty>
              ) : (
                <div ref={parent} className="max-h-[calc(100vh-290px)] min-h-[300px] overflow-y-auto">
                  <div style={{ height: v.getTotalSize(), position: "relative" }}>
                    {v.getVirtualItems().map((vi) => {
                      const r = rows[vi.index]!;
                      return (
                        <Link key={r.id} to={`/documentos/${r.id}`}
                          className={`grid ${COLS} items-center absolute inset-x-0 border-b border-line hover:bg-surface-2`}
                          style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}>
                          <span className="td code truncate">{r.code}</span>
                          <span className="td"><RevDelta label={r.revision_label} size="sm" /></span>
                          <span className="td truncate" title={r.title}>{r.title}</span>
                          <span className="td code text-ink-2">{r.discipline_code}</span>
                          <span className="td code text-ink-2">{r.doc_type_code}</span>
                          <span className="td"><StatusBadge status={r.revision_status} /></span>
                          <span className="td tnum text-ink-2">{fmtDate(r.issued_at)}</span>
                          <span className={`td tnum ${r.late ? "text-bad font-medium" : "text-ink-2"}`} title={r.late ? "Previsto vencido sem emissão" : undefined}>{fmtDate(r.planned_issue_date)}</span>
                          <span className="td flex items-center gap-2 text-muted">
                            {r.open_comments > 0 && <span className="inline-flex items-center gap-0.5 text-warn" title={`${r.open_comments} comentário(s) aberto(s)`}><MessageSquare size={14} /><span className="tnum text-[12px]">{r.open_comments}</span></span>}
                            {r.checked_out_by && <FileLock2 size={14} className="text-info" aria-label="Em check-out" />}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <NewDocument open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
