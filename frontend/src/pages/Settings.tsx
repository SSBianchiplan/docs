import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot, DraftingCompass, ExternalLink, KeyRound, LogOut, Palette, RefreshCw, Server, ShieldCheck, User as UserIcon, Users as UsersIcon, PenLine, FileSpreadsheet,
} from "lucide-react";
import { api } from "@/lib/api";
import { fmtBytes, fmtDateTime, relTime, ROLE_LABEL } from "@/lib/format";
import { usePerfil, type Perfil } from "@/lib/perfil";
import { useProjects } from "@/lib/hooks";
import { useSession } from "@/store/session";
import { type Theme, useUi } from "@/store/ui";
import { Avatar } from "@/components/Avatar";
import { ChangePasswordForm } from "@/pages/ChangePassword";
import { Badge, Drawer, ErrorBox, Field, PageHeader, Skeleton, toast } from "@/components/ui";

type Aba = "perfil" | "seguranca" | "preferencias" | "ia" | "integracao" | "sistema";

interface IAConfig {
  configurada: boolean; ativo: boolean; pronta: boolean; origem: "painel" | "env" | null; final: string | null;
  modelo: string; ilegivel: boolean; cifragem: string; modelos: { id: string; nome: string }[];
  atualizado_em: string | null; atualizado_por: string | null;
}
interface Sistema {
  servicos: { nome: string; ok: boolean; ms: number; detalhe: string }[];
  contagens: Record<string, number>;
  ocr: { status: string; n: number }[];
  integracao: { ativa: boolean; drawings_url: string; entregues: number; pendentes: number; desistidos: number;
    ultimo_entregue: string | null; ultimo_erro: string | null; documentos_drawings: number };
  integracao_writer?: { ativa: boolean; url: string; entregues: number; pendentes: number; desistidos: number;
    ultimo_entregue: string | null; ultimo_erro: string | null; documentos: number };
  integracao_sheets?: { ativa: boolean; url: string; entregues: number; pendentes: number; desistidos: number;
    ultimo_entregue: string | null; ultimo_erro: string | null; documentos: number };
  parametros: [string, string][];
  gerado_em: string;
}

/** Linha rótulo/valor das seções. */
function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="grid sm:grid-cols-[180px_1fr] gap-1 sm:gap-4 py-2.5 border-b border-line last:border-0 items-center">
      <span className="text-[13px] text-muted">{rotulo}</span><div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}
const Secao = ({ titulo, sub, children }: { titulo: string; sub?: string; children: ReactNode }) => (
  <section className="panel p-5 mb-4 max-w-3xl">
    <h2 className="font-semibold">{titulo}</h2>{sub && <p className="text-[13px] text-muted mt-0.5 mb-2">{sub}</p>}
    {children}
  </section>
);

