# -*- coding: utf-8 -*-
"""
VS AI — Document & Spreadsheet Generator Suite
Generates high-fidelity Microsoft Word (.docx) documents and Microsoft Excel (.xlsx) workbooks
with professional styling, typography, structured tables, formulas, and branding.
"""

import os
import re
import time
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple

APP_ROOT = Path(__file__).resolve().parent
DEFAULT_EXPORTS_DIR = APP_ROOT / "data" / "ai_exports"


def ensure_export_dir(output_dir: Optional[Path] = None) -> Path:
    target = output_dir or DEFAULT_EXPORTS_DIR
    target.mkdir(parents=True, exist_ok=True)
    return target


def parse_markdown_tables(content: str) -> List[Dict[str, Any]]:
    """Extracts all Markdown tables from text content."""
    tables = []
    lines = content.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("|") and line.endswith("|") and i + 1 < len(lines):
            next_line = lines[i + 1].strip()
            # Check for delimiter row: |---|---|
            if next_line.startswith("|") and re.match(r'^\|[\s\-:|]+\|$', next_line):
                # Header row
                raw_headers = [c.strip() for c in line.split("|")[1:-1]]
                # Alignments from delimiter
                raw_delims = [c.strip() for c in next_line.split("|")[1:-1]]
                alignments = []
                for d in raw_delims:
                    if d.startswith(":") and d.endswith(":"):
                        alignments.append("center")
                    elif d.endswith(":"):
                        alignments.append("right")
                    else:
                        alignments.append("left")

                rows = []
                j = i + 2
                while j < len(lines):
                    row_line = lines[j].strip()
                    if row_line.startswith("|") and row_line.endswith("|"):
                        row_cells = [c.strip() for c in row_line.split("|")[1:-1]]
                        # Ensure cell count matches header
                        if len(row_cells) < len(raw_headers):
                            row_cells.extend([""] * (len(raw_headers) - len(row_cells)))
                        rows.append(row_cells[:len(raw_headers)])
                        j += 1
                    else:
                        break

                if rows:
                    tables.append({
                        "headers": raw_headers,
                        "alignments": alignments,
                        "rows": rows
                    })
                i = j
                continue
        i += 1
    return tables


def clean_number_value(val_str: str) -> Tuple[Any, Optional[str]]:
    """Attempts to parse string as float, integer, currency, or percentage."""
    s = val_str.strip().replace(",", "")
    # Check for Currency (Rs, INR, ₹)
    is_currency = False
    if s.startswith("₹") or s.startswith("Rs.") or s.startswith("Rs ") or s.startswith("INR"):
        is_currency = True
        s = re.sub(r'^(?:₹|Rs\.?|INR)\s*', '', s).strip()

    # Percentage
    if s.endswith("%"):
        try:
            num = float(s[:-1].strip())
            return num / 100.0, "0.0%"
        except ValueError:
            pass

    # Float / Int
    try:
        if "." in s:
            num = float(s)
            fmt = "₹ #,##0.00" if is_currency else "#,##0.00"
            return num, fmt
        else:
            num = int(s)
            fmt = "₹ #,##0" if is_currency else "#,##0"
            return num, fmt
    except ValueError:
        pass

    return val_str, None


# ============================================================
# 1. MICROSOFT WORD (.DOCX) GENERATOR
# ============================================================

