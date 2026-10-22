from dataclasses import dataclass, field


@dataclass(slots=True)
class Word:
    t: str
    x: float   # normalizado 0..1 em relação à página
    y: float
    w: float
    h: float
    c: float   # confiança 0..100

    def as_dict(self) -> dict[str, float | str]:
        return {"t": self.t, "x": round(self.x, 5), "y": round(self.y, 5),
                "w": round(self.w, 5), "h": round(self.h, 5), "c": round(self.c, 1)}


@dataclass(slots=True)
class PageResult:
    page: int
    text: str
    confidence: float | None          # None = texto nativo (sem OCR)
    words: list[Word] = field(default_factory=list)
    source: str = "texto-nativo"      # texto-nativo | tesseract | paddle


@dataclass(slots=True)
class ProcessResult:
    engine: str
    pages: list[PageResult]
    archive_pdf: bytes | None = None
    thumbnail_webp: bytes | None = None
    titleblock_text: str = ""

    @property
    def content(self) -> str:
        return "\n\f".join(p.text for p in self.pages)

    @property
    def confidence_avg(self) -> float | None:
        vals = [p.confidence for p in self.pages if p.confidence is not None]
        return round(sum(vals) / len(vals), 2) if vals else None
