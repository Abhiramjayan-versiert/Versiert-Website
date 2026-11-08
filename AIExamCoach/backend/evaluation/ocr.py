"""Local OCR with Tesseract (via pytesseract). Returns text plus a mean word
confidence so callers can ask the user to verify low-confidence output."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

from PIL import Image, ImageOps

try:
    import pytesseract
except ImportError:  # pragma: no cover
    pytesseract = None  # type: ignore

_WIN_DEFAULTS = [r"C:\Program Files\Tesseract-OCR\tesseract.exe", r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"]


def tesseract_path() -> str | None:
    p = os.environ.get("TESSERACT_CMD") or shutil.which("tesseract")
    if p:
        return p
    for c in _WIN_DEFAULTS:
        if Path(c).exists():
            return c
    return None


def available() -> bool:
    return pytesseract is not None and tesseract_path() is not None


def _prep(img: Image.Image) -> Image.Image:
    img = ImageOps.exif_transpose(img)
    img = img.convert("L")
    # Upscale small photos — Tesseract works best around 300 DPI equivalents.
    if max(img.size) < 1600:
        f = 1600 / max(img.size)
        img = img.resize((int(img.width * f), int(img.height * f)))
    return ImageOps.autocontrast(img)


def ocr_image(img: Image.Image, lang: str = "eng") -> tuple[str, float]:
    if not available():
        raise RuntimeError("Tesseract OCR is not installed. Install it (see README) to read scanned/handwritten pages.")
    pytesseract.pytesseract.tesseract_cmd = tesseract_path()  # type: ignore[union-attr]
    img = _prep(img)
    data = pytesseract.image_to_data(img, lang=lang, output_type=pytesseract.Output.DICT)  # type: ignore[union-attr]
    confs = [float(c) for c, w in zip(data["conf"], data["text"]) if str(w).strip() and float(c) >= 0]
    text = pytesseract.image_to_string(img, lang=lang)  # type: ignore[union-attr]
    conf = round(sum(confs) / len(confs), 1) if confs else 0.0
    return text.strip(), conf


def ocr_file(path: Path, lang: str = "eng") -> tuple[str, float]:
    with Image.open(path) as img:
        return ocr_image(img, lang)
