import logging
import time

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from app.core.config import get_settings

log = logging.getLogger(__name__)
_pool: ArqRedis | None = None


async def pool() -> ArqRedis:
    global _pool
    if _pool is None:
        _pool = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
    return _pool


def _slot() -> int:
    # janela de 2 min no id: evita duplicar o job, sem que um resultado antigo bloqueie o reenvio
    return int(time.time() // 120)


async def enqueue_file(file_id: str) -> None:
    """Falha de fila nunca derruba o upload: o arquivo fica PENDENTE e o sweep do worker o reenfileira.
    _defer_by dá tempo de a transação da requisição confirmar antes de o worker ler a linha."""
    try:
        await (await pool()).enqueue_job("process_file", file_id, _job_id=f"ocr:{file_id}:{_slot()}", _defer_by=2)
    except Exception as e:  # noqa: BLE001
        log.warning("fila indisponível (%s); %s será reenfileirado pelo sweep", e, file_id)


async def enqueue_comment_check(revision_id: str) -> None:
    try:
        await (await pool()).enqueue_job("check_comments", revision_id, _job_id=f"cmt:{revision_id}:{_slot()}",
                                         _defer_by=2)
    except Exception as e:  # noqa: BLE001
        log.warning("fila indisponível (%s); verificação de comentários de %s não enfileirada", e, revision_id)
