# -*- coding: utf-8 -*-
"""
Comprehensive Regression Test Suite for RVS AI Document Intelligence & Validation Gate.
Tests:
1. Balanced statement with various label punctuation/casing (TOTAL - EQUITY AND LIABILITIES vs Total Equity and Liabilities).
2. Unbalanced statement -> MUST FAIL.
3. Incorrect formulas (syntax error, #NAME?, summing row 4 header) -> MUST FAIL.
4. Hardcoded zero in reconciliation row -> MUST FAIL (hardcoded zero cannot prove reconciliation).
5. Double-counted subtotals -> MUST FAIL.
6. Strict delivery gate enforcement -> Failed artifact must NOT receive READY status.
7. Word (.docx) and PDF (.pdf) DocIR and validation pipeline.
8. Mode B (Reference Style Extraction & Generation).
9. Mode C (Editable Template Population preserving original file and formatting).
"""

import os
import re
import sys
import time
import shutil
import unittest
from pathlib import Path

# Add project root to path
APP_ROOT = Path(__file__).resolve().parent
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

import openpyxl
from docir_models import (
    DocIR, TargetFormat, GenerationMode, DocumentType,
    SemanticSection, SemanticTable, SemanticRow, SemanticColumn,
    SemanticCell, SemanticRowType, NumberFormatType, ControlAssertion
)
from doc_validator import DocumentValidator, ValidationState
from doc_recovery import BoundedRecoveryEngine
from style_profile_engine import StyleProfileEngine, StyleProfile
from template_engine import TemplatePopulationEngine
from deterministic_generators import ExcelDocIRGenerator, WordDocIRGenerator, PDFDocIRGenerator, PowerPointDocIRGenerator
import vs_ai_doc_generator

TEST_OUT_DIR = APP_ROOT / "data" / "test_regression_outputs"
TEST_OUT_DIR.mkdir(parents=True, exist_ok=True)


