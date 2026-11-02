# -*- coding: utf-8 -*-
"""
Editable Template Population Engine (Mode C) for RVS AI / VS AI.
Populates user-provided working templates (XLSX, DOCX, PPTX, PDF)
preserving existing styles, formulas, macros, slide masters, and layouts
without altering the original file or destroying unrelated content.
"""

from __future__ import annotations
import shutil
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

APP_ROOT = Path(__file__).resolve().parent


class TemplatePopulationEngine:
    """Safely populates existing editable templates across formats."""

    @classmethod
    def populate_template(
        cls,
        template_path: Union[str, Path],
        output_path: Union[str, Path],
        context_data: Dict[str, Any],
        table_data: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """Universal template population dispatcher."""
        src = Path(template_path)
        dst = Path(output_path)
        dst.parent.mkdir(parents=True, exist_ok=True)

        if not src.exists():
            return {"ok": False, "error": f"Template file does not exist: {src}"}

        ext = src.suffix.lower()
        if ext in (".xlsx", ".xls"):
            return cls.populate_xlsx(src, dst, context_data, table_data)
        elif ext in (".docx", ".doc"):
            return cls.populate_docx(src, dst, context_data, table_data)
        elif ext in (".pptx", ".ppt"):
            return cls.populate_pptx(src, dst, context_data, table_data)
        elif ext == ".pdf":
            return cls.populate_pdf_form(src, dst, context_data)
        else:
            return {"ok": False, "error": f"Unsupported template format: {ext}"}

    @classmethod
    def populate_xlsx(
        cls,
        src: Path,
        dst: Path,
        context_data: Dict[str, Any],
        table_data: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Populates an existing Excel workbook template.
        Preserves all worksheets, formulas, conditional formats, cell styles,
        named ranges, and print setups.
        """
        try:
            import openpyxl
            # Copy original to output destination first to guarantee source is unchanged
            shutil.copy2(str(src), str(dst))

            wb = openpyxl.load_workbook(str(dst), data_only=False)
            cells_modified = 0

            # 1. Populate text placeholders e.g. {{client_name}} or [Client Name]
            normalized_ctx = {
                k.lower().strip(): v for k, v in context_data.items()
            }

            for sname in wb.sheetnames:
                ws = wb[sname]
                # Direct cell coordinate assignment (e.g. 'B1': value)
                for k, v in context_data.items():
                    coord = str(k).strip().upper()
                    if re.match(r'^[A-Za-z]+[0-9]+$', coord):
                        try:
                            cell = ws[coord]
                            # Avoid overwriting formulas
                            if not str(cell.value or "").startswith("="):
                                cell.value = v
                                cells_modified += 1
                        except Exception:
                            pass

                for r in range(1, ws.max_row + 1):
                    for c in range(1, ws.max_column + 1):
                        cell = ws.cell(row=r, column=c)
                        val = cell.value
                        if isinstance(val, str):
                            orig_str = val
                            new_str = val
                            # Match {{key}} or [key]
                            for k, v in normalized_ctx.items():
                                pat1 = r'\{\{\s*' + re.escape(k) + r'\s*\}\}'
                                pat2 = r'\[\s*' + re.escape(k) + r'\s*\]'
                                if re.search(pat1, new_str, re.IGNORECASE):
                                    new_str = re.sub(pat1, str(v), new_str, flags=re.IGNORECASE)
                                elif re.search(pat2, new_str, re.IGNORECASE):
                                    new_str = re.sub(pat2, str(v), new_str, flags=re.IGNORECASE)
                            if new_str != orig_str:
                                cell.value = new_str
                                cells_modified += 1

            # 2. Populate structured table data if matching row labels are found
            if table_data:
                for sname in wb.sheetnames:
                    ws = wb[sname]
                    for row_entry in table_data:
                        target_label = str(row_entry.get("label") or "").strip().lower()
                        target_val = row_entry.get("value")
                        target_col = row_entry.get("column", 3) # Default to col 3 (Amount)

                        if not target_label or target_val is None:
                            continue

                        for r in range(1, ws.max_row + 1):
                            lbl_val = str(ws.cell(row=r, column=1).value or "").strip().lower()
                            if target_label in lbl_val:
                                cell = ws.cell(row=r, column=target_col)
                                # Only fill if empty or placeholder to avoid overwriting existing user formulas
                                if cell.value is None or str(cell.value).strip() in ("", "-", "0", "0.00"):
                                    cell.value = target_val
                                    cells_modified += 1
                                break

            wb.save(str(dst))
            wb.close()
            return {"ok": True, "output_path": str(dst), "cells_modified": cells_modified}
        except Exception as exc:
            return {"ok": False, "error": f"Failed to populate Excel template: {str(exc)}"}

    @classmethod
    def populate_docx(
        cls,
        src: Path,
        dst: Path,
        context_data: Dict[str, Any],
        table_data: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Populates a Word .docx template.
        Uses docxtpl for Jinja2 tags if present; falls back to native python-docx
        surgical run replacement preserving all fonts, margins, headers, and footers.
        """
        try:
            # 1. Try docxtpl first if available
            try:
                from docxtpl import DocxTemplate
                tpl = DocxTemplate(str(src))
                tpl.render(context_data)
                tpl.save(str(dst))
                return {"ok": True, "output_path": str(dst), "engine": "docxtpl"}
            except Exception:
                pass

            # 2. Fallback to native python-docx replacement
            import docx
            shutil.copy2(str(src), str(dst))
            doc = docx.Document(str(dst))

            def replace_text_in_paragraph(p):
                for k, v in context_data.items():
                    pat = r'(\{\{\s*' + re.escape(k) + r'\s*\}\}|\[\s*' + re.escape(k) + r'\s*\])'
                    if re.search(pat, p.text, re.IGNORECASE):
                        for run in p.runs:
                            if re.search(pat, run.text, re.IGNORECASE):
                                run.text = re.sub(pat, str(v), run.text, flags=re.IGNORECASE)

            for p in doc.paragraphs:
                replace_text_in_paragraph(p)

            for tbl in doc.tables:
                for row in tbl.rows:
                    for cell in row.cells:
                        for cp in cell.paragraphs:
                            replace_text_in_paragraph(cp)

            doc.save(str(dst))
            return {"ok": True, "output_path": str(dst), "engine": "python-docx-native"}
        except Exception as exc:
            return {"ok": False, "error": f"Failed to populate Word template: {str(exc)}"}

    @classmethod
    def populate_pptx(
        cls,
        src: Path,
        dst: Path,
        context_data: Dict[str, Any],
        table_data: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Populates an existing PowerPoint presentation template.
        Preserves slide masters, layouts, visual shapes, and replaces text placeholders.
        """
        try:
            import pptx
            shutil.copy2(str(src), str(dst))
            prs = pptx.Presentation(str(dst))

            for slide in prs.slides:
                for shape in slide.shapes:
                    if shape.has_text_frame:
                        for para in shape.text_frame.paragraphs:
                            for run in para.runs:
                                for k, v in context_data.items():
                                    pat = r'(\{\{\s*' + re.escape(k) + r'\s*\}\}|\[\s*' + re.escape(k) + r'\s*\])'
                                    if re.search(pat, run.text, re.IGNORECASE):
                                        run.text = re.sub(pat, str(v), run.text, flags=re.IGNORECASE)

            prs.save(str(dst))
            return {"ok": True, "output_path": str(dst), "engine": "python-pptx"}
        except Exception as exc:
            return {"ok": False, "error": f"Failed to populate PowerPoint template: {str(exc)}"}

    @classmethod
    def populate_pdf_form(
        cls,
        src: Path,
        dst: Path,
        field_values: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Fills interactive form fields in a PDF template via pypdf."""
        try:
            import pypdf
            reader = pypdf.PdfReader(str(src))
            writer = pypdf.PdfWriter()
            writer.append(reader)

            # Update form fields if present
            writer.update_page_form_field_values(writer.pages[0], field_values)

            with open(dst, "wb") as f_out:
                writer.write(f_out)

            return {"ok": True, "output_path": str(dst), "engine": "pypdf-form"}
        except Exception as exc:
            return {"ok": False, "error": f"Failed to populate PDF form: {str(exc)}"}

    # Class aliases for convenience
    populate_excel = populate_xlsx
