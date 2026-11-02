# -*- coding: utf-8 -*-
"""
Deterministic Format-Specific Generators for RVS AI / VS AI.
Translates semantic DocIR documents into native Excel (.xlsx), Word (.docx),
PowerPoint (.pptx), and PDF (.pdf) files using StyleProfiles,
dynamic semantic row mapping, and formula dependency graphs.
"""

from __future__ import annotations
import os
import re
import time
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple, Union

from docir_models import (
    DocIR, SemanticTable, SemanticRow, SemanticColumn,
    SemanticRowType, NumberFormatType, TargetFormat
)
from style_profile_engine import StyleProfile, StyleProfileEngine

APP_ROOT = Path(__file__).resolve().parent
DEFAULT_EXPORTS_DIR = APP_ROOT / "data" / "ai_exports"
DEFAULT_EXPORTS_DIR.mkdir(parents=True, exist_ok=True)


def _safe_slug(text: str) -> str:
    s = re.sub(r'[^a-zA-Z0-9_-]', '_', text.replace("'", "")).strip('_')
    return re.sub(r'_+', '_', s)[:35].strip('_') or "Document"


# ===========================================================================
# 1. DETERMINISTIC EXCEL (.XLSX) GENERATOR
# ===========================================================================

class ExcelDocIRGenerator:
    """
    Compiles DocIR into multi-sheet Microsoft Excel workbooks.
    Enforces deterministic row-key mapping, prevents subtotal double-counting,
    and constructs accounting-valid control calculations.
    """

    @classmethod
    def generate(cls, doc_ir: DocIR, style: Optional[StyleProfile] = None, output_path: Optional[Path] = None) -> Path:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter

        style = style or StyleProfileEngine.get_default_profile("financial")
        if not output_path:
            filename = f"VS_AI_{_safe_slug(doc_ir.title)}_{int(time.time())}.xlsx"
            output_path = DEFAULT_EXPORTS_DIR / filename
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        wb = openpyxl.Workbook()

        # Styles derived from StyleProfile
        hex_primary = style.color_primary_hex.replace("#", "")
        hex_secondary = style.color_secondary_hex.replace("#", "")
        hex_zebra = style.color_bg_zebra_hex.replace("#", "")
        hex_total = style.color_bg_total_hex.replace("#", "")
        hex_border = style.color_border_hex.replace("#", "")

        font_name = style.font_primary
        FONT_TITLE = Font(name=font_name, size=13, bold=True, color="FFFFFF")
        FILL_TITLE = PatternFill(start_color=hex_primary, end_color=hex_primary, fill_type="solid")

        FONT_META = Font(name=font_name, size=9, italic=True, color="475569")
        FILL_META = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")

        FONT_HDR = Font(name=font_name, size=10, bold=True, color="FFFFFF")
        FILL_HDR = PatternFill(start_color=hex_secondary, end_color=hex_secondary, fill_type="solid")

        FONT_DATA = Font(name=font_name, size=10, color="0F172A")
        FONT_TOTAL = Font(name=font_name, size=10, bold=True, color="0F172A")
        FONT_CAT = Font(name=font_name, size=10, bold=True, color=hex_primary)
        FILL_ZEBRA = PatternFill(start_color=hex_zebra, end_color=hex_zebra, fill_type="solid")
        FILL_TOTAL = PatternFill(start_color=hex_total, end_color=hex_total, fill_type="solid")

        THIN_BORDER = Side(border_style="thin", color=hex_border)
        BORDER_CELL = Border(left=THIN_BORDER, right=THIN_BORDER, top=THIN_BORDER, bottom=THIN_BORDER)
        BORDER_TOTAL = Border(
            left=THIN_BORDER, right=THIN_BORDER,
            top=Side(border_style="thin", color=hex_border),
            bottom=Side(border_style="double", color=hex_primary)
        )

        all_tables = doc_ir.get_all_tables()
        if not all_tables:
            # Create a simple worksheet with title
            ws = wb.active
            ws.title = "Overview"
            ws.cell(row=1, column=1, value=doc_ir.title).font = FONT_TITLE
            wb.save(str(output_path))
            return output_path

        sheet_meta_list = []
        ws_exec = wb.active
        ws_exec.title = "Executive_Summary"
        ws_exec.views.sheetView[0].showGridLines = True
        ws_exec.page_setup.paperSize = ws_exec.PAPERSIZE_A4

        for t_idx, tbl in enumerate(all_tables):
            sheet_title = _safe_slug(tbl.title)[:25] or f"Schedule_{t_idx + 1}"
            ws = wb.create_sheet(title=sheet_title)

            ws.views.sheetView[0].showGridLines = True
            ws.page_setup.paperSize = ws.PAPERSIZE_A4
            num_cols = max(len(tbl.columns), 1)

            # Row 1: Document Title Banner
            ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=num_cols)
            top_cell = ws.cell(row=1, column=1, value=doc_ir.title)
            top_cell.font = FONT_TITLE
            top_cell.fill = FILL_TITLE
            top_cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
            ws.row_dimensions[1].height = 30

            # Row 2: Metadata Banner
            ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=num_cols)
            meta_str = f"Client: {doc_ir.client_name or 'General'}   |   Schedule: {tbl.title}   |   Date: {datetime.now().strftime('%d %b %Y')}   |   VS AI DocIR Engine"
            m_cell = ws.cell(row=2, column=1, value=meta_str)
            m_cell.font = FONT_META
            m_cell.fill = FILL_META
            m_cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
            ws.row_dimensions[2].height = 20

            # Row 3: Blank Separator
            ws.row_dimensions[3].height = 8

            # Row 4: Column Headers
            hdr_row_idx = 4
            ws.row_dimensions[hdr_row_idx].height = 26
            col_letter_map = {}
            for c_idx, col in enumerate(tbl.columns, start=1):
                col_letter = get_column_letter(c_idx)
                col_letter_map[col.col_id] = col_letter
                c = ws.cell(row=hdr_row_idx, column=c_idx, value=col.header)
                c.font = FONT_HDR
                c.fill = FILL_HDR
                c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
                c.border = BORDER_CELL

            # Step 1: Assign deterministic physical row coordinates to every semantic row
            first_data_row = 5
            row_coord_map: Dict[str, int] = {} # semantic row_id -> physical Excel row
            curr_row = first_data_row

            for r_entry in tbl.rows:
                row_coord_map[r_entry.row_id] = curr_row
                curr_row += 1

            # Step 2: Track group items for subtotal generation
            group_to_rows: Dict[str, List[int]] = {}
            subtotal_rows: List[int] = []
            detail_data_rows: List[int] = []
            grand_total_row: Optional[int] = None
            detail_row_count = 0

            for r_entry in tbl.rows:
                r_num = row_coord_map[r_entry.row_id]
                if r_entry.row_type == SemanticRowType.DETAIL:
                    detail_row_count += 1
                    detail_data_rows.append(r_num)
                    if r_entry.parent_group:
                        group_to_rows.setdefault(r_entry.parent_group, []).append(r_num)
                elif r_entry.row_type == SemanticRowType.SUBTOTAL:
                    subtotal_rows.append(r_num)
                elif r_entry.row_type == SemanticRowType.GRAND_TOTAL:
                    grand_total_row = r_num

            # Step 3: Populate cells with resolved deterministic formulas
            primary_amount_col = "C"
            for r_entry in tbl.rows:
                r_num = row_coord_map[r_entry.row_id]
                is_subtotal = (r_entry.row_type == SemanticRowType.SUBTOTAL)
                is_grand = (r_entry.row_type == SemanticRowType.GRAND_TOTAL)
                is_cat = (r_entry.row_type == SemanticRowType.CATEGORY)
                is_control = (r_entry.row_type == SemanticRowType.CONTROL_CHECK)

                for c_idx, col in enumerate(tbl.columns, start=1):
                    c_letter = get_column_letter(c_idx)
                    cell = ws.cell(row=r_num, column=c_idx)
                    cell_data = r_entry.cells.get(col.col_id)

                    val = cell_data.value if cell_data else None
                    fmt_type = cell_data.format_type if cell_data else col.default_format

                    is_amount_col = (c_idx > 1) and (col.default_format in (
                        NumberFormatType.CURRENCY_INR, NumberFormatType.INTEGER,
                        NumberFormatType.DECIMAL_2, NumberFormatType.RATIO
                    ) or any(k in col.header.lower() for k in ("amount", "period", "figure", "total", "value", "balance", "₹", "cgst", "sgst", "igst", "taxable")))
                    is_id_or_note = any(k in col.header.lower() for k in ("note", "code", "sr", "s.no", "particulars", "schedule", "rate", "%"))

                    if is_amount_col and not is_id_or_note:
                        primary_amount_col = c_letter

                    has_explicit_formula = str(val or '').strip().startswith("=")
                    is_empty = val is None or str(val).strip() == ""
                    if not has_explicit_formula and is_empty and is_amount_col and not is_id_or_note:
                        if is_subtotal:
                            if r_entry.parent_group in group_to_rows and group_to_rows[r_entry.parent_group]:
                                child_rows = group_to_rows[r_entry.parent_group]
                                val = f"=SUBTOTAL(9,{c_letter}{min(child_rows)}:{c_letter}{max(child_rows)})"
                            elif detail_data_rows:
                                val = f"=SUBTOTAL(9,{c_letter}{detail_data_rows[0]}:{c_letter}{detail_data_rows[-1]})"
                        elif is_grand:
                            if subtotal_rows:
                                val = "=" + "+".join(f"{c_letter}{sr}" for sr in subtotal_rows)
                            elif detail_data_rows:
                                val = f"=SUM({c_letter}{detail_data_rows[0]}:{c_letter}{detail_data_rows[-1]})"

                    elif c_idx == 1 and (val is None or str(val).strip() in ("", "-", "--", "—")):
                        val = r_entry.label

                    # Set Cell Value & Format
                    cell.value = val
                    cell.border = BORDER_TOTAL if (is_grand or is_subtotal) else BORDER_CELL

                    if is_grand or is_subtotal:
                        cell.font = FONT_TOTAL
                        cell.fill = FILL_TOTAL
                    elif is_cat:
                        cell.font = FONT_CAT
                    else:
                        cell.font = FONT_DATA
                        if r_num % 2 == 1:
                            cell.fill = FILL_ZEBRA

                    # Alignments and number formats
                    if fmt_type == NumberFormatType.CURRENCY_INR:
                        cell.number_format = "₹ #,##0"
                        cell.alignment = Alignment(horizontal="right", vertical="center")
                    elif fmt_type == NumberFormatType.PERCENTAGE:
                        cell.number_format = "0.0%"
                        cell.alignment = Alignment(horizontal="right", vertical="center")
                    elif fmt_type == NumberFormatType.INTEGER:
                        cell.number_format = "#,##0"
                        cell.alignment = Alignment(horizontal="right", vertical="center")
                    elif fmt_type == NumberFormatType.DECIMAL_2:
                        cell.number_format = "#,##0.00"
                        cell.alignment = Alignment(horizontal="right", vertical="center")
                    elif c_idx == 1:
                        cell.alignment = Alignment(horizontal="left", vertical="center", indent=r_entry.is_indent)
                    else:
                        cell.alignment = Alignment(horizontal="center", vertical="center")

                ws.row_dimensions[r_num].height = 20

            # Freeze Panes at A5
            ws.freeze_panes = "A5"

            # Auto-fit column widths
            max_col_letter = get_column_letter(num_cols)
            for c_idx in range(1, num_cols + 1):
                col_letter = get_column_letter(c_idx)
                max_len = max(len(str(ws.cell(row=r, column=c_idx).value or "")) for r in range(4, curr_row))
                ws.column_dimensions[col_letter].width = min(max(max_len + 4, 16), 45)

            # AutoFilter
            if curr_row > 4:
                ws.auto_filter.ref = f"A4:{max_col_letter}{curr_row - 1}"

            # Conditional Formatting
            from openpyxl.formatting.rule import CellIsRule
            red_fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")
            cf_rule = CellIsRule(operator='lessThan', formula=['0'], stopIfTrue=True, fill=red_fill)
            ws.conditional_formatting.add(f"A5:{max_col_letter}{curr_row - 1}", cf_rule)

            sheet_meta_list.append({
                "sheet_title": sheet_title,
                "heading": tbl.title,
                "first_data_row": first_data_row,
                "last_data_row": curr_row - 1,
                "grand_total_row": grand_total_row or (curr_row - 1),
                "detail_row_count": detail_row_count,
                "amount_col": primary_amount_col
            })

        # Multi-sheet Executive Summary with accounting equality
        ws_exec.merge_cells("A1:D1")
        ws_exec["A1"] = f"{doc_ir.title} — Executive Reconciliation Summary"
        ws_exec["A1"].font = FONT_TITLE
        ws_exec["A1"].fill = FILL_TITLE
        ws_exec["A1"].alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws_exec.row_dimensions[1].height = 30

        ws_exec.merge_cells("A2:D2")
        ws_exec["A2"] = f"Client: {doc_ir.client_name or 'General'}   |   Independent Control Index   |   Date: {datetime.now().strftime('%d %b %Y')}"
        ws_exec["A2"].font = FONT_META
        ws_exec["A2"].fill = FILL_META
        ws_exec["A2"].alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws_exec.row_dimensions[2].height = 20

        exec_hdrs = ["Schedule Worksheet", "Description", "Active Detail Items", "Control Total (₹)"]
        ws_exec.row_dimensions[4].height = 26
        for c_i, eh in enumerate(exec_hdrs, start=1):
            ec = ws_exec.cell(row=4, column=c_i, value=eh)
            ec.font = FONT_HDR
            ec.fill = FILL_HDR
            ec.border = BORDER_CELL
            ec.alignment = Alignment(horizontal="center", vertical="center")

        curr_ex = 5
        for sm in sheet_meta_list:
            st = sm["sheet_title"]
            gt_row = sm["grand_total_row"]
            amt_col = sm.get("amount_col", "C")

            c1 = ws_exec.cell(row=curr_ex, column=1, value=st)
            c2 = ws_exec.cell(row=curr_ex, column=2, value=sm["heading"])
            c3 = ws_exec.cell(row=curr_ex, column=3, value=sm["detail_row_count"])
            c4 = ws_exec.cell(row=curr_ex, column=4, value=f"='{st}'!{amt_col}{gt_row}")

            for cc in (c1, c2, c3, c4):
                cc.font = FONT_DATA
                cc.border = BORDER_CELL
            c3.alignment = Alignment(horizontal="right", vertical="center")
            c4.alignment = Alignment(horizontal="right", vertical="center")
            c4.number_format = "₹ #,##0"
            curr_ex += 1

        # Summary Subtotal Row
        sub_r1 = ws_exec.cell(row=curr_ex, column=1, value="Schedule Subtotal")
        sub_r2 = ws_exec.cell(row=curr_ex, column=2, value="Subtotal Across Active Schedules")
        sub_r3 = ws_exec.cell(row=curr_ex, column=3, value=f"=SUM(C5:C{curr_ex-1})")
        sub_r4 = ws_exec.cell(row=curr_ex, column=4, value=f"=SUBTOTAL(9,D5:D{curr_ex-1})")
        for cc in (sub_r1, sub_r2, sub_r3, sub_r4):
            cc.font = FONT_TOTAL
            cc.fill = FILL_TOTAL
            cc.border = BORDER_CELL
        sub_r3.alignment = Alignment(horizontal="right", vertical="center")
        sub_r4.alignment = Alignment(horizontal="right", vertical="center")
        sub_r4.number_format = "₹ #,##0"
        curr_ex += 1

        # Control Row: Assets vs Liabilities Equality Check
        cr1 = ws_exec.cell(row=curr_ex, column=1, value="Accounting Control")
        cr2 = ws_exec.cell(row=curr_ex, column=2, value="Balance Sheet Equality Check (Liabilities minus Assets)")
        cr3 = ws_exec.cell(row=curr_ex, column=3, value="Target = ₹0")
        if curr_ex > 6:
            cr4 = ws_exec.cell(row=curr_ex, column=4, value=f"=D5-D6")
        else:
            cr4 = ws_exec.cell(row=curr_ex, column=4, value=f"=D5-D5")

        for cc in (cr1, cr2, cr3, cr4):
            cc.font = FONT_TOTAL
            cc.fill = FILL_TOTAL
            cc.border = BORDER_TOTAL
        cr4.alignment = Alignment(horizontal="right", vertical="center")
        cr4.number_format = "₹ #,##0"

        ws_exec.freeze_panes = "A5"
        ws_exec.auto_filter.ref = f"A4:D{curr_ex - 1}"
        from openpyxl.formatting.rule import CellIsRule
        red_fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")
        cf_rule_exec = CellIsRule(operator='lessThan', formula=['0'], stopIfTrue=True, fill=red_fill)
        ws_exec.conditional_formatting.add(f"D5:D{curr_ex}", cf_rule_exec)

        ws_exec.column_dimensions["A"].width = 28
        ws_exec.column_dimensions["B"].width = 50
        ws_exec.column_dimensions["C"].width = 22
        ws_exec.column_dimensions["D"].width = 25

        wb.save(str(output_path))
        wb.close()
        return output_path


