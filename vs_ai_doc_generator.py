# -*- coding: utf-8 -*-
"""
VS AI — Unified Document, Spreadsheet & PDF Generator Suite
High-fidelity generator for:
  1. Microsoft Excel Workbooks (.xlsx) with smart multi-tab naming, formulas, and auto-sizing.
  2. Microsoft Word Documents (.docx) with executive typography, styled tables, and metadata.
  3. Authoritative Branded PDFs (.pdf) via ReportLab with tables, zebra striping, and running headers.
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


def clean_document_title(title: str, content: str = "") -> str:
    """
    Produces a concise, executive title (3-7 words) for documents and files.
    Eliminates raw user prompts with typos, multiple lines, and command phrases.
    """
    if not title:
        title = "Statutory Advisory & Financial Brief"

    # 1. If content begins with a strong Markdown heading, prefer that
    if content:
        for line in content.splitlines()[:6]:
            line = line.strip()
            if line.startswith("#") and len(line) > 3:
                cand = re.sub(r'^[#\s*]+', '', line).strip()
                cand = re.sub(r'[*_`]', '', cand).strip()
                cand = re.sub(r'^\d+\.\s*', '', cand).strip()
                cand = re.sub(r'^[\\/*?:"<>|]+', '', cand).strip()
                if 4 < len(cand) < 65 and not cand.lower().startswith(("table", "note", "disclaimer", "summary")):
                    return cand

    # 2. Clean the provided title string
    t = title.splitlines()[0].strip()
    # Strip common prompt verbs and requests
    t = re.sub(r'^(?:generate|create|draft|provide|explain|give me|what is|tell me about|how to)\s+(?:a\s+|an\s+|the\s+)?', '', t, flags=re.I).strip()
    # Strip trailing punctuation, colons, slashes
    t = re.sub(r'[:\-–—\\/]+$', '', t).strip()
    t = re.sub(r'[\\/*?:"<>|]', '', t).strip()
    t = re.sub(r'\s+', ' ', t).strip()

    if len(t) < 4:
        return "Statutory Advisory Brief"

    # Title-case if all lowercase
    if t.islower() or t.isupper():
        t = t.title()

    return t[:60].strip()


def parse_markdown_tables(content: str) -> List[Dict[str, Any]]:
    """
    Extracts all Markdown tables from text content along with their nearest section heading.
    """
    tables = []
    lines = content.splitlines()
    i = 0
    current_heading = "Table"

    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("#"):
            h = re.sub(r'^[#\s*]+', '', line).strip()
            h = re.sub(r'[*_`]', '', h).strip()
            h = re.sub(r'^\d+\.\s*', '', h).strip()
            if h:
                current_heading = h
        elif line.startswith("|") and line.endswith("|") and i + 1 < len(lines):
            next_line = lines[i + 1].strip()
            # Check for delimiter row: |---|---|
            if next_line.startswith("|") and re.match(r'^\|[\s\-:|]+\|$', next_line):
                raw_headers = [c.strip() for c in line.split("|")[1:-1]]
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
                        if len(row_cells) < len(raw_headers):
                            row_cells.extend([""] * (len(raw_headers) - len(row_cells)))
                        rows.append(row_cells[:len(raw_headers)])
                        j += 1
                    else:
                        break

                if rows:
                    tables.append({
                        "heading": current_heading,
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
    is_currency = False
    if s.startswith("₹") or s.startswith("Rs.") or s.startswith("Rs ") or s.startswith("INR"):
        is_currency = True
        s = re.sub(r'^(?:₹|Rs\.?|INR)\s*', '', s).strip()

    if s.endswith("%"):
        try:
            num = float(s[:-1].strip())
            return num / 100.0, "0.0%"
        except ValueError:
            pass

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
# 1. MICROSOFT EXCEL (.XLSX) GENERATOR
# ============================================================

def export_ai_spreadsheet_xlsx(
    title: str,
    content: str,
    client_name: Optional[str] = None,
    output_dir: Optional[Path] = None,
    citations: Optional[List[Any]] = None,
    **kwargs
) -> Dict[str, Any]:
    """Generates a professional, structured Microsoft Excel workbook (.xlsx)."""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter
    except ImportError:
        return {"ok": False, "error": "openpyxl library is not installed."}

    out_dir = ensure_export_dir(output_dir)
    doc_title = clean_document_title(title, content)
    safe_slug = re.sub(r'[\\/*?:"<>|]', '_', doc_title)[:35].strip() or "Spreadsheet"
    filename = f"VS_AI_{safe_slug}_{int(time.time())}.xlsx"
    xlsx_path = out_dir / filename

    wb = openpyxl.Workbook()
    tables = parse_markdown_tables(content)

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

    THIN_BORDER = Side(border_style="thin", color="CBD5E1")
    BORDER_CELL = Border(left=THIN_BORDER, right=THIN_BORDER, top=THIN_BORDER, bottom=THIN_BORDER)
    BORDER_TOTAL = Border(
        left=THIN_BORDER,
        right=THIN_BORDER,
        top=Side(border_style="thin", color="94A3B8"),
        bottom=Side(border_style="double", color="1E3A8A")
    )

    used_sheet_names = set()

    if tables:
        for t_idx, tbl in enumerate(tables):
            # Derive smart sheet name from heading
            raw_h = tbl.get("heading") or f"Table_{t_idx + 1}"
            raw_h = re.sub(r'[^a-zA-Z0-9_ ]', '', raw_h).strip()
            clean_sname = re.sub(r'\s+', '_', raw_h)[:25] or f"Sheet_{t_idx + 1}"
            
            # Avoid sheet name collisions
            sheet_title = clean_sname
            c_iter = 2
            while sheet_title.lower() in used_sheet_names:
                sheet_title = f"{clean_sname[:22]}_{c_iter}"
                c_iter += 1
            used_sheet_names.add(sheet_title.lower())

            if t_idx == 0:
                ws = wb.active
                ws.title = sheet_title
            else:
                ws = wb.create_sheet(title=sheet_title)

            ws.views.sheetView[0].showGridLines = True
            hdrs = tbl["headers"]
            rows = tbl["rows"]
            num_cols = max(len(hdrs), 1)

            # Row 1: Document Title Banner
            ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=num_cols)
            top_cell = ws.cell(row=1, column=1, value=doc_title)
            top_cell.font = FONT_TITLE
            top_cell.fill = FILL_TITLE
            top_cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
            ws.row_dimensions[1].height = 32

            # Row 2: Metadata Banner
            ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=num_cols)
            meta_str = f"Client: {client_name or 'General Advisory'}   |   Section: {tbl.get('heading', 'Statement')}   |   Date: {datetime.now().strftime('%d %b %Y')}   |   VS AI Statutory Intelligence"
            m_cell = ws.cell(row=2, column=1, value=meta_str)
            m_cell.font = FONT_META
            m_cell.fill = FILL_META
            m_cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
            ws.row_dimensions[2].height = 20

            # Row 3: Blank separator
            ws.row_dimensions[3].height = 10

            # Row 4: Column Headers
            hdr_row_idx = 4
            ws.row_dimensions[hdr_row_idx].height = 26
            for c_idx, h_text in enumerate(hdrs, start=1):
                c = ws.cell(row=hdr_row_idx, column=c_idx, value=h_text)
                c.font = FONT_HDR
                c.fill = FILL_HDR
                c.alignment = Alignment(horizontal="center", vertical="center")
                c.border = BORDER_CELL

            # Rows 5+: Data Rows
            current_r = 5
            for r_idx, r_data in enumerate(rows):
                ws.row_dimensions[current_r].height = 20
                is_even = (r_idx % 2 == 1)
                is_total = any(str(cell).strip().lower() in ("total", "sum", "grand total", "net total") for cell in r_data[:2])

                for c_idx, raw_val in enumerate(r_data, start=1):
                    val, fmt = clean_number_value(str(raw_val))
                    c = ws.cell(row=current_r, column=c_idx, value=val)
                    c.border = BORDER_TOTAL if is_total else BORDER_CELL

                    if is_total:
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
                    else:
                        if isinstance(val, (int, float)):
                            c.alignment = Alignment(horizontal="right", vertical="center")
                        else:
                            c.alignment = Alignment(horizontal="left", vertical="center")

                current_r += 1

            # Freeze Panes at A5 (Keep headers pinned while scrolling)
            ws.freeze_panes = "A5"

            # Auto-fit Column Widths
            for col_idx in range(1, num_cols + 1):
                col_letter = get_column_letter(col_idx)
                max_len = 0
                for r in range(4, current_r):
                    v = ws.cell(row=r, column=col_idx).value
                    if v is not None:
                        max_len = max(max_len, len(str(v)))
                ws.column_dimensions[col_letter].width = max(max_len + 4, 15)

    else:
        # Fallback text spreadsheet
        ws = wb.active
        ws.title = "Executive_Summary"
        ws.views.sheetView[0].showGridLines = True

        ws.merge_cells("A1:C1")
        c1 = ws["A1"]
        c1.value = doc_title
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
                ws.cell(row=curr, column=1, value=re.sub(r'^[#\s]+', '', s)).font = FONT_TOTAL
                ws.cell(row=curr, column=2, value="")
            elif ":" in s:
                parts = s.split(":", 1)
                ws.cell(row=curr, column=1, value=parts[0].strip()).font = FONT_DATA
                ws.cell(row=curr, column=2, value=parts[1].strip()).font = FONT_DATA
            else:
                ws.cell(row=curr, column=2, value=s).font = FONT_DATA
            curr += 1

        ws.column_dimensions["A"].width = 28
        ws.column_dimensions["B"].width = 85

    wb.save(str(xlsx_path))
    size_kb = round(os.path.getsize(xlsx_path) / 1024, 1)

    return {
        "ok": True,
        "format": "xlsx",
        "filename": filename,
        "path": str(xlsx_path),
        "size_kb": size_kb
    }


# ============================================================
# 2. MICROSOFT WORD (.DOCX) GENERATOR
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
    doc_title = clean_document_title(title, content)
    safe_slug = re.sub(r'[\\/*?:"<>|]', '_', doc_title)[:35].strip() or "Advisory_Document"
    filename = f"VS_AI_{safe_slug}_{int(time.time())}.docx"
    docx_path = out_dir / filename

    doc = docx.Document()

    # 1-inch margins
    for sec in doc.sections:
        sec.top_margin = Inches(1.0)
        sec.bottom_margin = Inches(1.0)
        sec.left_margin = Inches(1.0)
        sec.right_margin = Inches(1.0)

    COLOR_PRIMARY = RGBColor(30, 58, 138)    # Deep Navy #1E3A8A
    COLOR_ACCENT = RGBColor(37, 99, 235)     # Royal Blue #2563EB
    COLOR_TEXT = RGBColor(15, 23, 42)        # Slate Dark #0F172A
    COLOR_MUTED = RGBColor(100, 116, 139)    # Slate Muted #64748B

    # Header Badge
    p_badge = doc.add_paragraph()
    p_badge.paragraph_format.space_after = Pt(2)
    p_badge.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run_badge = p_badge.add_run("VS DATABASE • PRACTICE ADVISORY")
    run_badge.font.name = font_name
    run_badge.font.size = Pt(8.5)
    run_badge.font.bold = True
    run_badge.font.color.rgb = COLOR_ACCENT

    # Main Title
    p_title = doc.add_paragraph()
    p_title.paragraph_format.space_before = Pt(4)
    p_title.paragraph_format.space_after = Pt(4)
    run_title = p_title.add_run(doc_title)
    run_title.font.name = font_name
    run_title.font.size = Pt(18)
    run_title.font.bold = True
    run_title.font.color.rgb = COLOR_PRIMARY

    # Metadata Row
    p_meta = doc.add_paragraph()
    p_meta.paragraph_format.space_after = Pt(12)
    meta_runs = [
        f"Date: {datetime.now().strftime('%d %B %Y')}",
        f"Client: {client_name or 'General Advisory'}",
        "Engine: VS AI Statutory Copilot"
    ]
    run_meta = p_meta.add_run("   |   ".join(meta_runs))
    run_meta.font.name = font_name
    run_meta.font.size = Pt(9.5)
    run_meta.font.color.rgb = COLOR_MUTED

    # Divider Line
    p_div = doc.add_paragraph()
    p_div.paragraph_format.space_after = Pt(12)
    p_div_border = parse_xml(f'<w:pBdr {nsdecls("w")}><w:bottom w:val="single" w:sz="12" w:space="1" w:color="2563EB"/></w:pBdr>')
    p_div._p.get_or_add_pPr().append(p_div_border)

    lines = content.splitlines()
    i = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Markdown Table Parsing
        if stripped.startswith("|") and stripped.endswith("|") and i + 1 < len(lines):
            next_line = lines[i + 1].strip()
            if next_line.startswith("|") and re.match(r'^\|[\s\-:|]+\|$', next_line):
                table_lines = [stripped, next_line]
                j = i + 2
                while j < len(lines) and lines[j].strip().startswith("|") and lines[j].strip().endswith("|"):
                    table_lines.append(lines[j].strip())
                    j += 1

                t_list = parse_markdown_tables("\n".join(table_lines))
                if t_list:
                    tbl_info = t_list[0]
                    hdrs = tbl_info["headers"]
                    rows = tbl_info["rows"]

                    word_table = doc.add_table(rows=len(rows) + 1, cols=len(hdrs))
                    word_table.alignment = WD_TABLE_ALIGNMENT.CENTER
                    word_table.autofit = True

                    # Header row styling
                    hdr_row = word_table.rows[0]
                    trPr = hdr_row._tr.get_or_add_trPr()
                    trPr.append(parse_xml(f'<w:tblHeader {nsdecls("w")}/>'))

                    for col_idx, h_text in enumerate(hdrs):
                        cell = hdr_row.cells[col_idx]
                        cell.text = h_text
                        shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="1E3A8A"/>')
                        cell._tc.get_or_add_tcPr().append(shd)
                        for cp in cell.paragraphs:
                            cp.paragraph_format.space_before = Pt(4)
                            cp.paragraph_format.space_after = Pt(4)
                            for cr in cp.runs:
                                cr.font.name = font_name
                                cr.font.size = Pt(9.5)
                                cr.font.bold = True
                                cr.font.color.rgb = RGBColor(255, 255, 255)

                    # Data rows
                    for r_idx, r_cells in enumerate(rows):
                        r_row = word_table.rows[r_idx + 1]
                        r_trPr = r_row._tr.get_or_add_trPr()
                        r_trPr.append(parse_xml(f'<w:cantSplit {nsdecls("w")}/>'))

                        is_even = (r_idx % 2 == 1)
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
                                    cr.font.size = Pt(9)
                                    cr.font.color.rgb = COLOR_TEXT

                    # Spacing after table
                    sp_p = doc.add_paragraph()
                    sp_p.paragraph_format.space_after = Pt(6)

                i = j
                continue

        # Headings
        if stripped.startswith("### "):
            h = doc.add_heading(level=3)
            h.paragraph_format.space_before = Pt(10)
            h.paragraph_format.space_after = Pt(4)
            r = h.add_run(stripped[4:])
            r.font.name = font_name
            r.font.bold = True
            r.font.color.rgb = RGBColor(2, 132, 199)
        elif stripped.startswith("## "):
            h = doc.add_heading(level=2)
            h.paragraph_format.space_before = Pt(14)
            h.paragraph_format.space_after = Pt(4)
            r = h.add_run(stripped[3:])
            r.font.name = font_name
            r.font.bold = True
            r.font.color.rgb = COLOR_ACCENT
        elif stripped.startswith("# "):
            h = doc.add_heading(level=1)
            h.paragraph_format.space_before = Pt(16)
            h.paragraph_format.space_after = Pt(6)
            r = h.add_run(stripped[2:])
            r.font.name = font_name
            r.font.bold = True
            r.font.color.rgb = COLOR_PRIMARY

        # Callout Boxes
        elif stripped.startswith("> "):
            callout = doc.add_paragraph()
            callout.paragraph_format.space_before = Pt(6)
            callout.paragraph_format.space_after = Pt(8)
            callout.paragraph_format.left_indent = Inches(0.2)
            callout_text = stripped[2:].strip()
            # Left border in Word
            pBdr = parse_xml(f'<w:pBdr {nsdecls("w")}><w:left w:val="single" w:sz="24" w:space="8" w:color="2563EB"/></w:pBdr>')
            callout._p.get_or_add_pPr().append(pBdr)
            shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="EFF6FF"/>')
            callout._p.get_or_add_pPr().append(shd)
            _render_markdown_runs(callout, callout_text, font_name, COLOR_PRIMARY)

        # Bullets
        elif re.match(r'^(?:[-*]|\d+\.)\s+', stripped):
            bp = doc.add_paragraph(style='List Bullet')
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

    # Citations
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
    f_run = f_p.add_run("Generated by VS Database • Certified Practice Advisory")
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
            r.font.size = Pt(9)
            r.font.color.rgb = RGBColor(67, 56, 202)
        else:
            r = paragraph.add_run(tok)
            r.font.name = font_name
            r.font.color.rgb = default_color


# ============================================================
# 3. AUTHORITATIVE BRANDED PDF GENERATOR (REPORTLAB)
# ============================================================

def _xml_escape(text: str) -> str:
    """Escapes XML characters for ReportLab without corrupting HTML formatting tags."""
    # Escape ampersands not already part of an entity
    text = re.sub(r'&(?!(?:amp|lt|gt|quot|apos|bull|#\d+);)', '&amp;', text)
    text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'\*(.*?)\*', r'<i>\1</i>', text)
    text = re.sub(r'`(.*?)`', r'<font face="Courier" color="#4338CA">\1</font>', text)
    return text


def export_ai_opinion_pdf(
    title: str,
    content: str,
    citations: Optional[List[Dict[str, Any]]] = None,
    client_name: Optional[str] = None,
    output_dir: Optional[Path] = None,
    **kwargs
) -> Dict[str, Any]:
    """Generates an authoritative, executive PDF with structured ReportLab tables and layout."""
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, KeepTogether
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.pdfgen import canvas
    except ImportError:
        return {"ok": False, "error": "ReportLab library is not installed."}

    out_dir = ensure_export_dir(output_dir)
    doc_title = clean_document_title(title, content)
    safe_slug = re.sub(r'[\\/*?:"<>|]', '_', doc_title)[:35].strip() or "Legal_Opinion"
    filename = f"VS_AI_{safe_slug}_{int(time.time())}.pdf"
    pdf_path = out_dir / filename

    # Two-pass canvas for "Page X of Y" and professional header
    class NumberedCanvas(canvas.Canvas):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._saved_page_states = []

        def showPage(self):
            self._saved_page_states.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            num_pages = len(self._saved_page_states)
            for state in self._saved_page_states:
                self.__dict__.update(state)
                self.draw_decorations(num_pages)
                super().showPage()
            super().save()

        def draw_decorations(self, total_pages):
            self.saveState()
            self.setFont("Helvetica", 8)
            self.setFillColor(colors.HexColor("#64748B"))

            # Running header (pages 2+)
            if self._pageNumber > 1:
                self.drawString(36, 812, "VS DATABASE • PRACTICE ADVISORY")
                self.drawRightString(559, 812, doc_title[:45])
                self.setStrokeColor(colors.HexColor("#CBD5E1"))
                self.setLineWidth(0.5)
                self.line(36, 806, 559, 806)

            # Running footer (all pages)
            self.setStrokeColor(colors.HexColor("#CBD5E1"))
            self.setLineWidth(0.5)
            self.line(36, 42, 559, 42)
            self.drawString(36, 30, "Confidential • Prepared for Chartered Accountancy & Tax Practice")
            page_str = f"Page {self._pageNumber} of {total_pages}"
            self.drawRightString(559, 30, page_str)
            self.restoreState()

    doc = SimpleDocTemplate(
        str(pdf_path),
        pagesize=A4,
        leftMargin=36,
        rightMargin=36,
        topMargin=46,
        bottomMargin=48
    )

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=16,
        leading=20,
        textColor=colors.HexColor("#1E3A8A"),
        spaceBefore=2,
        spaceAfter=4
    )
    meta_style = ParagraphStyle(
        'DocMeta',
        fontName='Helvetica',
        fontSize=8.5,
        leading=12,
        textColor=colors.HexColor("#64748B"),
        spaceAfter=10
    )
    h1_style = ParagraphStyle(
        'DocH1',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=13,
        leading=17,
        textColor=colors.HexColor("#1E3A8A"),
        spaceBefore=12,
        spaceAfter=4,
        keepWithNext=True
    )
    h2_style = ParagraphStyle(
        'DocH2',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=15,
        textColor=colors.HexColor("#2563EB"),
        spaceBefore=10,
        spaceAfter=4,
        keepWithNext=True
    )
    h3_style = ParagraphStyle(
        'DocH3',
        parent=styles['Heading3'],
        fontName='Helvetica-Bold',
        fontSize=9.5,
        leading=13,
        textColor=colors.HexColor("#0284C7"),
        spaceBefore=8,
        spaceAfter=3,
        keepWithNext=True
    )
    body_style = ParagraphStyle(
        'DocBody',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13.5,
        textColor=colors.HexColor("#0F172A"),
        spaceAfter=6
    )
    bullet_style = ParagraphStyle(
        'DocBullet',
        parent=body_style,
        leftIndent=14,
        firstLineIndent=-10,
        spaceAfter=3
    )
    callout_style = ParagraphStyle(
        'DocCallout',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12.5,
        textColor=colors.HexColor("#1E3A8A"),
        backColor=colors.HexColor("#EFF6FF"),
        borderColor=colors.HexColor("#2563EB"),
        borderWidth=1,
        borderPadding=6,
        spaceBefore=4,
        spaceAfter=8
    )

    # Table Cell Typography
    th_style = ParagraphStyle(
        'THeader',
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=11,
        textColor=colors.white,
        alignment=1 # Center
    )
    tc_style = ParagraphStyle(
        'TCell',
        fontName='Helvetica',
        fontSize=8,
        leading=10.5,
        textColor=colors.HexColor("#0F172A"),
        alignment=0 # Left
    )
    tc_right = ParagraphStyle(
        'TCellR',
        parent=tc_style,
        alignment=2 # Right
    )

    story = []

    # 1. Title Banner
    story.append(Paragraph("VS DATABASE &bull; PRACTICE ADVISORY BRIEF", meta_style))
    story.append(Paragraph(_xml_escape(doc_title), title_style))
    date_str = datetime.now().strftime("%d %B %Y")
    client_str = f" | Client: {client_name}" if client_name else " | Client: General Advisory"
    story.append(Paragraph(f"Date: {date_str}{client_str} | Certified Statutory Intelligence", meta_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#2563EB"), spaceAfter=12))

    # 2. Content Parser
    lines = content.splitlines()
    i = 0
    printable_width = 523 # 595.27 - 72

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Parse Markdown Table into ReportLab Table
        if stripped.startswith("|") and stripped.endswith("|") and i + 1 < len(lines):
            next_line = lines[i + 1].strip()
            if next_line.startswith("|") and re.match(r'^\|[\s\-:|]+\|$', next_line):
                table_lines = [stripped, next_line]
                j = i + 2
                while j < len(lines) and lines[j].strip().startswith("|") and lines[j].strip().endswith("|"):
                    table_lines.append(lines[j].strip())
                    j += 1

                t_list = parse_markdown_tables("\n".join(table_lines))
                if t_list:
                    tbl_info = t_list[0]
                    hdrs = tbl_info["headers"]
                    rows = tbl_info["rows"]
                    alignments = tbl_info.get("alignments", [])

                    # Compute proportional column widths
                    col_lens = [len(h) for h in hdrs]
                    for r in rows:
                        for idx, val in enumerate(r):
                            if idx < len(col_lens):
                                col_lens[idx] = max(col_lens[idx], min(len(str(val)), 50))

                    total_len = max(sum(col_lens), 1)
                    col_widths = [(l / total_len) * printable_width for l in col_lens]
                    # Clamp minimum column width to 35pt
                    col_widths = [max(w, 35) for w in col_widths]
                    scale = printable_width / sum(col_widths)
                    col_widths = [w * scale for w in col_widths]

                    # Wrap cells in Paragraph
                    table_data = []
                    header_cells = [Paragraph(_xml_escape(h), th_style) for h in hdrs]
                    table_data.append(header_cells)

                    for r in rows:
                        row_cells = []
                        is_total_row = any(str(c).strip().lower() in ("total", "sum", "grand total") for c in r[:2])
                        for col_idx, cell_val in enumerate(r):
                            val_str = str(cell_val).strip()
                            clean_val, fmt = clean_number_value(val_str)
                            is_num = (fmt is not None) or isinstance(clean_val, (int, float))
                            align = alignments[col_idx] if col_idx < len(alignments) else "left"
                            use_right = is_num or align == "right"
                            st = tc_right if use_right else tc_style
                            if is_total_row:
                                st = ParagraphStyle('TotalCell', parent=st, fontName='Helvetica-Bold')
                            row_cells.append(Paragraph(_xml_escape(val_str), st))
                        table_data.append(row_cells)

                    t_flowable = Table(table_data, colWidths=col_widths, repeatRows=1)
                    t_flowable.setStyle(TableStyle([
                        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1E3A8A')),
                        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E1')),
                        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F8FAFC')]),
                        ('TOPPADDING', (0, 0), (-1, -1), 4),
                        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                        ('LEFTPADDING', (0, 0), (-1, -1), 4),
                        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
                    ]))
                    story.append(t_flowable)
                    story.append(Spacer(1, 8))

                i = j
                continue

        # Headings
        if stripped.startswith("### "):
            story.append(Paragraph(_xml_escape(stripped[4:]), h3_style))
        elif stripped.startswith("## "):
            story.append(Paragraph(_xml_escape(stripped[3:]), h2_style))
        elif stripped.startswith("# "):
            story.append(Paragraph(_xml_escape(stripped[2:]), h1_style))
        elif stripped.startswith("> "):
            callout_text = stripped[2:].strip()
            story.append(Paragraph(_xml_escape(callout_text), callout_style))
        elif re.match(r'^(?:[-*]|\d+\.)\s+', stripped):
            item_text = re.sub(r'^(?:[-*]|\d+\.)\s+', '', stripped)
            story.append(Paragraph(f"&bull; {_xml_escape(item_text)}", bullet_style))
        elif stripped:
            story.append(Paragraph(_xml_escape(stripped), body_style))

        i += 1

    # 3. Statutory Citations
    if citations:
        story.append(Spacer(1, 10))
        story.append(Paragraph("<b>Statutory Sources & References Cited</b>", h2_style))
        table_data = [["Source Statute / Ruling", "Provision / Section", "Reference Ref"]]
        for c in citations:
            sec_val = c.get("section", "-") if isinstance(c, dict) else str(c)
            act_val = c.get("source", "Statute") if isinstance(c, dict) else "Income-tax Act"
            table_data.append([
                Paragraph(_xml_escape(act_val), tc_style),
                Paragraph(_xml_escape(sec_val), tc_style),
                Paragraph("Section Analysis", tc_style)
            ])
        t_cit = Table(table_data, colWidths=[200, 180, 143])
        t_cit.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#F1F5F9")),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor("#0F172A")),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        story.append(t_cit)

    story.append(Spacer(1, 12))
    story.append(HRFlowable(width="100%", thickness=0.8, color=colors.HexColor("#CBD5E1"), spaceAfter=6))
    story.append(Paragraph("<i>This advisory analysis is digitally compiled for Chartered Accountancy practice reference. Please cross-verify with original gazette notifications before filing statutory submissions.</i>", meta_style))

    doc.build(story, canvasmaker=NumberedCanvas)
    size_kb = round(os.path.getsize(pdf_path) / 1024, 1)

    return {
        "ok": True,
        "format": "pdf",
        "file_path": str(pdf_path),
        "filename": filename,
        "size_kb": size_kb
    }
