import { api } from "@/lib/api";
import { toast } from "@/components/ui";

type Sistema = "drawings" | "writer" | "sheets";

/** Abre um sistema integrado já autenticado (entrada única). `para` = âncora do item de origem, ex.: "#d37". */
async function abrirNo(sistema: Sistema, para = "", novaAba = false) {
  const aba = novaAba ? window.open("about:blank", "_blank") : null;
  try {
    const r = await api.post<{ url: string }>("/integracao/sso/emitir", { para, sistema });
    if (aba) aba.location.href = r.url; else window.location.href = r.url;
  } catch (e) {
    aba?.close();
    toast.err(e);
  }
}

/** Abre o GPlanSiS|Drawings já autenticado. `para` = âncora do desenho, ex.: "#d37". */
export const abrirNoDrawings = (para = "", novaAba = false) => abrirNo("drawings", para, novaAba);

/** Abre o GPlanSiS|Writer já autenticado. `para` = âncora do documento, ex.: "#wabc123". */
export const abrirNoWriter = (para = "", novaAba = false) => abrirNo("writer", para, novaAba);

/** Abre o GPlanSiS|Sheets já autenticado. `para` = âncora da pasta, ex.: "#swb1a2b3c". */
export const abrirNoSheets = (para = "", novaAba = false) => abrirNo("sheets", para, novaAba);