class TestValidationHeuristicsAndGates(unittest.TestCase):
    """Rigorous independent test suite for validation heuristics and delivery gates."""

    @classmethod
    def setUpClass(cls):
        TEST_OUT_DIR.mkdir(parents=True, exist_ok=True)

    def test_01_balanced_statement_with_varied_labels(self):
        """Test that balanced sheets with different casing, hyphens, and spaces pass."""
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Balance_Sheet"
        
        # Test case: Unhyphenated Title "Total Equity and Liabilities"
        ws["A1"] = "Balance Sheet as at 31 March 2026"
        ws["A2"] = "M/s Precision Tech Corp"
        ws["A4"] = "Particulars"
        ws["B4"] = "Amount"
        
        ws["A5"] = "Share Capital"
        ws["B5"] = 1500000.0
        ws["A6"] = "Reserves and Surplus"
        ws["B6"] = 1000000.0
        ws["A7"] = "Total Equity and Liabilities"  # Unhyphenated mixed-case!
        ws["B7"] = "=SUM(B5:B6)"
        
        ws["A9"] = "Property Plant and Equipment"
        ws["B9"] = 1800000.0
        ws["A10"] = "Current Assets"
        ws["B10"] = 700000.0
        ws["A11"] = "Total Assets"  # Unhyphenated mixed-case!
        ws["B11"] = "=SUM(B9:B10)"
        
        test_file = TEST_OUT_DIR / "reg_test_balanced_varied_labels.xlsx"
        wb.save(str(test_file))
        wb.close()
        
        res = DocumentValidator.validate_artifact(test_file, target_format="xlsx")
        self.assertTrue(res.is_valid, f"Balanced statement should pass validation: {res.errors}")
        self.assertEqual(res.state, ValidationState.READY)
        self.assertIn("balance_sheet_assets_equal_liabilities", res.checks_passed)

    def test_02_unbalanced_statement_must_fail(self):
        """Test that unbalanced statement is detected and fails validation even with mixed-case labels."""
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Balance_Sheet"
        
        ws["A1"] = "Balance Sheet as at 31 March 2026"
        ws["A4"] = "Particulars"
        ws["B4"] = "Amount"
        
        ws["A5"] = "Share Capital"
        ws["B5"] = 1500000.0
        ws["A6"] = "Total Equity and Liabilities"
        ws["B6"] = "=B5"  # 15,00,000
        
        ws["A8"] = "Fixed Assets"
        ws["B8"] = 2000000.0
        ws["A9"] = "Total Assets"
        ws["B9"] = "=B8"  # 20,00,000 (Mismatch of 5,00,000!)
        
        test_file = TEST_OUT_DIR / "reg_test_unbalanced.xlsx"
        wb.save(str(test_file))
        wb.close()
        
        res = DocumentValidator.validate_artifact(test_file, target_format="xlsx")
        self.assertFalse(res.is_valid, "Unbalanced statement MUST fail validation")
        self.assertEqual(res.state, ValidationState.FAILED)
        self.assertTrue(any("out of balance" in err.lower() for err in res.errors))

    def test_03_incorrect_formulas_must_fail(self):
        """Test that invalid formula syntax, #NAME?, and summing header row 4 are flagged as errors."""
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Schedule"
        
        ws["A1"] = "Schedule of Expenses"
        ws["A4"] = "Expense Head"
        ws["B4"] = "Amount"
        
        ws["A5"] = "Rent"
        ws["B5"] = 50000
        ws["A6"] = "Salary"
        ws["B6"] = 120000
        
        # 1. Summing row 4 header text!
        ws["A7"] = "Total with Header Row"
        ws["B7"] = "=SUM(B4:B6)"
        
        # 2. Invalid syntax / #NAME?
        ws["A8"] = "Broken Formula"
        ws["B8"] = "=NON_EXISTENT_FORMULA_XYZ(B5:B6)"
        
        test_file = TEST_OUT_DIR / "reg_test_bad_formulas.xlsx"
        wb.save(str(test_file))
        wb.close()
        
        res = DocumentValidator.validate_artifact(test_file, target_format="xlsx")
        self.assertFalse(res.is_valid, "Broken formulas and header row inclusions MUST fail validation")
        self.assertEqual(res.state, ValidationState.FAILED)
        self.assertTrue(any("row 4" in err.lower() for err in res.errors))
        self.assertTrue(any("syntax" in err.lower() or "recalculation error" in err.lower() for err in res.errors))

    def test_04_hardcoded_zero_reconciliation_must_fail(self):
        """Test that a hardcoded zero in a reconciliation check row does NOT count as proof of reconciliation."""
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Reconciliation"
        
        ws["A1"] = "Tax Reconciliation"
        ws["A4"] = "Particulars"
        ws["B4"] = "Amount (₹)"
        
        ws["A5"] = "Books Output Tax"
        ws["B5"] = 1000000.0
        ws["A6"] = "Portal GSTR-3B Tax"
        ws["B6"] = 1250000.0  # Actual mismatch of 250,000!
        
        # Fraudulent / lazy hardcoded zero instead of =B5-B6!
        ws["A7"] = "Net Reconciliation Difference"
        ws["B7"] = 0  # Hardcoded literal 0!
        
        test_file = TEST_OUT_DIR / "reg_test_hardcoded_zero.xlsx"
        wb.save(str(test_file))
        wb.close()
        
        res = DocumentValidator.validate_artifact(test_file, target_format="xlsx")
        self.assertFalse(res.is_valid, "Hardcoded zero reconciliation check MUST fail validation")
        self.assertEqual(res.state, ValidationState.FAILED)
        self.assertTrue(any("hardcoded reconciliation" in err.lower() for err in res.errors))

    def test_05_double_counted_subtotals_must_fail(self):
        """Test that formula summing across another subtotal formula is flagged as double-counting."""
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Schedule"
        
        ws["A1"] = "Liabilities & Assets"
        ws["A4"] = "Particulars"
        ws["B4"] = "Amount"
        
        ws["A5"] = "Share Capital"
        ws["B5"] = 1000000
        ws["A6"] = "Reserves"
        ws["B6"] = 500000
        ws["A7"] = "Total Equity"
        ws["B7"] = "=SUM(B5:B6)"  # Subtotal on row 7!
        
        ws["A8"] = "Plant & Machinery"
        ws["B8"] = 1200000
        ws["A9"] = "Current Assets"
        ws["B9"] = 300000
        # Defect: Total Assets sums B5:B9, including row 7 subtotal and liabilities!
        ws["A10"] = "Total Assets"
        ws["B10"] = "=SUM(B5:B9)"
        
        test_file = TEST_OUT_DIR / "reg_test_double_counting.xlsx"
        wb.save(str(test_file))
        wb.close()
        
        res = DocumentValidator.validate_artifact(test_file, target_format="xlsx")
        self.assertFalse(res.is_valid, "Formula cross-summing nested subtotal MUST fail validation")
        self.assertEqual(res.state, ValidationState.FAILED)
        self.assertTrue(any("double-counted subtotal" in err.lower() for err in res.errors))

    def test_06_strict_delivery_gate_enforcement(self):
        """Test that export_ai_spreadsheet_xlsx blocks delivery on failed validation and stamps 'failed' in SQLite."""
        # Content with hardcoded reconciliation difference of 0
        bad_markdown = """
# GSTR-3B vs Books Reconciliation Statement

| Particulars | Books Amount (₹) | Portal Amount (₹) |
| :--- | :--- | :--- |
| Outward Taxable Supplies | ₹ 50,00,000 | ₹ 60,00,000 |
| IGST Liability | ₹ 9,00,000 | ₹ 10,80,000 |
| Difference Check | 0 | 0 |
"""
        res = vs_ai_doc_generator.export_ai_spreadsheet_xlsx(
            title="GSTR-3B vs Books Reconciliation",
            content=bad_markdown,
            client_name="Test Client Corp",
            output_dir=TEST_OUT_DIR
        )
        
        # Verify response contract
        self.assertFalse(res["ok"], "Export must return ok=False on validation failure")
        self.assertEqual(res["status"], "failed", "Status must be 'failed'")
        self.assertIsNone(res.get("download_url"), "download_url must be None to prevent delivery")
        self.assertTrue(len(res.get("validation_errors", [])) > 0, "Validation errors must be listed")

    def test_07_word_docx_generation_and_validation(self):
        """Test that Word export compiles via DocIR and passes independent validation."""
        md_content = """
# Statutory Tax Advisory Memo

## Executive Summary
This advisory memorandum reviews the statutory tax implications under Section 43B(h) of the Income-tax Act, 1961.

## Compliance Table
| Due Date | Supplier Category | Payment Term | Statutory Status |
| :--- | :--- | :--- | :--- |
| 15 Days | Micro Enterprise | Timely | Allowed |
| 45 Days | Small Enterprise | Written Agreement | Allowed |
"""
        res = vs_ai_doc_generator.export_ai_document_docx(
            title="Statutory Tax Advisory Memo",
            content=md_content,
            client_name="Apex Holdings Pvt. Ltd.",
            output_dir=TEST_OUT_DIR
        )
        
        self.assertTrue(res["ok"], f"DOCX generation failed: {res.get('error')}")
        self.assertEqual(res["status"], "ready")
        self.assertTrue(Path(res["path"]).exists())
        self.assertGreater(Path(res["path"]).stat().st_size, 1000)

    def test_08_pdf_generation_and_validation(self):
        """Test that PDF export compiles via DocIR and passes independent validation."""
        md_content = """
# Formal Legal Opinion on Input Tax Credit

## Background
The client has received an advisory communication regarding ITC mismatch under Rule 88C of the CGST Rules.

## Disputed Invoices
| Invoice No. | Supplier GSTIN | Taxable Value (₹) | ITC Claimed (₹) |
| :--- | :--- | :--- | :--- |
| INV-2025-01 | 27AABCT1234A1Z5 | ₹ 10,00,000 | ₹ 1,80,000 |
| INV-2025-02 | 27AABCT5678B1Z2 | ₹ 5,00,000 | ₹ 90,000 |
| Total | | ₹ 15,00,000 | ₹ 2,70,000 |
"""
        res = vs_ai_doc_generator.export_ai_opinion_pdf(
            title="Formal Legal Opinion on Input Tax Credit",
            content=md_content,
            client_name="Apex Holdings Pvt. Ltd.",
            output_dir=TEST_OUT_DIR
        )
        
        self.assertTrue(res["ok"], f"PDF generation failed: {res.get('error')}")
        self.assertEqual(res["status"], "ready")
        self.assertTrue(Path(res["path"]).exists())
        self.assertGreater(Path(res["path"]).stat().st_size, 1000)

    def test_09_mode_b_reference_style_extraction_and_application(self):
        """Test Mode B: Style extraction from reference document and application to new generation."""
        # 1. Create a distinctive styled reference document
        ref_file = TEST_OUT_DIR / "distinctive_reference.xlsx"
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "CustomStyle"
        fill_teal = openpyxl.styles.PatternFill(start_color="0D9488", end_color="0D9488", fill_type="solid")
        font_cambria = openpyxl.styles.Font(name="Cambria", size=11, bold=True, color="FFFFFF")
        
        for c in range(1, 4):
            cell = ws.cell(row=1, column=c, value=f"Header {c}")
            cell.fill = fill_teal
            cell.font = font_cambria
        wb.save(str(ref_file))
        wb.close()
        
        # 2. Extract style profile
        profile = StyleProfileEngine.extract_style(ref_file)
        self.assertEqual(profile.source_format, "xlsx")
        self.assertIn("0D9488", profile.color_bg_header_hex.upper())
        
        # 3. Generate new spreadsheet applying the extracted style
        sample_md = """
| Particulars | Q1 (₹) | Q2 (₹) |
| :--- | :--- | :--- |
| Professional Fees | ₹ 2,50,000 | ₹ 3,10,000 |
| Retainership | ₹ 1,00,000 | ₹ 1,00,000 |
"""
        res = vs_ai_doc_generator.export_ai_spreadsheet_xlsx(
            title="Quarterly Billing Statement",
            content=sample_md,
            client_name="Emerald Advisory",
            reference_file_path=str(ref_file),
            output_dir=TEST_OUT_DIR
        )
        
        self.assertTrue(res["ok"], f"Mode B export failed: {res.get('error')}")
        self.assertEqual(res["status"], "ready")
        
        # Verify the generated spreadsheet uses the extracted teal header
        wb_gen = openpyxl.load_workbook(res["path"])
        ws_gen = wb_gen[wb_gen.sheetnames[0]]
        header_fill_color = ws_gen["A4"].fill.start_color.rgb
        wb_gen.close()
        self.assertTrue("0D9488" in str(header_fill_color).upper() or "000D9488" in str(header_fill_color).upper())

    def test_10_mode_c_editable_template_population(self):
        """Test Mode C: Populating template placeholders and rows while preserving original file & formatting."""
        # 1. Create a pristine template file
        tpl_file = TEST_OUT_DIR / "pristine_template.xlsx"
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Statement"
        
        ws["A1"] = "Client: {{client_name}}"
        ws["A2"] = "PAN: {{pan_number}}"
        ws["A4"] = "Particulars"
        ws["B4"] = "Amount (₹)"
        
        ws["A5"] = "Basic Salary"
        ws["B5"] = 0  # Placeholder to be filled
        ws["A6"] = "HRA"
        ws["B6"] = 0  # Placeholder to be filled
        ws["A7"] = "Total Gross Salary"
        ws["B7"] = "=SUM(B5:B6)"  # Existing template formula!
        
        wb.save(str(tpl_file))
        wb.close()
        
        orig_hash_before = Path(tpl_file).stat().st_size
        
        # 2. Populate template
        dest_file = TEST_OUT_DIR / "populated_output.xlsx"
        pop_res = TemplatePopulationEngine.populate_template(
            template_path=tpl_file,
            output_path=dest_file,
            context_data={"client_name": "RVS Advisory LLP", "pan_number": "AABCR1234F"},
            table_data=[
                {"label": "basic salary", "value": 850000, "column": 2},
                {"label": "hra", "value": 350000, "column": 2}
            ]
        )
        
        self.assertTrue(pop_res["ok"], f"Template population failed: {pop_res.get('error')}")
        
        # 3. Verify original template file was NOT modified
        self.assertEqual(Path(tpl_file).stat().st_size, orig_hash_before)
        
        # 4. Verify populated file
        wb_dest = openpyxl.load_workbook(str(dest_file), data_only=False)
        ws_dest = wb_dest["Statement"]
        self.assertEqual(ws_dest["A1"].value, "Client: RVS Advisory LLP")
        self.assertEqual(ws_dest["A2"].value, "PAN: AABCR1234F")
        self.assertEqual(ws_dest["B5"].value, 850000)
        self.assertEqual(ws_dest["B6"].value, 350000)
        # Verify formula was preserved!
        self.assertEqual(ws_dest["B7"].value, "=SUM(B5:B6)")
        wb_dest.close()
        
        # 5. Verify independent validation passes
        val = DocumentValidator.validate_artifact(dest_file, target_format="xlsx")
        self.assertTrue(val.is_valid, f"Populated template failed validation: {val.errors}")
        self.assertEqual(val.state, ValidationState.READY)


if __name__ == "__main__":
    unittest.main(verbosity=2)
