import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Check, Download, FileUp, Plus, Star, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, ROLE_LABEL } from "@/lib/format";
import { useCatalog, useMembers, useProgress, useProject } from "@/lib/hooks";
import type { AdminUser, Confidentiality, ProjectDetail as PD, Role } from "@/lib/types";
import { useSession } from "@/store/session";
import { useUi } from "@/store/ui";
import { Badge, Empty, ErrorBox, Field, PageHeader, RevDelta, Skeleton, StatusBadge, toast } from "@/components/ui";
import { SCurve } from "@/components/SCurve";
import { Dropzone } from "@/components/Dropzone";
import { ProgressBar } from "./Projects";
import { StepEditor } from "./ProjectWizard";

const TABS = [["geral", "Visão geral"], ["equipe", "Equipe"], ["estrutura", "Estrutura"], ["fluxos", "Fluxos"], ["importar", "Importar"], ["config", "Configurações"]] as const;
type Tab = (typeof TABS)[number][0];
const ROLES: Role[] = ["ADMIN", "CONTROLADOR", "AUTOR", "REVISOR", "LEITOR", "EXTERNO"];

function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: "bad" | "ok" }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className={`text-[26px] font-semibold tnum leading-tight ${tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : ""}`}>{value}</div>
      {sub && <div className="text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

function Overview({ id, detail }: { id: string; detail: PD }) {
  const q = useProgress(id);
  const cat = useCatalog();
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Skeleton className="h-80" />;
  const { totals: t, actual_pct, planned_pct } = q.data;
  const gap = +(actual_pct - planned_pct).toFixed(1);
  const discName = (c: string) => cat.data?.disciplines.find((d) => d.code === c)?.name ?? c;
  if (t.documents === 0) return (
    <div className="panel"><Empty title="Projeto sem documentos ainda">
      <p>Cadastre a lista de documentos com data prevista para acompanhar a curva S.</p>
      <div className="flex flex-wrap gap-2 justify-center mt-4">
        <Link className="btn btn-primary" to="?aba=importar"><FileUp size={16} /> Importar planilha</Link>
        <Link className="btn" to="/documentos?novo=1"><Plus size={16} /> Novo documento</Link>
      </div>
    </Empty></div>
  );
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <Kpi label="Documentos" value={t.documents} sub={`${t.planned} com data prevista`} />
        <Kpi label="Emitidos" value={t.issued} sub={`${t.client_approved} aprovados pelo cliente`} />
        <Kpi label="Avanço real" value={`${actual_pct.toFixed(1)}%`} sub={`planejado até hoje ${planned_pct.toFixed(1)}%`} />
        <Kpi label="Desvio" value={`${gap > 0 ? "+" : ""}${gap}%`} sub={gap < 0 ? "abaixo do planejado" : "no prazo ou adiantado"} tone={gap < -5 ? "bad" : gap >= 0 ? "ok" : undefined} />
        <Kpi label="Atrasados" value={t.late} sub={t.client_rejected ? `${t.client_rejected} reprovado(s) pelo cliente` : "previsto vencido, sem emissão"} tone={t.late ? "bad" : undefined} />
      </div>
      <div className="grid xl:grid-cols-[1.6fr_1fr] gap-4">
        <section className="panel p-4 min-w-0">
          <h2 className="font-semibold">Curva S da documentação</h2>
          <p className="text-[12.5px] text-muted mb-3">% acumulado do peso dos documentos: planejado pela data prevista × realizado pela 1ª emissão em GRD.</p>
          {t.planned === 0 ? <Empty title="Sem datas previstas">Informe a data prevista dos documentos (na importação ou no cadastro) para traçar o planejado.</Empty> : <SCurve data={q.data.curve} />}
        </section>
        <section className="panel p-4">
          <h2 className="font-semibold mb-3">Por disciplina</h2>
          <ul className="space-y-3">
            {q.data.by_discipline.map((d) => (
              <li key={d.discipline}>
                <div className="flex items-baseline justify-between text-sm mb-1">
                  <span><span className="code text-[12px] mr-1.5">{d.discipline}</span>{discName(d.discipline)}</span>
                  <span className="tnum text-[12.5px] text-muted">{d.issued}/{d.documents}{d.late ? <span className="text-bad"> · {d.late} atras.</span> : null}</span>
                </div>
                <ProgressBar value={d.documents ? (100 * d.issued) / d.documents : 0} label={`Emitidos em ${d.discipline}`} />
              </li>
            ))}
          </ul>
        </section>
      </div>
      {q.data.late.length > 0 && (
        <section className="panel mt-4 overflow-x-auto">
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <h2 className="font-semibold">Documentos atrasados</h2>
            <Link to={`/documentos?atrasados=1`} onClick={() => useUi.getState().setProject(detail.project.id)} className="text-[13px] text-accent hover:underline">Ver na lista mestra</Link>
          </div>
          <table className="w-full min-w-[620px]">
            <thead className="border-y border-line bg-surface-2/60"><tr><th className="th">Código</th><th className="th">Rev.</th><th className="th">Título</th><th className="th">Situação</th><th className="th">Previsto</th><th className="th text-right">Atraso</th></tr></thead>
            <tbody className="divide-y divide-line">
              {q.data.late.map((d) => (
                <tr key={d.id}>
                  <td className="td code"><Link to={`/documentos/${d.id}`} className="hover:underline">{d.code}</Link></td>
                  <td className="td"><RevDelta label={d.revision_label} size="sm" /></td>
                  <td className="td truncate max-w-72">{d.title}</td>
                  <td className="td"><StatusBadge status={d.revision_status} /></td>
                  <td className="td tnum text-[13px]">{fmtDate(d.planned_issue_date)}</td>
                  <td className="td tnum text-right text-bad font-medium">{d.days_late} d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function Team({ detail }: { detail: PD }) {
  const me = useSession((s) => s.user);
  const qc = useQueryClient();
  const members = useMembers(detail.project.id);
  const users = useQuery({ queryKey: ["users"], enabled: !!me?.is_admin, queryFn: () => api.get<AdminUser[]>("/users") });
  const [add, setAdd] = useState({ user_id: "", role: "AUTOR" as Role });
  const canManage = ["ADMIN", "CONTROLADOR"].includes(detail.my_role);
  const done = (m: string) => () => { toast.ok(m); void qc.invalidateQueries(); };
  const upsert = useMutation({ mutationFn: (v: { user_id: string; role: Role }) => api.put(`/projects/${detail.project.id}/members`, v), onSuccess: done("Equipe atualizada"), onError: toast.err });
  const remove = useMutation({ mutationFn: (uid: string) => api.del(`/projects/${detail.project.id}/members/${uid}`), onSuccess: done("Removido da equipe"), onError: toast.err });
  return (
    <section className="panel p-4">
      {canManage && me?.is_admin && (
        <div className="flex flex-col sm:flex-row gap-2 mb-4 sm:items-end">
          <label className="flex-1"><span className="label">Incluir na equipe</span>
            <select className="input" value={add.user_id} onChange={(e) => setAdd({ ...add, user_id: e.target.value })}>
              <option value="">Selecione o usuário</option>
              {users.data?.filter((x) => x.is_active && !members.data?.some((m) => m.id === x.id)).map((x) => <option key={x.id} value={x.id}>{x.name} · {x.email}</option>)}
            </select></label>
          <select className="input sm:w-56" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value as Role })} aria-label="Perfil">
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <button className="btn btn-primary" disabled={!add.user_id} onClick={() => { upsert.mutate(add); setAdd({ ...add, user_id: "" }); }}>Incluir</button>
        </div>
      )}
      {members.isLoading ? <Skeleton className="h-40" /> : (
        <ul className="divide-y divide-line">
          {members.data?.map((m) => (
            <li key={m.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="flex-1 min-w-0"><div className="font-medium">{m.name}</div><div className="text-[13px] text-muted truncate">{m.email}{m.company ? ` · ${m.company}` : ""}</div></div>
              {canManage ? (
                <div className="flex gap-2">
                  <select className="input h-8 sm:w-56" value={m.role} onChange={(e) => upsert.mutate({ user_id: m.id, role: e.target.value as Role })} aria-label={`Perfil de ${m.name}`}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  {m.id !== me?.id && <button className="btn btn-ghost btn-sm" aria-label={`Remover ${m.name}`} onClick={() => confirm(`Remover ${m.name} da equipe?`) && remove.mutate(m.id)}><Trash2 size={15} /></button>}
                </div>
              ) : <Badge>{ROLE_LABEL[m.role]}</Badge>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12px] text-muted mt-3">Perfis: controle de documentos emite GRD e registra retorno; autor cria e revisa; revisor verifica e comenta; leitor só consulta; externo vê o que for liberado a ele.</p>
    </section>
  );
}

function Structure({ detail }: { detail: PD }) {
  const qc = useQueryClient();
  const cat = useCatalog();
  const me = useSession((s) => s.user);
  const canManage = ["ADMIN", "CONTROLADOR"].includes(detail.my_role);
  const [areas, setAreas] = useState(detail.areas.map(({ code, name }) => ({ code, name })));
  const [disc, setDisc] = useState<string[]>(detail.disciplines);
  const [newDisc, setNewDisc] = useState({ code: "", name: "" });
  useEffect(() => { setAreas(detail.areas.map(({ code, name }) => ({ code, name }))); setDisc(detail.disciplines); }, [detail]);
  const saveAreas = useMutation({ mutationFn: () => api.put(`/projects/${detail.project.id}/areas`, areas), onSuccess: () => { toast.ok("Áreas salvas"); void qc.invalidateQueries(); }, onError: toast.err });
  const saveDisc = useMutation({ mutationFn: () => api.put(`/projects/${detail.project.id}/disciplines`, disc), onSuccess: () => { toast.ok("Disciplinas salvas"); void qc.invalidateQueries(); }, onError: toast.err });
  const addCat = useMutation({ mutationFn: () => api.post("/catalog/disciplines", newDisc), onSuccess: () => { toast.ok("Disciplina adicionada ao catálogo"); setNewDisc({ code: "", name: "" }); void qc.invalidateQueries({ queryKey: ["catalog"] }); }, onError: toast.err });
  const areaInvalid = areas.some((a) => !/^[A-Z0-9]{1,6}$/.test(a.code) || a.name.trim().length < 2) || new Set(areas.map((a) => a.code)).size !== areas.length;
  const used = new Map(detail.areas.map((a) => [a.code, a.documents]));
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <section className="panel p-4">
        <h2 className="font-semibold">Áreas / unidades</h2>
        <p className="text-[13px] text-muted mb-3">{detail.project.code_mask.includes("{AREA}") ? "A máscara usa {AREA}: o código do documento leva a área." : "Com áreas cadastradas, os documentos só aceitam essas áreas."}</p>
        <ul className="space-y-2 mb-3">
          {areas.map((a, i) => (
            <li key={i} className="flex gap-2 items-center">
              <input className="input code w-24 uppercase" value={a.code} maxLength={6} disabled={!canManage} aria-label="Código"
                onChange={(e) => setAreas(areas.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") } : x)))} />
              <input className="input flex-1" value={a.name} disabled={!canManage} aria-label="Nome" onChange={(e) => setAreas(areas.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <span className="text-[12px] text-muted tnum w-14 text-right">{used.get(a.code) ?? 0} doc.</span>
              {canManage && <button className="btn btn-ghost btn-sm" disabled={(used.get(a.code) ?? 0) > 0} title={(used.get(a.code) ?? 0) > 0 ? "Área em uso" : "Remover"} onClick={() => setAreas(areas.filter((_, j) => j !== i))} aria-label="Remover área"><Trash2 size={15} /></button>}
            </li>
          ))}
          {areas.length === 0 && <li className="text-sm text-muted">Nenhuma área: campo livre nos documentos.</li>}
        </ul>
        {canManage && <div className="flex gap-2">
          <button className="btn btn-sm" onClick={() => setAreas([...areas, { code: "", name: "" }])}><Plus size={15} /> Área</button>
          <button className="btn btn-primary btn-sm ml-auto" disabled={areaInvalid || saveAreas.isPending} onClick={() => saveAreas.mutate()}>Salvar áreas</button>
        </div>}
      </section>
      <section className="panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Disciplinas habilitadas</h2>
          <span className="text-[12.5px] text-muted">{disc.length === 0 ? "todas" : `${disc.length} de ${cat.data?.disciplines.length ?? "?"}`}</span>
        </div>
        <p className="text-[13px] text-muted mb-3">Nenhuma marcada = todas liberadas. Disciplina com documentos não pode ser desabilitada.</p>
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {cat.data?.disciplines.map((d) => (
            <label key={d.code} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-line text-sm">
              <input type="checkbox" disabled={!canManage} checked={disc.includes(d.code)} onChange={(e) => setDisc(e.target.checked ? [...disc, d.code] : disc.filter((x) => x !== d.code))} />
              <span className="code text-[12px] w-9">{d.code}</span><span className="truncate">{d.name}</span>
            </label>
          ))}
        </div>
        {canManage && <div className="flex justify-end"><button className="btn btn-primary btn-sm" disabled={saveDisc.isPending} onClick={() => saveDisc.mutate()}>Salvar disciplinas</button></div>}
        {me?.is_admin && (
          <div className="border-t border-line mt-4 pt-3">
            <span className="label">Nova disciplina no catálogo</span>
            <div className="flex gap-2">
              <input className="input code w-24 uppercase" placeholder="GEO" maxLength={4} value={newDisc.code} onChange={(e) => setNewDisc({ ...newDisc, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} aria-label="Código" />
              <input className="input flex-1" placeholder="Geotecnia" value={newDisc.name} onChange={(e) => setNewDisc({ ...newDisc, name: e.target.value })} aria-label="Nome" />
              <button className="btn btn-sm" disabled={!newDisc.code || newDisc.name.trim().length < 2} onClick={() => addCat.mutate()}>Adicionar</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Flows({ detail }: { detail: PD }) {
  const qc = useQueryClient();
  const canManage = ["ADMIN", "CONTROLADOR"].includes(detail.my_role);
  const isAdmin = detail.my_role === "ADMIN";
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<{ name: string; role_required: "CONTROLADOR" | "AUTOR" | "REVISOR" | "ADMIN"; sla_hours: number }[]>([
    { name: "Verificação técnica", role_required: "REVISOR", sla_hours: 48 },
    { name: "Aprovação do controle de documentos", role_required: "CONTROLADOR", sla_hours: 24 },
  ]);
  const inv = () => void qc.invalidateQueries();
  const create = useMutation({ mutationFn: () => api.post(`/projects/${detail.project.id}/workflow-templates`, { name, steps }), onSuccess: () => { toast.ok("Fluxo criado"); setCreating(false); setName(""); inv(); }, onError: toast.err });
  const setDefault = useMutation({ mutationFn: (tid: string) => api.patch(`/projects/${detail.project.id}`, { default_template_id: tid }), onSuccess: () => { toast.ok("Fluxo padrão definido"); inv(); }, onError: toast.err });
  const toggle = useMutation({ mutationFn: (v: { id: string; active: boolean }) => api.patch(`/workflow-templates/${v.id}?active=${v.active}`), onSuccess: inv, onError: toast.err });
  const defaultId = detail.project.default_template_id ?? "00000000-0000-0000-0000-00000000f001";
  return (
    <>
      <ul className="grid md:grid-cols-2 gap-3 mb-4">
        {detail.templates.map((t) => (
          <li key={t.id} className={`panel p-4 ${t.active === false ? "opacity-60" : ""}`}>
            <div className="flex items-start gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{t.name}</div>
                <div className="text-[12px] text-muted">{t.project_id ? "Deste projeto" : "Global"} · usado {t.uses ?? 0} vez(es)</div>
              </div>
              {t.id === defaultId ? <Badge tone="accent"><Star size={12} /> padrão</Badge> : t.active !== false && isAdmin &&
                <button className="btn btn-sm" onClick={() => setDefault.mutate(t.id)}>Tornar padrão</button>}
            </div>
            <ol className="space-y-1.5">
              {t.steps.map((s) => (
                <li key={s.step_order} className="flex items-center gap-2 text-sm">
                  <span className="code w-5 h-5 rounded-full bg-surface-2 inline-flex items-center justify-center text-[11px]">{s.step_order}</span>
                  <span className="flex-1">{s.name}</span>
                  <span className="text-[12px] text-muted">{ROLE_LABEL[s.role_required]} · {s.sla_hours} h</span>
                </li>
              ))}
            </ol>
            {t.project_id && canManage && t.id !== defaultId && (
              <button className="btn btn-ghost btn-sm mt-2" onClick={() => toggle.mutate({ id: t.id, active: t.active === false })}>{t.active === false ? "Reativar" : "Desativar"}</button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (creating ? (
        <section className="panel p-4">
          <Field label="Nome do fluxo"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Verificação dupla + aprovação" /></Field>
          <StepEditor steps={steps} onChange={setSteps} />
          <div className="flex justify-end gap-2 mt-3">
            <button className="btn" onClick={() => setCreating(false)}>Cancelar</button>
            <button className="btn btn-primary" disabled={name.trim().length < 3 || steps.some((s) => s.name.trim().length < 3) || create.isPending} onClick={() => create.mutate()}>Criar fluxo</button>
          </div>
        </section>
      ) : <button className="btn" onClick={() => setCreating(true)}><Plus size={16} /> Novo fluxo de aprovação</button>)}
    </>
  );
}

interface ImportResult { dry_run: boolean; valid?: number; created?: number; errors: { line: number; title: string; errors: string[] }[]; preview?: { title: string; discipline_code: string; doc_type_code: string; area: string | null; planned_issue_date: string | null; weight: number }[] }

function ImportTab({ detail }: { detail: PD }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<ImportResult | null>(null);
  const canManage = ["ADMIN", "CONTROLADOR"].includes(detail.my_role);
  const run = useMutation({
    mutationFn: (dry: boolean) => { const fd = new FormData(); fd.append("file", file!); fd.append("dry_run", String(dry)); return api.upload<ImportResult>(`/projects/${detail.project.id}/import`, fd); },
    onSuccess: (r) => { setRes(r); if (!r.dry_run) { toast.ok(`${r.created} documento(s) criados`); void qc.invalidateQueries(); setFile(null); } },
    onError: toast.err,
  });
  function template() {
    const area = detail.areas[0]?.code ?? "";
    const csv = "﻿Título;Disciplina;Tipo;Área;Emissor;Código;Confidencialidade;Tags;Data prevista;Peso\r\n"
      + `Planta de fundações bloco B;CIV;DE;${area};;;;fundacao;15/11/2026;2\r\n`
      + `Memorial descritivo elétrico;ELE;MD;${area};;;;;30/11/2026;1\r\n`;
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `modelo-lista-${detail.project.code}.csv` });
    a.click();
  }
  if (!canManage) return <ErrorBox error="Importação exige perfil de controle de documentos." />;
  return (
    <section className="panel p-4 sm:p-5 max-w-3xl">
      <h2 className="font-semibold">Importar lista de documentos</h2>
      <p className="text-[13px] text-muted mb-3">Planilha CSV (salve do Excel como “CSV separado por ponto e vírgula”). Colunas obrigatórias: <b>Título, Disciplina, Tipo</b>. Opcionais: Área, Emissor, Código (vazio = gerado pela máscara), Confidencialidade, Tags, Data prevista (DD/MM/AAAA) e Peso. Validação completa antes de gravar: com qualquer erro, nada é criado.</p>
      <button className="btn btn-sm mb-4" onClick={template}><Download size={15} /> Baixar modelo</button>
      <Dropzone onFiles={(fs) => { setFile(fs[0] ?? null); setRes(null); }} compact />
      {file && <p className="text-sm mt-2">Arquivo: <b>{file.name}</b></p>}
      <div className="flex gap-2 mt-3">
        <button className="btn" disabled={!file || run.isPending} onClick={() => run.mutate(true)}><Check size={16} /> Validar</button>
        <button className="btn btn-primary" disabled={!file || !res?.dry_run || res.errors.length > 0 || !res.valid || run.isPending} onClick={() => run.mutate(false)}><Upload size={16} /> Importar {res?.valid ? `${res.valid} documento(s)` : ""}</button>
      </div>
      {res?.errors.length ? (
        <div className="mt-4">
          <p className="text-sm text-bad font-medium mb-2">{res.errors.length} linha(s) com erro — corrija e valide de novo:</p>
          <ul className="text-[13px] space-y-1 max-h-64 overflow-y-auto">
            {res.errors.map((e) => <li key={e.line}><span className="code">linha {e.line}</span> {e.title && <b>{e.title}</b>} — {e.errors.join("; ")}</li>)}
          </ul>
        </div>
      ) : null}
      {res?.dry_run && !res.errors.length && res.preview && (
        <div className="mt-4 overflow-x-auto">
          <p className="text-sm text-ok font-medium mb-2">{res.valid} documento(s) válidos. Prévia:</p>
          <table className="w-full text-[13px] min-w-[520px]">
            <thead className="border-b border-line"><tr><th className="th">Título</th><th className="th">Disc.</th><th className="th">Tipo</th><th className="th">Área</th><th className="th">Previsto</th><th className="th">Peso</th></tr></thead>
            <tbody className="divide-y divide-line">{res.preview.map((p, i) => <tr key={i}><td className="td">{p.title}</td><td className="td code">{p.discipline_code}</td><td className="td code">{p.doc_type_code}</td><td className="td code">{p.area ?? "—"}</td><td className="td tnum">{fmtDate(p.planned_issue_date)}</td><td className="td tnum">{p.weight}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {res && !res.dry_run && <p className="text-sm text-ok mt-4">Importação concluída: {res.created} documento(s). <Link className="text-accent hover:underline" to="/documentos">Abrir lista mestra</Link></p>}
    </section>
  );
}

function Settings({ detail }: { detail: PD }) {
  const qc = useQueryClient();
  const p = detail.project;
  const isAdmin = detail.my_role === "ADMIN";
  const [f, setF] = useState({
    name: p.name, client: p.client ?? "", contract: p.contract ?? "", location: p.location ?? "", description: p.description ?? "",
    start_date: p.start_date ?? "", end_date: p.end_date ?? "", require_workflow: p.require_workflow, revision_scheme: p.revision_scheme,
    default_confidentiality: p.default_confidentiality, retention_years: p.retention_years?.toString() ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => api.patch(`/projects/${p.id}`, {
      ...f, client: f.client || null, contract: f.contract || null, location: f.location || null, description: f.description || null,
      start_date: f.start_date || null, end_date: f.end_date || null, retention_years: f.retention_years ? Number(f.retention_years) : null,
    }),
    onSuccess: () => { toast.ok("Projeto atualizado"); void qc.invalidateQueries(); }, onError: toast.err,
  });
  const archive = useMutation({ mutationFn: (active: boolean) => api.patch(`/projects/${p.id}`, { active }), onSuccess: () => { toast.ok("Situação do projeto alterada"); void qc.invalidateQueries(); }, onError: toast.err });
  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
      <section className="panel p-4 sm:p-5">
        <div className="grid sm:grid-cols-2 gap-x-4">
          <Field label="Nome"><input className="input" disabled={!isAdmin} value={f.name} onChange={set("name")} /></Field>
          <Field label="Cliente"><input className="input" disabled={!isAdmin} value={f.client} onChange={set("client")} /></Field>
          <Field label="Contrato"><input className="input" disabled={!isAdmin} value={f.contract} onChange={set("contract")} /></Field>
          <Field label="Local"><input className="input" disabled={!isAdmin} value={f.location} onChange={set("location")} /></Field>
          <Field label="Início"><input className="input" type="date" disabled={!isAdmin} value={f.start_date} onChange={set("start_date")} /></Field>
          <Field label="Término"><input className="input" type="date" disabled={!isAdmin} value={f.end_date} onChange={set("end_date")} /></Field>
          <Field label="Revisões novas"><select className="input" disabled={!isAdmin} value={f.revision_scheme} onChange={set("revision_scheme")}><option value="auto">Letras (A, B…)</option><option value="numeric">Números (0, 1…)</option></select></Field>
          <Field label="Confidencialidade padrão"><select className="input" disabled={!isAdmin} value={f.default_confidentiality} onChange={(e) => setF({ ...f, default_confidentiality: e.target.value as Confidentiality })}>
            <option value="PUBLICO">Público</option><option value="INTERNO">Interno</option><option value="CONFIDENCIAL">Confidencial</option><option value="RESTRITO">Restrito</option></select></Field>
          <Field label="Retenção (anos)" hint="Vale para documentos criados daqui em diante"><input className="input tnum" type="number" min={1} max={100} disabled={!isAdmin} value={f.retention_years} onChange={set("retention_years")} /></Field>
          <div className="sm:col-span-2"><Field label="Descrição"><textarea className="input h-20 py-2" disabled={!isAdmin} value={f.description} onChange={set("description")} /></Field></div>
        </div>
        <label className="flex items-center gap-2 text-sm mb-4"><input type="checkbox" disabled={!isAdmin} checked={f.require_workflow} onChange={(e) => setF({ ...f, require_workflow: e.target.checked })} /> Aprovação interna exige workflow concluído</label>
        {isAdmin && <button className="btn btn-primary" disabled={f.name.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>Salvar alterações</button>}
      </section>
      <div className="space-y-4">
        <section className="panel p-4">
          <h2 className="font-semibold mb-1">Codificação</h2>
          <p className="code text-sm">{p.code_mask}</p>
          <p className="text-[12.5px] text-muted mt-1">A máscara é fixa depois de criado o projeto: todos os códigos emitidos dependem dela.</p>
        </section>
        {isAdmin && (
          <section className="panel p-4">
            <h2 className="font-semibold mb-1">{p.active ? "Arquivar projeto" : "Projeto arquivado"}</h2>
            <p className="text-[12.5px] text-muted mb-3">{p.active ? "O projeto sai das listas e não recebe documentos novos. Nada é apagado: consulta, GRD e auditoria continuam disponíveis." : "Reative para voltar a criar documentos."}</p>
            {p.active
              ? <button className="btn btn-danger" onClick={() => confirm(`Arquivar ${p.code}?`) && archive.mutate(false)}><Archive size={16} /> Arquivar</button>
              : <button className="btn" onClick={() => archive.mutate(true)}><ArchiveRestore size={16} /> Reativar</button>}
          </section>
        )}
        <p className="text-[12px] text-muted">Criado em {fmtDate(p.created_at)}{p.created_by_name ? ` por ${p.created_by_name}` : ""}.</p>
      </div>
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = (TABS.find(([k]) => k === sp.get("aba"))?.[0] ?? "geral") as Tab;
  const q = useProject(id);
  const setProject = useUi((s) => s.setProject);
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const p = q.data.project;
  return (
    <>
      <nav className="text-[13px] text-muted mb-2"><Link to="/projetos" className="hover:underline">Projetos</Link> / {p.code}</nav>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2"><span className="code text-accent">{p.code}</span> {p.name} {!p.active && <Badge>arquivado</Badge>}</span>}
        sub={[p.client, p.contract, p.location, (p.start_date || p.end_date) && `${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}`].filter(Boolean).join(" · ") || "—"}
        actions={<Link className="btn" to="/documentos" onClick={() => setProject(p.id)}>Abrir lista mestra</Link>} />
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line mb-4 -mx-1 px-1">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setSp({ aba: k }, { replace: true })}
            className={`h-10 px-3 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === k ? "border-accent text-accent font-medium" : "border-transparent text-muted hover:text-ink"}`}>{label}</button>
        ))}
      </div>
      {tab === "geral" && <Overview id={p.id} detail={q.data} />}
      {tab === "equipe" && <Team detail={q.data} />}
      {tab === "estrutura" && <Structure detail={q.data} />}
      {tab === "fluxos" && <Flows detail={q.data} />}
      {tab === "importar" && <ImportTab detail={q.data} />}
      {tab === "config" && <Settings detail={q.data} />}
    </>
  );
}
