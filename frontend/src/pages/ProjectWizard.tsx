import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/format";
import { useCatalog } from "@/lib/hooks";
import type { AdminUser, Confidentiality, Role } from "@/lib/types";
import { useSession } from "@/store/session";
import { useUi } from "@/store/ui";
import { ErrorBox, Field, PageHeader, toast } from "@/components/ui";

const STEPS = ["Identificação", "Codificação", "Estrutura", "Aprovação", "Equipe", "Revisão"] as const;
const TOKENS = ["{PROJ}", "{AREA}", "{DISC}", "{TIPO}", "{SEQ:4}"];
const MASKS = [
  { mask: "{PROJ}-{DISC}-{TIPO}-{SEQ:4}", label: "Projeto-Disciplina-Tipo-Seq" },
  { mask: "{PROJ}-{AREA}-{DISC}-{TIPO}-{SEQ:3}", label: "Com área/unidade" },
  { mask: "{PROJ}.{DISC}.{SEQ:5}", label: "Enxuta com pontos" },
];
const CONF: { v: Confidentiality; label: string }[] = [
  { v: "PUBLICO", label: "Público" }, { v: "INTERNO", label: "Interno" },
  { v: "CONFIDENCIAL", label: "Confidencial" }, { v: "RESTRITO", label: "Restrito" },
];
const ROLES: Role[] = ["CONTROLADOR", "AUTOR", "REVISOR", "LEITOR", "EXTERNO", "ADMIN"];
type Step = { name: string; role_required: "CONTROLADOR" | "AUTOR" | "REVISOR" | "ADMIN"; sla_hours: number };

export function useMaskPreview(mask: string, proj: string) {
  const [out, setOut] = useState<{ example?: string; error?: string }>({});
  useEffect(() => {
    const t = setTimeout(() => {
      api.get<{ example: string }>(`/coding/preview?mask=${encodeURIComponent(mask)}&proj=${encodeURIComponent(proj || "PROJ")}`)
        .then((r) => setOut({ example: r.example })).catch((e) => setOut({ error: e instanceof ApiError ? e.message : String(e) }));
    }, 250);
    return () => clearTimeout(t);
  }, [mask, proj]);
  return out;
}

export function StepEditor({ steps, onChange }: { steps: Step[]; onChange: (s: Step[]) => void }) {
  const up = (i: number, p: Partial<Step>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  return (
    <div>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="panel p-3 grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_180px_110px_auto] gap-2 items-center">
            <span className="code w-6 h-6 rounded-full bg-accent-soft text-accent inline-flex items-center justify-center text-[12px]">{i + 1}</span>
            <input className="input" value={s.name} onChange={(e) => up(i, { name: e.target.value })} aria-label={`Nome da etapa ${i + 1}`} placeholder="Ex.: Verificação técnica" />
            <select className="input col-span-2 sm:col-span-1" value={s.role_required} onChange={(e) => up(i, { role_required: e.target.value as Step["role_required"] })} aria-label="Perfil responsável">
              {(["REVISOR", "CONTROLADOR", "AUTOR", "ADMIN"] as const).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <label className="flex items-center gap-1.5 col-span-2 sm:col-span-1">
              <input className="input w-20 tnum" type="number" min={1} max={2160} value={s.sla_hours} onChange={(e) => up(i, { sla_hours: Math.max(1, Number(e.target.value) || 1) })} aria-label="Prazo em horas" />
              <span className="text-[12px] text-muted">h</span>
            </label>
            <button className="btn btn-ghost btn-sm justify-self-end col-span-2 sm:col-span-1" disabled={steps.length === 1} onClick={() => onChange(steps.filter((_, j) => j !== i))} aria-label={`Remover etapa ${i + 1}`}><Trash2 size={15} /></button>
          </li>
        ))}
      </ol>
      <button className="btn btn-sm mt-2" disabled={steps.length >= 10} onClick={() => onChange([...steps, { name: "", role_required: "REVISOR", sla_hours: 48 }])}><Plus size={15} /> Adicionar etapa</button>
    </div>
  );
}

