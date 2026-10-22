"""Worker arq: OCR/extração, leitura de carimbo, embeddings e verificação de comentários.

Execução: arq app.worker.WorkerSettings
Idempotente: reprocessar um arquivo reescreve só os dados derivados (file_text, ocr_page, text_chunk).
"""
from __future__ import annotations

import asyncio
import hmac
import hashlib
import io
import json
import logging
import time
from typing import Any, ClassVar

from arq import cron
from arq.connections import RedisSettings

from app.core import storage
from app.core.config import get_settings
from app.core.db import engine, fetch_all, fetch_one
from app.services import comment_check
from app.services.ocr import pipeline, titleblock

log = logging.getLogger("worker")
MAX_ATTEMPTS = 3


async def process_file(ctx: dict[str, Any], file_id: str) -> str:
    s = get_settings()
    async with engine().begin() as conn:
        row = await fetch_one(conn, """
            UPDATE file_text SET status = 'PROCESSANDO', attempts = attempts + 1
             WHERE file_id = :f AND status IN ('PENDENTE','FALHOU') AND attempts < :max
            RETURNING file_id""", f=file_id, max=MAX_ATTEMPTS)
        if not row:
            return "ignorado"
        meta = await fetch_one(conn, """
            SELECT f.filename, b.mime, b.storage_key, r.id::text AS revision_id, d.id::text AS document_id,
                   d.code, d.title, p.code_regex
              FROM revision_file f JOIN blob b ON b.sha256 = f.blob_sha256
              JOIN revision r ON r.id = f.revision_id JOIN document d ON d.id = r.document_id
              JOIN project p ON p.id = d.project_id WHERE f.id = :f""", f=file_id)
    assert meta
    data = await storage.get_bytes(meta["storage_key"])
    try:
        result = await asyncio.to_thread(pipeline.process, data, meta["mime"], meta["filename"], s)
    except pipeline.Unsupported as e:
        async with engine().begin() as conn:
            await fetch_one(conn, """UPDATE file_text SET status = 'IGNORADO', error = :e, processed_at = now()
                                     WHERE file_id = :f RETURNING file_id""", e=str(e), f=file_id)
        return "ignorado"
    except Exception as e:
        log.exception("falha OCR %s", file_id)
        async with engine().begin() as conn:
            await fetch_one(conn, """UPDATE file_text SET status = 'FALHOU', error = :e
                                     WHERE file_id = :f RETURNING file_id""", e=str(e)[:2000], f=file_id)
        return "falhou"

    archive_sha = None
    if result.archive_pdf:
        archive_sha = hashlib.sha256(result.archive_pdf).hexdigest()
        await storage.put(storage.key_for(archive_sha), io.BytesIO(result.archive_pdf),
                          len(result.archive_pdf), "application/pdf")
    thumb_key = None
    if result.thumbnail_webp:
        thumb_key = f"thumbs/{file_id}.webp"
        await storage.put_bytes(thumb_key, result.thumbnail_webp, "image/webp")

    vectors: list[tuple[int, str, list[float] | None]] = []
    if s.embeddings_enabled:
        from app.services import embeddings
        pieces = [(p.page, c) for p in result.pages for c in embeddings.chunk(p.text)]
        vecs = await asyncio.to_thread(embeddings.embed, [c for _, c in pieces]) if pieces else []
        vectors = [(pg, c, v) for (pg, c), v in zip(pieces, vecs, strict=True)]

    async with engine().begin() as conn:
        if archive_sha:
            await fetch_one(conn, """INSERT INTO blob (sha256, size_bytes, mime, storage_key)
                                     VALUES (:s, :z, 'application/pdf', :k)
                                     ON CONFLICT (sha256) DO NOTHING RETURNING sha256""",
                            s=archive_sha, z=len(result.archive_pdf or b""), k=storage.key_for(archive_sha))
        await fetch_all(conn, "DELETE FROM ocr_page WHERE file_id = :f RETURNING page", f=file_id)
        await fetch_all(conn, "DELETE FROM text_chunk WHERE file_id = :f RETURNING id", f=file_id)
        for p in result.pages:
            await fetch_one(conn, """INSERT INTO ocr_page (file_id, page, text, confidence, words)
                                     VALUES (:f, :p, :t, :c, CAST(:w AS jsonb)) RETURNING page""",
                            f=file_id, p=p.page, t=p.text.replace("\x00", ""), c=p.confidence,
                            w=json.dumps([w.as_dict() for w in p.words]))
        for pg, content, vec in vectors:
            await fetch_one(conn, """INSERT INTO text_chunk (file_id, page, content, embedding)
                                     VALUES (:f, :p, :c, CAST(:v AS vector)) RETURNING id""",
                            f=file_id, p=pg, c=content, v=str(vec) if vec else None)
        await fetch_one(conn, """
            UPDATE file_text SET status = 'CONCLUIDO', engine = :e, pages = :n, content = :c,
                   confidence_avg = :conf, archive_sha256 = :a, thumb_key = :th, error = NULL,
                   processed_at = now()
             WHERE file_id = :f RETURNING file_id""",
            e=result.engine, n=len(result.pages), c=result.content.replace("\x00", ""),
            conf=result.confidence_avg, a=archive_sha, th=thumb_key, f=file_id)

        # Carimbo → PROPOSTA (a IA propõe, o humano decide)
        tb_source = result.titleblock_text or (result.pages[0].text if result.pages else "")
        tb = titleblock.extract(tb_source, meta["code_regex"])
        if tb.code and titleblock.same_code(tb.code, meta["code"]):
            tb.code = meta["code"]           # leitura confirma o código cadastrado; não é divergência
        payload = {k: v for k, v in {"title": tb.title, "revision": tb.revision, "code": tb.code,
                                      "escala": tb.escala, "folha": tb.folha, "formato": tb.formato}.items() if v}
        divergent = (tb.title and tb.title.lower() != meta["title"].lower()) or \
                    (tb.code and tb.code != meta["code"]) or tb.escala or tb.folha
        if tb.found() >= 2 and divergent:
            payload["source_file"] = meta["filename"]
            await fetch_one(conn, """
                INSERT INTO ai_suggestion (kind, target_type, target_id, payload, confidence, engine)
                SELECT 'METADADOS_CARIMBO', 'document', CAST(:d AS uuid), CAST(:p AS jsonb), :c, 'carimbo-regex-v1'
                 WHERE NOT EXISTS (SELECT 1 FROM ai_suggestion WHERE kind = 'METADADOS_CARIMBO'
                                     AND target_id = CAST(:d AS uuid) AND status = 'PROPOSTA')
                RETURNING id""", d=meta["document_id"], p=json.dumps(payload, ensure_ascii=False),
                c=round(min(0.9, 0.3 + 0.12 * tb.found()), 3))
    await check_comments(ctx, meta["revision_id"])
    return "concluido"


