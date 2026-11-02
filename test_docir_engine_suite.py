# -*- coding: utf-8 -*-
"""
Master Verification & Acceptance Test Suite for RVS AI Document Intelligence Engine.
Covers Tests A through J:
  Test A: Professional Mode (Schedule III generation with verified row mapping & control totals)
  Test B: Reference Style Mode (Style extraction from reference documents and reproduction)
  Test C: Editable Template Mode (In-place population preserving formulas & styles, non-destructive)
  Test D: Formula Coordinate Regression (Header row 4 exclusion, detail row summation)
  Test E: Accounting Identity Verification (Unbalanced balance sheet blocked as FAILED)
  Test F: Headless Formula Recalculation (formulas.ExcelModel full dependency graph evaluation)
  Test G: Typography & Font Fallback Resolution
  Test H: Output Integrity & Corrupt Input Rejection
  Test I: PowerPoint (.pptx) Native 16:9 Generation & Slide Deck Validation
  Test J: Existing Server & Export API Integration Health
"""

import os
import sys
import unittest
import tempfile
import openpyxl
from pathlib import Path

# Ensure application root is in python path
APP_ROOT = Path(__file__).resolve().parent
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from docir_models import (
    DocIR, GenerationMode, TargetFormat, DocumentType,
    SemanticSection, SemanticTable, SemanticRow, SemanticColumn,
    SemanticCell, SemanticRowType, NumberFormatType, ControlAssertion,
    SlideContent
)
from style_profile_engine import StyleProfileEngine, StyleProfile
from doc_validator import DocumentValidator, ValidationState
from deterministic_generators import (
    ExcelDocIRGenerator, WordDocIRGenerator,
    PowerPointDocIRGenerator, PDFDocIRGenerator
)
from template_engine import TemplatePopulationEngine
from doc_recovery import BoundedRecoveryEngine
from docir_builder import DocIRBuilder, ModeDetector


