"""Extraction for every supported format, OCR, chunking (no LLM)."""
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFont

from backend.evaluation import ocr
from backend.rag.chunker import chunk_segments, estimate_tokens
from backend.rag.extract import Segment, extract, extract_all_text

FIX = Path(__file__).parent / "fixtures"


def make_pdf(path: Path, pages: list[str]) -> Path:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(str(path), pagesize=A4)
    for text in pages:
        y = 800
        for line in text.split("\n"):
            c.drawString(50, y, line)
            y -= 16
        c.showPage()
    c.save()
    return path


def make_text_image(path: Path, lines: list[str]) -> Path:
    img = Image.new("RGB", (1400, 120 + 70 * len(lines)), "white")
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 40)
    except OSError:
        font = ImageFont.load_default(size=40)
    for i, l in enumerate(lines):
        d.text((40, 40 + 70 * i), l, fill="black", font=font)
    img.save(path)
    return path


def test_pdf_pages_are_real(tmp_path):
    p = make_pdf(tmp_path / "s.pdf", ["Unit 1: Working Capital Management", "Unit 2: Capital Budgeting\nNPV and IRR"])
    segs = list(extract(p, "pdf"))
    assert [s.page for s in segs] == [1, 2]
    assert "Capital Budgeting" in segs[1].text


def test_docx_with_headings_and_tables(tmp_path):
    import docx

    d = docx.Document()
    d.add_heading("Financial Management", 1)
    d.add_paragraph("Ratio analysis evaluates liquidity.")
    t = d.add_table(rows=2, cols=2)
    t.cell(0, 0).text, t.cell(0, 1).text, t.cell(1, 0).text, t.cell(1, 1).text = "Ratio", "Formula", "Current", "CA/CL"
    d.save(tmp_path / "n.docx")
    segs = list(extract(tmp_path / "n.docx", "docx"))
    text = "\n".join(s.text for s in segs)
    assert segs[0].section == "Financial Management" and segs[0].page is None  # DOCX has no pages: never invented
    assert "CA/CL" in text


def test_pptx_slides(tmp_path):
    from pptx import Presentation

    prs = Presentation()
    for title in ("Marketing Mix", "4 Ps of Marketing"):
        s = prs.slides.add_slide(prs.slide_layouts[1])
        s.shapes.title.text = title
        s.placeholders[1].text = f"Content about {title}"
    prs.save(tmp_path / "m.pptx")
    segs = list(extract(tmp_path / "m.pptx", "pptx"))
    assert [s.page for s in segs] == [1, 2] and "4 Ps" in segs[1].text


def test_xlsx_csv_txt(tmp_path):
    import openpyxl

    wb = openpyxl.Workbook()
    wb.active.title = "Marks"
    wb.active.append(["Unit", "Marks"])
    wb.active.append(["Unit 1", 20])
    wb.save(tmp_path / "w.xlsx")
    assert "Unit 1 | 20" in next(extract(tmp_path / "w.xlsx", "xlsx")).text
    (tmp_path / "c.csv").write_text("topic,weight\nCosting,15\n")
    assert "Costing | 15" in next(extract(tmp_path / "c.csv", "csv")).text
    (tmp_path / "t.txt").write_bytes("Café — résumé".encode("cp1252"))
    assert "Café" in next(extract(tmp_path / "t.txt", "txt")).text


@pytest.mark.skipif(not ocr.available(), reason="Tesseract not installed")
def test_ocr_image_with_confidence(tmp_path):
    p = make_text_image(tmp_path / "a.png", ["Working capital equals", "current assets minus", "current liabilities"])
    text, conf = extract_all_text(p, "png")
    assert "current assets" in text.lower()
    assert conf is not None and conf > 50


@pytest.mark.skipif(not ocr.available(), reason="Tesseract not installed")
def test_scanned_pdf_page_triggers_ocr(tmp_path):
    img = make_text_image(tmp_path / "scan.png", ["Inventory turnover ratio", "Cost of goods sold"])
    pdf = tmp_path / "scan.pdf"
    Image.open(img).convert("RGB").save(pdf)
    segs = list(extract(pdf, "pdf"))
    assert segs[0].ocr and "inventory" in segs[0].text.lower()


def test_chunker_respects_size_overlap_and_pages():
    para = "Sentence about finance number {} explains liquidity in detail. "
    text = "\n\n".join(para.format(i) * 4 for i in range(80))
    chunks = chunk_segments([Segment(text, 3), Segment("short page", 4)], target_tokens=300, overlap_tokens=60)
    assert len(chunks) > 5
    assert all(c.tokens <= 330 for c in chunks)
    assert {c.page for c in chunks} == {3, 4}
    # overlap: the start of chunk 2 repeats the end of chunk 1
    assert chunks[1].text.split("\n\n")[0] in chunks[0].text
    assert estimate_tokens("one two three") == 4
