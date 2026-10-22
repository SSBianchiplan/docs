import re

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError, IntegrityError

_INV = re.compile(r"(INV-[A-Z]+-\d{3}[^\n]*)")
_CONSTRAINT_MSG = {
    "uq_document_code": "INV-DOC-001: já existe documento com este código no projeto",
    "uq_revision_label": "INV-REV-001: rótulo de revisão já utilizado",
    "uq_revision_current": "INV-REV-002: o documento já tem revisão vigente",
    "uq_revision_open": "INV-REV-009: já existe revisão em andamento para este documento",
    "uq_checkout_active": "INV-CHK-001: documento já está em check-out",
    "uq_workflow_active": "Já existe workflow ativo para esta revisão",
    "ck_ai_human_gate": "INV-AI-001: a IA propõe, o humano decide — decisão humana obrigatória",
    "ck_task_decided": "INV-WF-001: decisão incompleta (reprovação exige justificativa)",
    "ck_task_assignee": "INV-WF-002: só o responsável pode decidir a tarefa",
    "ck_comment_resolved": "Resolução de comentário exige texto de resolução",
    "ck_comment_rect": "INV-CMT-001: marcação fora dos limites da página",
}


class DomainError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


def db_message(exc: DBAPIError) -> str:
    raw = str(exc.orig) if exc.orig else str(exc)
    m = _INV.search(raw)
    if m:
        return m.group(1).strip()
    for name, msg in _CONSTRAINT_MSG.items():
        if name in raw:
            return msg
    return "Operação recusada pelo banco de dados"


async def db_error_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, DBAPIError)
    status = 409 if isinstance(exc, IntegrityError) or "INV-" in str(exc.orig) else 400
    return JSONResponse({"detail": db_message(exc)}, status_code=status)


async def domain_error_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, DomainError)
    return JSONResponse({"detail": exc.message}, status_code=exc.status)
