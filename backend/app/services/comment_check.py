"""Verificação de atendimento de comentários entre revisões (inspirado no recurso de IA do Greendocs).

Compara o texto da revisão anterior com o da nova e, para cada comentário ABERTO da anterior,
estima se a alteração pedida aparece. O resultado é sempre PROPOSTA (INV-AI-001).
Motor 1: heurística de diff lexical (sempre disponível). Motor 2: Claude (se houver API key).
"""
from __future__ import annotations

import difflib
import json
import logging
import re
import unicodedata
from dataclasses import dataclass

log = logging.getLogger(__name__)

_STOP = frozenset({
    "a", "o", "e", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas", "um", "uma", "para", "por", "com", "sem", "que", "se", "ao", "aos", "ou", "como", "mais", "menos", "ser", "deve", "devem", "favor", "verificar", "revisar", "corrigir", "incluir", "alterar", "conforme",
    "the", "and", "of", "to", "in", "for",
})


@dataclass(slots=True)
class Verdict:
    comment_id: str
    attended: bool
    confidence: float
    evidence: str
    engine: str


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def _terms(s: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9][a-z0-9\-/.,]{2,}", _norm(s)) if t not in _STOP}


def diff_lines(old: str, new: str, limit: int = 400) -> tuple[list[str], list[str]]:
    sm = difflib.unified_diff(old.splitlines(), new.splitlines(), lineterm="", n=0)
    added, removed = [], []
    for ln in sm:
        if ln.startswith("+") and not ln.startswith("+++"):
            added.append(ln[1:])
        elif ln.startswith("-") and not ln.startswith("---"):
            removed.append(ln[1:])
    return added[:limit], removed[:limit]


def heuristic(comments: list[dict[str, str]], old: str, new: str) -> list[Verdict]:
    added, removed = diff_lines(old, new)
    added_terms = _terms(" ".join(added))
    removed_terms = _terms(" ".join(removed))
    out = []
    for c in comments:
        terms = _terms(c["body"])
        if not terms:
            continue
        hits = terms & (added_terms | removed_terms)
        score = len(hits) / len(terms)
        if score >= 0.34:
            ev = next((a for a in added if _terms(a) & hits), ", ".join(sorted(hits)))
            out.append(Verdict(c["id"], True, round(min(0.6, 0.25 + score * 0.4), 3),
                               ev[:300], "heuristica-diff-v1"))
    return out


def with_claude(comments: list[dict[str, str]], old: str, new: str, api_key: str, model: str) -> list[Verdict]:
    import anthropic
    added, removed = diff_lines(old, new, limit=250)
    prompt = (
        "Você verifica se comentários de revisão de um documento técnico de engenharia foram atendidos "
        "na nova revisão. Responda SOMENTE um array JSON: "
        '[{"id": "...", "attended": true|false, "confidence": 0..1, "evidence": "trecho curto"}]. '
        "Seja conservador: sem evidência textual clara, attended=false.\n\n"
        f"COMENTÁRIOS:\n{json.dumps(comments, ensure_ascii=False)}\n\n"
        "LINHAS ADICIONADAS NA NOVA REVISÃO:\n" + "\n".join(added) +
        "\n\nLINHAS REMOVIDAS:\n" + "\n".join(removed))
    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(model=model, max_tokens=2000,
                                 messages=[{"role": "user", "content": prompt}])
    raw = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    raw = re.sub(r"```json|```", "", raw).strip()
    items = json.loads(raw)
    valid = {c["id"] for c in comments}
    return [Verdict(str(i["id"]), True, float(i.get("confidence", 0.5)), str(i.get("evidence", ""))[:300],
                    f"claude:{model}")
            for i in items if i.get("attended") and str(i.get("id")) in valid]


def check(comments: list[dict[str, str]], old: str, new: str, api_key: str | None, model: str) -> list[Verdict]:
    if not comments or not new.strip():
        return []
    if api_key:
        try:
            return with_claude(comments, old, new, api_key, model)
        except Exception as e:  # noqa: BLE001 — falha do provedor cai para heurística, registrada
            log.warning("verificação via Claude falhou (%s); usando heurística", e)
    return heuristic(comments, old, new)