// ---------------------------------------------------------------------------- perfil e foto
function Recorte({ arquivo, onClose, onSalvo }: { arquivo: File | null; onClose: () => void; onSalvo: (p: Perfil) => void }) {
  const T = 260;
  const cv = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const st = useRef({ z: 1, ox: 0, oy: 0, base: 1 });
  const [zoom, setZoom] = useState(1);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (!arquivo) return;
    const url = URL.createObjectURL(arquivo);
    const i = new Image();
    i.onload = () => {
      const base = T / Math.min(i.width, i.height);
      st.current = { z: 1, base, ox: (T - i.width * base) / 2, oy: (T - i.height * base) / 2 };
      setZoom(1); setImg(i);
    };
    i.onerror = () => toast.err("Não foi possível ler a imagem");
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [arquivo]);
  const desenha = (ctx: CanvasRenderingContext2D, N: number) => {
    if (!img) return;
    const { z, base, ox, oy } = st.current, k = N / T, s = base * z * k;
    ctx.clearRect(0, 0, N, N); ctx.drawImage(img, ox * k, oy * k, img.width * s, img.height * s);
  };
  const limita = () => {
    if (!img) return;
    const s = st.current.base * st.current.z;
    st.current.ox = Math.min(0, Math.max(T - img.width * s, st.current.ox));
    st.current.oy = Math.min(0, Math.max(T - img.height * s, st.current.oy));
  };
  useEffect(() => { const c = cv.current?.getContext("2d"); if (c) desenha(c, T); });
  const arrasto = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  async function salvar() {
    const o = document.createElement("canvas"); o.width = o.height = 256;
    desenha(o.getContext("2d")!, 256);
    let d = o.toDataURL("image/webp", 0.86);
    if (!d.startsWith("data:image/webp")) d = o.toDataURL("image/jpeg", 0.88);
    setSalvando(true);
    try { onSalvo(await api.put<Perfil>("/config/perfil/avatar", { data_url: d })); onClose(); toast.ok("Foto atualizada"); }
    catch (e) { toast.err(e); } finally { setSalvando(false); }
  }
  return (
    <Drawer open={!!arquivo} onClose={onClose} title="Enquadrar foto" footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary" disabled={!img || salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar foto"}</button>
    </>}>
      <div className="flex flex-col items-center gap-3">
        <canvas ref={cv} width={T} height={T} className="rounded-full bg-surface-2 cursor-grab touch-none" style={{ width: T, height: T }}
          onPointerDown={(e) => { arrasto.current = { x: e.clientX, y: e.clientY, ox: st.current.ox, oy: st.current.oy }; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { const a = arrasto.current; if (!a) return; st.current.ox = a.ox + e.clientX - a.x; st.current.oy = a.oy + e.clientY - a.y; limita(); const c = cv.current?.getContext("2d"); if (c) desenha(c, T); }}
          onPointerUp={() => { arrasto.current = null; }} />
        <label className="flex items-center gap-3 w-[260px] text-sm text-muted">Zoom
          <input type="range" min={1} max={4} step={0.01} value={zoom} className="flex-1 accent-[var(--color-accent)]"
            onChange={(e) => { const z0 = st.current.z, z = +e.target.value, cx = T / 2 - st.current.ox, cy = T / 2 - st.current.oy;
              st.current.z = z; st.current.ox = T / 2 - cx * z / z0; st.current.oy = T / 2 - cy * z / z0; limita(); setZoom(z); }} />
        </label>
        <p className="text-[13px] text-muted">Arraste a foto para enquadrar o rosto.</p>
      </div>
    </Drawer>
  );
}

function AbaPerfil({ p }: { p: Perfil }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState(p.name);
  const [empresa, setEmpresa] = useState(p.company ?? "");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const atualiza = (np: Perfil) => {
    qc.setQueryData(["perfil"], np);
    const s = useSession.getState();
    if (s.user && s.token) s.login(s.token, { ...s.user, name: np.name });
  };
  const salvar = useMutation({ mutationFn: () => api.patch<Perfil>("/config/perfil", { name: nome.trim(), company: empresa }),
    onSuccess: (np) => { atualiza(np); toast.ok("Perfil salvo"); }, onError: toast.err });
  const remover = useMutation({ mutationFn: () => api.del<Perfil>("/config/perfil/avatar"), onSuccess: atualiza, onError: toast.err });
  return (
    <>
      <Secao titulo="Perfil e foto" sub="Seu nome e sua foto aparecem no menu, nas tarefas, nos comentários e na trilha de auditoria.">
        <div className="flex flex-wrap items-center gap-5 py-2">
          <Avatar id={p.id} name={p.name} ver={p.avatar_ver} has={p.has_avatar} size={88} />
          <div className="min-w-0">
            <div className="text-lg font-semibold">{p.name}</div>
            <div className="text-sm text-muted">{p.email}</div>
            <div className="flex gap-2 mt-2">
              <button className="btn btn-primary btn-sm" onClick={() => input.current?.click()}>{p.has_avatar ? "Trocar foto" : "Enviar foto"}</button>
              {p.has_avatar && <button className="btn btn-sm" onClick={() => remover.mutate()}>Remover foto</button>}
            </div>
            <p className="text-[12px] text-muted mt-1.5">PNG, JPEG ou WebP; você enquadra antes de salvar.</p>
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setArquivo(f); }} />
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-x-4 mt-3">
          <Field label="Nome"><input className="input" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} /></Field>
          <Field label="Empresa"><input className="input" value={empresa} maxLength={120} onChange={(e) => setEmpresa(e.target.value)} /></Field>
        </div>
        <button className="btn btn-primary" disabled={salvar.isPending || nome.trim().length < 2} onClick={() => salvar.mutate()}>Salvar perfil</button>
      </Secao>
      <Secao titulo="Acesso">
        <Linha rotulo="Perfil">{p.is_admin ? <Badge tone="accent">Administrador</Badge> : <Badge>Usuário</Badge>}{p.is_external && <> <Badge tone="warn">Externo</Badge></>}</Linha>
        <Linha rotulo="Projetos">{p.projects.length ? <div className="flex flex-wrap gap-1.5">{p.projects.map((x) => <Badge key={x.code} title={x.name}>{x.code} · {ROLE_LABEL[x.role] ?? x.role}</Badge>)}</div> : <span className="text-muted">nenhum</span>}</Linha>
        <Linha rotulo="Conta criada">{fmtDateTime(p.created_at)}</Linha>
        <Linha rotulo="Último acesso">{p.last_login_at ? relTime(p.last_login_at) : "—"}</Linha>
        <p className="text-[12px] text-muted mt-2">Papéis por projeto são definidos pelo controlador do projeto ou por um administrador.</p>
      </Secao>
      <Recorte arquivo={arquivo} onClose={() => setArquivo(null)} onSalvo={atualiza} />
    </>
  );
}

