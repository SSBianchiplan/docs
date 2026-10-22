import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search as SearchIcon } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { SearchHit } from "@/lib/types";
import { useUi } from "@/store/ui";
import { Empty, ErrorBox, PageHeader, RevDelta, Skeleton, StatusBadge } from "@/components/ui";

/** Renderiza o trecho do ts_headline sem innerHTML: só <mark> é interpretado, o resto é texto. */
function Highlight({ html }: { html: string }) {
  const parts = html.split(/(<mark>|<\/mark>)/);
  let on = false;
  return <>{parts.map((p, i) => {
    if (p === "<mark>") { on = true; return null; }
    if (p === "</mark>") { on = false; return null; }
    return on ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>;
  })}</>;
}

const MODES = [
  { v: "auto", l: "Tudo" }, { v: "texto", l: "Conteúdo e código" }, { v: "fonetica", l: "Fonética" }, { v: "semantica", l: "Semântica" },
] as const;
const GROUPS: Record<string, string> = {
  conteudo: "No conteúdo dos arquivos (OCR)", documentos: "Por código e título", fonetica: "Por som parecido", semantica: "Por significado",
};

export default function SearchPage() {
  const projectId = useUi((s) => s.projectId);
  const [sp, setSp] = useSearchParams();
  const [text, setText] = useState(sp.get("q") ?? "");
  const q = sp.get("q") ?? "";
  const mode = sp.get("modo") ?? "auto";
  useEffect(() => {
    const t = setTimeout(() => { const n = new URLSearchParams(sp); if (text.trim().length >= 2) n.set("q", text.trim()); else n.delete("q"); setSp(n, { replace: true }); }, 300);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const res = useQuery({
    queryKey: ["search", q, mode, projectId], enabled: q.length >= 2, placeholderData: keepPreviousData,
    queryFn: () => api.get<{ results: Record<string, SearchHit[]> }>(`/search${qs({ q, mode, project_id: projectId })}`),
  });
  const groups = Object.entries(res.data?.results ?? {}).filter(([, v]) => v.length);

  return (
    <>
      <PageHeader title="Busca" sub="Texto completo do OCR sem acentos, código aproximado, fonética (“aranjo jeral” encontra “arranjo geral”) e semântica" />
      <div className="relative mb-3">
        <SearchIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input autoFocus className="input h-12 pl-10 text-base" value={text} onChange={(e) => setText(e.target.value)}
          placeholder='Ex.: válvula de segurança, P100-MEC, "classe 300" -flange' aria-label="Termo de busca" />
      </div>
      <div className="flex flex-wrap gap-1.5 mb-5" role="radiogroup" aria-label="Modo de busca">
        {MODES.map((m) => (
          <button key={m.v} role="radio" aria-checked={mode === m.v} onClick={() => { const n = new URLSearchParams(sp); n.set("modo", m.v); setSp(n, { replace: true }); }}
            className={`h-8 px-3 rounded-full border text-[13px] ${mode === m.v ? "bg-accent text-accent-ink border-transparent" : "border-line bg-surface hover:bg-surface-2"}`}>{m.l}</button>
        ))}
      </div>
      {q.length < 2 ? <Empty title="Digite ao menos duas letras" icon={<SearchIcon size={26} />}>Aspas buscam a frase exata; sinal de menos exclui um termo.</Empty>
        : res.error ? <ErrorBox error={res.error} />
        : res.isLoading ? <Skeleton className="h-60" />
        : groups.length === 0 ? <Empty title={`Nada encontrado para “${q}”`}>{mode === "semantica" ? "A busca semântica exige EMBEDDINGS_ENABLED no servidor." : "Tente a busca fonética ou menos termos."}</Empty>
        : (
          <div className="space-y-6">
            {groups.map(([k, hits]) => (
              <section key={k}>
                <h2 className="text-[13px] font-semibold text-muted mb-2">{GROUPS[k] ?? k} · {hits.length}</h2>
                <ul className="panel divide-y divide-line">
                  {hits.map((h, i) => (
                    <li key={`${h.document_id}-${h.file_id ?? ""}-${h.page ?? ""}-${i}`}>
                      <Link to={`/documentos/${h.document_id}`} className="block px-4 py-3 hover:bg-surface-2">
                        <div className="flex items-center gap-3">
                          {h.revision_label && <RevDelta label={h.revision_label} size="sm" />}
                          <span className="code text-[13px] text-ink-2">{h.code}</span>
                          <span className="font-medium truncate flex-1">{h.title}</span>
                          {h.status && <StatusBadge status={h.status} />}
                        </div>
                        {h.snippet && <p className="text-[13px] text-ink-2 mt-1.5 line-clamp-2"><Highlight html={h.snippet} /></p>}
                        {(h.filename || h.page) && <p className="text-[11px] text-muted mt-1">{h.filename}{h.page ? ` · folha ${h.page}` : ""}</p>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
    </>
  );
}
