import { useState } from "react";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { useSession } from "@/store/session";
import { ErrorBox, toast } from "@/components/ui";

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Pelo menos 10 caracteres";
  if (pw.length < 16 && !(/[a-zA-Z]/.test(pw) && /\d/.test(pw))) return "Use letras e números (ou uma frase com 16+ caracteres)";
  return null;
}

function strength(pw: string): number {
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) s++;
  return s;
}

/** Formulário de troca de senha — obrigatório no primeiro acesso ou após redefinição pelo administrador. */
export function ChangePasswordForm({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const login = useSession((s) => s.login);
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const problem = pw ? passwordProblem(pw) : null;
  const mismatch = pw2 && pw !== pw2;
  const st = strength(pw);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ token: string; user: User }>("/auth/change-password", { current_password: cur, new_password: pw });
      login(r.token, r.user);
      toast.ok("Senha alterada. As outras sessões foram encerradas.");
      onDone?.();
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="w-full">
      <label className="label" htmlFor="cur">{forced ? "Senha temporária" : "Senha atual"}</label>
      <input id="cur" className="input mb-3" type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} />
      <label className="label" htmlFor="npw">Nova senha</label>
      <input id="npw" className="input" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} aria-describedby="pwhint" />
      <div className="flex gap-1 mt-2" aria-hidden>
        {[0, 1, 2, 3].map((i) => <span key={i} className={`h-1 flex-1 rounded-full ${i < st ? (st >= 3 ? "bg-ok" : st === 2 ? "bg-warn" : "bg-bad") : "bg-surface-2"}`} />)}
      </div>
      <p id="pwhint" className={`text-[12px] mt-1 mb-3 ${problem ? "text-bad" : "text-muted"}`}>{problem ?? "10+ caracteres com letras e números. Frases longas são ótimas."}</p>
      <label className="label" htmlFor="npw2">Repita a nova senha</label>
      <input id="npw2" className="input mb-1" type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} />
      <p className="text-[12px] text-bad mb-3 min-h-4">{mismatch ? "As senhas não conferem" : ""}</p>
      {err !== null && <div className="mb-3"><ErrorBox error={err} /></div>}
      <button className="btn btn-primary w-full h-10" disabled={busy || !cur || !!problem || !pw || pw !== pw2}>
        {busy ? "Salvando…" : forced ? "Definir senha e entrar" : "Alterar senha"}
      </button>
    </form>
  );
}

export function ForcedPasswordChange() {
  const { user, logout } = useSession();
  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-8">
          <img src="/logo.svg" alt="" className="w-10 h-10" />
          <span className="text-lg font-semibold">GPlanSiS<span className="text-muted">|</span>DOCS</span>
        </div>
        <div className="w-11 h-11 rounded-full bg-accent-soft text-accent flex items-center justify-center mb-3"><KeyRound size={20} /></div>
        <h1 className="text-2xl font-semibold tracking-tight">Defina sua senha</h1>
        <p className="text-sm text-muted mb-6">Olá, {user?.name.split(" ")[0]}. Sua conta usa uma senha temporária — troque-a para continuar.</p>
        <ChangePasswordForm forced />
        <button className="btn btn-ghost w-full mt-2" onClick={logout}>Sair</button>
      </div>
    </div>
  );
}
