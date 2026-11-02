# -*- coding: utf-8 -*-
"""
Independent Document Validation Engine for RVS AI / VS AI.
Acts as a mandatory delivery gate verifying file integrity, formula syntax,
recalculated cell values, accounting identities (Assets = Liabilities),
and visual structure before any artifact is marked READY.
"""

from __future__ import annotations
import re
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
from pydantic import BaseModel, Field

from docir_models import DocIR, TargetFormat, SemanticRowType

try:
    import formulas
    _funcs = formulas.get_functions()
    if "SUBTOTAL" not in _funcs and "SUM" in _funcs:
        _funcs["SUBTOTAL"] = lambda fn_num, *args: _funcs["SUM"](*args)
except Exception:
    pass


class ValidationState:
    GENERATING = "GENERATING"
    VALIDATING = "VALIDATING"
    READY = "READY"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    FAILED = "FAILED"


class ValidationResult(BaseModel):
    """Structured report of independent validation checks."""
    is_valid: bool
    state: str = ValidationState.VALIDATING
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    checks_passed: List[str] = Field(default_factory=list)
    metrics: Dict[str, Any] = Field(default_factory=dict)

    def add_error(self, err: str) -> None:
        self.errors.append(err)
        self.is_valid = False
        self.state = ValidationState.FAILED

    def add_warning(self, warn: str) -> None:
        self.warnings.append(warn)
        if self.state == ValidationState.READY:
            self.state = ValidationState.NEEDS_REVIEW

    def add_pass(self, check_name: str) -> None:
        self.checks_passed.append(check_name)


