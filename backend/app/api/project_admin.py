"""Projeto avançado: criação completa (assistente), configurações, áreas, disciplinas habilitadas,
fluxos de aprovação próprios, avanço planejado × realizado (curva S) e importação da lista de documentos."""
import csv
import io
import json
import re
from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, File, Form, UploadFile
from pydantic import BaseModel, Field, field_validator

from app.api.deps import Conn
from app.core.db import fetch_all, fetch_one, scalar
from app.core.errors import DomainError
from app.core.security import CurrentUser, Principal
from app.services import access
from app.services.coding import MaskError, build_code, mask_to_regex

router = APIRouter(tags=["projetos"])

Conf = Literal["PUBLICO", "INTERNO", "CONFIDENCIAL", "RESTRITO"]
ROLE_RX = r"^(ADMIN|CONTROLADOR|AUTOR|REVISOR|LEITOR|EXTERNO)$"
DEFAULT_TEMPLATE = "00000000-0000-0000-0000-00000000f001"


class AreaIn(BaseModel):
    code: str = Field(pattern=r"^[A-Z0-9]{1,6}$")
    name: str = Field(min_length=2, max_length=120)


class StepIn(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    role_required: Literal["CONTROLADOR", "AUTOR", "REVISOR", "ADMIN"]
    sla_hours: int = Field(48, ge=1, le=24 * 90)


class TemplateIn(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    steps: list[StepIn] = Field(min_length=1, max_length=10)
    make_default: bool = False


class MemberIn(BaseModel):
    user_id: str
    role: str = Field(pattern=ROLE_RX)


class ProjectIn(BaseModel):
    code: str = Field(pattern=r"^[A-Z0-9]{2,12}$")
    name: str = Field(min_length=3, max_length=200)
    client: str | None = None
    description: str | None = Field(default=None, max_length=4000)
    contract: str | None = Field(default=None, max_length=120)
    location: str | None = Field(default=None, max_length=200)
    start_date: date | None = None
    end_date: date | None = None
    code_mask: str = "{PROJ}-{DISC}-{TIPO}-{SEQ:4}"
    revision_scheme: Literal["auto", "numeric"] = "auto"
    require_workflow: bool = True
    default_confidentiality: Conf = "INTERNO"
    retention_years: int | None = Field(default=None, ge=1, le=100)
    areas: list[AreaIn] = []
    disciplines: list[str] = []            # vazio = todas
    template: TemplateIn | None = None     # vazio = fluxo padrão global
    members: list[MemberIn] = []

    @field_validator("code", mode="before")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.strip().upper() if isinstance(v, str) else v


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=200)
    client: str | None = None
    description: str | None = Field(default=None, max_length=4000)
    contract: str | None = None
    location: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    require_workflow: bool | None = None
    revision_scheme: Literal["auto", "numeric"] | None = None
    default_confidentiality: Conf | None = None
    retention_years: int | None = Field(default=None, ge=1, le=100)
    default_template_id: str | None = None
    active: bool | None = None


# ---------------------------------------------------------------------------- helpers
async def _create_template(conn: Any, project_id: str, t: TemplateIn) -> str:
    row = await fetch_one(conn, """INSERT INTO workflow_template (project_id, name) VALUES (CAST(:p AS uuid), :n)
                                   RETURNING id::text""", p=project_id, n=t.name)
    assert row
    for i, s in enumerate(t.steps, start=1):
        await fetch_one(conn, """INSERT INTO workflow_template_step (template_id, step_order, name, role_required, sla_hours)
                                 VALUES (CAST(:t AS uuid), :o, :n, :r, :h) RETURNING step_order""",
                        t=row["id"], o=i, n=s.name, r=s.role_required, h=s.sla_hours)
    if t.make_default:
        await fetch_one(conn, "UPDATE project SET default_template_id = CAST(:t AS uuid) WHERE id = CAST(:p AS uuid) RETURNING id",
                        t=row["id"], p=project_id)
    return str(row["id"])


async def _replace_areas(conn: Any, project_id: str, areas: list[AreaIn]) -> None:
    codes = [a.code for a in areas]
    if len(codes) != len(set(codes)):
        raise DomainError("Código de área repetido", 422)
    in_use = await fetch_all(conn, """SELECT DISTINCT area FROM document WHERE project_id = CAST(:p AS uuid)
                                      AND area IS NOT NULL AND NOT (area = ANY(CAST(:c AS text[])))""",
                             p=project_id, c=codes)
    if in_use and codes:
        raise DomainError("Áreas em uso por documentos não podem sair: " + ", ".join(r["area"] for r in in_use), 409)
    await fetch_all(conn, "DELETE FROM project_area WHERE project_id = CAST(:p AS uuid) RETURNING code", p=project_id)
    for a in areas:
        await fetch_one(conn, """INSERT INTO project_area (project_id, code, name) VALUES (CAST(:p AS uuid), :c, :n)
                                 RETURNING code""", p=project_id, c=a.code, n=a.name.strip())


async def _replace_disciplines(conn: Any, project_id: str, codes: list[str]) -> None:
    codes = sorted(set(codes))
    if codes:
        in_use = await fetch_all(conn, """SELECT DISTINCT discipline_code AS c FROM document
                                          WHERE project_id = CAST(:p AS uuid)
                                            AND NOT (discipline_code = ANY(CAST(:c AS text[])))""", p=project_id, c=codes)
        if in_use:
            raise DomainError("Disciplinas com documentos não podem ser desabilitadas: "
                              + ", ".join(r["c"] for r in in_use), 409)
    await fetch_all(conn, "DELETE FROM project_discipline WHERE project_id = CAST(:p AS uuid) RETURNING discipline_code",
                    p=project_id)
    for c in codes:
        await fetch_one(conn, """INSERT INTO project_discipline (project_id, discipline_code)
                                 VALUES (CAST(:p AS uuid), :c) RETURNING discipline_code""", p=project_id, c=c)


# ---------------------------------------------------------------------------- criação e detalhe
@router.get("/coding/preview")
async def coding_preview(user: CurrentUser, mask: str, proj: str = "PROJ", disc: str = "CIV", tipo: str = "DE",
                         area: str = "A1") -> dict[str, str]:
    """Valida a máscara e mostra um exemplo de código — usado ao digitar no assistente."""
    try:
        return {"example": build_code(mask, proj=proj or "PROJ", disc=disc, tipo=tipo, seq=1, area=area),
                "regex": mask_to_regex(mask)}
    except MaskError as e:
        raise DomainError(str(e), 422) from e


@router.post("/projects", status_code=201)
async def create_project(body: ProjectIn, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    if not user.is_admin:
        raise DomainError("Somente administradores criam projetos", 403)
    try:
        rx = mask_to_regex(body.code_mask)
    except MaskError as e:
        raise DomainError(str(e), 422) from e
    if "{AREA}" in body.code_mask and not body.areas:
        raise DomainError("A máscara usa {AREA}: cadastre ao menos uma área", 422)
    if await scalar(conn, "SELECT 1 FROM project WHERE code = :c", c=body.code):
        raise DomainError(f"Já existe projeto com a sigla {body.code}", 409)
    row = await fetch_one(conn, """
        INSERT INTO project (code, name, client, code_mask, code_regex, require_workflow, description, contract,
                             location, start_date, end_date, revision_scheme, default_confidentiality,
                             retention_years, created_by)
        VALUES (:c, :n, :cl, :m, :rx, :rw, :ds, :ct, :lo, :sd, :ed, :rs, :cf, :ry, CAST(:u AS uuid))
        RETURNING id::text, code, name""",
        c=body.code, n=body.name.strip(), cl=body.client, m=body.code_mask, rx=rx, rw=body.require_workflow,
        ds=body.description, ct=body.contract, lo=body.location, sd=body.start_date, ed=body.end_date,
        rs=body.revision_scheme, cf=body.default_confidentiality, ry=body.retention_years, u=user.id)
    assert row
    pid = row["id"]
    await fetch_one(conn, """INSERT INTO project_member (project_id, user_id, role)
                             VALUES (CAST(:p AS uuid), CAST(:u AS uuid), 'ADMIN') RETURNING role""", p=pid, u=user.id)
    for m in body.members:
        if m.user_id == user.id:
            continue
        await fetch_one(conn, """INSERT INTO project_member (project_id, user_id, role)
                                 VALUES (CAST(:p AS uuid), CAST(:u AS uuid), :r)
                                 ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role RETURNING role""",
                        p=pid, u=m.user_id, r=m.role)
    await _replace_areas(conn, pid, body.areas)
    await _replace_disciplines(conn, pid, body.disciplines)
    if body.template:
        body.template.make_default = True
        await _create_template(conn, pid, body.template)
    return row


@router.get("/projects/{project_id}")
async def project_detail(project_id: str, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    role = await access.require(conn, project_id, user)
    p = await fetch_one(conn, """
        SELECT p.id::text, p.code, p.name, p.client, p.description, p.contract, p.location, p.start_date, p.end_date,
               p.code_mask, p.code_regex, p.revision_scheme, p.require_workflow, p.default_confidentiality,
               p.retention_years, p.default_template_id::text, p.active, p.created_at, u.name AS created_by_name
          FROM project p LEFT JOIN app_user u ON u.id = p.created_by WHERE p.id = CAST(:p AS uuid)""", p=project_id)
    if not p:
        raise DomainError("Projeto não encontrado", 404)
    areas = await fetch_all(conn, """SELECT a.code, a.name,
                                            (SELECT count(*) FROM document d WHERE d.project_id = a.project_id AND d.area = a.code) AS documents
                                       FROM project_area a WHERE a.project_id = CAST(:p AS uuid) ORDER BY a.code""", p=project_id)
    disciplines = await fetch_all(conn, "SELECT discipline_code AS code FROM project_discipline WHERE project_id = CAST(:p AS uuid) ORDER BY 1",
                                  p=project_id)
    templates = await fetch_all(conn, """
        SELECT t.id::text, t.name, t.project_id::text, t.active,
               json_agg(json_build_object('step_order', s.step_order, 'name', s.name, 'role_required', s.role_required,
                        'sla_hours', s.sla_hours) ORDER BY s.step_order) AS steps,
               (SELECT count(*) FROM workflow_instance wi WHERE wi.template_id = t.id) AS uses
          FROM workflow_template t JOIN workflow_template_step s ON s.template_id = t.id
         WHERE t.project_id IS NULL OR t.project_id = CAST(:p AS uuid)
         GROUP BY t.id ORDER BY t.project_id NULLS LAST, t.name""", p=project_id)
    return {"project": p, "my_role": role, "areas": areas, "disciplines": [d["code"] for d in disciplines],
            "templates": templates}


@router.patch("/projects/{project_id}")
async def patch_project(project_id: str, body: ProjectPatch, conn: Conn, user: CurrentUser) -> dict[str, str]:
    await access.require(conn, project_id, user, ("ADMIN",))
    fields = body.model_dump(exclude_unset=True)
    if fields.get("default_template_id"):
        ok = await scalar(conn, """SELECT 1 FROM workflow_template WHERE id = CAST(:t AS uuid) AND active
                                   AND (project_id IS NULL OR project_id = CAST(:p AS uuid))""",
                          t=fields["default_template_id"], p=project_id)
        if not ok:
            raise DomainError("Fluxo inválido para este projeto", 422)
    if fields:
        sets = ", ".join(f"{k} = CAST(:{k} AS uuid)" if k == "default_template_id" else f"{k} = :{k}" for k in fields)
        await fetch_one(conn, f"UPDATE project SET {sets} WHERE id = CAST(:id AS uuid) RETURNING id", id=project_id, **fields)
    return {"id": project_id}


@router.put("/projects/{project_id}/areas", status_code=204)
async def put_areas(project_id: str, body: list[AreaIn], conn: Conn, user: CurrentUser) -> None:
    await access.require(conn, project_id, user, access.CONTROL_ROLES)
    await _replace_areas(conn, project_id, body)


@router.put("/projects/{project_id}/disciplines", status_code=204)
async def put_disciplines(project_id: str, body: list[str], conn: Conn, user: CurrentUser) -> None:
    await access.require(conn, project_id, user, access.CONTROL_ROLES)
    await _replace_disciplines(conn, project_id, body)


@router.post("/projects/{project_id}/workflow-templates", status_code=201)
async def add_template(project_id: str, body: TemplateIn, conn: Conn, user: CurrentUser) -> dict[str, str]:
    await access.require(conn, project_id, user, access.CONTROL_ROLES)
    return {"id": await _create_template(conn, project_id, body)}


@router.patch("/workflow-templates/{template_id}")
async def toggle_template(template_id: str, active: bool, conn: Conn, user: CurrentUser) -> dict[str, str]:
    pid = await scalar(conn, "SELECT project_id::text FROM workflow_template WHERE id = CAST(:t AS uuid)", t=template_id)
    if not pid:
        raise DomainError("Fluxos globais só mudam pelo catálogo", 403)
    await access.require(conn, str(pid), user, access.CONTROL_ROLES)
    if not active and await scalar(conn, "SELECT 1 FROM project WHERE default_template_id = CAST(:t AS uuid)", t=template_id):
        raise DomainError("Este é o fluxo padrão do projeto: escolha outro padrão antes de desativá-lo", 409)
    await fetch_one(conn, "UPDATE workflow_template SET active = :a WHERE id = CAST(:t AS uuid) RETURNING id",
                    a=active, t=template_id)
    return {"id": template_id}


# ---------------------------------------------------------------------------- avanço (curva S)
@router.get("/projects/{project_id}/progress")
async def progress(project_id: str, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    """Avanço físico da documentação: peso emitido ÷ peso total; curva S semanal planejado × realizado."""
    await access.require(conn, project_id, user)
    totals = await fetch_one(conn, """
        SELECT count(*) AS documents, coalesce(sum(weight), 0)::float8 AS weight,
               count(*) FILTER (WHERE planned_issue_date IS NOT NULL) AS planned,
               count(*) FILTER (WHERE first_issued_at IS NOT NULL) AS issued,
               coalesce(sum(weight) FILTER (WHERE first_issued_at IS NOT NULL), 0)::float8 AS issued_weight,
               coalesce(sum(weight) FILTER (WHERE planned_issue_date <= current_date), 0)::float8 AS planned_weight_to_date,
               count(*) FILTER (WHERE planned_issue_date < current_date AND first_issued_at IS NULL) AS late,
               count(*) FILTER (WHERE revision_status IN ('APROVADA','APROVADA_COM_COMENTARIOS')) AS client_approved,
               count(*) FILTER (WHERE revision_status = 'REPROVADA') AS client_rejected,
               min(planned_issue_date) AS first_planned, max(planned_issue_date) AS last_planned
          FROM v_master_list WHERE project_id = CAST(:p AS uuid)""", p=project_id)
    assert totals
    w = float(totals["weight"] or 0)
    curve = await fetch_all(conn, """
        WITH b AS (
          SELECT least(coalesce(min(planned_issue_date), current_date), coalesce(min(first_issued_at)::date, current_date),
                       current_date) AS lo,
                 greatest(coalesce(max(planned_issue_date), current_date), current_date) AS hi
            FROM v_master_list WHERE project_id = CAST(:p AS uuid)),
        -- começa uma semana antes do primeiro marco: a curva S parte de 0%
        wk AS (SELECT generate_series(date_trunc('week', b.lo) - interval '1 week', date_trunc('week', b.hi),
                                      interval '1 week')::date AS w FROM b)
        SELECT to_char(wk.w, 'YYYY-MM-DD') AS week,
               (SELECT coalesce(sum(weight), 0) FROM v_master_list v WHERE v.project_id = CAST(:p AS uuid)
                  AND v.planned_issue_date < wk.w + 7) AS planned,
               CASE WHEN wk.w <= current_date THEN
                 (SELECT coalesce(sum(weight), 0) FROM v_master_list v WHERE v.project_id = CAST(:p AS uuid)
                    AND v.first_issued_at::date < wk.w + 7) END AS actual
          FROM wk ORDER BY wk.w LIMIT 260""", p=project_id)
    by_discipline = await fetch_all(conn, """
        SELECT discipline_code AS discipline, count(*) AS documents,
               count(*) FILTER (WHERE first_issued_at IS NOT NULL) AS issued,
               count(*) FILTER (WHERE planned_issue_date < current_date AND first_issued_at IS NULL) AS late
          FROM v_master_list WHERE project_id = CAST(:p AS uuid) GROUP BY 1 ORDER BY 2 DESC""", p=project_id)
    late = await fetch_all(conn, """
        SELECT id::text, code, title, planned_issue_date, revision_label, revision_status,
               current_date - planned_issue_date AS days_late
          FROM v_master_list WHERE project_id = CAST(:p AS uuid)
           AND planned_issue_date < current_date AND first_issued_at IS NULL
         ORDER BY planned_issue_date LIMIT 25""", p=project_id)
    def pct(x: Any) -> float:
        return round(100 * float(x) / w, 1) if w else 0.0

    return {"totals": totals, "actual_pct": pct(totals["issued_weight"]), "planned_pct": pct(totals["planned_weight_to_date"]),
            "curve": [{**c, "planned": pct(c["planned"]), "actual": None if c["actual"] is None else pct(c["actual"])}
                      for c in curve],
            "by_discipline": by_discipline, "late": late}


# ---------------------------------------------------------------------------- importação da lista
_COLS = {"titulo": "title", "título": "title", "title": "title", "disciplina": "discipline_code",
         "discipline": "discipline_code", "tipo": "doc_type_code", "type": "doc_type_code", "area": "area",
         "área": "area", "emissor": "originator", "originator": "originator", "codigo": "code", "código": "code",
         "code": "code", "confidencialidade": "confidentiality", "tags": "tags",
         "data prevista": "planned_issue_date", "previsto": "planned_issue_date", "planned": "planned_issue_date",
         "peso": "weight", "weight": "weight"}
_CONF = {"PUBLICO", "INTERNO", "CONFIDENCIAL", "RESTRITO"}


def _parse_date(v: str) -> date | None:
    v = v.strip()
    if not v:
        return None
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            return date.fromisoformat(v)
        if (m := re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})", v)):
            y = int(m.group(3))
            return date(y + 2000 if y < 100 else y, int(m.group(2)), int(m.group(1)))
    except ValueError:
        pass
    raise ValueError(f"data inválida '{v}' (use DD/MM/AAAA)")


@router.post("/projects/{project_id}/import")
async def import_documents(project_id: str, conn: Conn, user: CurrentUser,
                           file: Annotated[UploadFile, File()],
                           dry_run: Annotated[bool, Form()] = True) -> dict[str, Any]:
    """Importa a lista de documentos (CSV ; ou ,). dry_run=true só valida e mostra o que seria criado.
    Tudo ou nada: com qualquer linha inválida, nada é gravado."""
    await access.require(conn, project_id, user, access.CONTROL_ROLES)
    raw = await file.read(5 * 1024 * 1024 + 1)
    if len(raw) > 5 * 1024 * 1024:
        raise DomainError("Planilha acima de 5 MB", 413)
    text = raw.decode("utf-8-sig", errors="replace")
    if not text.strip():
        raise DomainError("Arquivo vazio", 422)
    dialect = csv.Sniffer().sniff(text.splitlines()[0], delimiters=";,\t")
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    headers = {h: _COLS.get((h or "").strip().lower()) for h in (reader.fieldnames or [])}
    if not {"title", "discipline_code", "doc_type_code"} <= set(headers.values()):
        raise DomainError("Colunas obrigatórias: Título; Disciplina; Tipo (opcionais: Área; Emissor; Código; "
                          "Confidencialidade; Tags; Data prevista; Peso)", 422)
    proj = await fetch_one(conn, """SELECT code, code_mask, code_regex, default_confidentiality, retention_years,
                                           revision_scheme FROM project WHERE id = CAST(:p AS uuid)""", p=project_id)
    assert proj
    allowed_disc = {r["c"] for r in await fetch_all(conn, """SELECT discipline_code AS c FROM project_discipline
                                                             WHERE project_id = CAST(:p AS uuid)""", p=project_id)} \
        or {r["c"] for r in await fetch_all(conn, "SELECT code AS c FROM discipline")}
    types = {r["c"] for r in await fetch_all(conn, "SELECT code AS c FROM doc_type")}
    areas = {r["c"] for r in await fetch_all(conn, "SELECT code AS c FROM project_area WHERE project_id = CAST(:p AS uuid)",
                                             p=project_id)}
    existing = {r["c"] for r in await fetch_all(conn, "SELECT code AS c FROM document WHERE project_id = CAST(:p AS uuid)",
                                                p=project_id)}
    rx = re.compile(proj["code_regex"])
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    seen: set[str] = set()
    for n, line in enumerate(reader, start=2):
        r = {headers[k]: (v or "").strip() for k, v in line.items() if headers.get(k)}
        if not any(r.values()):
            continue
        errs: list[str] = []
        r["discipline_code"] = r.get("discipline_code", "").upper()
        r["doc_type_code"] = r.get("doc_type_code", "").upper()
        r["area"] = r.get("area", "").upper() or None
        if len(r.get("title", "")) < 3:
            errs.append("título curto")
        if r["discipline_code"] not in allowed_disc:
            errs.append(f"disciplina {r['discipline_code'] or '(vazia)'} não habilitada")
        if r["doc_type_code"] not in types:
            errs.append(f"tipo {r['doc_type_code'] or '(vazio)'} inexistente")
        if r["area"] and areas and r["area"] not in areas:
            errs.append(f"área {r['area']} não cadastrada")
        if "{AREA}" in proj["code_mask"] and not r["area"] and not r.get("code"):
            errs.append("a máscara exige área")
        conf = (r.get("confidentiality") or proj["default_confidentiality"]).upper()
        if conf not in _CONF:
            errs.append(f"confidencialidade {conf} inválida")
        code = (r.get("code") or "").upper() or None
        if code:
            if not rx.match(code):
                errs.append(f"código {code} fora da máscara")
            if code in existing or code in seen:
                errs.append(f"código {code} já existe")
            seen.add(code)
        try:
            planned = _parse_date(r.get("planned_issue_date", ""))
        except ValueError as e:
            errs.append(str(e))
            planned = None
        try:
            weight = float((r.get("weight") or "1").replace(",", "."))
            if weight <= 0:
                raise ValueError
        except ValueError:
            errs.append("peso inválido")
            weight = 1.0
        if errs:
            errors.append({"line": n, "title": r.get("title", ""), "errors": errs})
            continue
        rows.append({"title": r["title"], "discipline_code": r["discipline_code"], "doc_type_code": r["doc_type_code"],
                     "area": r["area"], "originator": r.get("originator") or None, "code": code, "confidentiality": conf,
                     "tags": [t.strip() for t in (r.get("tags") or "").split(",") if t.strip()],
                     "planned_issue_date": planned, "weight": weight})
    if len(rows) + len(errors) > 5000:
        raise DomainError("Limite de 5.000 linhas por importação", 413)
    if dry_run or errors:
        return {"dry_run": True, "valid": len(rows), "errors": errors,
                "preview": [{**x, "planned_issue_date": x["planned_issue_date"]} for x in rows[:20]]}
    created = []
    first = "0" if proj["revision_scheme"] == "numeric" else "A"
    for x in rows:
        code = x["code"]
        if not code:
            seq = await scalar(conn, "SELECT fn_next_doc_seq(CAST(:p AS uuid), :d, :t)",
                               p=project_id, d=x["discipline_code"], t=x["doc_type_code"])
            code = build_code(proj["code_mask"], proj=proj["code"], disc=x["discipline_code"], tipo=x["doc_type_code"],
                              seq=int(seq), area=x["area"])
        d = await fetch_one(conn, """
            INSERT INTO document (project_id, code, title, discipline_code, doc_type_code, area, originator,
                                  confidentiality, tags, metadata, created_by, planned_issue_date, weight, retention_until)
            VALUES (CAST(:p AS uuid), :c, :t, :d, :dt, :a, :o, :cf, :tags, '{}'::jsonb, CAST(:u AS uuid), :pl, :w,
                    CASE WHEN CAST(:ry AS int) IS NULL THEN NULL ELSE current_date + make_interval(years => CAST(:ry AS int)) END)
            RETURNING id::text, code""",
            p=project_id, c=code, t=x["title"], d=x["discipline_code"], dt=x["doc_type_code"], a=x["area"],
            o=x["originator"], cf=x["confidentiality"], tags=x["tags"], u=user.id, pl=x["planned_issue_date"],
            w=x["weight"], ry=proj["retention_years"])
        assert d
        await fetch_one(conn, """INSERT INTO revision (document_id, label, created_by, description)
                                 VALUES (CAST(:d AS uuid), :l, CAST(:u AS uuid), 'Emissão inicial') RETURNING id""",
                        d=d["id"], l=first, u=user.id)
        created.append(d["code"])
    return {"dry_run": False, "created": len(created), "codes": created[:50], "errors": []}


# ---------------------------------------------------------------------------- catálogo (admin)
class CatalogItem(BaseModel):
    code: str = Field(pattern=r"^[A-Z0-9]{1,4}$")
    name: str = Field(min_length=2, max_length=120)


def _admin(user: Principal) -> None:
    if not user.is_admin:
        raise DomainError("Somente administradores", 403)


@router.post("/catalog/disciplines", status_code=201)
async def add_discipline(body: CatalogItem, conn: Conn, user: CurrentUser) -> dict[str, str]:
    _admin(user)
    await fetch_one(conn, """INSERT INTO discipline (code, name) VALUES (:c, :n)
                             ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING code""",
                    c=body.code, n=body.name.strip())
    return {"code": body.code}


@router.post("/catalog/doc-types", status_code=201)
async def add_doc_type(body: CatalogItem, conn: Conn, user: CurrentUser) -> dict[str, str]:
    _admin(user)
    if len(body.code) < 2:
        raise DomainError("Tipo precisa de 2 a 4 caracteres", 422)
    await fetch_one(conn, """INSERT INTO doc_type (code, name, metadata_schema) VALUES (:c, :n, CAST(:s AS jsonb))
                             ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING code""",
                    c=body.code, n=body.name.strip(), s=json.dumps({}))
    return {"code": body.code}
