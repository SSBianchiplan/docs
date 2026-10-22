import csv
import io
import json
import mimetypes
import tempfile
from datetime import UTC, date, datetime
from typing import Annotated, Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, File, Form, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.api.deps import Conn
from app.core import storage
from app.core.config import get_settings
from app.core.db import fetch_all, fetch_one, scalar
from app.core.errors import DomainError
from app.core.security import CurrentUser
from app.services import access
from app.services.coding import build_code, next_revision_label
from app.services.queue import enqueue_file

router = APIRouter(tags=["documentos"])

SORTS = {"code": "code", "title": "title", "updated": "updated_at", "status": "revision_status",
         "issued": "issued_at", "planned": "planned_issue_date"}


class DocumentIn(BaseModel):
    project_id: str
    title: str = Field(min_length=3)
    discipline_code: str
    doc_type_code: str
    area: str | None = None
    originator: str | None = None
    confidentiality: Literal["PUBLICO", "INTERNO", "CONFIDENCIAL", "RESTRITO"] | None = None  # vazio = padrão do projeto
    code: str | None = None               # vazio = gerado pela máscara
    planned_issue_date: date | None = None
    weight: float = Field(1, gt=0, le=100000)
    tags: list[str] = []
    metadata: dict[str, Any] = {}
    first_revision: str | None = None     # padrão: "A"


class DocumentPatch(BaseModel):
    title: str | None = Field(default=None, min_length=3)
    area: str | None = None
    originator: str | None = None
    confidentiality: Literal["PUBLICO", "INTERNO", "CONFIDENCIAL", "RESTRITO"] | None = None
    tags: list[str] | None = None
    metadata: dict[str, Any] | None = None
    retention_until: str | None = None
    planned_issue_date: date | None = None
    weight: float | None = Field(default=None, gt=0, le=100000)


class RevisionIn(BaseModel):
    label: str | None = None
    description: str | None = None
    scheme: Literal["auto", "numeric"] = "auto"


class TransitionIn(BaseModel):
    to: Literal["EM_ELABORACAO", "EM_VERIFICACAO", "APROVADA_INTERNA", "APROVADA",
                "APROVADA_COM_COMENTARIOS", "REPROVADA", "CANCELADA"]
    client_return_code: Literal["A", "B", "C", "D"] | None = None


# ---------------------------------------------------------------------------- lista mestra
def _master_filters(user: CurrentUser, project_id: str | None, q: str | None, discipline: str | None,
                    doc_type: str | None, status: str | None, tag: str | None,
                    late: bool = False) -> tuple[str, dict[str, Any]]:
    where = ["(:adm OR EXISTS (SELECT 1 FROM project_member m WHERE m.project_id = v.project_id AND m.user_id = :u))"]
    params: dict[str, Any] = {"u": user.id, "adm": user.is_admin}
    if project_id:
        where.append("v.project_id = :p")
        params["p"] = project_id
    if q:
        where.append("(v.code ILIKE :ql OR v.title ILIKE :ql OR similarity(v.title, :q) > 0.25)")
        params.update(q=q, ql=f"%{q}%")
    if discipline:
        where.append("v.discipline_code = :disc")
        params["disc"] = discipline
    if doc_type:
        where.append("v.doc_type_code = :dt")
        params["dt"] = doc_type
    if status:
        where.append("v.revision_status = ANY(:st)")
        params["st"] = status.split(",")
    if tag:
        where.append(":tag = ANY(v.tags)")
        params["tag"] = tag
    if late:
        where.append("v.planned_issue_date < current_date AND v.first_issued_at IS NULL")
    return " AND ".join(where), params