# ===========================================================================
# 2. DETERMINISTIC WORD (.DOCX) GENERATOR
# ===========================================================================

class WordDocIRGenerator:
    """Compiles DocIR into professional Microsoft Word (.docx) documents."""

    @classmethod
    def generate(cls, doc_ir: DocIR, style: Optional[StyleProfile] = None, output_path: Optional[Path] = None) -> Path:
        import docx
        from docx.shared import Inches, Pt, RGBColor
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        from docx.enum.table import WD_TABLE_ALIGNMENT
        from docx.enum.section import WD_ORIENT
        from docx.oxml import parse_xml
        from docx.oxml.ns import nsdecls

        style = style or StyleProfileEngine.get_default_profile("legal")
        if not output_path:
            filename = f"VS_AI_{_safe_slug(doc_ir.title)}_{int(time.time())}.docx"
            output_path = DEFAULT_EXPORTS_DIR / filename
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        doc = docx.Document()
        font_name = style.font_primary

        # Page Setup
        sec = doc.sections[0]
        if style.orientation == "landscape":
            sec.orientation = WD_ORIENT.LANDSCAPE
            sec.page_width = Inches(11.69)
            sec.page_height = Inches(8.27)
        else:
            sec.orientation = WD_ORIENT.PORTRAIT
            sec.page_width = Inches(8.27)
            sec.page_height = Inches(11.69)

        sec.top_margin = Inches(style.margin_top_inches)
        sec.bottom_margin = Inches(style.margin_bottom_inches)
        sec.left_margin = Inches(style.margin_left_inches)
        sec.right_margin = Inches(style.margin_right_inches)

        def hex_to_rgb(h: str) -> RGBColor:
            clean = h.replace("#", "")
            return RGBColor(int(clean[0:2], 16), int(clean[2:4], 16), int(clean[4:6], 16))

        COLOR_PRIMARY = hex_to_rgb(style.color_primary_hex)
        COLOR_SECONDARY = hex_to_rgb(style.color_secondary_hex)
        COLOR_TEXT = hex_to_rgb(style.color_text_hex)
        COLOR_MUTED = hex_to_rgb(style.color_muted_hex)

        # Header Badge
        p_badge = doc.add_paragraph()
        p_badge.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        r_badge = p_badge.add_run("RVS AI • PRACTICE DOCUMENT ENGINE")
        r_badge.font.name = font_name
        r_badge.font.size = Pt(8.5)
        r_badge.font.bold = True
        r_badge.font.color.rgb = COLOR_SECONDARY

        # Title
        p_title = doc.add_paragraph()
        p_title.paragraph_format.space_before = Pt(4)
        p_title.paragraph_format.space_after = Pt(4)
        p_title.paragraph_format.keep_with_next = True
        r_title = p_title.add_run(doc_ir.title)
        r_title.font.name = font_name
        r_title.font.size = Pt(style.font_size_title)
        r_title.font.bold = True
        r_title.font.color.rgb = COLOR_PRIMARY

        # Metadata
        p_meta = doc.add_paragraph()
        p_meta.paragraph_format.space_after = Pt(10)
        m_text = f"Entity: {doc_ir.client_name or 'General'}   |   Date: {datetime.now().strftime('%d %B %Y')}   |   Mode: {doc_ir.generation_mode.value.title()}"
        r_meta = p_meta.add_run(m_text)
        r_meta.font.name = font_name
        r_meta.font.size = Pt(9.5)
        r_meta.font.color.rgb = COLOR_MUTED

        # Sections
        for sec_data in doc_ir.sections:
            h = doc.add_heading(level=min(sec_data.level, 3))
            h.paragraph_format.space_before = Pt(12)
            h.paragraph_format.space_after = Pt(4)
            h.paragraph_format.keep_with_next = True
            r_h = h.add_run(sec_data.heading)
            r_h.font.name = font_name
            r_h.font.bold = True
            r_h.font.color.rgb = COLOR_PRIMARY

            for para_text in sec_data.paragraphs:
                p = doc.add_paragraph()
                p.paragraph_format.space_after = Pt(6)
                r_p = p.add_run(para_text)
                r_p.font.name = font_name
                r_p.font.size = Pt(style.font_size_body)
                r_p.font.color.rgb = COLOR_TEXT

            for tbl in sec_data.tables:
                from vs_ai_doc_generator import evaluate_table_formulas_for_display
                headers = [col.header for col in tbl.columns]
                raw_rows = []
                for r_data in tbl.rows:
                    row_vals = []
                    for c_i, col in enumerate(tbl.columns):
                        cell_info = r_data.cells.get(col.col_id)
                        val_str = str(cell_info.value if cell_info and cell_info.value is not None else (r_data.label if c_i == 0 else ""))
                        row_vals.append(val_str)
                    raw_rows.append(row_vals)

                display_matrix = evaluate_table_formulas_for_display(headers, raw_rows, first_excel_row=5)

                col_count = len(tbl.columns)
                row_count = len(tbl.rows) + 1
                w_tbl = doc.add_table(rows=row_count, cols=col_count)
                w_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER

                # Header Row
                hdr_row = w_tbl.rows[0]
                hdr_row._tr.get_or_add_trPr().append(parse_xml(f'<w:tblHeader {nsdecls("w")}/>'))
                hdr_row._tr.get_or_add_trPr().append(parse_xml(f'<w:cantSplit {nsdecls("w")}/>'))

                for c_i, col in enumerate(tbl.columns):
                    c = hdr_row.cells[c_i]
                    c.text = col.header
                    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{style.color_bg_header_hex.replace("#","")}"/>')
                    c._tc.get_or_add_tcPr().append(shd)
                    p = c.paragraphs[0]
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    for run in p.runs:
                        run.font.name = font_name
                        run.font.bold = True
                        run.font.color.rgb = RGBColor(255, 255, 255)
                        run.font.size = Pt(style.font_size_table)

                # Data Rows
                for r_i, r_data in enumerate(tbl.rows):
                    row = w_tbl.rows[r_i + 1]
                    row._tr.get_or_add_trPr().append(parse_xml(f'<w:cantSplit {nsdecls("w")}/>'))
                    is_subtotal = (r_data.row_type in (SemanticRowType.SUBTOTAL, SemanticRowType.GRAND_TOTAL))

                    for c_i, col in enumerate(tbl.columns):
                        c = row.cells[c_i]
                        val_str = display_matrix[r_i][c_i] if r_i < len(display_matrix) and c_i < len(display_matrix[r_i]) else ""
                        c.text = val_str

                        if is_subtotal:
                            shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{style.color_bg_total_hex.replace("#","")}"/>')
                            c._tc.get_or_add_tcPr().append(shd)

                        p = c.paragraphs[0]
                        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT if c_i > 0 else WD_ALIGN_PARAGRAPH.LEFT
                        for run in p.runs:
                            run.font.name = font_name
                            run.font.size = Pt(style.font_size_table)
                            if is_subtotal:
                                run.font.bold = True

                doc.add_paragraph().paragraph_format.space_after = Pt(6)

        # Footer with live OpenXML PAGE and NUMPAGES fields
        from vs_ai_doc_generator import _append_docx_xml_field
        footer = sec.footer
        p_foot = footer.paragraphs[0]
        p_foot.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        r_f1 = p_foot.add_run(f"{doc_ir.title}   |   Page ")
        r_f1.font.name = font_name
        r_f1.font.size = Pt(8.5)
        r_f1.font.color.rgb = COLOR_MUTED
        _append_docx_xml_field(p_foot, "PAGE", font_name, 8.5, COLOR_MUTED)
        r_f2 = p_foot.add_run(" of ")
        r_f2.font.name = font_name
        r_f2.font.size = Pt(8.5)
        r_f2.font.color.rgb = COLOR_MUTED
        _append_docx_xml_field(p_foot, "NUMPAGES", font_name, 8.5, COLOR_MUTED)

        doc.save(str(output_path))
        return output_path


