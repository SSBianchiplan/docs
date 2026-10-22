"""Busca unificada: texto completo (OCR) · código/título aproximado · fonética · semântica (opcional)."""
from typing import Any, Literal

from fastapi import APIRouter, Query

from app.api.deps import Conn
from app.core.config import get_settings
from app.core.db import fetch_all
from app.core.security import CurrentUser

router = APIRouter(tags=["busca"])

_ACL = """(:adm OR EXISTS (SELECT 1 FROM project_member m WHERE m.project_id = d.project_id AND m.user_id = :u))"""


@router.get("/search")
async def search(
    conn: Conn, user: CurrentUser, q: str = Query(min_length=2),
    mode: Literal["auto", "texto", "fonetica", "semantica"] = "auto",
    project_id: str | None = None, limit: int = Query(30, le=100),
) -> dict[str, Any]:
    p = {"q": q, "u": user.id, "adm": user.is_admin, "p": project_id, "lim": limit}
    proj = "AND (CAST(:p AS uuid) IS NULL OR d.project_id = CAST(:p AS uuid))"
    results: dict[str, list[dict[str, Any]]] = {}

    if mode in ("auto", "texto"):
        results["conteudo"] = await fetch_all(conn, f"""
            WITH query AS (SELECT websearch_to_tsquery('pt_unaccent', :q) AS tq)
            SELECT d.id::text AS document_id, d.code, d.title, r.label AS revision_label, r.status,
                   f.id::text AS file_id, f.filename, ts_rank_cd(t.tsv, query.tq) AS rank,
                   ts_headline('pt_unaccent', left(t.content, 200000), query.tq,
                               'StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MaxWords=18,MinWords=6') AS snippet
              FROM file_text t
              JOIN revision_file f ON f.id = t.file_id
              JOIN revision r ON r.id = f.revision_id
              JOIN document d ON d.id = r.document_id
              CROSS JOIN query
             WHERE t.tsv @@ query.tq AND {_ACL} {proj}
             ORDER BY r.is_current DESC, rank DESC LIMIT :lim""", **p)
        results["documentos"] = await fetch_all(conn, f"""
            SELECT d.id::text AS document_id, d.code, d.title,
                   greatest(similarity(d.code, :q), similarity(d.title, :q)) AS rank
              FROM document d
             WHERE (d.code ILIKE '%' || :q || '%' OR d.title % :q OR d.title ILIKE '%' || :q || '%')
               AND {_ACL} {proj}
             ORDER BY rank DESC LIMIT :lim""", **p)

    if mode in ("auto", "fonetica"):
        results["fonetica"] = await fetch_all(conn, f"""
            SELECT d.id::text AS document_id, d.code, d.title,
                   similarity(d.title_phonetic, fn_phonetic(:q)) AS rank
              FROM document d
             WHERE fn_phonetic(:q) <> '' AND d.title_phonetic % fn_phonetic(:q) AND {_ACL} {proj}
             ORDER BY rank DESC LIMIT :lim""", **p)

    if mode == "semantica" and get_settings().embeddings_enabled:
        from app.services.embeddings import embed_query
        vec = embed_query(q)
        results["semantica"] = await fetch_all(conn, f"""
            SELECT d.id::text AS document_id, d.code, d.title, r.label AS revision_label,
                   c.page, left(c.content, 300) AS snippet, 1 - (c.embedding <=> CAST(:v AS vector)) AS rank
              FROM text_chunk c JOIN revision_file f ON f.id = c.file_id
              JOIN revision r ON r.id = f.revision_id JOIN document d ON d.id = r.document_id
             WHERE c.embedding IS NOT NULL AND {_ACL} {proj}
             ORDER BY c.embedding <=> CAST(:v AS vector) LIMIT :lim""", **p, v=str(vec))
    return {"q": q, "mode": mode, "results": results}