function AbaSeguranca({ p }: { p: Perfil }) {
  const login = useSession((s) => s.login);
  const user = useSession((s) => s.user);
  const sair = useMutation({ mutationFn: () => api.post<{ token: string }>("/config/sessoes/encerrar"),
    onSuccess: (r) => { if (user) login(r.token, user); toast.ok("Todas as outras sessões foram encerradas"); }, onError: toast.err });
  return (
    <>
      <Secao titulo="Trocar senha" sub={`Última troca: ${p.password_changed_at ? fmtDateTime(p.password_changed_at) : "—"}. Ao trocar, as sessões em outros aparelhos caem.`}>
        <div className="max-w-sm"><ChangePasswordForm /></div>
      </Secao>
      <Secao titulo="Sessões" sub="Encerra o acesso em todos os outros aparelhos e navegadores; você continua conectado aqui.">
        <button className="btn" disabled={sair.isPending} onClick={() => sair.mutate()}><LogOut size={16} /> Sair de todos os outros aparelhos</button>
      </Secao>
    </>
  );
}

function AbaPreferencias() {
  const { theme, setTheme, projectId, setProject } = useUi();
  const projects = useProjects();
  return (
    <Secao titulo="Preferências" sub="Valem para este navegador.">
      <Linha rotulo="Tema">
        <div className="inline-flex rounded-md border border-line overflow-hidden">
          {([["light", "Claro"], ["system", "Do sistema"], ["dark", "Escuro"]] as [Theme, string][]).map(([v, l]) => (
            <button key={v} onClick={() => setTheme(v)} aria-pressed={theme === v}
              className={`px-3 h-8 text-sm ${theme === v ? "bg-accent-soft text-accent font-medium" : "text-ink-2 hover:bg-surface-2"}`}>{l}</button>))}
        </div>
      </Linha>
      <Linha rotulo="Projeto ao abrir">
        <select className="input max-w-sm" value={projectId ?? ""} onChange={(e) => setProject(e.target.value || null)}>
          <option value="">Todos os projetos</option>
          {projects.data?.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
        </select>
      </Linha>
    </Secao>
  );
}

// ---------------------------------------------------------------------------- assistente IA
function AbaIA() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["config-ia"], queryFn: () => api.get<IAConfig>("/config/ia") });
  const [chave, setChave] = useState("");
  const [modelo, setModelo] = useState("");
  const [ativo, setAtivo] = useState(true);
  const [teste, setTeste] = useState<{ ok: boolean; texto: string } | null>(null);
  const [extras, setExtras] = useState<string[]>([]);
  useEffect(() => { if (q.data) { setModelo(q.data.modelo); setAtivo(q.data.ativo); } }, [q.data]);
  const salvar = useMutation({ mutationFn: () => api.put<IAConfig>("/config/ia", { chave: chave.trim() || null, modelo, ativo }),
    onSuccess: (c) => { qc.setQueryData(["config-ia"], c); setChave(""); toast.ok(c.pronta ? "Assistente IA ligado" : "Configuração salva — assistente desligado"); }, onError: toast.err });
  const remover = useMutation({ mutationFn: () => api.del<IAConfig>("/config/ia/chave"),
    onSuccess: (c) => { qc.setQueryData(["config-ia"], c); toast.ok("Chave removida do painel"); }, onError: toast.err });
  const testar = useMutation({
    mutationFn: () => api.post<{ ok: boolean; erro?: string; modelo?: string; resposta?: string; ms?: number; modelos: string[] }>("/config/ia/testar", { chave: chave.trim() || null, modelo }),
    onMutate: () => setTeste({ ok: true, texto: "Testando…" }),
    onSuccess: (r) => {
      setExtras(r.modelos ?? []);
      setTeste(r.ok ? { ok: true, texto: `Conexão funcionando: ${r.modelo} respondeu “${r.resposta}” em ${((r.ms ?? 0) / 1000).toFixed(1).replace(".", ",")} s. A chave enxerga ${r.modelos.length} modelo(s).` }
        : { ok: false, texto: r.erro ?? "Falhou" });
    },
    onError: (e) => setTeste({ ok: false, texto: e instanceof Error ? e.message : String(e) }),
  });
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Skeleton className="h-64 max-w-3xl" />;
  const c = q.data;
  const opcoes = [...c.modelos, ...extras.filter((m) => !c.modelos.some((x) => x.id === m)).map((m) => ({ id: m, nome: m }))];
  if (!opcoes.some((o) => o.id === c.modelo)) opcoes.push({ id: c.modelo, nome: c.modelo });
  return (
    <>
      <Secao titulo="Assistente IA (Anthropic)" sub="Usado pela verificação automática de comentários atendidos entre revisões. A IA só propõe; aplicar continua sendo decisão humana registrada.">
        <Linha rotulo="Situação">{c.pronta ? <Badge tone="ok">ligado</Badge> : c.configurada ? <Badge>desligado</Badge> : <Badge tone="bad">sem chave</Badge>}
          {c.ilegivel && <span className="text-bad text-[13px] ml-2">a chave guardada não pôde ser decifrada (o segredo do servidor mudou) — cole de novo</span>}</Linha>
        <Linha rotulo="Chave"><span className="code">{c.final ? `sk-ant-…${c.final}` : "—"}</span> <span className="text-[12px] text-muted">{c.origem === "painel" ? "definida neste painel" : c.origem === "env" ? "do arquivo .env do servidor" : ""}</span></Linha>
        <Linha rotulo="Modelo"><span className="code">{c.modelo}</span></Linha>
        {c.atualizado_em && <Linha rotulo="Alterado">{fmtDateTime(c.atualizado_em)}{c.atualizado_por ? ` por ${c.atualizado_por}` : ""}</Linha>}
      </Secao>
      <Secao titulo="Configurar" sub="A chave é cifrada no banco e nunca volta para o navegador — aparecem só os 4 últimos caracteres. Deixe em branco para manter a atual.">
        <form onSubmit={(e) => { e.preventDefault(); salvar.mutate(); }} autoComplete="off">
          <Field label="Chave da API (console.anthropic.com › API Keys)">
            <input className="input code" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-api03-…" value={chave} onChange={(e) => setChave(e.target.value)} />
          </Field>
          <Field label="Modelo" hint="Trocar o modelo muda a qualidade da verificação de comentários — confira alguns resultados depois da troca.">
            <select className="input" value={modelo} onChange={(e) => setModelo(e.target.value)}>{opcoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}</select>
          </Field>
          <label className="flex items-center gap-2 text-sm mb-4"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Assistente ligado</label>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={salvar.isPending}>Salvar</button>
            <button type="button" className="btn" disabled={testar.isPending} onClick={() => testar.mutate()}>Testar conexão</button>
            {c.origem === "painel" && <button type="button" className="btn" onClick={() => remover.mutate()}>Remover chave</button>}
          </div>
          {teste && <p className={`text-sm mt-3 ${teste.ok ? "text-ok" : "text-bad"}`}>{teste.texto}</p>}
          <p className="text-[12px] text-muted mt-3">Cifragem: {c.cifragem}.</p>
        </form>
      </Secao>
      <CotaIA />
    </>
  );
}

