import { useEffect, useState } from "react";
import { avatarUrl } from "@/lib/perfil";

const iniciais = (n: string) => n.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";

/** Foto do usuário, ou as iniciais quando não há foto. */
export function Avatar({ id, name, ver, has, size = 32 }: { id?: string; name: string; ver?: number; has?: boolean; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    if (id && has) avatarUrl(id, ver ?? 0).then((u) => vivo && setSrc(u)).catch(() => vivo && setSrc(null));
    else setSrc(null);
    return () => { vivo = false; };
  }, [id, has, ver]);
  return (
    <span className="rounded-full bg-surface-2 border border-line inline-flex items-center justify-center font-semibold overflow-hidden shrink-0 text-ink-2"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden>
      {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : iniciais(name)}
    </span>
  );
}