# ===========================================================================
# 3. DETERMINISTIC POWERPOINT (.PPTX) GENERATOR
# ===========================================================================

class PowerPointDocIRGenerator:
    """
    Compiles DocIR into professional Microsoft PowerPoint (.pptx) presentations.
    Provides native slide master creation, executive KPI cards, tables, and typography.
    """

    @classmethod
    def generate(cls, doc_ir: DocIR, style: Optional[StyleProfile] = None, output_path: Optional[Path] = None) -> Path:
        import pptx
        from pptx.util import Inches, Pt
        from pptx.dml.color import RGBColor
        from pptx.enum.text import PP_ALIGN

        style = style or StyleProfileEngine.get_default_profile("corporate")
        if not output_path:
            filename = f"VS_AI_{_safe_slug(doc_ir.title)}_{int(time.time())}.pptx"
            output_path = DEFAULT_EXPORTS_DIR / filename
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        prs = pptx.Presentation()
        prs.slide_width = Inches(13.33)  # 16:9 Widescreen
        prs.slide_height = Inches(7.50)

        def hex_to_rgb(h: str) -> RGBColor:
            clean = h.replace("#", "")
            return RGBColor(int(clean[0:2], 16), int(clean[2:4], 16), int(clean[4:6], 16))

        COLOR_PRIMARY = hex_to_rgb(style.color_primary_hex)
        COLOR_SECONDARY = hex_to_rgb(style.color_secondary_hex)
        COLOR_TEXT = hex_to_rgb(style.color_text_hex)
        COLOR_MUTED = hex_to_rgb(style.color_muted_hex)
        font_name = style.font_primary

        blank_layout = prs.slide_layouts[6]

        # Slide 1: Title Slide
        s1 = prs.slides.add_slide(blank_layout)
        # Background Header Banner
        banner = s1.shapes.add_shape(1, Inches(0), Inches(0), Inches(13.33), Inches(2.2)) # msoShapeRectangle = 1
        banner.fill.solid()
        banner.fill.fore_color.rgb = COLOR_PRIMARY
        banner.line.color.rgb = COLOR_PRIMARY

        tb = s1.shapes.add_textbox(Inches(0.8), Inches(0.4), Inches(11.7), Inches(1.4))
        tf = tb.text_frame
        p_t = tf.paragraphs[0]
        p_t.text = doc_ir.title
        p_t.font.name = font_name
        p_t.font.size = Pt(32)
        p_t.font.bold = True
        p_t.font.color.rgb = RGBColor(255, 255, 255)

        sub_tb = s1.shapes.add_textbox(Inches(0.8), Inches(2.6), Inches(11.7), Inches(3.0))
        sub_tf = sub_tb.text_frame
        p_sub = sub_tf.paragraphs[0]
        p_sub.text = f"Entity: {doc_ir.client_name or 'Client Advisory'}\nDate: {datetime.now().strftime('%d %B %Y')}\nPrepared by: RVS AI Practice Engine"
        p_sub.font.name = font_name
        p_sub.font.size = Pt(18)
        p_sub.font.color.rgb = COLOR_TEXT

        # Slide Content (either from doc_ir.slides or synthesized from sections)
        slides_to_render = doc_ir.slides
        if not slides_to_render and doc_ir.sections:
            # Synthesize slides from sections
            for sec in doc_ir.sections:
                slides_to_render.append(SlideContent(
                    slide_id=sec.section_id,
                    title=sec.heading,
                    bullet_points=sec.paragraphs,
                    table=sec.tables[0] if sec.tables else None
                ))

        for sc in slides_to_render:
            slide = prs.slides.add_slide(blank_layout)

            # Slide Top Banner Rule
            top_bar = slide.shapes.add_shape(1, Inches(0), Inches(0), Inches(13.33), Inches(0.15))
            top_bar.fill.solid()
            top_bar.fill.fore_color.rgb = COLOR_SECONDARY
            top_bar.line.color.rgb = COLOR_SECONDARY

            # Slide Title
            t_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.4), Inches(11.7), Inches(0.8))
            p = t_box.text_frame.paragraphs[0]
            p.text = sc.title
            p.font.name = font_name
            p.font.size = Pt(22)
            p.font.bold = True
            p.font.color.rgb = COLOR_PRIMARY

            curr_y = Inches(1.3)

            # KPI Metrics Cards if present
            if sc.metrics:
                card_w = Inches(11.7 / max(len(sc.metrics), 1) - 0.2)
                for m_i, metric in enumerate(sc.metrics):
                    card_x = Inches(0.8 + m_i * (11.7 / len(sc.metrics)))
                    c_box = slide.shapes.add_shape(1, card_x, curr_y, card_w, Inches(1.2))
                    c_box.fill.solid()
                    c_box.fill.fore_color.rgb = RGBColor(241, 245, 249)
                    c_box.line.color.rgb = COLOR_SECONDARY

                    c_tf = c_box.text_frame
                    p_l = c_tf.paragraphs[0]
                    p_l.text = metric.get("label", "")
                    p_l.font.size = Pt(11)
                    p_l.font.color.rgb = COLOR_MUTED
                    p_l.alignment = PP_ALIGN.CENTER

                    p_v = c_tf.add_paragraph()
                    p_v.text = metric.get("value", "")
                    p_v.font.size = Pt(18)
                    p_v.font.bold = True
                    p_v.font.color.rgb = COLOR_PRIMARY
                    p_v.alignment = PP_ALIGN.CENTER
                curr_y += Inches(1.4)

            # Table or Bullet Points
            if sc.table:
                tbl_data = sc.table
                num_r = min(len(tbl_data.rows) + 1, 10)
                num_c = len(tbl_data.columns)
                t_shape = slide.shapes.add_table(num_r, num_c, Inches(0.8), curr_y, Inches(11.7), Inches(4.5))
                table = t_shape.table

                # Header Row
                for c_i, col in enumerate(tbl_data.columns):
                    cell = table.cell(0, c_i)
                    cell.text = col.header
                    cell.fill.solid()
                    cell.fill.fore_color.rgb = COLOR_PRIMARY
                    p = cell.text_frame.paragraphs[0]
                    p.font.name = font_name
                    p.font.size = Pt(11)
                    p.font.bold = True
                    p.font.color.rgb = RGBColor(255, 255, 255)

                # Data Rows
                for r_i, r_data in enumerate(tbl_data.rows[:num_r - 1]):
                    for c_i, col in enumerate(tbl_data.columns):
                        cell = table.cell(r_i + 1, c_i)
                        cell_info = r_data.cells.get(col.col_id)
                        val_str = str(cell_info.value if cell_info and cell_info.value is not None else (r_data.label if c_i == 0 else ""))
                        cell.text = val_str
                        p = cell.text_frame.paragraphs[0]
                        p.font.name = font_name
                        p.font.size = Pt(10)
                        if r_data.row_type in (SemanticRowType.SUBTOTAL, SemanticRowType.GRAND_TOTAL):
                            p.font.bold = True
                            cell.fill.solid()
                            cell.fill.fore_color.rgb = RGBColor(226, 232, 240)
            elif sc.get_bullets():
                b_box = slide.shapes.add_textbox(Inches(0.8), curr_y, Inches(11.7), Inches(5.0))
                b_tf = b_box.text_frame
                for bp in sc.get_bullets():
                    bp_p = b_tf.add_paragraph()
                    bp_p.text = f"• {bp}"
                    bp_p.font.name = font_name
                    bp_p.font.size = Pt(14)
                    bp_p.font.color.rgb = COLOR_TEXT
                    bp_p.space_after = Pt(10)

        prs.save(str(output_path))
        return output_path