interface UsoIA {
  cota_padrao_usd: number; gasto_usd: number; cota_usd: number;
  por_usuario?: { id: string; name: string; ia_cota_usd: number | null; chamadas: number; gasto_usd: number }[];
}

function CotaIA() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["config-ia-uso"], queryFn: () => api.get<UsoIA>("/config/ia/uso") });
  const [padrao, setPadrao] = useState("");
  useEffect(() => { if (q.data) setPadrao(String(q.data.cota_padrao_usd)); }, [q.data]);
  const salvar = useMutation({ mutationFn: () => api.put<{ cota_padrao_usd: number }>("/config/ia/cota", { cota_usd: Number(padrao.replace(",", ".")) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["config-ia-uso"] }); toast.ok("Cota padrão salva"); }, onError: toast.err });
  const individual = useMutation({ mutationFn: (a: { id: string; v: string }) => api.put(`/config/ia/cota/usuarios/${a.id}`, { cota_usd: a.v.trim() === "" ? null : Number(a.v.replace(",", ".")) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["config-ia-uso"] }); toast.ok("Cota da pessoa salva"); }, onError: toast.err });
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return null;
  const usd = (n: number) => `US$ ${Number(n).toFixed(2).replace(".", ",")}`;
  return (
    <Secao titulo="Cota mensal de IA" sub="Gasto real por pessoa (tokens × preço do modelo) no mês corrente. Quem atinge a cota recebe aviso e a verificação passa a usar só a heurística, sem custo.">
      <form className="flex flex-wrap items-end gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); salvar.mutate(); }}>
        <Field label="Cota padrão por pessoa (US$ / mês)"><input className="input max-w-[10rem]" inputMode="decimal" value={padrao} onChange={(e) => setPadrao(e.target.value)} /></Field>
        <button className="btn btn-primary mb-4" disabled={salvar.isPending}>Salvar</button>
      </form>
      {q.data.por_usuario?.filter((u) => u.chamadas > 0 || u.ia_cota_usd !== null).map((u) => (
        <Linha key={u.id} rotulo={u.name}>{usd(u.gasto_usd)} de {usd(u.ia_cota_usd ?? q.data.cota_padrao_usd)} · {u.chamadas} chamada(s)
          <input className="input max-w-[7rem] ml-2" inputMode="decimal" placeholder="padrão" defaultValue={u.ia_cota_usd ?? ""} title="Cota própria (vazio = padrão)"
            onBlur={(e) => { if (e.target.value !== String(u.ia_cota_usd ?? "")) individual.mutate({ id: u.id, v: e.target.value }); }} />
        </Linha>))}
    </Secao>
  );
}