def export_ai_document_docx(
    title: str,
    content: str,
    client_name: Optional[str] = None,
    output_dir: Optional[Path] = None,
    font_name: str = "Calibri",
    citations: Optional[List[Any]] = None,
    **kwargs
) -> Dict[str, Any]:
    """Generates an executive, beautifully formatted Microsoft Word document (.docx)."""
    try:
        import docx
        from docx.shared import Inches, Pt, RGBColor
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
        from docx.oxml import parse_xml, OxmlElement
        from docx.oxml.ns import nsdecls, qn
    except ImportError:
        return {"ok": False, "error": "python-docx library is not installed."}

    out_dir = ensure_export_dir(output_dir)
    safe_title = re.sub(r'[\\/*?:"<>|]', '_', title)[:40].strip() or "Advisory_Document"
    filename = f"VS_AI_{safe_title}_{int(time.time())}.docx"
    docx_path = out_dir / filename

    doc = docx.Document()

    # Page Margins: 1 inch standard
    for sec in doc.sections:
        sec.top_margin = Inches(1.0)
        sec.bottom_margin = Inches(1.0)
        sec.left_margin = Inches(1.0)
        sec.right_margin = Inches(1.0)

    # Palette
    COLOR_PRIMARY = RGBColor(30, 58, 138)    # Deep Navy #1E3A8A
    COLOR_ACCENT = RGBColor(37, 99, 235)     # Royal Blue #2563EB
    COLOR_TEXT = RGBColor(15, 23, 42)        # Slate Dark #0F172A
    COLOR_MUTED = RGBColor(100, 116, 139)    # Slate Muted #64748B

    # Document Header / Brand Badge
    p_badge = doc.add_paragraph()
    p_badge.paragraph_format.space_after = Pt(2)
    p_badge.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run_badge = p_badge.add_run("VS DATABASE • PRACTICE AI REPORT")
    run_badge.font.name = font_name
    run_badge.font.size = Pt(8.5)
    run_badge.font.bold = True
    run_badge.font.color.rgb = COLOR_ACCENT

    # Main Title
    p_title = doc.add_paragraph()
    p_title.paragraph_format.space_before = Pt(4)
    p_title.paragraph_format.space_after = Pt(4)
    run_title = p_title.add_run(title)
    run_title.font.name = font_name
    run_title.font.size = Pt(20)
    run_title.font.bold = True
    run_title.font.color.rgb = COLOR_PRIMARY

    # Metadata Row (Client, Date, Version)
    p_meta = doc.add_paragraph()
    p_meta.paragraph_format.space_after = Pt(14)
    meta_runs = [
        f"Date: {datetime.now().strftime('%d %B %Y')}",
        f"Client: {client_name or 'General Advisory'}",
        "Engine: VS AI Statutory Copilot"
    ]
    run_meta = p_meta.add_run("   |   ".join(meta_runs))
    run_meta.font.name = font_name
    run_meta.font.size = Pt(9.5)
    run_meta.font.color.rgb = COLOR_MUTED

    # Decorative Divider Line
    p_div = doc.add_paragraph()
    p_div.paragraph_format.space_after = Pt(12)
    p_div_border = parse_xml(f'<w:pBdr {nsdecls("w")}><w:bottom w:val="single" w:sz="12" w:space="1" w:color="2563EB"/></w:pBdr>')
    p_div._p.get_or_add_pPr().append(p_div_border)

    # Parse and render body lines
    lines = content.splitlines()
    i = 0
    in_table = False

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Check for Markdown Table Start
        if stripped.startswith("|") and stripped.endswith("|") and i + 1 < len(lines):
            next_line = lines[i + 1].strip()
            if next_line.startswith("|") and re.match(r'^\|[\s\-:|]+\|$', next_line):
                # Parse full table
                table_lines = [stripped, next_line]
                j = i + 2
                while j < len(lines) and lines[j].strip().startswith("|") and lines[j].strip().endswith("|"):
                    table_lines.append(lines[j].strip())
                    j += 1
                
                table_data = parse_markdown_tables("\n".join(table_lines))
                if table_data:
                    tbl_info = table_data[0]
                    hdrs = tbl_info["headers"]
                    rows = tbl_info["rows"]

                    word_table = doc.add_table(rows=len(rows) + 1, cols=len(hdrs))
                    word_table.alignment = WD_TABLE_ALIGNMENT.CENTER
                    word_table.autofit = True

                    # Header Row
                    hdr_row = word_table.rows[0]
                    for col_idx, h_text in enumerate(hdrs):
                        cell = hdr_row.cells[col_idx]
                        cell.text = h_text
                        shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="2563EB"/>')
                        cell._tc.get_or_add_tcPr().append(shd)
                        # Font styling
                        for cp in cell.paragraphs:
                            cp.paragraph_format.space_before = Pt(4)
                            cp.paragraph_format.space_after = Pt(4)
                            for cr in cp.runs:
                                cr.font.name = font_name
                                cr.font.size = Pt(10)
                                cr.font.bold = True
                                cr.font.color.rgb = RGBColor(255, 255, 255)

                    # Data Rows
                    for row_idx, r_cells in enumerate(rows):
                        r_row = word_table.rows[row_idx + 1]
                        is_even = (row_idx % 2 == 1)
                        for col_idx, cell_val in enumerate(r_cells):
                            cell = r_row.cells[col_idx]
                            cell.text = cell_val
                            if is_even:
                                shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="F8FAFC"/>')
                                cell._tc.get_or_add_tcPr().append(shd)
                            for cp in cell.paragraphs:
                                cp.paragraph_format.space_before = Pt(3)
                                cp.paragraph_format.space_after = Pt(3)
                                for cr in cp.runs:
                                    cr.font.name = font_name
                                    cr.font.size = Pt(9.5)
                                    cr.font.color.rgb = COLOR_TEXT

                    doc.add_paragraph().paragraph_format.space_after = Pt(8)
                i = j
                continue

        # Headings
        if stripped.startswith("# "):
            h = doc.add_paragraph()
            h.paragraph_format.space_before = Pt(14)
            h.paragraph_format.space_after = Pt(4)
            hr = h.add_run(stripped[2:])
            hr.font.name = font_name
            hr.font.size = Pt(15)
            hr.font.bold = True
            hr.font.color.rgb = COLOR_PRIMARY
        elif stripped.startswith("## "):
            h = doc.add_paragraph()
            h.paragraph_format.space_before = Pt(12)
            h.paragraph_format.space_after = Pt(4)
            hr = h.add_run(stripped[3:])
            hr.font.name = font_name
            hr.font.size = Pt(13)
            hr.font.bold = True
            hr.font.color.rgb = COLOR_ACCENT
        elif stripped.startswith("### "):
            h = doc.add_paragraph()
            h.paragraph_format.space_before = Pt(10)
            h.paragraph_format.space_after = Pt(3)
            hr = h.add_run(stripped[4:])
            hr.font.name = font_name
            hr.font.size = Pt(11.5)
            hr.font.bold = True
            hr.font.color.rgb = COLOR_TEXT

        # Callouts (> ...)
        elif stripped.startswith("> "):
            callout_text = stripped[2:]
            cp = doc.add_paragraph()
            cp.paragraph_format.left_indent = Inches(0.25)
            cp.paragraph_format.space_before = Pt(4)
            cp.paragraph_format.space_after = Pt(6)
            # Add left border
            bdr = parse_xml(f'<w:pBdr {nsdecls("w")}><w:left w:val="single" w:sz="18" w:space="8" w:color="3B82F6"/></w:pBdr>')
            cp._p.get_or_add_pPr().append(bdr)
            shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="EFF6FF"/>')
            cp._p.get_or_add_pPr().append(shd)
            cr = cp.add_run(callout_text)
            cr.font.name = font_name
            cr.font.size = Pt(9.5)
            cr.font.italic = True
            cr.font.color.rgb = RGBColor(30, 58, 138)

        # Bullet List Items
        elif stripped.startswith("- ") or stripped.startswith("* ") or re.match(r'^\d+\.\s+', stripped):
            bp = doc.add_paragraph(style='List Bullet' if not re.match(r'^\d+\.\s+', stripped) else 'List Number')
            bp.paragraph_format.space_after = Pt(3)
            item_text = re.sub(r'^(?:[-*]|\d+\.)\s+', '', stripped)
            _render_markdown_runs(bp, item_text, font_name, COLOR_TEXT)

        # Regular Paragraph
        elif stripped:
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(6)
            p.paragraph_format.line_spacing = 1.15
            _render_markdown_runs(p, stripped, font_name, COLOR_TEXT)

        i += 1

    # Citations / References Section
    if citations:
        c_head = doc.add_heading("Statutory Authorities & Citations", level=2)
        c_head.paragraph_format.space_before = Pt(14)
        c_head.paragraph_format.space_after = Pt(6)
        if hasattr(c_head, 'runs') and c_head.runs:
            c_head.runs[0].font.name = font_name
            c_head.runs[0].font.color.rgb = COLOR_PRIMARY
        for cit in citations:
            p_c = doc.add_paragraph(style='List Bullet')
            cit_txt = cit.get('section', '') or cit.get('title', '') if isinstance(cit, dict) else str(cit)
            if cit_txt:
                r_c = p_c.add_run(cit_txt)
                r_c.font.name = font_name
                r_c.font.size = Pt(9.5)
                r_c.font.color.rgb = COLOR_TEXT

    # Footer note
    section = doc.sections[0]
    footer = section.footer
    f_p = footer.paragraphs[0]
    f_p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    f_run = f_p.add_run("Generated by VS Database • Certified Practice Document")
    f_run.font.name = font_name
    f_run.font.size = Pt(8)
    f_run.font.color.rgb = COLOR_MUTED

    doc.save(str(docx_path))
    size_kb = round(os.path.getsize(docx_path) / 1024, 1)

    return {
        "ok": True,
        "format": "docx",
        "filename": filename,
        "path": str(docx_path),
        "size_kb": size_kb
    }