@router.get("/documents")
async def master_list(
    conn: Conn, user: CurrentUser,
    project_id: str | None = None, q: str | None = None, discipline: str | None = None,
    doc_type: str | None = None, status: str | None = None, tag: str | None = None,
    page: int = Query(1, ge=1), size: int = Query(50, ge=1, le=500),
    sort: str = "code", desc: bool = False, late: bool = False,
) -> dict[str, Any]:
    w, params = _master_filters(user, project_id, q, discipline, doc_type, status, tag, late)
    order = SORTS.get(sort, "code")
    total = await scalar(conn, f"SELECT count(*) FROM v_master_list v WHERE {w}", **params)
    rows = await fetch_all(conn, f"""
        SELECT v.id::text, v.project_code, v.code, v.title, v.discipline_code, v.doc_type_code, v.area,
               v.originator, v.confidentiality, v.tags, v.updated_at, v.revision_id::text,
               v.revision_label, v.revision_status, v.purpose, v.issued_at, v.client_return_code,
               v.open_comments, v.checked_out_by::text, v.planned_issue_date, v.weight::float8 AS weight, v.first_issued_at,
               (v.planned_issue_date < current_date AND v.first_issued_at IS NULL) AS late
          FROM v_master_list v WHERE {w}
         ORDER BY {order} {"DESC" if desc else "ASC"} NULLS LAST, v.code
         LIMIT :lim OFFSET :off""", **params, lim=size, off=(page - 1) * size)
    return {"total": total, "page": page, "size": size, "items": rows}