// ---------------------------------------------------------------------------- integração e sistema
function useSistema() { return useQuery({ queryKey: ["config-sistema"], queryFn: () => api.get<Sistema>("/config/sistema"), refetchInterval: 30_000 }); }

function AbaIntegracao() {
  const q = useSistema();
  const qc = useQueryClient();
  const ev = useQuery({ queryKey: ["config-eventos"], queryFn: () => api.get<{ id: number; sistema?: string; tipo: string; code: string; criado_em: string; entregue_em: string | null; tentativas: number; ultimo_erro: string | null }[]>("/config/integracao/eventos") });
  const reenviar = useMutation({ mutationFn: () => api.post<{ reprogramados: number }>("/config/integracao/reenviar"),
    onSuccess: (r) => { toast.ok(`${r.reprogramados} evento(s) reprogramado(s)`); qc.invalidateQueries({ queryKey: ["config-sistema"] }); qc.invalidateQueries({ queryKey: ["config-eventos"] }); }, onError: toast.err });
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Skeleton className="h-64 max-w-3xl" />;
  const i = q.data.integracao;
  const svc = q.data.servicos.find((s) => s.nome.includes("Drawings"));
  const w = q.data.integracao_writer;
  const svcW = q.data.servicos.find((s) => s.nome.includes("Writer"));
  const sh = q.data.integracao_sheets;
  const svcS = q.data.servicos.find((s) => s.nome.includes("Sheets"));
  return (
    <>
      <Secao titulo="GPlanSiS|Drawings" sub="Folhas enviadas pelo Drawings, entrada única entre os sistemas e eventos de revisão/comentário que voltam para lá.">
        <Linha rotulo="Situação">{i.ativa ? <Badge tone="ok">ligada</Badge> : <Badge tone="bad">sem segredo compartilhado no servidor</Badge>}</Linha>
        <Linha rotulo="Endereço"><a className="code hover:underline" href={i.drawings_url} target="_blank" rel="noreferrer">{i.drawings_url}</a></Linha>
        {svc && <Linha rotulo="Alcance a partir do servidor">{svc.ok ? <Badge tone="ok">responde · {svc.ms} ms</Badge> : <Badge tone="bad">{svc.detalhe}</Badge>}</Linha>}
        <Linha rotulo="Documentos do Drawings"><Link to="/drawings" className="hover:underline">{i.documentos_drawings} na área Drawings</Link></Linha>
        <Linha rotulo="Eventos">{i.entregues} entregue(s) · {i.pendentes} pendente(s){i.desistidos ? ` · ${i.desistidos} com falha definitiva` : ""}
          {i.ultimo_entregue && <span className="text-muted"> · último {relTime(i.ultimo_entregue)}</span>}</Linha>
        {i.ultimo_erro && <Linha rotulo="Último erro"><span className="text-bad text-[13px] code break-all">{i.ultimo_erro}</span></Linha>}
        <div className="flex gap-2 mt-3">
          <button className="btn" disabled={reenviar.isPending || !(i.pendentes + i.desistidos)} onClick={() => reenviar.mutate()}><RefreshCw size={15} /> Reenviar pendentes agora</button>
          <a className="btn" href={i.drawings_url} target="_blank" rel="noreferrer"><DraftingCompass size={15} /> Abrir o Drawings <ExternalLink size={13} /></a>
        </div>
      </Secao>
      {w && <Secao titulo="GPlanSiS|Writer" sub="Documentos de texto enviados pelo Writer (PDF, Word e nativo), entrada única entre os sistemas e eventos de revisão/comentário que voltam para lá.">
        <Linha rotulo="Situação">{w.ativa ? <Badge tone="ok">ligada</Badge> : <Badge tone="bad">sem segredo compartilhado no servidor</Badge>}</Linha>
        <Linha rotulo="Endereço"><a className="code hover:underline" href={w.url} target="_blank" rel="noreferrer">{w.url}</a></Linha>
        {svcW && <Linha rotulo="Alcance a partir do servidor">{svcW.ok ? <Badge tone="ok">responde · {svcW.ms} ms</Badge> : <Badge tone="bad">{svcW.detalhe}</Badge>}</Linha>}
        <Linha rotulo="Documentos do Writer"><Link to="/writer" className="hover:underline">{w.documentos} na área Writer</Link></Linha>
        <Linha rotulo="Eventos">{w.entregues} entregue(s) · {w.pendentes} pendente(s){w.desistidos ? ` · ${w.desistidos} com falha definitiva` : ""}
          {w.ultimo_entregue && <span className="text-muted"> · último {relTime(w.ultimo_entregue)}</span>}</Linha>
        {w.ultimo_erro && <Linha rotulo="Último erro"><span className="text-bad text-[13px] code break-all">{w.ultimo_erro}</span></Linha>}
        <div className="flex gap-2 mt-3">
          <a className="btn" href={w.url} target="_blank" rel="noreferrer"><PenLine size={15} /> Abrir o Writer <ExternalLink size={13} /></a>
        </div>
      </Secao>}
      {sh && <Secao titulo="GPlanSiS|Sheets" sub="Pastas de planilhas e BI enviadas pelo Sheets (PDF, Excel e nativo), entrada única entre os sistemas e eventos de revisão/comentário que voltam para lá.">
        <Linha rotulo="Situação">{sh.ativa ? <Badge tone="ok">ligada</Badge> : <Badge tone="bad">sem segredo compartilhado no servidor</Badge>}</Linha>
        <Linha rotulo="Endereço"><a className="code hover:underline" href={sh.url} target="_blank" rel="noreferrer">{sh.url}</a></Linha>
        {svcS && <Linha rotulo="Alcance a partir do servidor">{svcS.ok ? <Badge tone="ok">responde · {svcS.ms} ms</Badge> : <Badge tone="bad">{svcS.detalhe}</Badge>}</Linha>}
        <Linha rotulo="Documentos do Sheets"><Link to="/sheets" className="hover:underline">{sh.documentos} na área Sheets</Link></Linha>
        <Linha rotulo="Eventos">{sh.entregues} entregue(s) · {sh.pendentes} pendente(s){sh.desistidos ? ` · ${sh.desistidos} com falha definitiva` : ""}
          {sh.ultimo_entregue && <span className="text-muted"> · último {relTime(sh.ultimo_entregue)}</span>}</Linha>
        {sh.ultimo_erro && <Linha rotulo="Último erro"><span className="text-bad text-[13px] code break-all">{sh.ultimo_erro}</span></Linha>}
        <div className="flex gap-2 mt-3">
          <a className="btn" href={sh.url} target="_blank" rel="noreferrer"><FileSpreadsheet size={15} /> Abrir o Sheets <ExternalLink size={13} /></a>
        </div>
      </Secao>}
      <Secao titulo="Últimos eventos">
        {ev.data?.length ? (
          <div className="overflow-x-auto -mx-1"><table className="w-full min-w-[560px] text-sm">
            <thead><tr><th className="th">#</th><th className="th">Sistema</th><th className="th">Evento</th><th className="th">Documento</th><th className="th">Criado</th><th className="th">Situação</th></tr></thead>
            <tbody className="divide-y divide-line">{ev.data.map((e) => (
              <tr key={e.id}><td className="td tnum">{e.id}</td><td className="td text-[12px]">{e.sistema === "writer" ? "Writer" : e.sistema === "sheets" ? "Sheets" : "Drawings"}</td><td className="td code text-[12px]">{e.tipo}</td><td className="td code text-[12px]">{e.code}</td>
                <td className="td">{relTime(e.criado_em)}</td>
                <td className="td">{e.entregue_em ? <Badge tone="ok">entregue</Badge> : <Badge tone={e.tentativas >= 30 ? "bad" : "warn"} title={e.ultimo_erro ?? ""}>{e.tentativas >= 30 ? "falhou" : `pendente · ${e.tentativas} tentativa(s)`}</Badge>}</td></tr>))}</tbody>
          </table></div>) : <p className="text-sm text-muted">Nenhum evento ainda.</p>}
      </Secao>
    </>
  );
}

