import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  Bot, ClipboardCheck, DraftingCompass, FileStack, FolderKanban, KeyRound, LayoutDashboard, LogOut, Menu, Monitor, Moon, Search, Send, Settings, ShieldCheck, Sun,
  Users as UsersIcon, WifiOff, PenLine, FileSpreadsheet,
} from "lucide-react";
import { ChangePasswordForm } from "@/pages/ChangePassword";
import { api } from "@/lib/api";
import { useProjects } from "@/lib/hooks";
import { abrirNoDrawings, abrirNoSheets, abrirNoWriter } from "@/lib/integracao";
import { usePerfil } from "@/lib/perfil";
import { Avatar } from "./Avatar";
import type { AccessRequest, Dashboard } from "@/lib/types";
import { useSession } from "@/store/session";
import { type Theme, useUi } from "@/store/ui";
import { Drawer, Toasts } from "./ui";

interface NavItem { to: string; label: string; icon: ReactNode; badge?: number; admin?: boolean; mobile?: boolean }

function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    window.addEventListener("online", a); window.addEventListener("offline", b);
    return () => { window.removeEventListener("online", a); window.removeEventListener("offline", b); };
  }, []);
  return on;
}

function ThemeSwitch() {
  const { theme, setTheme } = useUi();
  const opts: { v: Theme; icon: ReactNode; label: string }[] = [
    { v: "light", icon: <Sun size={15} />, label: "Tema claro" },
    { v: "system", icon: <Monitor size={15} />, label: "Tema do sistema" },
    { v: "dark", icon: <Moon size={15} />, label: "Tema escuro" },
  ];
  return (
    <div role="radiogroup" aria-label="Tema" className="inline-flex rounded-md border border-line p-0.5 bg-surface">
      {opts.map((o) => (
        <button key={o.v} role="radio" aria-checked={theme === o.v} title={o.label} aria-label={o.label}
          onClick={() => setTheme(o.v)}
          className={`h-7 w-8 inline-flex items-center justify-center rounded ${theme === o.v ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}>
          {o.icon}
        </button>
      ))}
    </div>
  );
}

export function Layout() {
  const perfil = usePerfil();
  const { user, logout } = useSession();
  const { projectId, setProject } = useUi();
  const projects = useProjects();
  const online = useOnline();
  const nav = useNavigate();
  const dash = useQuery({ queryKey: ["dashboard", projectId], queryFn: () => api.get<Dashboard>(`/dashboard${projectId ? `?project_id=${projectId}` : ""}`), refetchInterval: 60_000 });
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const requests = useQuery({ queryKey: ["access-requests"], enabled: !!user?.is_admin, refetchInterval: 120_000,
    queryFn: () => api.get<AccessRequest[]>("/access-requests") });
  const [pwOpen, setPwOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();

  // atalho: "/" ou Ctrl+K abre a busca
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName);
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) { e.preventDefault(); nav("/busca"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav]);

  const c = dash.data?.counters;
  const items: NavItem[] = [
    { to: "/", label: "Painel", icon: <LayoutDashboard size={18} />, mobile: true },
    { to: "/documentos", label: "Lista mestra", icon: <FileStack size={18} />, mobile: true },
    { to: "/drawings", label: "Drawings", icon: <DraftingCompass size={18} />, mobile: true },
    { to: "/writer", label: "Writer", icon: <PenLine size={18} /> },
    { to: "/sheets", label: "Sheets", icon: <FileSpreadsheet size={18} /> },
    { to: "/pendencias", label: "Pendências", icon: <ClipboardCheck size={18} />, badge: c?.my_tasks, mobile: true },
    { to: "/grd", label: "GRD", icon: <Send size={18} />, badge: c?.grds_awaiting_receipt },
    { to: "/busca", label: "Busca", icon: <Search size={18} />, mobile: true },
    { to: "/ia", label: "Sugestões da IA", icon: <Bot size={18} />, badge: c?.ai_pending },
    { to: "/projetos", label: "Projetos", icon: <FolderKanban size={18} /> },
    { to: "/usuarios", label: "Usuários e acessos", icon: <UsersIcon size={18} />, badge: requests.data?.length, admin: true },
    { to: "/auditoria", label: "Auditoria", icon: <ShieldCheck size={18} />, admin: true },
    { to: "/configuracoes", label: "Configurações", icon: <Settings size={18} /> },
  ];
  const visible = items.filter((i) => !i.admin || user?.is_admin);
  const more = visible.filter((i) => !i.mobile);

  return (
    <div className="h-full flex">
      <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-line bg-surface">
        <div className="h-14 flex items-center gap-2.5 px-4 border-b border-line">
          <img src="/logo.svg" alt="" className="w-8 h-8" />
          <div className="leading-tight">
            <div className="font-semibold tracking-tight">GPlanSiS<span className="text-muted">|</span>DOCS</div>
            <div className="text-[11px] text-muted">Documentos técnicos</div>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto" aria-label="Principal">
          {visible.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === "/"}
              className={({ isActive }) => `flex items-center gap-3 h-9 px-3 rounded-md text-[14px] ${isActive ? "bg-accent-soft text-accent font-medium" : "text-ink-2 hover:bg-surface-2"}`}>
              {i.icon}<span className="flex-1">{i.label}</span>
              {!!i.badge && <span className="tnum text-[11px] font-semibold min-w-5 h-5 px-1.5 rounded-full bg-delta text-white inline-flex items-center justify-center">{i.badge}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-line space-y-3">
          <ThemeSwitch />
          <div className="flex items-center gap-2">
            <NavLink to="/configuracoes" title="Configurações — perfil, foto, senha e sistema"
              className="min-w-0 flex-1 flex items-center gap-2 rounded-md -m-1 p-1 hover:bg-surface-2">
              <Avatar id={perfil.data?.id ?? user?.id} name={user?.name ?? "?"} ver={perfil.data?.avatar_ver} has={perfil.data?.has_avatar} size={32} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-sm font-medium truncate">{user?.name}</div>
                <div className="text-[11px] text-muted truncate">{user?.email}</div>
              </div>
            </NavLink>
            <button className="btn btn-ghost btn-sm" onClick={() => setPwOpen(true)} title="Trocar senha" aria-label="Trocar senha"><KeyRound size={16} /></button>
            <button className="btn btn-ghost btn-sm" onClick={logout} title="Sair" aria-label="Sair"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 shrink-0 border-b border-line bg-surface flex items-center gap-3 px-4">
          <img src="/logo.svg" alt="" className="w-7 h-7 lg:hidden" />
          <label className="sr-only" htmlFor="proj">Projeto</label>
          <select id="proj" className="input max-w-72 h-8" value={projectId ?? ""} onChange={(e) => setProject(e.target.value || null)}>
            <option value="">Todos os projetos</option>
            {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select>
          <button onClick={() => nav("/busca")} className="hidden md:flex items-center gap-2 h-8 px-3 rounded-md border border-line text-sm text-muted hover:border-line-strong flex-1 max-w-md">
            <Search size={15} /> Buscar por código, título ou conteúdo <kbd className="ml-auto code text-[11px] border border-line rounded px-1">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn btn-sm" onClick={() => abrirNoDrawings("")} title="Abrir o GPlanSiS|Drawings já conectado com a sua conta">
              <DraftingCompass size={15} /><span className="hidden sm:inline">Drawings</span>
            </button>
            <button className="btn btn-sm" onClick={() => abrirNoWriter("")} title="Abrir o GPlanSiS|Writer já conectado com a sua conta">
              <PenLine size={15} /><span className="hidden sm:inline">Writer</span>
            </button>
            <button className="btn btn-sm" onClick={() => abrirNoSheets("")} title="Abrir o GPlanSiS|Sheets já conectado com a sua conta">
              <FileSpreadsheet size={15} /><span className="hidden sm:inline">Sheets</span>
            </button>
            {!online && <span className="inline-flex items-center gap-1 text-[12px] text-warn"><WifiOff size={14} /> Offline — exibindo cache</span>}
          </div>
        </header>
        {needRefresh && (
          <div className="bg-info-soft text-info text-sm px-4 py-2 flex items-center gap-3">
            Nova versão disponível.
            <button className="btn btn-sm" onClick={() => updateServiceWorker(true)}>Atualizar agora</button>
          </div>
        )}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1500px] mx-auto p-4 sm:p-6 pb-24 lg:pb-8"><Outlet /></div>
        </main>
      </div>

      <nav aria-label="Navegação móvel" className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-line grid grid-cols-6 pb-safe">
        {visible.filter((i) => i.mobile).map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === "/"}
            className={({ isActive }) => `relative flex flex-col items-center justify-center h-14 text-[11px] gap-0.5 ${isActive ? "text-accent" : "text-muted"}`}>
            {i.icon}{i.label}
            {!!i.badge && <span className="absolute top-1.5 right-[28%] w-2 h-2 rounded-full bg-delta" />}
          </NavLink>
        ))}
        <button onClick={() => setMoreOpen(true)} aria-label="Mais opções"
          className={`relative flex flex-col items-center justify-center h-14 text-[11px] gap-0.5 ${more.some((i) => location.pathname.startsWith(i.to)) ? "text-accent" : "text-muted"}`}>
          <Menu size={18} />Mais
          {more.some((i) => i.badge) && <span className="absolute top-1.5 right-[28%] w-2 h-2 rounded-full bg-delta" />}
        </button>
      </nav>
      <Drawer open={moreOpen} onClose={() => setMoreOpen(false)} title="Menu">
        <NavLink to="/configuracoes" onClick={() => setMoreOpen(false)} className="flex items-center gap-3 mb-4 rounded-md p-1 -m-1 hover:bg-surface-2">
          <Avatar id={perfil.data?.id ?? user?.id} name={user?.name ?? "?"} ver={perfil.data?.avatar_ver} has={perfil.data?.has_avatar} size={40} />
          <div className="min-w-0"><div className="font-medium truncate">{user?.name}</div><div className="text-[12px] text-muted truncate">{user?.email} · Configurações</div></div>
        </NavLink>
        <nav className="space-y-1 mb-4" aria-label="Mais opções">
          {more.map((i) => (
            <NavLink key={i.to} to={i.to} onClick={() => setMoreOpen(false)}
              className={({ isActive }) => `flex items-center gap-3 h-11 px-3 rounded-md ${isActive ? "bg-accent-soft text-accent font-medium" : "text-ink-2 hover:bg-surface-2"}`}>
              {i.icon}<span className="flex-1">{i.label}</span>
              {!!i.badge && <span className="tnum text-[11px] font-semibold min-w-5 h-5 px-1.5 rounded-full bg-delta text-white inline-flex items-center justify-center">{i.badge}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line pt-4 space-y-3">
          <div className="flex items-center justify-between"><span className="text-sm text-ink-2">Tema</span><ThemeSwitch /></div>
          <button className="btn w-full" onClick={() => { setMoreOpen(false); setPwOpen(true); }}><KeyRound size={16} /> Trocar senha</button>
          <button className="btn w-full" onClick={logout}><LogOut size={16} /> Sair</button>
        </div>
      </Drawer>
      <Drawer open={pwOpen} onClose={() => setPwOpen(false)} title="Trocar senha">
        <p className="text-sm text-muted mb-4">Ao trocar, as sessões abertas em outros aparelhos são encerradas.</p>
        <ChangePasswordForm onDone={() => setPwOpen(false)} />
      </Drawer>
      <Toasts />
    </div>
  );
}
