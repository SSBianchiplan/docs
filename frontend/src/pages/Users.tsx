import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Crown, KeyRound, Search, ShieldCheck, UserCheck, UserPlus, UserX, X } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDateTime, relTime, ROLE_LABEL } from "@/lib/format";
import { useProjects } from "@/lib/hooks";
import type { AccessRequest, AdminUser, Role } from "@/lib/types";
import { useSession } from "@/store/session";
import { Badge, Drawer, Empty, ErrorBox, Field, PageHeader, Skeleton, toast } from "@/components/ui";
import { passwordProblem } from "./ChangePassword";

const ROLES: Role[] = ["CONTROLADOR", "AUTOR", "REVISOR", "LEITOR", "EXTERNO", "ADMIN"];

/** Mostra a senha temporária uma única vez, com botão de copiar. */
function TempPassword({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Acesso ao GPlanSiS|DOCS\nEndereço: ${location.origin}/entrar\nE-mail: ${email}\nSenha temporária: ${password}\n(troque no primeiro acesso)`;
  return (
    <Drawer open onClose={onClose} title="Senha temporária" footer={<button className="btn btn-primary" onClick={onClose}>Concluir</button>}>
      <p className="text-sm text-ink-2 mb-4">Repasse ao usuário por um canal seguro. Ela <b>não será exibida de novo</b> e precisa ser trocada no primeiro acesso.</p>
      <div className="panel p-4 bg-surface-2 mb-3">
        <div className="text-[12px] text-muted">E-mail</div><div className="text-sm mb-2">{email}</div>
        <div className="text-[12px] text-muted">Senha temporária</div><div className="code text-[18px] tracking-wide select-all">{password}</div>
      </div>
      <button className="btn w-full" onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true)); }}>
        {copied ? <><Check size={16} /> Copiado</> : <><Copy size={16} /> Copiar mensagem de acesso</>}
      </button>
    </Drawer>
  );
}

export default function Users() {
  const me = useSession((s) => s.user);
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.get<AdminUser[]>("/users") });
  const requests = useQuery({ queryKey: ["access-requests"], queryFn: () => api.get<AccessRequest[]>("/access-requests"), refetchInterval: 60_000 });
  const projects = useProjects();
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"ativos" | "inativos" | "todos">("ativos");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const blank = { name: "", email: "", company: "", password: "", is_admin: false, is_external: false, project_ids: [] as string[], project_role: "LEITOR" as Role };
  const [u, setU] = useState(blank);
  const refresh = () => void qc.invalidateQueries();

  const create = useMutation({
    mutationFn: () => api.post<{ email: string; temporary_password: string }>("/users", { ...u, company: u.company || null, password: u.password || null }),
    onSuccess: (r) => { setCreating(false); setU(blank); refresh(); toast.ok("Usuário criado"); setSecret({ email: r.email, password: r.temporary_password }); },
    onError: toast.err,
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; body: Partial<AdminUser> }) => api.patch(`/users/${v.id}`, v.body),
    onSuccess: () => { refresh(); toast.ok("Usuário atualizado"); },
    onError: toast.err,
  });
  const reset = useMutation({
    mutationFn: (x: AdminUser) => api.post<{ temporary_password: string }>(`/users/${x.id}/reset-password`).then((r) => ({ ...r, email: x.email })),
    onSuccess: (r) => { refresh(); setSecret({ email: r.email, password: r.temporary_password }); },
    onError: toast.err,
  });
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: "APROVADA" | "RECUSADA"; is_external?: boolean }) =>
      api.post<{ email?: string; temporary_password?: string }>(`/access-requests/${v.id}/decide`, v),
    onSuccess: (r) => {
      refresh();
      if (r.temporary_password && r.email) setSecret({ email: r.email, password: r.temporary_password });
      else toast.ok("Solicitação recusada");
    },
    onError: toast.err,
  });

  const list = useMemo(() => (users.data ?? []).filter((x) =>
    (show === "todos" || (show === "ativos" ? x.is_active : !x.is_active))
    && (!q || `${x.name} ${x.email} ${x.company ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [users.data, q, show]);
  const pwProblem = u.password ? passwordProblem(u.password) : null;
  const pending = requests.data ?? [];

  return (
    <>
      <PageHeader title="Usuários e acessos" sub={users.data ? `${users.data.filter((x) => x.is_active).length} ativos · ${pending.length} solicitação(ões) pendente(s)` : " "}
        actions={<button className="btn btn-primary" onClick={() => setCreating(true)}><UserPlus size={16} /> Novo usuário</button>} />

      {pending.length > 0 && (
        <section className="panel mb-4 border-accent/40">
          <h2 className="px-4 pt-3 pb-2 font-semibold flex items-center gap-2"><UserCheck size={17} className="text-accent" /> Solicitações de acesso</h2>
          <ul className="divide-y divide-line">
            {pending.map((r) => (
              <li key={r.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{r.name} <span className="text-muted font-normal">· {r.email}</span></div>
                  <div className="text-[13px] text-muted">{r.company ?? "Sem empresa"} · {relTime(r.created_at)}</div>
                  {r.message && <p className="text-[13px] text-ink-2 mt-1 line-clamp-2">{r.message}</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button className="btn btn-sm" disabled={decide.isPending} onClick={() => confirm(`Recusar a solicitação de ${r.name}?`) && decide.mutate({ id: r.id, decision: "RECUSADA" })}><X size={15} /> Recusar</button>
                  <button className="btn btn-sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: "APROVADA", is_external: true })} title="Cliente ou fornecedor">Aprovar como externo</button>
                  <button className="btn btn-primary btn-sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: "APROVADA" })}><Check size={15} /> Aprovar</button>
                </div>
              </li>
            ))}
          </ul>
          <p className="px-4 pb-3 text-[12px] text-muted">Aprovar cria a conta com senha temporária. Depois inclua a pessoa na equipe do projeto em <b>Projetos e equipe</b>.</p>
        </section>
      )}

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <label className="relative flex-1 sm:max-w-sm">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input pl-8" placeholder="Buscar por nome, e-mail ou empresa" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar usuário" />
        </label>
        <div role="radiogroup" aria-label="Filtro" className="inline-flex rounded-md border border-line p-0.5 bg-surface self-start">
          {(["ativos", "inativos", "todos"] as const).map((v) => (
            <button key={v} role="radio" aria-checked={show === v} onClick={() => setShow(v)}
              className={`h-8 px-3 rounded text-[13px] capitalize ${show === v ? "bg-surface-2 text-ink font-medium" : "text-muted hover:text-ink"}`}>{v}</button>
          ))}
        </div>
      </div>

      {users.error ? <ErrorBox error={users.error} /> : users.isLoading ? <Skeleton className="h-72" /> : list.length === 0 ? (
        <div className="panel"><Empty title="Nenhum usuário encontrado" /></div>
      ) : (
        <>
          {/* celular: cartões */}
          <ul className="md:hidden space-y-2">
            {list.map((x) => (
              <li key={x.id} className={`panel p-3 ${x.is_active ? "" : "opacity-60"}`}>
                <button className="w-full text-left" onClick={() => setEditing(x)}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{x.name}</span>
                    {x.is_master && <Badge tone="accent"><Crown size={12} /> master</Badge>}
                    {x.is_admin && !x.is_master && <Badge tone="info">admin</Badge>}
                    {!x.is_active && <Badge tone="bad">inativo</Badge>}
                  </div>
                  <div className="text-[13px] text-muted truncate">{x.email}</div>
                  <div className="text-[12px] text-muted mt-1">{x.projects} projeto(s) · último acesso {x.last_login_at ? relTime(x.last_login_at) : "nunca"}</div>
                </button>
              </li>
            ))}
          </ul>
          {/* desktop: tabela */}
          <section className="panel overflow-x-auto hidden md:block">
            <table className="w-full">
              <thead className="border-b border-line bg-surface-2/60"><tr>
                <th className="th">Nome</th><th className="th">E-mail</th><th className="th">Empresa</th><th className="th">Perfil</th>
                <th className="th">Projetos</th><th className="th">Último acesso</th><th className="th" />
              </tr></thead>
              <tbody className="divide-y divide-line">
                {list.map((x) => (
                  <tr key={x.id} className={x.is_active ? "" : "opacity-60"}>
                    <td className="td font-medium">{x.name}</td>
                    <td className="td text-ink-2">{x.email}</td>
                    <td className="td text-ink-2">{x.company ?? "—"}</td>
                    <td className="td"><div className="flex gap-1 flex-wrap">
                      {x.is_master && <Badge tone="accent"><Crown size={12} /> master</Badge>}
                      {x.is_admin && !x.is_master && <Badge tone="info"><ShieldCheck size={12} /> admin</Badge>}
                      {x.is_external && <Badge>externo</Badge>}
                      {!x.is_active && <Badge tone="bad">inativo</Badge>}
                      {x.must_change_password && x.is_active && <Badge tone="warn">senha temporária</Badge>}
                      {!x.is_admin && !x.is_external && x.is_active && !x.must_change_password && <span className="text-[13px] text-muted">usuário</span>}
                    </div></td>
                    <td className="td tnum">{x.projects}</td>
                    <td className="td text-[13px] text-ink-2" title={fmtDateTime(x.last_login_at)}>{x.last_login_at ? relTime(x.last_login_at) : "nunca"}</td>
                    <td className="td text-right"><button className="btn btn-sm" onClick={() => setEditing(x)}>Gerenciar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      <Drawer open={creating} onClose={() => setCreating(false)} title="Novo usuário" footer={<>
        <button className="btn" onClick={() => setCreating(false)}>Cancelar</button>
        <button className="btn btn-primary" disabled={u.name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email) || !!pwProblem || create.isPending} onClick={() => create.mutate()}>Criar usuário</button>
      </>}>
        <Field label="Nome"><input className="input" value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} /></Field>
        <Field label="E-mail"><input className="input" type="email" value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} /></Field>
        <Field label="Empresa"><input className="input" value={u.company} onChange={(e) => setU({ ...u, company: e.target.value })} /></Field>
        <Field label="Senha inicial" hint={pwProblem ?? "Deixe vazio para gerar uma senha temporária. A troca é obrigatória no primeiro acesso."}>
          <input className="input" type="text" autoComplete="off" value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} />
        </Field>
        {!!projects.data?.length && (
          <fieldset className="mb-3.5">
            <legend className="label">Incluir nos projetos</legend>
            <div className="panel max-h-40 overflow-y-auto divide-y divide-line">
              {projects.data.map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <input type="checkbox" checked={u.project_ids.includes(p.id)} onChange={(e) => setU({ ...u, project_ids: e.target.checked ? [...u.project_ids, p.id] : u.project_ids.filter((x) => x !== p.id) })} />
                  <span className="code text-[12px]">{p.code}</span> {p.name}
                </label>
              ))}
            </div>
            {u.project_ids.length > 0 && (
              <select className="input mt-2" value={u.project_role} onChange={(e) => setU({ ...u, project_role: e.target.value as Role })} aria-label="Perfil nos projetos">
                {ROLES.map((r) => <option key={r} value={r}>Perfil: {ROLE_LABEL[r]}</option>)}
              </select>
            )}
          </fieldset>
        )}
        <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={u.is_external} onChange={(e) => setU({ ...u, is_external: e.target.checked })} /> Usuário externo (cliente ou fornecedor)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={u.is_admin} onChange={(e) => setU({ ...u, is_admin: e.target.checked })} /> Administrador do sistema (vê todos os projetos)</label>
      </Drawer>

      {editing && (() => {
        const x = users.data?.find((y) => y.id === editing.id) ?? editing;
        const self = x.id === me?.id;
        return (
          <Drawer open onClose={() => setEditing(null)} title={x.name} footer={<button className="btn" onClick={() => setEditing(null)}>Fechar</button>}>
            <p className="text-sm text-muted mb-4">{x.email} · criado em {fmtDateTime(x.created_at)}</p>
            {x.is_master && <p className="text-[13px] mb-4 flex items-center gap-1.5 text-accent"><Crown size={14} /> Administrador master: não pode ser rebaixado nem desativado.</p>}
            <EditForm key={x.id} user={x} onSave={(body) => patch.mutate({ id: x.id, body })} busy={patch.isPending} />
            <div className="border-t border-line pt-4 mt-2 space-y-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={x.is_admin} disabled={x.is_master || self || patch.isPending}
                onChange={(e) => patch.mutate({ id: x.id, body: { is_admin: e.target.checked } })} /> Administrador do sistema</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={x.is_external} disabled={patch.isPending}
                onChange={(e) => patch.mutate({ id: x.id, body: { is_external: e.target.checked } })} /> Usuário externo</label>
            </div>
            <div className="border-t border-line pt-4 mt-4 flex flex-col gap-2">
              <button className="btn" disabled={reset.isPending || (x.is_master && me?.email.toLowerCase() !== x.email.toLowerCase())}
                onClick={() => confirm(`Gerar nova senha temporária para ${x.name}? As sessões abertas dele serão encerradas.`) && reset.mutate(x)}>
                <KeyRound size={16} /> Redefinir senha
              </button>
              {x.is_active ? (
                <button className="btn btn-danger" disabled={x.is_master || self || patch.isPending}
                  onClick={() => confirm(`Desativar ${x.name}? O acesso é cortado imediatamente; o histórico é preservado.`) && patch.mutate({ id: x.id, body: { is_active: false } })}>
                  <UserX size={16} /> Desativar conta
                </button>
              ) : (
                <button className="btn" disabled={patch.isPending} onClick={() => patch.mutate({ id: x.id, body: { is_active: true } })}><UserCheck size={16} /> Reativar conta</button>
              )}
              <p className="text-[12px] text-muted">Contas não são excluídas: a trilha de auditoria precisa saber quem fez cada ação.</p>
            </div>
          </Drawer>
        );
      })()}

      {secret && <TempPassword {...secret} onClose={() => setSecret(null)} />}
    </>
  );
}

function EditForm({ user, onSave, busy }: { user: AdminUser; onSave: (b: Partial<AdminUser>) => void; busy: boolean }) {
  const [name, setName] = useState(user.name);
  const [company, setCompany] = useState(user.company ?? "");
  const dirty = name !== user.name || company !== (user.company ?? "");
  return (
    <>
      <Field label="Nome"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Empresa"><input className="input" value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
      <button className="btn btn-primary btn-sm mb-4" disabled={!dirty || name.trim().length < 2 || busy} onClick={() => onSave({ name: name.trim(), company: company || null })}>Salvar dados</button>
    </>
  );
}
