"""Text extraction for PDF, DOCX, PPTX, XLSX, CSV, TXT and images.

Each extractor yields ``Segment`` objects carrying the real page / slide /
sheet location so citations are never invented. Large files are streamed
page by page (PyMuPDF) rather than loaded into memory at once."""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from backend.evaluation import ocr


@dataclass
class Segment:
    text: str
    page: int | None  # 1-based page/slide; None when the format has no pages
    section: str = ""
    ocr: bool = False
    ocr_confidence: float | None = None


def _read_text(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def page_count(path: Path, ext: str) -> int:
    if ext == "pdf":
        import fitz

        with fitz.open(path) as d:
            return d.page_count
    if ext == "pptx":
        from pptx import Presentation

        return len(Presentation(str(path)).slides)
    return 0


def extract_pdf(path: Path, lang: str = "eng", ocr_min_chars: int = 40) -> Iterator[Segment]:
    import fitz  # PyMuPDF

    with fitz.open(path) as doc:
        for i in range(doc.page_count):
            page = doc.load_page(i)
            text = page.get_text("text") or ""
            # tables → pipe-separated rows (PyMuPDF table finder)
            try:
                tabs = page.find_tables()
                for t in tabs.tables[:5]:
                    rows = t.extract()
                    if rows:
                        text += "\n[Table]\n" + "\n".join(" | ".join(str(c or "").strip() for c in r) for r in rows)
            except Exception:  # noqa: BLE001 - table detection is best-effort
                pass
            if len(text.strip()) < ocr_min_chars and ocr.available():
                pix = page.get_pixmap(dpi=200)
                from PIL import Image

                img = Image.open(io.BytesIO(pix.tobytes("png")))
                otext, conf = ocr.ocr_image(img, lang)
                yield Segment(otext, i + 1, ocr=True, ocr_confidence=conf)
            else:
                yield Segment(text, i + 1)
            del page


def extract_docx(path: Path) -> Iterator[Segment]:
    import docx

    d = docx.Document(str(path))
    section, buf = "", []
    for block in d.element.body.iterchildren():
        tag = block.tag.rsplit("}", 1)[-1]
        if tag == "p":
            from docx.text.paragraph import Paragraph

            p = Paragraph(block, d)
            style = (p.style.name if p.style is not None else "") or ""
            if style.lower().startswith("heading") and p.text.strip():
                if buf:
                    yield Segment("\n".join(buf), None, section)
                    buf = []
                section = p.text.strip()[:200]
                buf.append(p.text.strip())
            elif p.text.strip():
                buf.append(p.text.strip())
        elif tag == "tbl":
            from docx.table import Table

            t = Table(block, d)
            rows = [" | ".join(c.text.strip() for c in r.cells) for r in t.rows]
            buf.append("[Table]\n" + "\n".join(rows))
    if buf:
        yield Segment("\n".join(buf), None, section)


def extract_pptx(path: Path) -> Iterator[Segment]:
    from pptx import Presentation

    prs = Presentation(str(path))
    for i, slide in enumerate(prs.slides, 1):
        parts, title = [], ""
        for shape in slide.shapes:
            if shape.has_text_frame and shape.text_frame.text.strip():
                parts.append(shape.text_frame.text.strip())
                if not title and getattr(shape, "is_placeholder", False):
                    title = shape.text_frame.text.strip()[:120]
            if getattr(shape, "has_table", False) and shape.has_table:
                parts.append("[Table]\n" + "\n".join(" | ".join(c.text for c in r.cells) for r in shape.table.rows))
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame.text.strip():
            parts.append("Notes: " + slide.notes_slide.notes_text_frame.text.strip())
        if parts:
            yield Segment("\n".join(parts), i, title)


def extract_xlsx(path: Path) -> Iterator[Segment]:
    import openpyxl

    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    try:
        for ws in wb.worksheets:
            rows, n = [], 0
            for row in ws.iter_rows(values_only=True):
                vals = [str(v).strip() for v in row if v is not None and str(v).strip()]
                if vals:
                    rows.append(" | ".join(vals))
                    n += 1
                if len(rows) >= 200:
                    yield Segment("\n".join(rows), None, f"Sheet: {ws.title}")
                    rows = []
            if rows:
                yield Segment("\n".join(rows), None, f"Sheet: {ws.title}")
    finally:
        wb.close()


def extract_csv(path: Path) -> Iterator[Segment]:
    text = _read_text(path)
    reader = csv.reader(io.StringIO(text))
    rows = []
    for r in reader:
        if any(c.strip() for c in r):
            rows.append(" | ".join(c.strip() for c in r))
        if len(rows) >= 200:
            yield Segment("\n".join(rows), None, "CSV rows")
            rows = []
    if rows:
        yield Segment("\n".join(rows), None, "CSV rows")


def extract_txt(path: Path) -> Iterator[Segment]:
    yield Segment(_read_text(path), None)


def extract_image(path: Path, lang: str = "eng") -> Iterator[Segment]:
    text, conf = ocr.ocr_file(path, lang)
    yield Segment(text, 1, ocr=True, ocr_confidence=conf)


def extract(path: Path, ext: str, lang: str = "eng") -> Iterator[Segment]:
    if ext == "pdf":
        return extract_pdf(path, lang)
    if ext == "docx":
        return extract_docx(path)
    if ext == "pptx":
        return extract_pptx(path)
    if ext == "xlsx":
        return extract_xlsx(path)
    if ext == "csv":
        return extract_csv(path)
    if ext == "txt":
        return extract_txt(path)
    if ext in ("jpg", "jpeg", "png"):
        return extract_image(path, lang)
    raise ValueError(f"Unsupported type: {ext}")


def extract_all_text(path: Path, ext: str, lang: str = "eng") -> tuple[str, float | None]:
    """Convenience for answer sheets: whole text + lowest OCR confidence."""
    texts, confs = [], []
    for seg in extract(path, ext, lang):
        texts.append(seg.text)
        if seg.ocr_confidence is not None:
            confs.append(seg.ocr_confidence)
    return "\n\n".join(t for t in texts if t.strip()), (min(confs) if confs else None)
