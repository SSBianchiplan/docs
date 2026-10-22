"""Fumaça do motor Tesseract com imagem sintética (pula se tesseract/opencv ausentes)."""
import shutil

import pytest

pytest.importorskip("cv2")
pytest.importorskip("pytesseract")


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="tesseract não instalado")
def test_tesseract_reconhece_texto_sintetico() -> None:
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont

    from app.services.ocr.engines import TesseractEngine, dedupe, words_to_text
    from app.services.ocr.types import Word

    img = Image.new("L", (1800, 500), 255)
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 56)
    except OSError:
        font = ImageFont.load_default()
    d.text((60, 80), "VALVE SPECIFICATION SHEET", fill=0, font=font)
    d.text((60, 240), "PRESSURE CLASS 300 FLANGE", fill=0, font=font)
    langs = "eng"
    words, text = TesseractEngine(langs).recognize(np.array(img))
    joined = text.upper()
    assert "SPECIFICATION" in joined and "FLANGE" in joined
    assert all(0 <= w.x <= 1 and 0 <= w.y <= 1 for w in words)
    assert sum(w.c for w in words) / len(words) > 70

    dup = [Word("A", 0.1, 0.1, 0.05, 0.02, 90), Word("A", 0.101, 0.1, 0.05, 0.02, 80)]
    assert len(dedupe(dup)) == 1
    assert words_to_text([Word("b", 0.5, 0.1, 0.1, 0.02, 90), Word("a", 0.1, 0.1, 0.1, 0.02, 90)]) == "a b"