function AbaSistema() {
  const q = useSistema();
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Skeleton className="h-64 max-w-3xl" />;
  const s = q.data, c = s.contagens;
  return (
    <>
      <Secao titulo="Serviços" sub={`Verificado ${relTime(s.gerado_em)} · atualiza a cada 30 s.`}>
        {s.servicos.map((x) => (
          <Linha key={x.nome} rotulo={x.nome}><span className="flex flex-wrap items-center gap-2">{x.ok ? <Badge tone="ok">em operação</Badge> : <Badge tone="bad">falha</Badge>}
            <span className="text-[13px] text-muted break-all">{x.detalhe} · {x.ms} ms</span></span></Linha>))}
      </Secao>
      <Secao titulo="Conteúdo">
        <Linha rotulo="Usuários">{c.usuarios_ativos} ativo(s){c.usuarios_inativos ? ` · ${c.usuarios_inativos} inativo(s)` : ""} · <Link className="hover:underline" to="/usuarios">gerenciar</Link></Linha>
        <Linha rotulo="Projetos ativos">{c.projetos} · <Link className="hover:underline" to="/projetos">abrir</Link></Linha>
        <Linha rotulo="Documentos">{c.documentos} documento(s) · {c.revisoes} revisão(ões) · {c.arquivos} arquivo(s)</Linha>
        <Linha rotulo="Armazenamento">{fmtBytes(Number(c.bytes))} em {c.blobs} arquivo(s) únicos (deduplicados por SHA-256)</Linha>
        <Linha rotulo="OCR">{s.ocr.length ? s.ocr.map((o) => `${o.status.toLowerCase()} ${o.n}`).join(" · ") : "—"}</Linha>
        <Linha rotulo="Auditoria">{c.eventos_auditoria} registro(s) encadeados · <Link className="hover:underline" to="/auditoria">verificar integridade</Link></Linha>
      </Secao>
      <Secao titulo="Parâmetros do servidor" sub="Definidos no .env do servidor; mudam com nova publicação.">
        {s.parametros.map(([k, v]) => <Linha key={k} rotulo={k}>{v}</Linha>)}
      </Secao>
    </>
  );
}

