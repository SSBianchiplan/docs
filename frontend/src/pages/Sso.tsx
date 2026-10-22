import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { useSession } from "@/store/session";

/** Entrada vinda do GPlanSiS|Drawings, do GPlanSiS|Writer ou do GPlanSiS|Sheets: troca o código assinado por uma sessão e segue para o destino. */
export default function Sso() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const login = useSession((s) => s.login);
  const [erro, setErro] = useState<string | null>(null);
  const de = (() => { try { return JSON.parse(atob(((sp.get("token") || "").split(".")[0] ?? "").replace(/-/g, "+").replace(/_/g, "/"))).de as string; } catch { return ""; } })();
  const nome = de === "writer" ? "Writer" : de === "sheets" ? "Sheets" : "Drawings";
  useEffect(() => {
    const token = sp.get("token");
    if (!token) { setErro("Link de entrada incompleto."); return; }
    api.post<{ token: string; user: User; para: string; de?: string }>("/integracao/sso/trocar", { token })
      .then((r) => { login(r.token, r.user); nav(r.para && r.para.startsWith("/") ? r.para : r.de === "writer" ? "/writer" : r.de === "sheets" ? "/sheets" : "/drawings", { replace: true }); })
      .catch((e: Error) => setErro(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="panel p-6 max-w-md w-full text-center space-y-3">
        {erro ? <>
          <h1 className="text-lg font-semibold">Não foi possível entrar pelo {nome}</h1>
          <p className="text-ink-2 text-sm">{erro}</p>
          <a className="btn btn-primary" href="/entrar">Entrar com e-mail e senha</a>
        </> : <p className="text-ink-2">Entrando com a sua conta do GPlanSiS|{nome}…</p>}
      </div>
    </div>
  );
}
