import { useSession } from "@/store/session";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  const token = useSession.getState().token;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api${path}`, {
    method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (res.status === 401 && token && path !== "/auth/change-password") useSession.getState().logout();
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail)) msg = j.detail.map((d: { msg?: string }) => d.msg).join("; ");
    } catch { /* corpo não-JSON */ }
    if (res.status === 403 && msg.startsWith("Troque a senha")) useSession.getState().requireChange();
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(p: string) => request<T>("GET", p),
  post: <T>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>("PUT", p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => request<T>("PATCH", p, b ?? {}),
  del: <T>(p: string) => request<T>("DELETE", p),
  upload: <T>(p: string, fd: FormData) => request<T>("POST", p, undefined, fd),
};

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

/** Token curto de escopo "file" para <img>, visualizador e downloads (renova a cada 8 min). */
let fileTok: { v: string; at: number } | null = null;
export async function fileToken(): Promise<string> {
  if (fileTok && Date.now() - fileTok.at < 8 * 60_000) return fileTok.v;
  const r = await api.post<{ token: string }>("/auth/file-token");
  fileTok = { v: r.token, at: Date.now() };
  return r.token;
}
export async function fileUrl(fileId: string, opts: { variant?: "original" | "archive"; download?: boolean; thumb?: boolean } = {}) {
  const t = await fileToken();
  if (opts.thumb) return `/api/files/${fileId}/thumb?token=${t}`;
  return `/api/files/${fileId}/content${qs({ variant: opts.variant, download: opts.download, token: t })}`;
}

/** Baixa uma rota autenticada como arquivo (ex.: CSV da lista mestra). */
export async function download(path: string, fallbackName: string): Promise<void> {
  const token = useSession.getState().token;
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, `Erro ${res.status} ao exportar`);
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
