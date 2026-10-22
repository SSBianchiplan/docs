"""Motores de OCR plugáveis. Contrato: imagem (ndarray) → palavras normalizadas + confiança."""
from __future__ import annotations

import logging
from typing import Protocol

import numpy as np

from app.services.ocr import preprocess
from app.services.ocr.types import Word

log = logging.getLogger(__name__)

TILE_THRESHOLD_PX = 25_000_000   # acima disso (≈A2 a 300 dpi) a página é fatiada


class OcrEngine(Protocol):
    name: str

    def recognize(self, img: np.ndarray) -> tuple[list[Word], str]: ...


def _iou(a: Word, b: Word) -> float:
    ix = max(0.0, min(a.x + a.w, b.x + b.w) - max(a.x, b.x))
    iy = max(0.0, min(a.y + a.h, b.y + b.h) - max(a.y, b.y))
    inter = ix * iy
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union > 0 else 0.0


def dedupe(words: list[Word]) -> list[Word]:
    """Remove palavras duplicadas na sobreposição entre fatias, mantendo a de maior confiança."""
    words = sorted(words, key=lambda w: -w.c)
    kept: list[Word] = []
    for w in words:
        if not any(k.t == w.t and _iou(k, w) > 0.4 for k in kept):
            kept.append(w)
    return kept


def words_to_text(words: list[Word]) -> str:
    """Reconstrói linhas por proximidade vertical (ordem de leitura esquerda→direita, cima→baixo)."""
    if not words:
        return ""
    ws = sorted(words, key=lambda w: (w.y + w.h / 2, w.x))
    lines: list[list[Word]] = []
    for w in ws:
        cy = w.y + w.h / 2
        if lines:
            last = lines[-1]
            ly = sum(x.y + x.h / 2 for x in last) / len(last)
            lh = sum(x.h for x in last) / len(last)
            if abs(cy - ly) < lh * 0.6:
                last.append(w)
                continue
        lines.append([w])
    return "\n".join(" ".join(x.t for x in sorted(line, key=lambda k: k.x)) for line in lines)


class TesseractEngine:
    name = "tesseract"

    def __init__(self, languages: str = "por+eng") -> None:
        import pytesseract
        self._t = pytesseract
        self.languages = languages

    def _osd_rotate(self, gray: np.ndarray) -> np.ndarray:
        try:
            osd = self._t.image_to_osd(gray, config="--psm 0", output_type=self._t.Output.DICT)
            rot = int(osd.get("rotate", 0))
            if rot and float(osd.get("orientation_conf", 0)) > 2.0:
                k = {90: -1, 180: 2, 270: 1}.get(rot, 0)
                return np.ascontiguousarray(np.rot90(gray, k))
        except self._t.TesseractError:
            pass
        return gray

    def _data(self, img: np.ndarray, psm: int, ox: int, oy: int, W: int, H: int) -> list[Word]:
        d = self._t.image_to_data(img, lang=self.languages, config=f"--oem 1 --psm {psm}",
                                  output_type=self._t.Output.DICT)
        out: list[Word] = []
        for i, txt in enumerate(d["text"]):
            t = (txt or "").strip()
            conf = float(d["conf"][i])
            if not t or conf < 0:
                continue
            out.append(Word(t, (d["left"][i] + ox) / W, (d["top"][i] + oy) / H,
                            d["width"][i] / W, d["height"][i] / H, conf))
        return out

    def recognize(self, img: np.ndarray) -> tuple[list[Word], str]:
        gray = preprocess.to_gray(img)
        gray = self._osd_rotate(gray)
        drawing = preprocess.looks_like_drawing(gray)
        prepared = preprocess.prepare(gray, drawing=drawing)
        H, W = prepared.shape[:2]
        if H * W > TILE_THRESHOLD_PX:
            words: list[Word] = []
            half = preprocess.TILE_OVERLAP // 2
            for x, y, w, h in preprocess.tiles(prepared.shape):
                # núcleo da fatia: cada palavra pertence só à fatia que contém o seu centro,
                # o que elimina a palavra cortada na borda (a vizinha a lê inteira)
                x0 = (x + half) / W if x > 0 else 0.0
                y0 = (y + half) / H if y > 0 else 0.0
                x1 = (x + w - half) / W if x + w < W else 1.0
                y1 = (y + h - half) / H if y + h < H else 1.0
                words += [wd for wd in self._data(prepared[y:y + h, x:x + w], 11, x, y, W, H)
                          if x0 <= wd.x + wd.w / 2 < x1 and y0 <= wd.y + wd.h / 2 < y1]
            words = dedupe(words)
        else:
            # passada 1: layout de página; passada 2 (texto esparso) se a primeira for pobre
            words = self._data(prepared, 3, 0, 0, W, H)
            mean = sum(w.c for w in words) / len(words) if words else 0.0
            if drawing or len(words) < 25 or mean < 60:
                alt = self._data(prepared, 11, 0, 0, W, H)
                alt_mean = sum(w.c for w in alt) / len(alt) if alt else 0.0
                if len(alt) * alt_mean > len(words) * mean:
                    words = alt
        return words, words_to_text(words)


class PaddleEngine:
    """PaddleOCR (PP-OCRv5). Melhor em tabelas e texto rotacionado; exige extra [paddle]."""
    name = "paddle"

    def __init__(self, lang: str = "pt") -> None:
        from paddleocr import PaddleOCR
        self._ocr = PaddleOCR(lang=lang, use_doc_orientation_classify=True, use_doc_unwarping=False,
                              use_textline_orientation=True)

    def recognize(self, img: np.ndarray) -> tuple[list[Word], str]:
        H, W = img.shape[:2]
        rgb = img if img.ndim == 3 else np.stack([img] * 3, axis=-1)
        res = self._ocr.predict(rgb)
        words: list[Word] = []
        for r in res or []:
            data = r.json.get("res", r.json) if hasattr(r, "json") else r
            for txt, score, poly in zip(data.get("rec_texts", []), data.get("rec_scores", []),
                                        data.get("rec_polys", []), strict=False):
                xs = [p[0] for p in poly]
                ys = [p[1] for p in poly]
                words.append(Word(str(txt), min(xs) / W, min(ys) / H, (max(xs) - min(xs)) / W,
                                  (max(ys) - min(ys)) / H, float(score) * 100))
        return words, words_to_text(words)


_engines: dict[str, OcrEngine] = {}


def get_engine(name: str, languages: str) -> OcrEngine:
    """Motor configurado com fallback para Tesseract se o extra não estiver instalado."""
    if name not in _engines:
        try:
            _engines[name] = PaddleEngine() if name == "paddle" else TesseractEngine(languages)
        except ImportError:
            log.warning("motor %s indisponível; usando tesseract", name)
            _engines[name] = TesseractEngine(languages)
    return _engines[name]