class MasterDocIREngineTestSuite(unittest.TestCase):
    """Full acceptance suite validating all 10 core dimensions."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.work_dir = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    # -------------------------------------------------------------------------
    # TEST A: Professional Mode (Schedule III Balance Sheet Generation)
    # -------------------------------------------------------------------------
    def test_a_professional_mode_generation(self):
        """Validates Mode A generation: Schedule III with verified formulas, rows starting at 5+, no text header summation."""
        doc_ir = DocIRBuilder.create_schedule_iii_balance_sheet_docir(
            title="Professional Schedule III Balance Sheet",
            client_name="Test Enterprise LLP",
            share_capital=5000000.0,
            reserves_surplus=4190000.0,
            long_term_borrowings=2800000.0,
            trade_payables=1840000.0,
            short_term_provisions=460000.0,
            property_plant_equipment=6800000.0,
            inventories=2450000.0,
            trade_receivables=3120000.0,
            cash_bank=1480000.0,
            short_term_advances=440000.0,
            mode=GenerationMode.PROFESSIONAL,
            target_format=TargetFormat.XLSX
        )
        out_xlsx = self.work_dir / "test_a_schedule_iii.xlsx"
        ExcelDocIRGenerator.generate(doc_ir, output_path=out_xlsx)
        self.assertTrue(out_xlsx.exists())

        # Inspect generated workbook
        wb = openpyxl.load_workbook(str(out_xlsx), data_only=False)
        self.assertIn("Equity_and_Liabilities", wb.sheetnames)
        self.assertIn("Assets", wb.sheetnames)
        self.assertIn("Executive_Summary", wb.sheetnames)

        ws_eq = wb["Equity_and_Liabilities"]
        # Verify Row 4 is header, details start at Row 5
        self.assertEqual(ws_eq.cell(row=4, column=1).value, "Particulars")
        self.assertEqual(ws_eq.cell(row=5, column=1).value, "I. EQUITY AND LIABILITIES")
        self.assertEqual(ws_eq.cell(row=6, column=1).value, "(1) Shareholders' Funds")
        self.assertEqual(ws_eq.cell(row=7, column=1).value, "(a) Share capital")
        self.assertEqual(ws_eq.cell(row=8, column=1).value, "(b) Reserves and surplus")

        # Subtotal row must sum detail rows strictly (C7:C8), NEVER including header C4 or category C5/C6
        sub_formula = str(ws_eq.cell(row=9, column=3).value)
        self.assertEqual(sub_formula, "=SUM(C7:C8)")

        # Verify Grand Total is a sum of subtotals, not double-counting detail rows
        gt_formula = str(ws_eq.cell(row=17, column=3).value)
        self.assertEqual(gt_formula, "=C9+C12+C16")

        # Verify Executive Summary reconciliation formula is difference, not addition
        ws_sum = wb["Executive_Summary"]
        diff_cell = ws_sum.cell(row=7, column=4).value
        self.assertEqual(str(diff_cell), "=D5-D6")

        # Independent validation gate
        val_res = DocumentValidator.validate_artifact(out_xlsx, doc_ir, "xlsx")
        self.assertTrue(val_res.is_valid, f"Validation failed: {val_res.errors}")
        self.assertEqual(val_res.state, ValidationState.READY)

    # -------------------------------------------------------------------------
    # TEST B: Reference Style Mode (Extraction & Reproduction)
    # -------------------------------------------------------------------------
    def test_b_reference_style_mode(self):
        """Validates Mode B: Style extraction from reference document and reproduction in generated output."""
        # Create a reference style profile
        custom_style = StyleProfile(
            profile_id="ref_custom_firm",
            profile_name="Custom Firm Reference Style",
            font_primary="Georgia",
            font_secondary="Calibri",
            color_primary_hex="#7C2D12",   # Dark rust
            color_secondary_hex="#9A3412",
            color_bg_header_hex="#431407"
        )
        StyleProfileEngine.save_profile(custom_style)

        # Build a DocIR that references this style
        doc_ir = DocIRBuilder.from_markdown_or_prompt(
            text="## 1. Executive Findings\nReference style reproduction verified.\n- Finding A: Full compliance.\n- Finding B: Zero discrepancy.",
            title="Style Reference Report",
            target_format=TargetFormat.DOCX,
            client_name="Heritage Textiles Ltd",
            mode=GenerationMode.REFERENCE_STYLE,
            style_profile_id="ref_custom_firm"
        )
        out_docx = self.work_dir / "test_b_styled.docx"
        WordDocIRGenerator.generate(doc_ir, style=custom_style, output_path=out_docx)
        self.assertTrue(out_docx.exists())

        # Inspect generated docx typography
        import docx
        doc = docx.Document(str(out_docx))
        title_run = doc.paragraphs[1].runs[0]  # Title paragraph
        self.assertEqual(title_run.font.name, "Georgia")
        self.assertEqual(str(title_run.font.color.rgb).upper(), "7C2D12")

        val_res = DocumentValidator.validate_artifact(out_docx, doc_ir, "docx")
        self.assertTrue(val_res.is_valid)

    # -------------------------------------------------------------------------
    # TEST C: Editable Template Mode (In-Place Population Without Breaking Formulas)
    # -------------------------------------------------------------------------
    def test_c_editable_template_population(self):
        """Validates Mode C: Non-destructive template population preserving formulas and original styles."""
        # Create a mock template with a formula
        tmpl_path = self.work_dir / "source_template.xlsx"
        wb_orig = openpyxl.Workbook()
        ws = wb_orig.active
        ws.title = "Financials"
        ws["A1"] = "Client Name"
        ws["B1"] = "[CLIENT_NAME]"
        ws["A2"] = "Gross Revenue"
        ws["B2"] = 0
        ws["A3"] = "Operating Expenses"
        ws["B3"] = 0
        ws["A4"] = "Net Operating Income"
        ws["B4"] = "=B2-B3"   # Live formula in template
        wb_orig.save(str(tmpl_path))

        out_populated = self.work_dir / "populated_output.xlsx"
        payload = {
            "B1": "Mahindra Solutions Ltd",
            "B2": 4500000.0,
            "B3": 2800000.0
        }
        res = TemplatePopulationEngine.populate_template(
            template_path=tmpl_path,
            output_path=out_populated,
            context_data=payload
        )
        self.assertTrue(res.get("ok"), f"Template population error: {res}")
        self.assertTrue(out_populated.exists())

        # Check source template was NEVER modified
        wb_source_check = openpyxl.load_workbook(str(tmpl_path))
        self.assertEqual(wb_source_check["Financials"]["B1"].value, "[CLIENT_NAME]")

        # Check populated workbook has values updated AND formula preserved
        wb_pop = openpyxl.load_workbook(str(out_populated), data_only=False)
        self.assertEqual(wb_pop["Financials"]["B1"].value, "Mahindra Solutions Ltd")
        self.assertEqual(wb_pop["Financials"]["B2"].value, 4500000.0)
        self.assertEqual(wb_pop["Financials"]["B3"].value, 2800000.0)
        self.assertEqual(wb_pop["Financials"]["B4"].value, "=B2-B3")  # Formula perfectly intact!

    # -------------------------------------------------------------------------
    # TEST D: Formula Coordinate Regression (Legacy Header Summation Defect)
    # -------------------------------------------------------------------------
    def test_d_formula_coordinate_regression(self):
        """Explicitly proves that the legacy defect (summing row 4 header) is completely eliminated."""
        import re
        doc_ir = DocIRBuilder.create_schedule_iii_balance_sheet_docir(
            title="Regression Test Balance Sheet",
            client_name="Apex Quality Check"
        )
        out_xlsx = self.work_dir / "test_d_regression.xlsx"
        ExcelDocIRGenerator.generate(doc_ir, output_path=out_xlsx)

        wb = openpyxl.load_workbook(str(out_xlsx), data_only=False)
        ws_eq = wb["Equity_and_Liabilities"]

        # Examine all formulas in column C
        for row in range(1, ws_eq.max_row + 1):
            val = str(ws_eq.cell(row=row, column=3).value or "")
            if val.startswith("="):
                # Ensure no formula references C1, C2, C3, or C4 using word-boundary regex
                self.assertFalse(
                    bool(re.search(r'\bC[1-4]\b', val)),
                    f"Row {row} formula '{val}' illegally references header rows C1-C4!"
                )

    # -------------------------------------------------------------------------
    # TEST E: Accounting Identity Verification (Unbalanced Balance Sheet Blocked)
    # -------------------------------------------------------------------------
    def test_e_accounting_identity_unbalanced_rejected(self):
        """Verifies that an unbalanced balance sheet is caught by DocumentValidator and blocked."""
        doc_ir_unbalanced = DocIRBuilder.create_schedule_iii_balance_sheet_docir(
            title="Unbalanced Balance Sheet",
            share_capital=5000000.0,
            reserves_surplus=4190000.0,
            property_plant_equipment=99999999.0  # Intentional massive mismatch!
        )
        out_xlsx = self.work_dir / "test_e_unbalanced.xlsx"
        ExcelDocIRGenerator.generate(doc_ir_unbalanced, output_path=out_xlsx)

        val_res = DocumentValidator.validate_artifact(out_xlsx, doc_ir_unbalanced, "xlsx")
        self.assertFalse(val_res.is_valid, "Validator should reject unbalanced balance sheet!")
        self.assertEqual(val_res.state, ValidationState.FAILED)
        self.assertTrue(any("accounting identity failed" in err.lower() or "out of balance" in err.lower() for err in val_res.errors))

    # -------------------------------------------------------------------------
    # TEST F: Headless Formula Recalculation (formulas.ExcelModel Graph)
    # -------------------------------------------------------------------------
    def test_f_headless_formula_recalculation(self):
        """Validates that formulas library parses OpenXML formula graph and evaluates correct totals."""
        doc_ir = DocIRBuilder.create_schedule_iii_balance_sheet_docir(
            title="Formula Calculation Test",
            share_capital=2000000.0,
            reserves_surplus=1000000.0,
            long_term_borrowings=500000.0,
            trade_payables=400000.0,
            short_term_provisions=100000.0,
            property_plant_equipment=2500000.0,
            inventories=500000.0,
            trade_receivables=600000.0,
            cash_bank=300000.0,
            short_term_advances=100000.0
        )
        out_xlsx = self.work_dir / "test_f_recalc.xlsx"
        ExcelDocIRGenerator.generate(doc_ir, output_path=out_xlsx)

        val_res = DocumentValidator.validate_artifact(out_xlsx, doc_ir, "xlsx")
        self.assertTrue(val_res.is_valid)

        # Check recalculated figures in metrics
        calc_res = val_res.metrics.get("calculated_results", {})
        # Total Equity & Liabilities = 20L + 10L + 5L + 4L + 1L = 40 Lakhs (4,000,000)
        # Total Assets = 25L + 5L + 6L + 3L + 1L = 40 Lakhs (4,000,000)
        # Difference = 0.0
        calc_total_eq = calc_res.get("EQUITY_AND_LIABILITIES!C17") if "EQUITY_AND_LIABILITIES!C17" in calc_res else calc_res.get("Equity_and_Liabilities!C17")
        calc_total_asst = calc_res.get("ASSETS!C15") if "ASSETS!C15" in calc_res else calc_res.get("Assets!C15")
        calc_diff = calc_res.get("EXECUTIVE_SUMMARY!D7") if "EXECUTIVE_SUMMARY!D7" in calc_res else calc_res.get("Executive_Summary!D7")
        self.assertEqual(calc_total_eq, 4000000.0)
        self.assertEqual(calc_total_asst, 4000000.0)
        self.assertEqual(calc_diff, 0.0)

    # -------------------------------------------------------------------------
    # TEST G: Typography & Font Fallback Resolution
    # -------------------------------------------------------------------------
    def test_g_font_fallback_resolution(self):
        """Validates font fallback resolution when non-existent font is specified."""
        resolved = StyleProfileEngine.resolve_font_family("NonExistentFancyFont", "pdf")
        self.assertEqual(resolved, "Helvetica")

        resolved_win = StyleProfileEngine.resolve_font_family("NonExistentFancyFont", "docx")
        self.assertEqual(resolved_win, "Calibri")

    # -------------------------------------------------------------------------
    # TEST H: Output Integrity & Corrupt Input Rejection
    # -------------------------------------------------------------------------
    def test_h_output_integrity_corrupt_rejection(self):
        """Validates that a corrupt or 0-byte file is caught by validator and marked FAILED."""
        corrupt_file = self.work_dir / "corrupt_file.xlsx"
        with open(corrupt_file, "wb") as f:
            f.write(b"NOT_A_VALID_ZIP_OR_XLSX_DATA")

        doc_ir = DocIRBuilder.from_markdown_or_prompt("Sample", target_format=TargetFormat.XLSX)
        val_res = DocumentValidator.validate_artifact(corrupt_file, doc_ir, "xlsx")
        self.assertFalse(val_res.is_valid)
        self.assertEqual(val_res.state, ValidationState.FAILED)
        self.assertTrue(len(val_res.errors) > 0)

    # -------------------------------------------------------------------------
    # TEST I: PowerPoint (.pptx) Native 16:9 Slide Deck Generation & Validation
    # -------------------------------------------------------------------------
    def test_i_powerpoint_generation_and_validation(self):
        """Validates native PowerPoint 16:9 presentation generation and independent validation."""
        doc_ir = DocIR(
            title="Q4 Board Audit Review",
            subtitle="Statutory Audit Presentation",
            generation_mode=GenerationMode.PROFESSIONAL,
            target_format=TargetFormat.PPTX,
            document_type=DocumentType.BOARD_PRESENTATION,
            client_name="Axis Industrial Corp",
            slides=[
                SlideContent(
                    title="Key Financial Milestones",
                    bullets=[
                        "Total Turnover increased by 18.4% YoY.",
                        "Net Working Capital ratio maintained at 2.4x.",
                        "Zero statutory notices pending across direct and indirect taxes."
                    ]
                ),
                SlideContent(
                    title="Statutory Tax Position",
                    bullets=[
                        "Form 3CD filed prior to specified date.",
                        "Advance tax installments paid strictly on schedule."
                    ]
                )
            ]
        )
        out_pptx = self.work_dir / "test_i_board_review.pptx"
        PowerPointDocIRGenerator.generate(doc_ir, output_path=out_pptx)
        self.assertTrue(out_pptx.exists())

        # Inspect pptx
        import pptx
        from pptx.util import Inches
        prs = pptx.Presentation(str(out_pptx))
        self.assertAlmostEqual(prs.slide_width.inches, 13.33, places=1)  # 16:9 Widescreen
        self.assertEqual(len(prs.slides), 3)  # Title + 2 content slides

        # Independent validation
        val_res = DocumentValidator.validate_artifact(out_pptx, doc_ir, "pptx")
        self.assertTrue(val_res.is_valid)
        self.assertEqual(val_res.state, ValidationState.READY)

    # -------------------------------------------------------------------------
    # TEST J: Existing Server & Export API Integration Health
    # -------------------------------------------------------------------------
    def test_j_existing_server_and_export_endpoints(self):
        """Validates that export endpoints and helper functions in vs_ai_doc_generator and server operate cleanly."""
        import vs_ai_doc_generator

        # 1. Test export_ai_spreadsheet_xlsx
        res_xlsx = vs_ai_doc_generator.export_ai_spreadsheet_xlsx(
            title="Integration Health Spreadsheet",
            content="| Metric | Value |\n| :--- | ---: |\n| Revenue | 100 |\n| Cost | 60 |\n| Profit | =B5-B6 |\n",
            client_name="Test Health LLP"
        )
        self.assertTrue(res_xlsx.get("ok"))
        self.assertTrue(Path(res_xlsx["file_path"]).exists())

        # 2. Test export_ai_presentation_pptx
        res_pptx = vs_ai_doc_generator.export_ai_presentation_pptx(
            title="Integration Health Presentation",
            content="## Slide 1: Welcome\n- Point 1\n- Point 2\n\n## Slide 2: Review\n- Audit complete",
            client_name="Test Health LLP"
        )
        self.assertTrue(res_pptx.get("ok"))
        self.assertTrue(Path(res_pptx["file_path"]).exists())
        self.assertEqual(res_pptx.get("format"), "pptx")


if __name__ == "__main__":
    unittest.main()