class DocumentValidator:
    """Independent validator checking files against DocIR specifications and accounting rules."""

    @classmethod
    def validate_artifact(
        cls,
        file_path: Union[str, Path],
        doc_ir: Optional[DocIR] = None,
        target_format: Optional[str] = None
    ) -> ValidationResult:
        p = Path(file_path)
        res = ValidationResult(is_valid=True, state=ValidationState.READY)

        # 1. General Pre-flight checks
        if not p.exists():
            res.add_error(f"Generated file does not exist on disk: {p}")
            return res
        file_size = p.stat().st_size
        if file_size == 0:
            res.add_error("Generated file is 0 bytes (empty file).")
            return res
        res.metrics["file_size_bytes"] = file_size
        res.add_pass("file_exists_non_zero")

        fmt = (target_format or p.suffix.replace(".", "")).lower()

        # 2. Format-specific validation
        if fmt in ("xlsx", "excel"):
            cls._validate_xlsx(p, doc_ir, res)
        elif fmt in ("docx", "word"):
            cls._validate_docx(p, doc_ir, res)
        elif fmt in ("pptx", "powerpoint"):
            cls._validate_pptx(p, doc_ir, res)
        elif fmt == "pdf":
            cls._validate_pdf(p, doc_ir, res)
        else:
            res.add_warning(f"Unsupported format '{fmt}' for deep structural validation.")

        # Final state resolution
        if res.errors:
            res.is_valid = False
            res.state = ValidationState.FAILED
        elif res.warnings and res.state != ValidationState.FAILED:
            res.state = ValidationState.NEEDS_REVIEW
        else:
            res.state = ValidationState.READY

        return res

    @classmethod
    def _validate_xlsx(cls, p: Path, doc_ir: Optional[DocIR], res: ValidationResult) -> None:
        """Deep spreadsheet formula, calculation, and accounting identity validation."""
        try:
            import openpyxl
            wb = openpyxl.load_workbook(str(p), data_only=False)
        except Exception as exc:
            res.add_error(f"Cannot parse XLSX workbook: {str(exc)}")
            return

        res.add_pass("xlsx_open_syntax")
        res.metrics["sheets_count"] = len(wb.sheetnames)
        res.metrics["sheet_names"] = wb.sheetnames

        total_formulas = 0
        error_strings = {"#REF!", "#VALUE!", "#NAME?", "#DIV/0!", "#N/A", "#NULL!", "#NUM!"}

        # Try to import formulas library for AST syntax validation
        formulas_parser = None
        try:
            import formulas
            formulas_parser = formulas.Parser()
        except Exception:
            pass

        # Scan all sheets for formulas and literal error flags
        for sname in wb.sheetnames:
            ws = wb[sname]
            for r in range(1, ws.max_row + 1):
                for c in range(1, ws.max_column + 1):
                    val = ws.cell(row=r, column=c).value
                    if val is None:
                        continue
                    str_v = str(val).strip()

                    # Check for literal formula errors
                    if str_v.upper() in error_strings:
                        res.add_error(f"Formula error '{str_v}' found at sheet '{sname}' cell ({r}, {c}).")

                    if str_v.startswith("="):
                        total_formulas += 1
                        # AST syntax check via formulas library
                        if formulas_parser:
                            try:
                                formulas_parser.ast(str_v)
                            except Exception as parse_err:
                                res.add_error(f"Invalid Excel formula syntax '{str_v}' at '{sname}' row {r}: {parse_err}")

                        # Range coordinate sanity check:
                        # Detect if a formula sums row 4 (standard header text row)
                        if re.search(r'\b[A-Za-z]+4:[A-Za-z]+', str_v):
                            # In RVS AI layout, Row 4 is the column header text!
                            res.add_error(
                                f"Formula '{str_v}' at sheet '{sname}' row {r} incorrectly includes Row 4 (column header text)."
                            )

                        # Detect double-counted subtotals (SUM range containing another SUM/SUBTOTAL cell)
                        sum_ranges = re.findall(r'(?:SUM|SUBTOTAL)\s*\(\s*([A-Za-z]+)(\d+)\s*:\s*([A-Za-z]+)(\d+)', str_v, re.IGNORECASE)
                        for col_s, r_s_str, col_e, r_e_str in sum_ranges:
                            if col_s.upper() == col_e.upper():
                                col_letter = col_s.upper()
                                import openpyxl.utils
                                col_idx = openpyxl.utils.column_index_from_string(col_letter)
                                r_s = int(r_s_str)
                                r_e = int(r_e_str)
                                for int_r in range(r_s, r_e + 1):
                                    if int_r == r:
                                        continue
                                    int_val = str(ws.cell(row=int_r, column=col_idx).value or "").strip()
                                    if int_val.startswith("=") and any(f in int_val.upper() for f in ("SUM(", "SUBTOTAL(")):
                                        # Only flag if intermediate formula sums cells in this same column (vertical subtotal)
                                        if re.search(rf'\b{col_letter}\d+', int_val, re.IGNORECASE):
                                            res.add_error(
                                                f"Double-counted subtotal detected at sheet '{sname}' cell {col_letter}{r}: "
                                                f"formula '{str_v}' sums range {col_letter}{r_s}:{col_letter}{r_e} which already contains nested subtotal formula at row {int_r} ('{int_val}')."
                                            )
                                            break

            # Check for hardcoded reconciliation values (e.g. difference row having 0 without a formula)
            recon_keywords = ("reconciliation", "difference", "balance check", "variance", "unreconciled", "mismatch", "equality check")
            for r in range(1, ws.max_row + 1):
                lbl_1 = str(ws.cell(row=r, column=1).value or "").lower()
                lbl_2 = str(ws.cell(row=r, column=2).value or "").lower()
                matched_kw = next((kw for kw in recon_keywords if kw in lbl_1 or kw in lbl_2), None)
                if matched_kw:
                    for c in range(2, ws.max_column + 1):
                        cell = ws.cell(row=r, column=c)
                        c_val = cell.value
                        if c_val is not None:
                            s_val = str(c_val).strip()
                            is_zero_equiv = (
                                s_val in ("0", "0.0", "0.00", "-", "nil", "nil/-", "0/-") or
                                (isinstance(c_val, (int, float)) and abs(c_val) < 0.001)
                            )
                            if is_zero_equiv and not s_val.startswith("="):
                                res.add_error(
                                    f"Hardcoded reconciliation check detected at sheet '{sname}', row {r} (labeled '{matched_kw}'): "
                                    f"cell ({r}, {c}) contains literal '{c_val}' without an underlying formula. A hardcoded zero does not count as proof of reconciliation."
                                )

        res.metrics["formulas_count"] = total_formulas
        res.add_pass("xlsx_formula_syntax_and_headers")

        # 3. Independent Workbook Recalculation Engine via formulas
        calc_results = {}
        try:
            import formulas
            funcs = formulas.get_functions()
            if "SUBTOTAL" not in funcs and "SUM" in funcs:
                funcs["SUBTOTAL"] = lambda fn_num, *args: funcs["SUM"](*args)
            xl_model = formulas.ExcelModel().loads(str(p)).finish()
            calc_results = xl_model.calculate()
            res.add_pass("xlsx_recalculation_engine_verified")

            clean_calc = {}
            # Check if any calculated cell produced an Excel error string and store metrics
            for k, val in calc_results.items():
                val_str = str(val)
                for err_token in error_strings:
                    if err_token in val_str:
                        res.add_error(f"Recalculation error '{err_token}' at cell {k}: {val}")
                match = re.search(r'\](.*?)\'!([A-Za-z0-9]+)', str(k))
                if match:
                    s_name, c_ref = match.group(1), match.group(2)
                    try:
                        num_v = float(val_str.split("[[")[-1].split("]]")[0].strip())
                        clean_calc[f"{s_name}!{c_ref}"] = num_v
                    except Exception:
                        pass
            res.metrics["calculated_results"] = clean_calc
        except Exception as calc_exc:
            res.add_warning(f"Headless calculation engine notice: {str(calc_exc)}")

        # 4. Independent Accounting Identity & Control Verification
        if doc_ir and doc_ir.control_assertions:
            for assertion in doc_ir.control_assertions:
                cls._verify_control_assertion(wb, assertion, calc_results, res)
        else:
            cls._heuristic_balance_sheet_check(wb, calc_results, res)

        wb.close()

    @classmethod
    def _normalize_token(cls, s: Any) -> str:
        """Strips all non-alphanumeric characters and lowercases for fuzzy semantic matching."""
        return re.sub(r'[^a-z0-9]', '', str(s or '').lower())

    @classmethod
    def _verify_control_assertion(cls, wb, assertion, calc_results: Dict[str, Any], res: ValidationResult) -> None:
        """Checks equality of financial statement opposing sections using calculated values."""
        name = assertion.name
        left_val = cls._resolve_semantic_value(wb, assertion.left_expr, calc_results)
        right_val = cls._resolve_semantic_value(wb, assertion.right_expr, calc_results)

        if left_val is not None and right_val is not None:
            variance = abs(float(left_val) - float(right_val))
            res.metrics[f"assertion_{assertion.assertion_id}_variance"] = variance
            if variance > assertion.tolerance:
                res.add_error(
                    f"Accounting identity failed for '{name}': {assertion.left_expr} ({left_val}) != "
                    f"{assertion.right_expr} ({right_val}). Variance: {variance:,.2f}"
                )
            else:
                res.add_pass(f"assertion_{assertion.assertion_id}_reconciled")
        else:
            # Check Executive Summary D7 (Reconciliation difference) only if backed by dynamic formula
            d7_val = None
            d7_is_formula = False
            for sname in wb.sheetnames:
                if "EXECUTIVE" in sname.upper():
                    ws_ex = wb[sname]
                    c_d7 = ws_ex["D7"] if ws_ex.max_row >= 7 else None
                    if c_d7 and str(c_d7.value or "").startswith("="):
                        d7_is_formula = True
                        for k, v in calc_results.items():
                            if "D7" in str(k) and sname.upper() in str(k).upper():
                                try:
                                    d7_val = float(str(v).split("[[")[-1].split("]]")[0])
                                except Exception:
                                    pass

            if d7_is_formula and d7_val is not None and abs(d7_val) <= assertion.tolerance:
                res.add_pass(f"assertion_{assertion.assertion_id}_reconciled_via_summary_control")
            else:
                res.add_error(
                    f"Accounting identity verification failed for '{name}': could not independently reconcile {assertion.left_expr} vs {assertion.right_expr}."
                )

    @classmethod
    def _resolve_semantic_value(cls, wb, expr_name: str, calc_results: Dict[str, Any]) -> Optional[float]:
        """Scans workbook and calculated results for cell matching semantic label with flexible punctuation/casing."""
        import openpyxl.utils
        target_norm = cls._normalize_token(expr_name)

        target_variants = [target_norm]
        if "equity" in target_norm and "liabilit" in target_norm:
            target_variants.extend([
                "totalequityandliabilities",
                "totalequityliabilities",
                "totalliabilitiesandequity",
                "totalequityandliability",
                "totalliabilities",
                "totalcapitalandliabilities"
            ])
        elif "asset" in target_norm:
            target_variants.extend([
                "totalassets",
                "totalassetsandapplications",
                "totalapplicationsoffunds",
                "totalfundsapplied"
            ])

        for sname in wb.sheetnames:
            ws = wb[sname]
            for r in range(1, ws.max_row + 1):
                lbl1 = str(ws.cell(row=r, column=1).value or "")
                lbl2 = str(ws.cell(row=r, column=2).value or "")
                for candidate in (lbl1, lbl2):
                    if not candidate:
                        continue
                    c_norm = cls._normalize_token(candidate)
                    if any(t == c_norm or (t in c_norm and len(t) >= 10) for t in target_variants):
                        # Matched label row! Look for number in subsequent columns
                        for c in range(2, ws.max_column + 1):
                            v = ws.cell(row=r, column=c).value
                            # If cell has formula, lookup in calc_results
                            if isinstance(v, str) and v.startswith("="):
                                c_letter = openpyxl.utils.get_column_letter(c)
                                cell_key = f"{sname.upper()}'!{c_letter}{r}"
                                for k, calc_v in calc_results.items():
                                    if cell_key in str(k):
                                        try:
                                            num_str = str(calc_v).split("[[")[-1].split("]]")[0].strip()
                                            return float(num_str)
                                        except Exception:
                                            pass
                            elif isinstance(v, (int, float)):
                                return float(v)
        return None

    @classmethod
    def _heuristic_balance_sheet_check(cls, wb, calc_results: Dict[str, Any], res: ValidationResult) -> None:
        """Scans for Equity/Liabilities and Assets totals with normalized punctuation and verifies equality."""
        total_liab = cls._resolve_semantic_value(wb, "TOTAL - EQUITY AND LIABILITIES", calc_results)
        if total_liab is None:
            total_liab = cls._resolve_semantic_value(wb, "TOTAL LIABILITIES", calc_results)

        total_assets = cls._resolve_semantic_value(wb, "TOTAL - ASSETS", calc_results)
        if total_assets is None:
            total_assets = cls._resolve_semantic_value(wb, "TOTAL ASSETS", calc_results)

        # Check if workbook is a Balance Sheet
        is_bs_workbook = False
        for sname in wb.sheetnames:
            ws = wb[sname]
            s_text = (sname + " " + str(ws.cell(row=1, column=1).value or "") + " " + str(ws.cell(row=2, column=1).value or "")).lower()
            if any(k in s_text for k in ("balance sheet", "schedule iii", "financial position", "equity and liabilities")):
                is_bs_workbook = True
                break

        if total_liab is not None and total_assets is not None:
            variance = abs(total_liab - total_assets)
            res.metrics["balance_sheet_variance"] = variance
            if variance > 0.01:
                res.add_error(
                    f"Balance Sheet out of balance! Total Equity & Liabilities ({total_liab:,.2f}) != "
                    f"Total Assets ({total_assets:,.2f}). Difference: ₹{variance:,.2f}"
                )
            else:
                res.add_pass("balance_sheet_assets_equal_liabilities")
        elif is_bs_workbook:
            if total_liab is None and total_assets is None:
                res.add_warning("Balance sheet format detected but could not locate explicit Total Liabilities / Total Assets rows.")
            elif total_liab is None:
                res.add_error(f"Balance sheet verification failed: Total Assets found ({total_assets:,.2f}) but Total Equity & Liabilities row is missing.")
            elif total_assets is None:
                res.add_error(f"Balance sheet verification failed: Total Equity & Liabilities found ({total_liab:,.2f}) but Total Assets row is missing.")

    @classmethod
    def _validate_docx(cls, p: Path, doc_ir: Optional[DocIR], res: ValidationResult) -> None:
        """Validates Word document structure, non-empty tables, and section headings."""
        try:
            import docx
            doc = docx.Document(str(p))
        except Exception as exc:
            res.add_error(f"Cannot parse DOCX file: {str(exc)}")
            return

        res.add_pass("docx_open_syntax")
        res.metrics["paragraphs_count"] = len(doc.paragraphs)
        res.metrics["tables_count"] = len(doc.tables)

        if len(doc.paragraphs) == 0 and len(doc.tables) == 0:
            res.add_error("DOCX document contains zero paragraphs and zero tables.")
            return

        # Check for empty tables
        for idx, tbl in enumerate(doc.tables):
            if len(tbl.rows) == 0 or len(tbl.columns) == 0:
                res.add_error(f"Table {idx + 1} in DOCX has 0 rows or 0 columns.")
            elif len(tbl.rows) == 1:
                res.add_warning(f"Table {idx + 1} has only a header row with no data rows.")

        res.add_pass("docx_content_structure")

    @classmethod
    def _validate_pptx(cls, p: Path, doc_ir: Optional[DocIR], res: ValidationResult) -> None:
        """Validates PowerPoint presentation slides, shapes, and boundaries."""
        try:
            import pptx
            prs = pptx.Presentation(str(p))
        except Exception as exc:
            res.add_error(f"Cannot parse PPTX presentation: {str(exc)}")
            return

        res.add_pass("pptx_open_syntax")
        slide_count = len(prs.slides)
        res.metrics["slides_count"] = slide_count

        if slide_count == 0:
            res.add_error("PPTX presentation contains 0 slides.")
            return

        # Check for empty slides
        for idx, slide in enumerate(prs.slides):
            if len(slide.shapes) == 0:
                res.add_warning(f"Slide {idx + 1} contains no shapes or text.")

        res.add_pass("pptx_slide_count_and_shapes")

    @classmethod
    def _validate_pdf(cls, p: Path, doc_ir: Optional[DocIR], res: ValidationResult) -> None:
        """Validates PDF structure, page count, and readable text layer."""
        try:
            import pymupdf as fitz
        except ImportError:
            import fitz

        try:
            doc = fitz.open(str(p))
            page_count = len(doc)
            res.metrics["pdf_pages_count"] = page_count

            if page_count == 0:
                res.add_error("PDF document contains 0 pages.")
                doc.close()
                return

            # Check that first page has readable text
            first_page_text = (doc[0].get_text("text") or "").strip()
            if not first_page_text:
                res.add_warning("First page of PDF contains no readable text layer.")

            doc.close()
            res.add_pass("pdf_structure_and_text")
        except Exception as exc:
            res.add_error(f"Cannot parse PDF file: {str(exc)}")
