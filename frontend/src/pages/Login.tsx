import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { useSession } from "@/store/session";
import { ErrorBox } from "@/components/ui";

export function Login() {
  const login = useSession((s) => s.login);
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ token: string; user: User }>("/auth/login", { email, password });
      login(r.token, r.user);
      nav("/", { replace: true });
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-full grid lg:grid-cols-[1fr_minmax(420px,520px)]">
      {/* painel de identidade: prancha técnica com carimbo */}
      <div className="hidden lg:flex relative overflow-hidden bg-[#14202B] text-[#E2E8ED] p-12 flex-col justify-between">
        <svg className="absolute inset-0 w-full h-full opacity-[0.08]" aria-hidden>
          <defs><pattern id="g" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#fff" strokeWidth=".6" /></pattern></defs>
          <rect width="100%" height="100%" fill="url(#g)" />
        </svg>
        <Link to="/" className="relative flex items-center gap-3 w-fit">
          <img src="/logo.svg" alt="" className="w-11 h-11" />
          <span className="text-xl font-semibold tracking-tight">GPlanSiS<span className="opacity-50">|</span>DOCS</span>
        </Link>
        <div className="relative max-w-xl">
          <p className="text-[34px] leading-[1.15] font-semibold tracking-tight">Cada revisão rastreada, do rascunho à emissão para construção.</p>
          <p className="mt-4 text-[#9FB3C2] max-w-md">Lista mestra, workflow de verificação, GRD numerada e OCR que lê até o carimbo da prancha.</p>
        </div>
        <div className="relative border border-[#37475A] grid grid-cols-[1fr_auto_auto] text-[12px] max-w-lg">
          <div className="px-3 py-2 border-r border-[#37475A]"><div className="text-[#8593A0]">Título</div>Controle de documentos de engenharia</div>
          <div className="px-3 py-2 border-r border-[#37475A]"><div className="text-[#8593A0]">Folha</div><span className="code">1/1</span></div>
          <div className="px-3 py-2 flex items-center gap-2"><div className="text-[#8593A0]">Rev.</div>
            <svg width="26" height="23" viewBox="0 0 24 21"><path d="M12 1.5 22.5 19.5h-21z" fill="none" stroke="#F0654F" strokeWidth="1.8" /><text x="12" y="17" textAnchor="middle" fontSize="8" fill="#E2E8ED" fontFamily="IBM Plex Mono">0</text></svg>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <Link to="/" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink mb-8"><ArrowLeft size={14} /> Voltar ao início</Link>
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <img src="/logo.svg" alt="" className="w-10 h-10" />
            <span className="text-lg font-semibold">GPlanSiS<span className="text-muted">|</span>DOCS</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
          <p className="text-sm text-muted mb-6">Use a conta criada pelo administrador do projeto.</p>
          <label className="label" htmlFor="email">E-mail</label>
          <input id="email" className="input mb-3" type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
          <label className="label" htmlFor="pw">Senha</label>
          <input id="pw" className="input mb-4" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          {err !== null && <div className="mb-3"><ErrorBox error={err} /></div>}
          <button className="btn btn-primary w-full h-10" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
          <p className="text-[13px] text-muted mt-6">Ainda não tem conta? <Link to="/#acesso" className="text-accent font-medium hover:underline">Solicite acesso</Link> — o administrador aprova e você recebe uma senha temporária.</p>
          <p className="text-[12px] text-muted mt-3">Esqueceu a senha? Peça ao administrador para redefini-la.</p>
        </form>
      </div>
    </div>
  );
}
