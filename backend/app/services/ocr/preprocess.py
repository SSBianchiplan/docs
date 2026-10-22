"""Pré-processamento de imagem para OCR (OpenCV).

Escolhas: correção de inclinação por ângulo dominante dos traços de texto, CLAHE para scans
desbotados, remoção de ruído só quando o fundo é ruidoso (desenho limpo perde traço fino com
denoise agressivo) e binarização adaptativa. Desenhos técnicos NÃO são binarizados por padrão:
linhas de cota e hachuras viram ruído de texto quando binarizadas.
"""
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

Img = NDArray[Any]


def to_gray(img: Img) -> Img:
    if img.ndim == 3:
        return cv2.cvtColor(img, cv2.COLOR_RGB2GRAY if img.shape[2] == 3 else cv2.COLOR_RGBA2GRAY)
    return img


def estimate_skew(gray: Img) -> float:
    """Ângulo em graus (−15..15). Usa minAreaRect sobre pixels de tinta de uma versão reduzida."""
    small = cv2.resize(gray, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA) if gray.shape[1] > 2000 else gray
    thr = cv2.threshold(small, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    thr = cv2.morphologyEx(thr, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (15, 3)))
    coords = np.column_stack(np.where(thr > 0))
    if len(coords) < 500:
        return 0.0
    angle = float(cv2.minAreaRect(coords.astype(np.float32))[-1])
    angle = angle - 90 if angle > 45 else angle
    return angle if abs(angle) <= 15 else 0.0


def rotate(gray: Img, angle: float) -> Img:
    if abs(angle) < 0.15:
        return gray
    h, w = gray.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(gray, m, (w, h), flags=cv2.INTER_CUBIC, borderValue=255)


def noise_level(gray: Img) -> float:
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def prepare(img: Img, *, drawing: bool = False) -> Img:
    gray = to_gray(img)
    gray = rotate(gray, estimate_skew(gray))
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    if drawing:
        return gray
    if noise_level(gray) > 1500:          # scan granulado / fax
        gray = cv2.fastNlMeansDenoising(gray, None, h=12, templateWindowSize=7, searchWindowSize=21)
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15)


def looks_like_drawing(gray: Img) -> bool:
    """Heurística: formato grande e alta densidade de linhas longas retas → desenho técnico."""
    h, w = gray.shape[:2]
    if max(h, w) / max(1, min(h, w)) > 1.25 and max(h, w) > 4500:
        return True
    small = cv2.resize(gray, (1000, int(1000 * h / w))) if w > 1000 else gray
    edges = cv2.Canny(small, 50, 150)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=120, minLineLength=small.shape[1] // 6, maxLineGap=4)
    return lines is not None and len(lines) > 60


TILE_OVERLAP = 800   # > largura de uma palavra longa em prancha a 300 dpi; o núcleo de cada fatia evita duplicar


def tiles(shape: tuple[int, ...], size: int = 3200, overlap: int = TILE_OVERLAP) -> list[tuple[int, int, int, int]]:
    """Janelas (x, y, w, h) sobrepostas para OCR de pranchas grandes (A1/A0 a 300 dpi)."""
    h, w = shape[:2]
    out = []
    step = size - overlap
    for y in range(0, max(1, h - overlap), step):
        for x in range(0, max(1, w - overlap), step):
            out.append((x, y, min(size, w - x), min(size, h - y)))
    return out
