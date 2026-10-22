"""Codificação de documentos a partir da máscara do projeto (ex.: {PROJ}-{DISC}-{TIPO}-{SEQ:4}).

Funções puras: a mesma máscara gera o código e a regex gravada em project.code_regex,
que o banco usa para validar (INV-DOC-002). Uma única fonte, duas projeções.
"""
import re

_TOKEN = re.compile(r"\{(PROJ|DISC|TIPO|AREA|SEQ)(?::(\d))?\}")
_TOKEN_RX = {"PROJ": "[A-Z0-9]{2,12}", "DISC": "[A-Z0-9]{1,4}", "TIPO": "[A-Z0-9]{2,4}",
             "AREA": "[A-Z0-9]{1,6}"}


class MaskError(ValueError):
    pass


def validate_mask(mask: str) -> None:
    tokens = [m.group(1) for m in _TOKEN.finditer(mask)]
    if "SEQ" not in tokens:
        raise MaskError("A máscara DEVE conter {SEQ:n}")
    if len(tokens) != len(set(tokens)):
        raise MaskError("Token repetido na máscara")
    literal = _TOKEN.sub("", mask)
    if not re.fullmatch(r"[A-Z0-9\-_.]*", literal):
        raise MaskError("Literais permitidos: A-Z, 0-9, '-', '_' e '.'")


def mask_to_regex(mask: str) -> str:
    validate_mask(mask)
    out, pos = [], 0
    for m in _TOKEN.finditer(mask):
        out.append(re.escape(mask[pos:m.start()]))
        tok, width = m.group(1), m.group(2)
        out.append(f"[0-9]{{{width or 4}}}" if tok == "SEQ" else _TOKEN_RX[tok])
        pos = m.end()
    out.append(re.escape(mask[pos:]))
    return "^" + "".join(out) + "$"


def build_code(mask: str, *, proj: str, disc: str, tipo: str, seq: int, area: str | None = None) -> str:
    validate_mask(mask)
    values = {"PROJ": proj, "DISC": disc, "TIPO": tipo, "AREA": area or ""}

    def repl(m: re.Match[str]) -> str:
        tok, width = m.group(1), m.group(2)
        if tok == "SEQ":
            w = int(width or 4)
            if seq >= 10 ** w:
                raise MaskError(f"Sequencial {seq} excede {w} dígitos")
            return str(seq).zfill(w)
        if tok == "AREA" and not area:
            raise MaskError("A máscara exige {AREA}")
        return values[tok]

    return _TOKEN.sub(repl, mask)


_REV_NEXT = re.compile(r"^([0-9]{1,2}|[A-Z]{1,2})$")


def next_revision_label(current: str | None, scheme: str = "auto") -> str:
    """Letras (A, B, …, Z, AA) antes de emissão para construção; números (0, 1, 2…) depois."""
    if current is None:
        return "0" if scheme == "numeric" else "A"
    if not _REV_NEXT.match(current):
        raise ValueError(f"Rótulo de revisão inválido: {current}")
    if current.isdigit():
        return str(int(current) + 1)
    if current == "Z":
        return "AA"
    if len(current) == 2:
        a, b = current[0], current[1]
        return a + chr(ord(b) + 1) if b != "Z" else chr(ord(a) + 1) + "A"
    return chr(ord(current) + 1)
