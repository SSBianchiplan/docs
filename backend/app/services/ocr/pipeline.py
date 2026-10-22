"""Pipeline de extração: normaliza → detecta camada de texto → OCR só onde falta → PDF/A → miniatura.

Síncrono e CPU-bound: o worker chama via asyncio.to_thread. Nada aqui toca o banco.
"""
from __future__ import annotations

import io
import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import httpx
import numpy as np

from app.core.config import Settings
from app.services.ocr.engines import get_engine, words_to_text
from app.services.ocr.types import PageResult, ProcessResult

log = logging.getLogger(__name__)

IMAGE_MIMES = {"image/png", "image/jpeg", "image/tiff", "image/bmp", "image/webp", "image/gif"}
OFFICE_EXT = {".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".rtf", ".txt", ".csv"}
CAD_EXT = {".dwg", ".dxf", ".dgn", ".rvt", ".nwd", ".ifc", ".step", ".stp"}
# Tetos contra arquivo hostil (bomba de descompressão, página gigante): o worker processa PDF/imagem não confiável.
MAX_IMAGE_PIXELS = 120_000_000        # imagem de entrada (≈ A0 a 300 dpi em escala de cinza)
MAX_RENDER_PIXELS = 160_000_000       # bitmap de uma página no OCR; acima disso o DPI da página é reduzido
MAX_PAGE_PT = 14_400                  # 5,08 m de lado (200 pol.): maior que isso não é desenho técnico real


class Unsupported(Exception):
    """Formato sem extração de texto (ex.: CAD nativo) — status IGNORADO, não FALHOU."""


def to_pdf(data: bytes, mime: str, filename: str, s: Settings) -> bytes:
    ext = Path(filename).suffix.lower()
    if mime == "application/pdf" or ext == ".pdf":
        return data
    if ext in CAD_EXT:
        raise Unsupported("CAD nativo: anexe o PDF de plotagem para OCR e visualização")
    if mime in IMAGE_MIMES:
        import img2pdf
        from PIL import Image
        Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS    # acima de 2x isso o PIL recusa (DecompressionBombError)
        img = Image.open(io.BytesIO(data))
        if img.width * img.height > MAX_IMAGE_PIXELS:
            raise Unsupported(f"Imagem de {img.width}x{img.height} px excede o limite de {MAX_IMAGE_PIXELS // 1_000_000} MP")
        if img.mode in ("RGBA", "P", "LA") or mime in ("image/webp", "image/gif", "image/bmp"):
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="PNG")
            data = buf.getvalue()
        # imagem sem DPI (foto de celular, print) seria lida como 96 dpi e renderizada 3x maior no OCR,
        # caindo no fatiamento à toa: a página passa a ter exatamente os pixels originais na resolução do OCR
        dpi = img.info.get("dpi", (0, 0))[0] or 0
        if dpi < 150:
            return bytes(img2pdf.convert(data, layout_fun=img2pdf.get_fixed_dpi_layout_fun((s.ocr_dpi, s.ocr_dpi))))
        return bytes(img2pdf.convert(data))
    if ext in OFFICE_EXT:
        r = httpx.post(f"{s.gotenberg_url}/forms/libreoffice/convert",
                       files={"files": (filename, data)}, timeout=180)
        r.raise_for_status()
        return r.content
    raise Unsupported(f"Tipo {mime} sem extração de texto")


def _safe_scale(page: Any, scale: float) -> float:
    """Escala de renderização limitada por MAX_RENDER_PIXELS (página enorme não estoura a memória)."""
    w, h = page.get_size()
    if w <= 0 or h <= 0 or w > MAX_PAGE_PT or h > MAX_PAGE_PT:
        raise Unsupported(f"Página de {w:.0f}x{h:.0f} pt fora dos limites (máx. {MAX_PAGE_PT} pt de lado)")
    if w * h * scale * scale > MAX_RENDER_PIXELS:
        scale = (MAX_RENDER_PIXELS / (w * h)) ** 0.5
    return scale


def _render(page: Any, dpi: int) -> np.ndarray[Any, Any]:
    bmp = page.render(scale=_safe_scale(page, dpi / 72), grayscale=True)
    return np.ascontiguousarray(bmp.to_numpy())


def _titleblock_native(page: object) -> str:
    """Texto nativo do quadrante inferior direito (carimbo)."""
    w, h = page.get_size()  # type: ignore[attr-defined]
    tp = page.get_textpage()  # type: ignore[attr-defined]
    return str(tp.get_text_bounded(left=w * 0.55, bottom=0, right=w, top=h * 0.28))


def _thumbnail(pdf: object) -> bytes:
    page = pdf[0]  # type: ignore[index]
    w, _ = page.get_size()
    img = page.render(scale=_safe_scale(page, min(480 / w, 4.0))).to_pil()
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=78)
    return buf.getvalue()


def _archive(pdf_bytes: bytes, s: Settings) -> bytes | None:
    """PDF/A pesquisável via OCRmyPDF (--skip-text preserva páginas que já têm texto)."""
    with tempfile.TemporaryDirectory() as d:
        src, dst = Path(d) / "in.pdf", Path(d) / "out.pdf"
        src.write_bytes(pdf_bytes)
        base = ["ocrmypdf", "--skip-text", "--rotate-pages", "--output-type", "pdfa", "--optimize", "1",
                "-l", s.ocr_languages, "--jobs", "2", "-q",
                "--max-image-mpixels", str(MAX_RENDER_PIXELS // 1_000_000)]
        for extra in (["--deskew"], []):
            proc = subprocess.run([*base, *extra, str(src), str(dst)], capture_output=True, timeout=1800, check=False)
            if proc.returncode in (0, 6):          # 6 = já tinha texto em todas as páginas
                return dst.read_bytes() if dst.exists() else None
            log.warning("ocrmypdf rc=%s %s", proc.returncode, proc.stderr[-400:])
    return None


def process(data: bytes, mime: str, filename: str, s: Settings) -> ProcessResult:
    import pypdfium2 as pdfium

    pdf_bytes = to_pdf(data, mime, filename, s)
    pdf = pdfium.PdfDocument(pdf_bytes)
    n = len(pdf)
    if n > s.ocr_max_pages:
        raise Unsupported(f"{n} páginas excede o limite de {s.ocr_max_pages}")

    engine = get_engine(s.ocr_engine, s.ocr_languages)
    pages: list[PageResult] = []
    needed_ocr = False
    titleblock = ""
    for i in range(n):
        page = pdf[i]
        native = page.get_textpage().get_text_range().strip()
        if len(native) >= s.ocr_min_chars_per_page:
            pages.append(PageResult(i + 1, native, None, [], "texto-nativo"))
            if i == 0:
                titleblock = _titleblock_native(page)
            continue
        needed_ocr = True
        words, text = engine.recognize(_render(page, s.ocr_dpi))
        conf = round(sum(w.c for w in words) / len(words), 2) if words else 0.0
        pages.append(PageResult(i + 1, text, conf, words, engine.name))
        if i == 0:
            titleblock = words_to_text([w for w in words if w.x > 0.55 and w.y > 0.72])

    thumb = _thumbnail(pdf)
    pdf.close()
    archive = _archive(pdf_bytes, s) if (needed_ocr and s.ocr_archive_pdfa) else None
    used = engine.name if needed_ocr else "texto-nativo"
    return ProcessResult(used, pages, archive, thumb, titleblock)