def _render_markdown_runs(paragraph, text: str, font_name: str, default_color):
    """Splits markdown text into bold, italic, and regular runs."""
    # Pattern for **bold** and *italic*
    tokens = re.split(r'(\*\*[^*]+?\*\*|\*[^*]+?\*|`[^`]+?`)', text)
    for tok in tokens:
        if not tok:
            continue
        if tok.startswith("**") and tok.endswith("**"):
            r = paragraph.add_run(tok[2:-2])
            r.font.name = font_name
            r.font.bold = True
            r.font.color.rgb = default_color
        elif tok.startswith("*") and tok.endswith("*"):
            r = paragraph.add_run(tok[1:-1])
            r.font.name = font_name
            r.font.italic = True
            r.font.color.rgb = default_color
        elif tok.startswith("`") and tok.endswith("`"):
            r = paragraph.add_run(tok[1:-1])
            r.font.name = "Consolas"
            r.font.size = Pt(9.5)
            r.font.color.rgb = RGBColor(67, 56, 202)
        else:
            r = paragraph.add_run(tok)
            r.font.name = font_name
            r.font.color.rgb = default_color


# ============================================================
# 2. MICROSOFT EXCEL (.XLSX) GENERATOR
# ============================================================

def export_ai_spreadsheet_xlsx(
    title: str,
    content: str,
    client_name: Optional[str] = None,
    output_dir: Optional[Path] = None,
    citations: Optional[List[Any]] = None,
    **kwargs
) -> Dict[str, Any]:
    """Generates a professional, structured Microsoft Excel workbook (.xlsx) with tables, formatting, and formulas."""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter
    except ImportError:
        return {"ok": False, "error": "openpyxl library is not installed."}

    out_dir = ensure_export_dir(output_dir)
    safe_title = re.sub(r'[\\/*?:"<>|]', '_', title)[:35].strip() or "Spreadsheet"
    filename = f"VS_AI_{safe_title}_{int(time.time())}.xlsx"
    xlsx_path = out_dir / filename

    wb = openpyxl.Workbook()
    tables = parse_markdown_tables(content)

    # Styling Palette
    FONT_TITLE = Font(name="Segoe UI", size=13, bold=True, color="FFFFFF")
    FILL_TITLE = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")

    FONT_META = Font(name="Segoe UI", size=9, italic=True, color="475569")
    FILL_META = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")

    FONT_HDR = Font(name="Segoe UI", size=10.5, bold=True, color="FFFFFF")
    FILL_HDR = PatternFill(start_color="2563EB", end_color="2563EB", fill_type="solid")

    FONT_DATA = Font(name="Segoe UI", size=10, color="0F172A")
    FONT_TOTAL = Font(name="Segoe UI", size=10.5, bold=True, color="0F172A")
    FILL_ZEBRA = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
    FILL_TOTAL = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")

    THIN_BORDER_SIDE = Side(border_style="thin", color="CBD5E1")
    BORDER_CELL = Border(left=THIN_BORDER_SIDE, right=THIN_BORDER_SIDE, top=THIN_BORDER_SIDE, bottom=THIN_BORDER_SIDE)
    BORDER_TOTAL = Border(
        left=THIN_BORDER_SIDE,
        right=THIN_BORDER_SIDE,
        top=Side(border_style="thin", color="94A3B8"),
        bottom=Side(border_style="double", color="1E3A8A")
    )

    if tables:
        for t_idx, tbl in enumerate(tables):
            sheet_title = f"Table_{t_idx + 1}"
            if t_idx == 0:
                ws = wb.active
                ws.title = sheet_title
            else:
                ws = wb.create_sheet(title=sheet_title)

            ws.views.sheetView[0].showGridLines = True
            hdrs = tbl["headers"]
            rows = tbl["rows"]
            num_cols = max(len(hdrs), 1)

            # Row 1: Header Banner
            ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=num_cols)
            top_cell = ws.cell(row=1, column=1, value=f"{title}")
            top_cell.font = FONT_TITLE
            top_cell.fill = FILL_TITLE
            top_cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
            ws.row_dimensions[1].height = 32

            # Row 2: Metadata Banner
            ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=num_cols)
            meta_str = f"Client: {client_name or 'General'}   |   Date: {datetime.now().strftime('%d %b %Y')}   |   Generated by VS AI"
            m_cell = ws.cell(row=2, column=1, value=meta_str)
            m_cell.font = FONT_META
            m_cell.fill = FILL_META
            m_cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
            ws.row_dimensions[2].height = 20

            # Row 3: Blank separator
            ws.row_dimensions[3].height = 10

            # Row 4: Column Headers
            hdr_row_idx = 4
            ws.row_dimensions[hdr_row_idx].height = 24
            for c_idx, h_text in enumerate(hdrs, start=1):
                c = ws.cell(row=hdr_row_idx, column=c_idx, value=h_text)
                c.font = FONT_HDR
                c.fill = FILL_HDR
                c.alignment = Alignment(horizontal="center", vertical="center")
                c.border = BORDER_CELL

            # Rows 5+: Data
            current_r = 5
            col_types = [None] * num_cols

            for r_idx, r_data in enumerate(rows):
                ws.row_dimensions[current_r].height = 20
                is_even = (r_idx % 2 == 1)
                is_total_row = any(str(cell).strip().lower() in ("total", "sum", "grand total", "net total") for cell in r_data[:2])

                for c_idx, raw_val in enumerate(r_data, start=1):
                    val, fmt = clean_number_value(str(raw_val))
                    c = ws.cell(row=current_r, column=c_idx, value=val)
                    c.border = BORDER_TOTAL if is_total_row else BORDER_CELL

                    if is_total_row:
                        c.font = FONT_TOTAL
                        c.fill = FILL_TOTAL
                    elif is_even:
                        c.font = FONT_DATA
                        c.fill = FILL_ZEBRA
                    else:
                        c.font = FONT_DATA

                    if fmt:
                        c.number_format = fmt
                        c.alignment = Alignment(horizontal="right", vertical="center")
                        col_types[c_idx - 1] = "number"
                    else:
                        if isinstance(val, (int, float)):
                            c.alignment = Alignment(horizontal="right", vertical="center")
                        else:
                            c.alignment = Alignment(horizontal="left", vertical="center")

                current_r += 1

            # Auto Column Widths
            for col_idx in range(1, num_cols + 1):
                col_letter = get_column_letter(col_idx)
                max_len = 0
                for r in range(4, current_r):
                    v = ws.cell(row=r, column=col_idx).value
                    if v is not None:
                        max_len = max(max_len, len(str(v)))
                ws.column_dimensions[col_letter].width = max(max_len + 4, 14)

    else:
        # Fallback: Document lines converted into structured tabular overview
        ws = wb.active
        ws.title = "Advisory Overview"
        ws.views.sheetView[0].showGridLines = True

        ws.merge_cells("A1:C1")
        c1 = ws["A1"]
        c1.value = f"{title}"
        c1.font = FONT_TITLE
        c1.fill = FILL_TITLE
        c1.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws.row_dimensions[1].height = 32

        ws.cell(row=3, column=1, value="Section / Item").font = FONT_HDR
        ws.cell(row=3, column=1).fill = FILL_HDR
        ws.cell(row=3, column=2, value="Content Details").font = FONT_HDR
        ws.cell(row=3, column=2).fill = FILL_HDR
        ws.row_dimensions[3].height = 24

        curr = 4
        for line in content.splitlines():
            s = line.strip()
            if not s:
                continue
            ws.row_dimensions[curr].height = 20
            if s.startswith("#"):
                ws.cell(row=curr, column=1, value=s.replace("#", "").strip()).font = FONT_TOTAL
                ws.cell(row=curr, column=2, value="")
            elif ":" in s:
                parts = s.split(":", 1)
                ws.cell(row=curr, column=1, value=parts[0].strip().replace("*", "")).font = FONT_DATA
                val, fmt = clean_number_value(parts[1].strip())
                c = ws.cell(row=curr, column=2, value=val)
                c.font = FONT_DATA
                if fmt: c.number_format = fmt
            else:
                ws.cell(row=curr, column=1, value="—").font = FONT_DATA
                ws.cell(row=curr, column=2, value=s).font = FONT_DATA

            ws.cell(row=curr, column=1).border = BORDER_CELL
            ws.cell(row=curr, column=2).border = BORDER_CELL
            curr += 1

        ws.column_dimensions["A"].width = 28
        ws.column_dimensions["B"].width = 75

    wb.save(str(xlsx_path))
    size_kb = round(os.path.getsize(xlsx_path) / 1024, 1)

    return {
        "ok": True,
        "format": "xlsx",
        "filename": filename,
        "path": str(xlsx_path),
        "size_kb": size_kb
    }