async def check_comments(ctx: dict[str, Any], revision_id: str) -> int:
    s = get_settings()
    async with engine().begin() as conn:
        cur = await fetch_one(conn, """SELECT r.id::text, r.label, r.document_id::text, r.created_at
                                       FROM revision r WHERE r.id = :r""", r=revision_id)
        if not cur:
            return 0
        prev = await fetch_one(conn, """SELECT id::text FROM revision WHERE document_id = :d AND id <> :r
                                        AND created_at < :t ORDER BY created_at DESC LIMIT 1""",
                               d=cur["document_id"], r=revision_id, t=cur["created_at"])
        if not prev:
            return 0
        comments = await fetch_all(conn, """
            SELECT c.id::text AS id, c.body FROM revision_comment c
             WHERE c.revision_id = :p AND c.status = 'ABERTO'
               AND NOT EXISTS (SELECT 1 FROM ai_suggestion s WHERE s.target_type = 'revision_comment'
                               AND s.target_id = c.id AND s.status = 'PROPOSTA')""", p=prev["id"])
        texts = await fetch_all(conn, """
            SELECT f.revision_id::text AS rid, string_agg(t.content, E'\n' ORDER BY f.created_at) AS txt
              FROM revision_file f JOIN file_text t ON t.file_id = f.id
             WHERE f.revision_id IN (:a, :b) AND t.status = 'CONCLUIDO' GROUP BY f.revision_id""",
            a=prev["id"], b=revision_id)
    by = {t["rid"]: t["txt"] or "" for t in texts}
    if revision_id not in by or not comments:
        return 0
    from app.core import sysconfig
    ia = await sysconfig.ia_config()      # painel Configurações › Assistente IA (o .env vale como reserva)
    verdicts = await asyncio.to_thread(comment_check.check, comments, by.get(prev["id"], ""), by[revision_id],
                                       ia["chave"] if ia["pronta"] else None, ia["modelo"])
    async with engine().begin() as conn:
        for v in verdicts:
            await fetch_one(conn, """
                INSERT INTO ai_suggestion (kind, target_type, target_id, payload, confidence, engine)
                VALUES ('COMENTARIO_ATENDIDO', 'revision_comment', :c, CAST(:p AS jsonb), :conf, :e)
                RETURNING id""", c=v.comment_id, conf=v.confidence, e=v.engine,
                p=json.dumps({"revision_id": revision_id, "revision_label": cur["label"],
                              "evidence": v.evidence}, ensure_ascii=False))
    return len(verdicts)


