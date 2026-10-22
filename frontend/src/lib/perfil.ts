import { useQuery } from "@tanstack/react-query";
import { api, fileToken } from "@/lib/api";

export interface Perfil {
  id: string; email: string; name: string; company: string | null; is_admin: boolean; is_external: boolean;
  created_at: string; last_login_at: string | null; password_changed_at: string | null;
  avatar_ver: number; has_avatar: boolean; prefs: Record<string, unknown>;
  projects: { code: string; name: string; role: string }[];
}

export const usePerfil = () => useQuery({ queryKey: ["perfil"], queryFn: () => api.get<Perfil>("/config/perfil"), staleTime: 60_000 });

/** URL da foto (precisa de token curto de arquivo, como as miniaturas). */
export async function avatarUrl(userId: string, ver: number): Promise<string> {
  const t = await fileToken();
  return `/api/config/avatar/${userId}?v=${ver}&token=${t}`;
}
