"""Extracción ligera de texto/tablas de documentos para RAG (poca RAM)."""

from __future__ import annotations

import csv
import io
import re
from pathlib import Path
from typing import Any


def extract_document(data: bytes, filename: str) -> dict[str, Any]:
    name = filename or "documento"
    suffix = Path(name).suffix.lower()
    if not data:
        return {"ok": False, "error": "Archivo vacío."}
    if len(data) > 12_000_000:
        return {"ok": False, "error": "El archivo supera 12 MB."}

    try:
        if suffix == ".pdf":
            text = extract_pdf(data)
        elif suffix == ".docx":
            text = extract_docx(data)
        elif suffix in {".xlsx", ".xls"}:
            text = extract_xlsx(data)
        elif suffix == ".csv":
            text = extract_csv(data)
        elif suffix in {".txt", ".md", ".markdown"}:
            text = data.decode("utf-8", errors="replace")
        else:
            return {
                "ok": False,
                "error": f"Formato no soportado ({suffix or 'sin extensión'}). Usa pdf, docx, xlsx, csv, txt o md.",
            }
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "error": str(error)}

    cleaned = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(cleaned) < 20:
        return {"ok": False, "error": "No extraje texto útil del archivo."}
    return {
        "ok": True,
        "title": Path(name).stem[:160] or "Documento",
        "filename": name,
        "text": cleaned[:40_000],
        "chars": len(cleaned),
    }


def extract_pdf(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages: list[str] = []
    for page in reader.pages[:30]:
        pages.append(page.extract_text() or "")
    return "\n\n".join(pages)


def extract_docx(data: bytes) -> str:
    from docx import Document

    document = Document(io.BytesIO(data))
    parts: list[str] = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
    for table in document.tables[:20]:
        parts.append(table_to_markdown([[cell.text.strip() for cell in row.cells] for row in table.rows]))
    return "\n\n".join(parts)


def extract_xlsx(data: bytes) -> str:
    from openpyxl import load_workbook

    workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    chunks: list[str] = []
    for sheet in workbook.worksheets[:5]:
        rows: list[list[str]] = []
        for index, row in enumerate(sheet.iter_rows(values_only=True)):
            if index >= 80:
                break
            rows.append(["" if cell is None else str(cell) for cell in row])
        if rows:
            chunks.append(f"## Hoja: {sheet.title}\n\n{table_to_markdown(rows)}")
    workbook.close()
    return "\n\n".join(chunks)


def extract_csv(data: bytes) -> str:
    text = data.decode("utf-8", errors="replace")
    reader = csv.reader(io.StringIO(text))
    rows = [[cell for cell in row] for index, row in enumerate(reader) if index < 120]
    return table_to_markdown(rows)


def table_to_markdown(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    header = normalized[0]
    body = normalized[1:] if len(normalized) > 1 else []
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(["---"] * width) + " |",
    ]
    for row in body:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)