async def sweep(ctx: dict[str, Any]) -> int:
    """Rede de segurança: reenfileira arquivos pendentes há mais de 2 min (ex.: Redis reiniciou)."""
    async with engine().begin() as conn:
        rows = await fetch_all(conn, """
            SELECT t.file_id::text FROM file_text t JOIN revision_file f ON f.id = t.file_id
             WHERE (t.status = 'PENDENTE' AND f.created_at < now() - interval '2 minutes')
                OR (t.status = 'FALHOU' AND t.attempts < :max)
                OR (t.status = 'PROCESSANDO' AND f.created_at < now() - interval '2 hours')
             LIMIT 50""", max=MAX_ATTEMPTS)
        if rows:
            await fetch_all(conn, """UPDATE file_text SET status = 'PENDENTE'
                                     WHERE status = 'PROCESSANDO' AND file_id = ANY(CAST(:ids AS uuid[]))
                                     RETURNING file_id""", ids=[r["file_id"] for r in rows])
    for r in rows:
        await ctx["redis"].enqueue_job("process_file", r["file_id"], _job_id=f"ocr:{r['file_id']}:sweep:{int(time.time() // 120)}")
    return len(rows)


async def entregar_eventos(ctx: dict[str, Any]) -> int:
    """Entrega aos sistemas integrados (GPlanSiS|Drawings, GPlanSiS|Writer, GPlanSiS|Sheets) os eventos da fila (integracao_evento),
    em ordem dentro de cada sistema, com assinatura HMAC da chave daquele sistema.
    Falha → nova tentativa com espera crescente (1, 2, 4… até 60 min); desiste após 30 tentativas.
    Um sistema fora do ar não segura a fila do outro."""
    total = 0
    for sistema in ("drawings", "writer", "sheets"):
        total += await _entregar_sistema(sistema)
    return total


async def _entregar_sistema(sistema: str) -> int:
    from app.core.security import chave_integracao
    s = get_settings()
    chave = chave_integracao("webhook", sistema)
    if not chave:
        return 0
    if sistema == "writer":
        url, nome = s.writer_webhook_url or s.writer_url.rstrip("/") + "/api/integracao/docs/evento", "Writer"
    elif sistema == "sheets":
        url, nome = s.sheets_webhook_url or s.sheets_url.rstrip("/") + "/api/integracao/docs/evento", "Sheets"
    else:
        url, nome = s.drawings_webhook_url or s.drawings_url.rstrip("/") + "/api/integracao/docs/evento", "Drawings"
    entregues = 0
    async with engine().begin() as conn:
        rows = await fetch_all(conn, """
            SELECT id, tipo, document_id::text, payload, criado_em, tentativas FROM integracao_evento
             WHERE sistema = :s AND entregue_em IS NULL AND proxima_em <= now() AND tentativas < 30
             ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED""", s=sistema)
        if not rows:
            return 0
        import httpx
        async with httpx.AsyncClient(timeout=15) as cli:
            for r in rows:
                corpo = json.dumps({"id": r["id"], "tipo": r["tipo"], "document_id": r["document_id"],
                                    "criado_em": r["criado_em"].isoformat(), "estado": r["payload"]},
                                   ensure_ascii=False, default=str).encode()
                sig = hmac.new(chave, corpo, hashlib.sha256).hexdigest()
                try:
                    resp = await cli.post(url, content=corpo, headers={"content-type": "application/json",
                                                                         "x-assinatura": "sha256=" + sig,
                                                                         "x-evento-id": str(r["id"])})
                    ok, erro = resp.status_code < 300, f"HTTP {resp.status_code}: {resp.text[:200]}"
                except httpx.HTTPError as e:
                    ok, erro = False, f"{type(e).__name__}: {e}"[:300]
                if ok:
                    entregues += 1
                    await fetch_one(conn, "UPDATE integracao_evento SET entregue_em = now(), tentativas = tentativas + 1, ultimo_erro = NULL WHERE id = :i RETURNING id", i=r["id"])
                else:
                    await fetch_one(conn, """UPDATE integracao_evento SET tentativas = tentativas + 1, ultimo_erro = :e,
                                             proxima_em = now() + make_interval(mins => LEAST(60, power(2, tentativas)::int))
                                             WHERE id = :i RETURNING id""", e=erro, i=r["id"])
                    log.warning("evento %s não entregue ao %s: %s", r["id"], nome, erro)
                    break   # mantém a ordem: o resto espera a próxima rodada
    return entregues


class WorkerSettings:
    functions: ClassVar[list[Any]] = [process_file, check_comments]
    cron_jobs: ClassVar[list[Any]] = [cron(sweep, minute=set(range(0, 60, 2)), run_at_startup=True),
                                      cron(entregar_eventos, second=set(range(0, 60, 10)), run_at_startup=True)]
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    max_jobs = 2              # OCR é CPU-bound; escale por réplicas do worker
    job_timeout = 3600