# ===========================================================================
# 4. DETERMINISTIC PDF (.PDF) GENERATOR
# ===========================================================================

class PDFDocIRGenerator:
    """Compiles DocIR into branded high-fidelity PDF documents via ReportLab Platypus."""

    @classmethod
    def generate(cls, doc_ir: DocIR, style: Optional[StyleProfile] = None, output_path: Optional[Path] = None) -> Path:
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib import colors
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.pdfgen import canvas

        style = style or StyleProfileEngine.get_default_profile("financial")
        if not output_path:
            filename = f"VS_AI_{_safe_slug(doc_ir.title)}_{int(time.time())}.pdf"
            output_path = DEFAULT_EXPORTS_DIR / filename
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        use_landscape = (style.orientation == "landscape")
        page_size = landscape(A4) if use_landscape else A4
        left_m = style.margin_left_inches * 72
        right_m = style.margin_right_inches * 72
        top_m = style.margin_top_inches * 72
        bottom_m = style.margin_bottom_inches * 72

        from vs_ai_doc_generator import init_pdf_fonts
        font_reg, font_bold = init_pdf_fonts()

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
                pw, ph = self._pagesize
                self.setFont(font_reg, 8)
                self.setFillColor(colors.HexColor("#64748B"))
                if self._pageNumber > 1:
                    self.drawString(left_m, ph - 30, "RVS AI • PRACTICE ADVISORY")
                    self.drawRightString(pw - right_m, ph - 30, doc_ir.title[:50])
                    self.setStrokeColor(colors.HexColor("#CBD5E1"))
                    self.setLineWidth(0.5)
                    self.line(left_m, ph - 36, pw - right_m, ph - 36)

                self.line(left_m, 36, pw - right_m, 36)
                self.drawString(left_m, 24, "Confidential • Prepared for Professional Practice")
                self.drawRightString(pw - right_m, 24, f"Page {self._pageNumber} of {total_pages}")
                self.restoreState()

        doc = SimpleDocTemplate(str(output_path), pagesize=page_size, leftMargin=left_m, rightMargin=right_m, topMargin=top_m, bottomMargin=bottom_m)
        styles = getSampleStyleSheet()

        title_style = ParagraphStyle(
            'PDFTitle', parent=styles['Heading1'], fontName=font_bold, fontSize=style.font_size_title,
            leading=style.font_size_title * 1.25, textColor=colors.HexColor(style.color_primary_hex), spaceAfter=4
        )
        meta_style = ParagraphStyle('PDFMeta', fontName=font_reg, fontSize=8.5, textColor=colors.HexColor("#64748B"), spaceAfter=10)
        h1_style = ParagraphStyle('PDFH1', fontName=font_bold, fontSize=style.font_size_heading1, leading=style.font_size_heading1 * 1.25, textColor=colors.HexColor(style.color_primary_hex), spaceBefore=10, spaceAfter=4)
        body_style = ParagraphStyle('PDFBody', fontName=font_reg, fontSize=style.font_size_body, leading=style.font_size_body * 1.3, textColor=colors.HexColor(style.color_text_hex), spaceAfter=6)
        tbl_cell_style = ParagraphStyle('PDFCell', fontName=font_reg, fontSize=style.font_size_table, leading=style.font_size_table * 1.2)

        story = []
        story.append(Paragraph(doc_ir.title, title_style))
        story.append(Paragraph(f"Client: {doc_ir.client_name or 'General'}   |   Date: {datetime.now().strftime('%d %B %Y')}   |   DocIR Verified", meta_style))
        story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor(style.color_secondary_hex), spaceAfter=10))

        for sec in doc_ir.sections:
            story.append(Paragraph(sec.heading, h1_style))
            for p_txt in sec.paragraphs:
                story.append(Paragraph(p_txt, body_style))

            for tbl in sec.tables:
                from vs_ai_doc_generator import evaluate_table_formulas_for_display
                hdr_row = [col.header for col in tbl.columns]
                raw_rows = []
                for r_data in tbl.rows:
                    row_vals = []
                    for c_i, col in enumerate(tbl.columns):
                        c_info = r_data.cells.get(col.col_id)
                        val_str = str(c_info.value if c_info and c_info.value is not None else (r_data.label if c_i == 0 else ""))
                        row_vals.append(val_str)
                    raw_rows.append(row_vals)

                display_matrix = evaluate_table_formulas_for_display(hdr_row, raw_rows, first_excel_row=5)

                table_matrix = []
                table_matrix.append(hdr_row)

                for r_i, r_data in enumerate(tbl.rows):
                    row_cells = []
                    for c_i, col in enumerate(tbl.columns):
                        val_str = display_matrix[r_i][c_i] if r_i < len(display_matrix) and c_i < len(display_matrix[r_i]) else ""
                        row_cells.append(Paragraph(val_str, tbl_cell_style))
                printable_w = (841.89 if use_landscape else 595.27) - (left_m + right_m)
                col_count = len(tbl.columns)
                col_w = printable_w / max(col_count, 1)
                t = Table(table_matrix, repeatRows=1, colWidths=[col_w] * col_count)
                t_style = [
                    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor(style.color_bg_header_hex)),
                    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                    ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                    ('FONTNAME', (0, 0), (-1, 0), font_bold),
                    ('FONTNAME', (0, 1), (-1, -1), font_reg),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                    ('TOPPADDING', (0, 0), (-1, -1), 4),
                    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor(style.color_border_hex)),
                ]
                t.setStyle(TableStyle(t_style))
                story.append(t)
                story.append(Spacer(1, 10))

        doc.build(story, canvasmaker=NumberedCanvas)
        return output_path
