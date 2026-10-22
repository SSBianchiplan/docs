"""Blobs endereçados por SHA-256 — deduplicação natural e prova de integridade.

Dois backends com a mesma chave lógica: sistema de arquivos (padrão, volume Docker) ou S3/MinIO.
"""
import asyncio
import hashlib
import io
import os
import shutil
import tempfile
from pathlib import Path
from typing import BinaryIO

from minio import Minio
from minio.error import S3Error

from app.core.config import get_settings

_client: Minio | None = None


def client() -> Minio:
    global _client
    if _client is None:
        s = get_settings()
        _client = Minio(s.s3_endpoint, access_key=s.s3_access_key, secret_key=s.s3_secret_key,
                        secure=s.s3_secure)
        if not _client.bucket_exists(s.s3_bucket):
            _client.make_bucket(s.s3_bucket)
    return _client


def key_for(sha256: str) -> str:
    return f"blobs/{sha256[:2]}/{sha256[2:4]}/{sha256}"


def sha256_file(fp: BinaryIO) -> tuple[str, int]:
    h = hashlib.sha256()
    size = 0
    fp.seek(0)
    for chunk in iter(lambda: fp.read(1024 * 1024), b""):
        h.update(chunk)
        size += len(chunk)
    fp.seek(0)
    return h.hexdigest(), size


def _fs() -> bool:
    return get_settings().storage_backend == "fs"


def _path(key: str) -> Path:
    root = Path(get_settings().storage_dir).resolve()
    p = (root / key).resolve()
    if root not in p.parents:
        raise ValueError("chave de armazenamento inválida")
    return p


def _fs_put(key: str, fp: BinaryIO) -> None:
    dst = _path(key)
    dst.parent.mkdir(parents=True, exist_ok=True)
    # grava em arquivo temporário e renomeia: leitor nunca vê blob pela metade
    fd, tmp = tempfile.mkstemp(dir=dst.parent, prefix=".up-")
    try:
        with os.fdopen(fd, "wb") as out:
            fp.seek(0)
            shutil.copyfileobj(fp, out, 1024 * 1024)
        os.replace(tmp, dst)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


async def put(key: str, fp: BinaryIO, size: int, mime: str) -> None:
    if _fs():
        await asyncio.to_thread(_fs_put, key, fp)
        return
    s = get_settings()
    await asyncio.to_thread(client().put_object, s.s3_bucket, key, fp, size, content_type=mime)


async def put_bytes(key: str, data: bytes, mime: str) -> None:
    await put(key, io.BytesIO(data), len(data), mime)


async def get_bytes(key: str) -> bytes:
    if _fs():
        return await asyncio.to_thread(_path(key).read_bytes)
    s = get_settings()

    def _get() -> bytes:
        r = client().get_object(s.s3_bucket, key)
        try:
            return bytes(r.read())
        finally:
            r.close()
            r.release_conn()

    return await asyncio.to_thread(_get)


async def exists(key: str) -> bool:
    if _fs():
        return await asyncio.to_thread(_path(key).is_file)
    s = get_settings()
    try:
        await asyncio.to_thread(client().stat_object, s.s3_bucket, key)
        return True
    except S3Error:
        return False