@router.get("/documents/export.csv")
async def export_master_list(
    conn: Conn, user: CurrentUser,
    project_id: str | None = None, q: str | None = None, discipline: str | None = None,
    doc_type: str | None = None, status: str | None = None, tag: str | None = None, late: bool = False,
) -> Response:
    """Lista mestra em CSV (separador ';' e BOM para abrir direto no Excel pt-BR)."""
    w, params = _master_filters(user, project_id, q, discipline, doc_type, status, tag, late)
    rows = await fetch_all(conn, f"""
        SELECT v.project_code, v.code, v.title, v.discipline_code, v.doc_type_code, v.area, v.originator,
               v.confidentiality, v.revision_label, v.revision_status, v.purpose,
               to_char(v.issued_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS issued,
               v.client_return_code, v.open_comments, array_to_string(v.tags, ', ') AS tags,
               to_char(v.planned_issue_date, 'DD/MM/YYYY') AS planned, v.weight,
               to_char(v.updated_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS updated
          FROM v_master_list v WHERE {w} ORDER BY v.project_code, v.code LIMIT 100000""", **params)
    buf = io.StringIO()
    wr = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    wr.writerow(["Projeto", "Código", "Título", "Disciplina", "Tipo", "Área", "Emissor", "Confidencialidade",
                 "Revisão", "Situação", "Finalidade", "Emitida em", "Retorno cliente", "Comentários abertos",
                 "Tags", "Data prevista", "Peso", "Atualizado em"])
    for r in rows:
        # neutraliza fórmula (=, +, -, @) injetada em título/tags ao abrir no Excel
        wr.writerow([("'" + str(v)) if isinstance(v, str) and v and v[0] in "=+-@" else ("" if v is None else v)
                     for v in r.values()])
    name = f"lista-mestra-{datetime.now(UTC):%Y%m%d-%H%M}.csv"
    return Response("\ufeff" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.post("/documents", status_code=201)
async def create_document(body: DocumentIn, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    await access.require(conn, body.project_id, user, access.WRITE_ROLES)
    proj = await fetch_one(conn, """SELECT code, code_mask, active, default_confidentiality, retention_years,
                                           revision_scheme FROM project WHERE id = :p""", p=body.project_id)
    if not proj:
        raise DomainError("Projeto não encontrado", 404)
    if not proj["active"]:
        raise DomainError("Projeto arquivado não recebe documentos novos", 409)
    code = body.code
    if not code:
        seq = await scalar(conn, "SELECT fn_next_doc_seq(:p, :d, :t)",
                           p=body.project_id, d=body.discipline_code, t=body.doc_type_code)
        code = build_code(proj["code_mask"], proj=proj["code"], disc=body.discipline_code,
                          tipo=body.doc_type_code, seq=int(seq), area=body.area)
    doc = await fetch_one(conn, """
        INSERT INTO document (project_id, code, title, discipline_code, doc_type_code, area, originator,
                              confidentiality, tags, metadata, created_by, planned_issue_date, weight, retention_until)
        VALUES (:p, :c, :t, :d, :dt, :a, :o, :cf, :tags, CAST(:md AS jsonb), :u, :pl, :w,
                CASE WHEN CAST(:ry AS int) IS NULL THEN NULL ELSE current_date + make_interval(years => CAST(:ry AS int)) END)
        RETURNING id::text, code""",
        p=body.project_id, c=code, t=body.title, d=body.discipline_code, dt=body.doc_type_code,
        a=body.area, o=body.originator, cf=body.confidentiality or proj["default_confidentiality"], tags=body.tags,
        md=json.dumps(body.metadata), u=user.id, pl=body.planned_issue_date, w=body.weight, ry=proj["retention_years"])
    assert doc
    rev = await fetch_one(conn, """INSERT INTO revision (document_id, label, created_by, description)
                                   VALUES (:d, :l, :u, 'Emissão inicial') RETURNING id::text, label""",
                          d=doc["id"], u=user.id,
                          l=body.first_revision or ("0" if proj["revision_scheme"] == "numeric" else "A"))
    return {**doc, "revision": rev}


@router.get("/documents/{document_id}")
async def document_detail(document_id: str, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    project_id = await access.project_of_document(conn, document_id)
    role = await access.require(conn, project_id, user)
    doc = await fetch_one(conn, """
        SELECT d.id::text, d.project_id::text, p.code AS project_code, p.name AS project_name, d.code, d.title,
               d.discipline_code, di.name AS discipline_name, d.doc_type_code, dt.name AS doc_type_name,
               d.area, d.originator, d.confidentiality, d.metadata, d.tags, d.retention_until,
               d.planned_issue_date, d.weight::float8 AS weight, p.active AS project_active,
               d.created_at, d.updated_at, u.name AS created_by_name
          FROM document d JOIN project p ON p.id = d.project_id
          JOIN discipline di ON di.code = d.discipline_code JOIN doc_type dt ON dt.code = d.doc_type_code
          JOIN app_user u ON u.id = d.created_by
         WHERE d.id = :d""", d=document_id)
    revisions = await fetch_all(conn, """
        SELECT r.id::text, r.label, r.status, r.purpose, r.description, r.is_current, r.created_at,
               r.issued_at, r.client_return_code, r.client_returned_at, u.name AS created_by_name,
               r.created_by::text,
               (SELECT count(*) FROM revision_comment c WHERE c.revision_id = r.id AND c.status = 'ABERTO') AS open_comments,
               (SELECT json_agg(json_build_object(
                    'id', f.id, 'role', f.role, 'filename', f.filename, 'sha256', f.blob_sha256,
                    'size', b.size_bytes, 'mime', b.mime, 'ocr_status', t.status, 'ocr_engine', t.engine,
                    'pages', t.pages, 'confidence', t.confidence_avg, 'has_archive', t.archive_sha256 IS NOT NULL,
                    'has_thumb', t.thumb_key IS NOT NULL, 'ocr_error', t.error) ORDER BY f.created_at)
                  FROM revision_file f JOIN blob b ON b.sha256 = f.blob_sha256
                  LEFT JOIN file_text t ON t.file_id = f.id WHERE f.revision_id = r.id) AS files,
               (SELECT json_agg(json_build_object('grd_id', g.id, 'number', g.number, 'status', g.status,
                    'recipient', g.recipient, 'issued_at', g.issued_at))
                  FROM grd_item gi JOIN grd g ON g.id = gi.grd_id WHERE gi.revision_id = r.id) AS grds
          FROM revision r JOIN app_user u ON u.id = r.created_by
         WHERE r.document_id = :d ORDER BY r.created_at DESC""", d=document_id)
    checkout = await fetch_one(conn, """
        SELECT c.id::text, c.user_id::text, u.name, c.checked_out_at, c.note
          FROM document_checkout c JOIN app_user u ON u.id = c.user_id
         WHERE c.document_id = :d AND c.checked_in_at IS NULL""", d=document_id)
    suggestions = await fetch_all(conn, """
        SELECT s.id::text, s.kind, s.payload, s.confidence, s.engine, s.created_at, s.target_type,
               s.target_id::text
          FROM ai_suggestion s
         WHERE s.status = 'PROPOSTA' AND (
               (s.target_type = 'document' AND s.target_id = :d)
            OR (s.target_type = 'revision' AND s.target_id IN (SELECT id FROM revision WHERE document_id = :d))
            OR (s.target_type = 'revision_comment' AND s.target_id IN (
                  SELECT c.id FROM revision_comment c JOIN revision r ON r.id = c.revision_id WHERE r.document_id = :d)))
         ORDER BY s.created_at DESC""", d=document_id)
    workflow = await fetch_all(conn, """
        SELECT wi.id::text, wi.revision_id::text, wi.status, wi.current_step, wi.started_at, wi.finished_at,
               t.name AS template_name,
               (SELECT json_agg(json_build_object('id', k.id, 'step_order', k.step_order, 'step_name', k.step_name,
                    'assignee', ua.name, 'status', k.status, 'due_at', k.due_at, 'decided_at', k.decided_at,
                    'note', k.decision_note) ORDER BY k.created_at)
                  FROM workflow_task k JOIN app_user ua ON ua.id = k.assignee_id WHERE k.instance_id = wi.id) AS tasks
          FROM workflow_instance wi JOIN workflow_template t ON t.id = wi.template_id
          JOIN revision r ON r.id = wi.revision_id
         WHERE r.document_id = :d ORDER BY wi.started_at DESC""", d=document_id)
    return {"document": doc, "my_role": role, "revisions": revisions, "checkout": checkout,
            "suggestions": suggestions, "workflows": workflow}


@router.patch("/documents/{document_id}")
async def patch_document(document_id: str, body: DocumentPatch, conn: Conn, user: CurrentUser) -> dict[str, str]:
    project_id = await access.project_of_document(conn, document_id)
    await access.require(conn, project_id, user, access.WRITE_ROLES)
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return {"id": document_id}
    sets, params = [], {"d": document_id}
    for k, v in fields.items():
        if k == "metadata":
            sets.append("metadata = CAST(:metadata AS jsonb)")
            params["metadata"] = json.dumps(v)
        elif k in ("planned_issue_date", "weight"):
            sets.append(f"{k} = :{k}")
            params[k] = v
        elif k == "retention_until":
            sets.append("retention_until = CAST(:retention_until AS date)")
            params[k] = v
        else:
            sets.append(f"{k} = :{k}")
            params[k] = v
    await fetch_one(conn, f"UPDATE document SET {', '.join(sets)} WHERE id = :d RETURNING id", **params)
    return {"id": document_id}


# ---------------------------------------------------------------------------- check-out
@router.post("/documents/{document_id}/checkout")
async def checkout(document_id: str, conn: Conn, user: CurrentUser, note: str | None = None) -> dict[str, Any]:
    project_id = await access.project_of_document(conn, document_id)
    await access.require(conn, project_id, user, access.WRITE_ROLES)
    row = await fetch_one(conn, """INSERT INTO document_checkout (document_id, user_id, note)
                                   VALUES (:d, :u, :n) RETURNING id::text, checked_out_at""",
                          d=document_id, u=user.id, n=note)
    assert row
    return row


@router.post("/documents/{document_id}/checkin")
async def checkin(document_id: str, conn: Conn, user: CurrentUser) -> dict[str, str]:
    project_id = await access.project_of_document(conn, document_id)
    role = await access.require(conn, project_id, user)
    row = await fetch_one(conn, """
        UPDATE document_checkout SET checked_in_at = now()
         WHERE document_id = :d AND checked_in_at IS NULL AND (user_id = :u OR :ctl)
        RETURNING id::text""", d=document_id, u=user.id, ctl=role in access.CONTROL_ROLES)
    if not row:
        raise DomainError("Nenhum check-out seu ativo para este documento", 409)
    return row


async def _assert_not_locked_by_other(conn: Any, document_id: str, user_id: str) -> None:
    holder = await scalar(conn, """SELECT user_id::text FROM document_checkout
                                   WHERE document_id = :d AND checked_in_at IS NULL""", d=document_id)
    if holder and holder != user_id:
        raise DomainError("Documento em check-out por outro usuário", 423)


# ---------------------------------------------------------------------------- revisões
@router.post("/documents/{document_id}/revisions", status_code=201)
async def new_revision(document_id: str, body: RevisionIn, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    project_id = await access.project_of_document(conn, document_id)
    await access.require(conn, project_id, user, access.WRITE_ROLES)
    await _assert_not_locked_by_other(conn, document_id, user.id)
    cur = await fetch_one(conn, """SELECT id::text, label, status FROM revision
                                   WHERE document_id = :d AND is_current FOR UPDATE""", d=document_id)
    label = body.label or next_revision_label(cur["label"] if cur else None, body.scheme)
    if cur:
        await fetch_one(conn, "UPDATE revision SET is_current = false WHERE id = :r RETURNING id", r=cur["id"])
        if cur["status"] in ("EMITIDA", "APROVADA", "APROVADA_COM_COMENTARIOS", "REPROVADA"):
            await fetch_one(conn, "UPDATE revision SET status = 'SUPERADA' WHERE id = :r RETURNING id", r=cur["id"])
    row = await fetch_one(conn, """INSERT INTO revision (document_id, label, description, created_by)
                                   VALUES (:d, :l, :ds, :u) RETURNING id::text, label, status""",
                          d=document_id, l=label, ds=body.description, u=user.id)
    assert row
    return row


@router.post("/revisions/{revision_id}/transition")
async def transition(revision_id: str, body: TransitionIn, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    project_id = await access.project_of_revision(conn, revision_id)
    role = await access.require(conn, project_id, user)
    client_states = ("APROVADA", "APROVADA_COM_COMENTARIOS", "REPROVADA")
    if body.to in client_states and role not in access.CONTROL_ROLES:
        raise DomainError("Registrar retorno do cliente exige perfil CONTROLADOR", 403)
    if body.to in ("EM_VERIFICACAO", "APROVADA_INTERNA", "EM_ELABORACAO", "CANCELADA") \
            and role not in access.WRITE_ROLES:
        raise DomainError("Sem permissão para alterar a revisão", 403)
    ret: str | None = body.client_return_code if body.to in client_states else None
    if body.to in client_states and not ret:
        ret = {"APROVADA": "A", "APROVADA_COM_COMENTARIOS": "B", "REPROVADA": "C"}[body.to]
    row = await fetch_one(conn, """
        UPDATE revision SET status = :s,
               client_return_code = COALESCE(CAST(:rc AS text), client_return_code),
               client_returned_at = CASE WHEN CAST(:rc AS text) IS NOT NULL THEN now()
                                         ELSE client_returned_at END
         WHERE id = :r RETURNING id::text, status""", s=body.to, rc=ret, r=revision_id)
    if not row:
        raise DomainError("Revisão não encontrada", 404)
    return row


# ---------------------------------------------------------------------------- arquivos
@router.post("/revisions/{revision_id}/files", status_code=201)
async def upload_file(
    revision_id: str, conn: Conn, user: CurrentUser, bg: BackgroundTasks,
    file: Annotated[UploadFile, File()], role: Annotated[Literal["PDF", "NATIVO", "ANEXO"] | None, Form()] = None,
) -> dict[str, Any]:
    project_id = await access.project_of_revision(conn, revision_id)
    await access.require(conn, project_id, user, access.WRITE_ROLES)
    doc_id = await scalar(conn, "SELECT document_id::text FROM revision WHERE id = :r", r=revision_id)
    await _assert_not_locked_by_other(conn, str(doc_id), user.id)

    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    filename = (file.filename or "arquivo").replace("/", "_")[:255]
    mime = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    if role is None:
        role = "PDF" if mime == "application/pdf" else "NATIVO"

    with tempfile.SpooledTemporaryFile(max_size=32 * 1024 * 1024) as tmp:
        size = 0
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > max_bytes:
                raise DomainError(f"Arquivo excede {get_settings().max_upload_mb} MB", 413)
            tmp.write(chunk)
        if size == 0:
            raise DomainError("Arquivo vazio")
        sha, size = storage.sha256_file(tmp)  # type: ignore[arg-type]
        key = storage.key_for(sha)
        if not await storage.exists(key):
            await storage.put(key, tmp, size, mime)  # type: ignore[arg-type]

    await fetch_one(conn, """INSERT INTO blob (sha256, size_bytes, mime, storage_key)
                             VALUES (:s, :z, :m, :k) ON CONFLICT (sha256) DO NOTHING RETURNING sha256""",
                    s=sha, z=size, m=mime, k=key)
    row = await fetch_one(conn, """
        INSERT INTO revision_file (revision_id, blob_sha256, role, filename, created_by)
        VALUES (:r, :s, :role, :f, :u) RETURNING id::text, filename, role, blob_sha256 AS sha256""",
        r=revision_id, s=sha, role=role, f=filename, u=user.id)
    assert row
    await fetch_one(conn, "INSERT INTO file_text (file_id) VALUES (:f) RETURNING file_id", f=row["id"])
    bg.add_task(enqueue_file, row["id"])   # roda após o commit da transação
    return {**row, "size": size, "mime": mime}


async def _file_row(conn: Any, file_id: str, user: CurrentUser) -> dict[str, Any]:
    row = await fetch_one(conn, """
        SELECT f.id::text, f.filename, f.role, b.storage_key, b.mime, t.archive_sha256, t.thumb_key,
               d.project_id::text, d.confidentiality
          FROM revision_file f JOIN blob b ON b.sha256 = f.blob_sha256
          JOIN revision r ON r.id = f.revision_id JOIN document d ON d.id = r.document_id
          LEFT JOIN file_text t ON t.file_id = f.id WHERE f.id = :f""", f=file_id)
    if not row:
        raise DomainError("Arquivo não encontrado", 404)
    role = await access.require(conn, row["project_id"], user)
    if row["confidentiality"] == "RESTRITO" and role in ("LEITOR", "EXTERNO"):
        raise DomainError("Documento restrito", 403)
    return row


MIME_INLINE = frozenset({"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp",
                         "image/tiff", "text/plain"})


@router.get("/files/{file_id}/content")
async def file_content(file_id: str, conn: Conn, user: CurrentUser,
                       variant: Literal["original", "archive"] = "original",
                       download: bool = False) -> Response:
    row = await _file_row(conn, file_id, user)
    key, mime, name = row["storage_key"], row["mime"], row["filename"]
    if variant == "archive" and row["archive_sha256"]:
        key, mime = storage.key_for(row["archive_sha256"]), "application/pdf"
        name = name.rsplit(".", 1)[0] + "_pdfa.pdf"
    data = await storage.get_bytes(key)
    # o MIME veio do cliente no upload: só tipos inertes abrem inline; o resto (HTML, SVG, XML…) é baixado.
    # CSP sandbox + nosniff: mesmo aberto direto na origem do Docs, o arquivo não roda script nem lê a sessão.
    inline_ok = (mime or "").split(";")[0].strip().lower() in MIME_INLINE
    disp = "inline" if inline_ok and not download else "attachment"
    headers = {"Content-Disposition": f"{disp}; filename*=UTF-8''{quote(name)}",
               "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"}
    if mime != "application/pdf":   # o visualizador de PDF do Chrome não abre sob CSP sandbox; PDF não roda script na origem
        headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'"
    return Response(data, media_type=mime if inline_ok else "application/octet-stream", headers=headers)


@router.get("/files/{file_id}/thumb")
async def file_thumb(file_id: str, conn: Conn, user: CurrentUser) -> Response:
    row = await _file_row(conn, file_id, user)
    if not row["thumb_key"]:
        raise DomainError("Miniatura ainda não gerada", 404)
    return Response(await storage.get_bytes(row["thumb_key"]), media_type="image/webp",
                    headers={"Cache-Control": "private, max-age=86400"})


@router.get("/files/{file_id}/text")
async def file_text(file_id: str, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    await _file_row(conn, file_id, user)
    meta = await fetch_one(conn, """SELECT status, engine, pages, confidence_avg, processed_at, error
                                    FROM file_text WHERE file_id = :f""", f=file_id)
    pages = await fetch_all(conn, """SELECT page, text, confidence FROM ocr_page
                                     WHERE file_id = :f ORDER BY page""", f=file_id)
    return {"meta": meta, "pages": pages}


@router.post("/files/{file_id}/reprocess", status_code=202)
async def reprocess(file_id: str, conn: Conn, user: CurrentUser, bg: BackgroundTasks) -> dict[str, str]:
    row = await _file_row(conn, file_id, user)
    await access.require(conn, row["project_id"], user, access.WRITE_ROLES)
    await fetch_one(conn, """UPDATE file_text SET status = 'PENDENTE', error = NULL
                             WHERE file_id = :f RETURNING file_id""", f=file_id)
    bg.add_task(enqueue_file, file_id)
    return {"status": "PENDENTE"}