export default function ProjectWizard() {
  const me = useSession((s) => s.user);
  const nav = useNavigate();
  const qc = useQueryClient();
  const setProject = useUi((s) => s.setProject);
  const cat = useCatalog();
  const users = useQuery({ queryKey: ["users"], enabled: !!me?.is_admin, queryFn: () => api.get<AdminUser[]>("/users") });
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    code: "", name: "", client: "", contract: "", location: "", start_date: "", end_date: "", description: "",
    code_mask: MASKS[0]!.mask, revision_scheme: "auto" as "auto" | "numeric", default_confidentiality: "INTERNO" as Confidentiality,
    retention_years: "", require_workflow: true,
  });
  const [areas, setAreas] = useState<{ code: string; name: string }[]>([]);
  const [disc, setDisc] = useState<string[] | null>(null);          // null = todas
  const [customFlow, setCustomFlow] = useState(false);
  const [flowName, setFlowName] = useState("Fluxo do projeto");
  const [steps, setSteps] = useState<Step[]>([
    { name: "Verificação técnica", role_required: "REVISOR", sla_hours: 48 },
    { name: "Aprovação do controle de documentos", role_required: "CONTROLADOR", sla_hours: 24 },
  ]);
  const [members, setMembers] = useState<{ user_id: string; role: Role }[]>([]);
  const preview = useMaskPreview(f.code_mask, f.code);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const usesArea = f.code_mask.includes("{AREA}");

  const problems: Record<number, string | null> = {
    0: !/^[A-Z0-9]{2,12}$/.test(f.code) ? "Sigla com 2 a 12 caracteres (A-Z, 0-9)"
      : f.name.trim().length < 3 ? "Informe o nome do projeto"
      : f.start_date && f.end_date && f.end_date < f.start_date ? "Término antes do início" : null,
    1: preview.error ?? null,
    2: usesArea && areas.length === 0 ? "A máscara usa {AREA}: cadastre ao menos uma área"
      : areas.some((a) => !/^[A-Z0-9]{1,6}$/.test(a.code) || a.name.trim().length < 2) ? "Área com código (1-6, A-Z/0-9) e nome"
      : new Set(areas.map((a) => a.code)).size !== areas.length ? "Código de área repetido"
      : disc !== null && disc.length === 0 ? "Habilite ao menos uma disciplina" : null,
    3: customFlow && (flowName.trim().length < 3 || steps.some((s) => s.name.trim().length < 3)) ? "Dê nome ao fluxo e a cada etapa" : null,
    4: null, 5: null,
  };
  const firstProblem = Object.entries(problems).find(([, v]) => v);

  const create = useMutation({
    mutationFn: () => api.post<{ id: string; code: string }>("/projects", {
      ...f, client: f.client || null, contract: f.contract || null, location: f.location || null,
      description: f.description || null, start_date: f.start_date || null, end_date: f.end_date || null,
      retention_years: f.retention_years ? Number(f.retention_years) : null,
      areas, disciplines: disc ?? [],
      template: customFlow ? { name: flowName.trim(), steps } : null, members,
    }),
    onSuccess: (r) => {
      toast.ok(`Projeto ${r.code} criado`);
      void qc.invalidateQueries();
      setProject(r.id);
      nav(`/projetos/${r.id}`);
    },
    onError: toast.err,
  });

  if (!me?.is_admin) return <ErrorBox error="Somente administradores criam projetos." />;
  const canNext = !problems[step];

  return (
    <div className="max-w-4xl">
      <nav className="text-[13px] text-muted mb-2"><Link to="/projetos" className="hover:underline">Projetos</Link> / Novo</nav>
      <PageHeader title="Novo projeto" sub="Configure uma vez: a codificação, as áreas e o fluxo passam a valer para todos os documentos." />

      <ol className="flex gap-1 overflow-x-auto pb-2 mb-4 -mx-1 px-1" aria-label="Etapas">
        {STEPS.map((s, i) => (
          <li key={s} className="shrink-0">
            <button onClick={() => (i < step || Object.keys(problems).slice(0, i).every((k) => !problems[Number(k)])) && setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className={`h-9 px-3 rounded-full text-[13px] inline-flex items-center gap-2 border ${i === step ? "bg-accent text-accent-ink border-transparent font-medium" : i < step ? "bg-accent-soft text-accent border-transparent" : "border-line text-muted"}`}>
              <span className="tnum">{i < step ? <Check size={14} /> : i + 1}</span>{s}
            </button>
          </li>
        ))}
      </ol>

      <section className="panel p-4 sm:p-6">
        {step === 0 && (
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Sigla" hint="Entra no código de cada documento. 2 a 12 caracteres."><input className="input code uppercase" autoFocus value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} placeholder="UHE01" /></Field>
            <Field label="Nome do projeto"><input className="input" value={f.name} onChange={set("name")} placeholder="UHE Rio Claro — projeto executivo" /></Field>
            <Field label="Cliente"><input className="input" value={f.client} onChange={set("client")} /></Field>
            <Field label="Contrato / pedido"><input className="input" value={f.contract} onChange={set("contract")} placeholder="CT-2026/014" /></Field>
            <Field label="Local"><input className="input" value={f.location} onChange={set("location")} placeholder="Cidade / UF" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Início"><input className="input" type="date" value={f.start_date} onChange={set("start_date")} /></Field>
              <Field label="Término"><input className="input" type="date" value={f.end_date} onChange={set("end_date")} /></Field>
            </div>
            <div className="sm:col-span-2"><Field label="Escopo / descrição"><textarea className="input h-24 py-2" value={f.description} onChange={set("description")} maxLength={4000} /></Field></div>
          </div>
        )}

        {step === 1 && (
          <>
            <Field label="Máscara de codificação" hint="O banco recusa qualquer código fora dela. Clique nos tokens para montar.">
              <input className="input code" value={f.code_mask} onChange={(e) => setF({ ...f, code_mask: e.target.value.toUpperCase() })} />
            </Field>
            <div className="flex flex-wrap gap-1.5 -mt-1 mb-3">
              {TOKENS.map((t) => <button key={t} className="btn btn-sm code" onClick={() => setF({ ...f, code_mask: f.code_mask ? `${f.code_mask}-${t}` : t })}>{t}</button>)}
              <button className="btn btn-ghost btn-sm" onClick={() => setF({ ...f, code_mask: "" })}>Limpar</button>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              {MASKS.map((m) => (
                <button key={m.mask} onClick={() => setF({ ...f, code_mask: m.mask })}
                  className={`text-left panel px-3 py-2 ${f.code_mask === m.mask ? "border-accent" : "hover:border-line-strong"}`}>
                  <div className="text-[12px] text-muted">{m.label}</div><div className="code text-[12.5px]">{m.mask}</div>
                </button>
              ))}
            </div>
            <div className={`rounded-md px-3 py-2.5 mb-5 text-sm ${preview.error ? "bg-bad-soft text-bad" : "bg-surface-2"}`} aria-live="polite">
              {preview.error ? preview.error : <>Exemplo do 1º documento: <span className="code font-semibold">{preview.example ?? "…"}</span></>}
            </div>
            <div className="grid sm:grid-cols-3 gap-x-4">
              <Field label="Revisões" hint={f.revision_scheme === "auto" ? "Nasce em A, B… (antes da emissão)" : "Nasce em 0, 1, 2…"}>
                <select className="input" value={f.revision_scheme} onChange={set("revision_scheme")}>
                  <option value="auto">Letras (A, B, C…)</option><option value="numeric">Números (0, 1, 2…)</option>
                </select>
              </Field>
              <Field label="Confidencialidade padrão">
                <select className="input" value={f.default_confidentiality} onChange={set("default_confidentiality")}>
                  {CONF.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Retenção (anos)" hint="Documento não pode ser excluído nesse prazo">
                <input className="input tnum" type="number" min={1} max={100} value={f.retention_years} onChange={set("retention_years")} placeholder="Sem retenção" />
              </Field>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="font-semibold">Áreas / unidades</h2>
            <p className="text-[13px] text-muted mb-3">{usesArea ? "Obrigatório: a máscara usa {AREA}." : "Opcional. Com áreas cadastradas, só elas são aceitas nos documentos."}</p>
            <ul className="space-y-2 mb-2">
              {areas.map((a, i) => (
                <li key={i} className="flex gap-2">
                  <input className="input code w-28 uppercase" value={a.code} placeholder="CF" maxLength={6} aria-label="Código da área"
                    onChange={(e) => setAreas(areas.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") } : x)))} />
                  <input className="input flex-1" value={a.name} placeholder="Casa de força" aria-label="Nome da área"
                    onChange={(e) => setAreas(areas.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <button className="btn btn-ghost btn-sm" onClick={() => setAreas(areas.filter((_, j) => j !== i))} aria-label="Remover área"><Trash2 size={15} /></button>
                </li>
              ))}
            </ul>
            <button className="btn btn-sm mb-6" onClick={() => setAreas([...areas, { code: "", name: "" }])}><Plus size={15} /> Adicionar área</button>

            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">Disciplinas habilitadas</h2>
              <div className="flex gap-2 text-[13px]">
                <button className="text-accent hover:underline" onClick={() => setDisc(null)}>Todas</button>
                <button className="text-accent hover:underline" onClick={() => setDisc([])}>Nenhuma</button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
              {cat.data?.disciplines.map((d) => {
                const on = disc === null || disc.includes(d.code);
                return (
                  <label key={d.code} className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm cursor-pointer ${on ? "border-accent/50 bg-accent-soft/50" : "border-line"}`}>
                    <input type="checkbox" checked={on} onChange={(e) => {
                      const cur = disc ?? cat.data!.disciplines.map((x) => x.code);
                      const next = e.target.checked ? [...cur, d.code] : cur.filter((x) => x !== d.code);
                      setDisc(next.length === cat.data!.disciplines.length ? null : next);
                    }} />
                    <span className="code text-[12px] w-9">{d.code}</span><span className="truncate">{d.name}</span>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <label className="flex items-start gap-2 mb-5">
              <input type="checkbox" className="mt-1" checked={f.require_workflow} onChange={(e) => setF({ ...f, require_workflow: e.target.checked })} />
              <span><span className="font-medium">Aprovação interna exige workflow concluído</span>
                <span className="block text-[13px] text-muted">Recomendado. Sem isso, o autor pode aprovar direto (a segregação autor ≠ aprovador continua valendo no workflow).</span></span>
            </label>
            <div className="grid sm:grid-cols-2 gap-2 mb-4" role="radiogroup" aria-label="Fluxo de aprovação">
              <button role="radio" aria-checked={!customFlow} onClick={() => setCustomFlow(false)} className={`panel p-3 text-left ${!customFlow ? "border-accent" : ""}`}>
                <div className="font-medium">Fluxo padrão</div>
                <div className="text-[13px] text-muted">Verificação técnica (48 h) → aprovação do controle de documentos (24 h)</div>
              </button>
              <button role="radio" aria-checked={customFlow} onClick={() => setCustomFlow(true)} className={`panel p-3 text-left ${customFlow ? "border-accent" : ""}`}>
                <div className="font-medium">Fluxo personalizado</div>
                <div className="text-[13px] text-muted">Defina etapas, perfis e prazos próprios deste projeto</div>
              </button>
            </div>
            {customFlow && (
              <>
                <Field label="Nome do fluxo"><input className="input" value={flowName} onChange={(e) => setFlowName(e.target.value)} /></Field>
                <StepEditor steps={steps} onChange={setSteps} />
              </>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <p className="text-[13px] text-muted mb-3">Você entra como administrador do projeto. Inclua agora quem já vai trabalhar nele (dá para ajustar depois).</p>
            {users.data?.filter((u) => u.is_active && u.id !== me.id).length === 0 && (
              <p className="text-sm mb-3">Ainda não há outros usuários. <Link to="/usuarios" className="text-accent hover:underline">Cadastre em Usuários</Link> e inclua-os depois na aba Equipe do projeto.</p>
            )}
            <ul className="divide-y divide-line">
              {users.data?.filter((u) => u.is_active && u.id !== me.id).map((u) => {
                const m = members.find((x) => x.user_id === u.id);
                return (
                  <li key={u.id} className="flex flex-col sm:flex-row sm:items-center gap-2 py-2">
                    <label className="flex items-center gap-2 flex-1 min-w-0">
                      <input type="checkbox" checked={!!m} onChange={(e) => setMembers(e.target.checked ? [...members, { user_id: u.id, role: u.is_external ? "EXTERNO" : "AUTOR" }] : members.filter((x) => x.user_id !== u.id))} />
                      <span className="truncate"><span className="font-medium">{u.name}</span> <span className="text-muted text-[13px]">· {u.email}</span></span>
                    </label>
                    {m && (
                      <select className="input w-full sm:w-56" value={m.role} onChange={(e) => setMembers(members.map((x) => (x.user_id === u.id ? { ...x, role: e.target.value as Role } : x)))} aria-label={`Perfil de ${u.name}`}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {step === 5 && (
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div><dt className="text-muted text-[12px]">Projeto</dt><dd><span className="code">{f.code}</span> · {f.name}</dd></div>
            <div><dt className="text-muted text-[12px]">Cliente / contrato</dt><dd>{f.client || "—"} · {f.contract || "—"}</dd></div>
            <div><dt className="text-muted text-[12px]">Prazo</dt><dd>{f.start_date || "—"} → {f.end_date || "—"}</dd></div>
            <div><dt className="text-muted text-[12px]">Código de exemplo</dt><dd className="code">{preview.example}</dd></div>
            <div><dt className="text-muted text-[12px]">Revisões · confidencialidade · retenção</dt><dd>{f.revision_scheme === "auto" ? "A, B, C…" : "0, 1, 2…"} · {CONF.find((c) => c.v === f.default_confidentiality)?.label} · {f.retention_years ? `${f.retention_years} anos` : "sem retenção"}</dd></div>
            <div><dt className="text-muted text-[12px]">Áreas</dt><dd>{areas.length ? areas.map((a) => a.code).join(", ") : "livre"}</dd></div>
            <div><dt className="text-muted text-[12px]">Disciplinas</dt><dd>{disc === null ? "todas" : disc.join(", ")}</dd></div>
            <div><dt className="text-muted text-[12px]">Aprovação</dt><dd>{customFlow ? `${flowName}: ${steps.map((s) => s.name).join(" → ")}` : "Fluxo padrão"}{f.require_workflow ? "" : " (opcional)"}</dd></div>
            <div><dt className="text-muted text-[12px]">Equipe</dt><dd>{members.length + 1} pessoa(s)</dd></div>
          </dl>
        )}

        {problems[step] && (step > 0 || f.code || f.name) && <p className="text-[13px] text-bad mt-4" role="alert">{problems[step]}</p>}
      </section>

      <div className="sticky bottom-16 lg:bottom-0 bg-bg/95 backdrop-blur py-3 mt-3 flex gap-2 justify-between">
        <button className="btn" onClick={() => (step === 0 ? nav("/projetos") : setStep(step - 1))}><ArrowLeft size={16} /> {step === 0 ? "Cancelar" : "Voltar"}</button>
        {step < STEPS.length - 1
          ? <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Avançar <ArrowRight size={16} /></button>
          : <button className="btn btn-primary" disabled={!!firstProblem || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Criando…" : <><Check size={16} /> Criar projeto</>}</button>}
      </div>
    </div>
  );
}
