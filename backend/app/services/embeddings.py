"""Embeddings locais (fastembed/ONNX, sem GPU) para busca semântica — opcional."""
from functools import lru_cache
from typing import Any

from app.core.config import get_settings


@lru_cache
def _model() -> Any:
    from fastembed import TextEmbedding
    return TextEmbedding(model_name=get_settings().embeddings_model)


def embed(texts: list[str]) -> list[list[float]]:
    return [list(map(float, v)) for v in _model().embed(texts)]


def embed_query(q: str) -> list[float]:
    return embed([q])[0]


def chunk(text: str, size: int = 900, overlap: int = 150) -> list[str]:
    text = " ".join(text.split())
    if len(text) <= size:
        return [text] if text else []
    return [text[i:i + size] for i in range(0, len(text), size - overlap)]
