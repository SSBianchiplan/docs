"""Leitura do carimbo (title block): propõe código, revisão, título, escala e folha.

Saída vira ai_suggestion(kind='METADADOS_CARIMBO') — nunca escreve no documento (INV-AI-001).
"""
import re
from dataclasses import dataclass

# rótulos em PT e EN (carimbos de fornecedores estrangeiros são comuns em EPC)
_REV = re.compile(r"\bREV(?:IS[AÃ]O|ISION)?\.?\s*[:\-]?\s*([0-9]{1,2}|[A-Z]{1,2})\b", re.IGNORECASE)
_SCALE = re.compile(r"\b(?:ESC(?:ALA)?|SCALE)\.?\s*[:\-]?\s*(1\s*[:/]\s*\d{1,5}|S/?\s?E|NTS|INDICADA)", re.IGNORECASE)
_SHEET = re.compile(r"\b(?:FOLHA|FL|SHEET|SH)\.?\s*[:\-]?\s*(\d{1,3}\s*(?:/|DE|OF)\s*\d{1,3})", re.IGNORECASE)
_FORMAT = re.compile(r"\b(A[0-4lI])\b")
_TITLE = re.compile(r"\b(?:T[IÍ]TULO|TITLE)\s*[:\-]?\s*(.{6,120}?)(?:\s{2,}|\s[A-Z0-9]{2,12}-[A-Z0-9]|\bREV|\bESC|\bSCALE|\bFOLHA|\bSHEET|\bDES\.|$)", re.IGNORECASE)


@dataclass(slots=True)
class TitleBlock:
    code: str | None = None
    revision: str | None = None
    title: str | None = None
    escala: str | None = None
    folha: str | None = None
    formato: str | None = None

    def found(self) -> int:
        return sum(v is not None for v in (self.code, self.revision, self.title, self.escala, self.folha))


def extract(text: str, code_regex: str) -> TitleBlock:
    flat = re.sub(r"[ \t]+", " ", text.replace("\n", "  "))
    tb = TitleBlock()
    core = code_regex.strip("^$")
    m = re.search(core, flat.upper())
    if m:
        tb.code = m.group(0)
    if (m := _REV.search(flat)):
        tb.revision = m.group(1).upper()
    if (m := _SCALE.search(flat)):
        tb.escala = re.sub(r"\s", "", m.group(1)).upper()
    if (m := _SHEET.search(flat)):
        tb.folha = re.sub(r"\s*(DE|OF)\s*", "/", m.group(1).upper()).replace(" ", "")
    if (m := _FORMAT.search(flat)):
        tb.formato = m.group(1).upper().replace("L", "1").replace("I", "1")
    if (m := _TITLE.search(flat)):
        tb.title = m.group(1).strip(" :-")
    return tb


def same_code(ocr_code: str, known: str) -> bool:
    """OCR troca O/0 e I/1 e às vezes duplica um caractere: similaridade alta = mesmo código."""
    import difflib
    norm = str.maketrans({"O": "0", "I": "1", "L": "1"})
    a, b = ocr_code.upper().translate(norm), known.upper().translate(norm)
    return a == b or difflib.SequenceMatcher(None, a, b).ratio() >= 0.88