// ---------------------------------------------------------------------------- página
export default function Settings() {
  const perfil = usePerfil();
  const [sp, setSp] = useSearchParams();
  const admin = !!perfil.data?.is_admin;
  const abas: { k: Aba; l: string; icon: ReactNode; admin?: boolean }[] = [
    { k: "perfil", l: "Perfil e foto", icon: <UserIcon size={17} /> },
    { k: "seguranca", l: "Senha e sessões", icon: <KeyRound size={17} /> },
    { k: "preferencias", l: "Preferências", icon: <Palette size={17} /> },
    { k: "ia", l: "Assistente IA", icon: <Bot size={17} />, admin: true },
    { k: "integracao", l: "Integrações", icon: <DraftingCompass size={17} />, admin: true },
    { k: "sistema", l: "Sistema", icon: <Server size={17} />, admin: true },
  ];
  const visiveis = abas.filter((a) => !a.admin || admin);
  const aba = (visiveis.find((a) => a.k === sp.get("aba"))?.k ?? "perfil") as Aba;
  if (perfil.error) return <ErrorBox error={perfil.error} />;
  if (!perfil.data) return <Skeleton className="h-96" />;
  return (
    <>
      <PageHeader title="Configurações" sub={`${perfil.data.name} · ${perfil.data.email}`} />
      <div className="grid lg:grid-cols-[220px_1fr] gap-5 items-start">
        <nav className="panel p-1.5 flex lg:flex-col gap-0.5 overflow-x-auto" aria-label="Seções das configurações">
          {visiveis.map((a) => (
            <button key={a.k} onClick={() => setSp({ aba: a.k })} aria-current={aba === a.k ? "page" : undefined}
              className={`flex items-center gap-2.5 h-9 px-3 rounded-md text-[14px] whitespace-nowrap ${aba === a.k ? "bg-accent-soft text-accent font-medium" : "text-ink-2 hover:bg-surface-2"}`}>
              {a.icon}{a.l}</button>))}
          {admin && <>
            <div className="hidden lg:block border-t border-line my-1" />
            <Link to="/usuarios" className="flex items-center gap-2.5 h-9 px-3 rounded-md text-[14px] text-ink-2 hover:bg-surface-2 whitespace-nowrap"><UsersIcon size={17} />Usuários e acessos</Link>
            <Link to="/auditoria" className="flex items-center gap-2.5 h-9 px-3 rounded-md text-[14px] text-ink-2 hover:bg-surface-2 whitespace-nowrap"><ShieldCheck size={17} />Auditoria</Link>
          </>}
        </nav>
        <div className="min-w-0">
          {aba === "perfil" && <AbaPerfil key={perfil.data.id + perfil.data.avatar_ver} p={perfil.data} />}
          {aba === "seguranca" && <AbaSeguranca p={perfil.data} />}
          {aba === "preferencias" && <AbaPreferencias />}
          {aba === "ia" && <AbaIA />}
          {aba === "integracao" && <AbaIntegracao />}
          {aba === "sistema" && <AbaSistema />}
        </div>
      </div>
    </>
  );
}
