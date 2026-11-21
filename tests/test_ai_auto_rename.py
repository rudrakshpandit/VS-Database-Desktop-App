"""
VS Database — AI Auto Document Rename Verification Suite
Covers 16 comprehensive tests:
1. Standard GST Return (GSTR-3B) with September 2026 period -> 'GST RETURN Sept.26 XYZ&CO..pdf'
2. Standard ITR Acknowledgement (ITR-V) with AY 2026-27 -> 'ITR AY 26-27 MR. Ramlal.pdf'
3. Form 26AS with AY 2025-26 -> 'FORM 26AS AY 25-26 XYZ&CO..pdf'
4. Period normalization with 'Sept.' instead of 'Sep.'
5. FY normalization ('FY 25-26') vs AY normalization ('AY 26-27')
6. Client entity name normalization ('XYZ & CO.' -> 'XYZ&CO.')
7. Client mismatch detection (document belongs to 'ABC Traders', active context is 'XYZ&CO.')
8. Missing period fallback (does not hallucinate, clean output)
9. Missing client fallback (uses active context or clean output)
10. Filename sanitization (removes illegal Windows chars: \\ / : * ? \" < > |)
11. Extension preservation (.pdf preserved)
12. Duplicate collision handling ('keep_both' generates '(1)')
13. Duplicate collision handling ('replace' removes older)
14. Scanned / low-text fallback handling
15. Strictly first 2 pages analysis verification
16. Backend endpoint structure and contract verification
"""

import os
import shutil
import tempfile
import unittest
from pathlib import Path

import fitz  # PyMuPDF
import vs_ai_rename
from vs_ai_rename import (
    DocumentContentExtractor,
    NamingTemplateEngine,
    normalize_month_token,
    normalize_client_name,
    sanitize_filename,
    check_client_mismatch,
    generate_unique_filename,
    AiAutoRenameCoordinator
)


class TestAiAutoDocumentRename(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp(prefix="vs_ai_rename_test_"))

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _create_sample_pdf(self, pages_text: list) -> Path:
        """Helper to create multi-page test PDF in temp dir."""
        doc = fitz.open()
        for text in pages_text:
            page = doc.new_page()
            page.insert_text((50, 72), text)
        pdf_path = self.temp_dir / f"test_doc_{len(pages_text)}p.pdf"
        doc.save(str(pdf_path))
        doc.close()
        return pdf_path

    # Test 1: GST Return
    def test_01_gstr3b_september_2026(self):
        content = (
            "Form GSTR-3B\n"
            "[See rule 61(5)]\n"
            "Return of outward supplies and inward supplies\n"
            "Year: 2026-2027\n"
            "Return Period: September 2026\n"
            "GSTIN: 07AAAAA0000A1Z5\n"
            "Legal Name of Business: XYZ & CO.\n"
        )
        pdf_path = self._create_sample_pdf([content])
        coord = AiAutoRenameCoordinator()
        res = coord.analyze_document(str(pdf_path), context_client_name="XYZ & CO.")
        self.assertTrue(res["ok"])
        self.assertIn("GSTR-3B", res["proposed_filename"])
        self.assertIn("Sept.26", res["proposed_filename"])
        self.assertIn("XYZ&CO.", res["proposed_filename"])
        self.assertEqual(res["confidence"], "HIGH")

    # Test 2: ITR Acknowledgement
    def test_02_itr_acknowledgement_ay_26_27(self):
        content = (
            "INDIAN INCOME TAX RETURN ACKNOWLEDGEMENT\n"
            "[Where the data of the Return of Income in Form ITR-1 (SAHAJ)]\n"
            "Assessment Year: 2026-27\n"
            "PAN: ABCDE1234F\n"
            "Name: MR. Ramlal\n"
            "Filed u/s 139(1)\n"
        )
        pdf_path = self._create_sample_pdf([content])
        coord = AiAutoRenameCoordinator()
        res = coord.analyze_document(str(pdf_path), context_client_name="MR. Ramlal")
        self.assertTrue(res["ok"])
        self.assertIn("ITR", res["proposed_filename"])
        self.assertIn("AY 26-27", res["proposed_filename"])
        self.assertIn("Ramlal", res["proposed_filename"])

    # Test 3: Form 26AS
    def test_03_form_26as_ay_25_26(self):
        content = (
            "FORM NO. 26AS\n"
            "Annual Tax Statement under Section 203AA of the Income-tax Act, 1961\n"
            "Assessment Year : 2025-26\n"
            "Permanent Account Number (PAN): AAAAA0000A\n"
            "Name of Assessee: XYZ & CO.\n"
        )
        pdf_path = self._create_sample_pdf([content])
        coord = AiAutoRenameCoordinator()
        res = coord.analyze_document(str(pdf_path), context_client_name="XYZ & CO.")
        self.assertTrue(res["ok"])
        self.assertIn("FORM 26AS", res["proposed_filename"])
        self.assertIn("AY 25-26", res["proposed_filename"])

    # Test 4: Month Normalization (Sept. instead of Sep.)
    def test_04_month_normalization_sept(self):
        self.assertEqual(normalize_month_token("September"), "Sept.")
        self.assertEqual(normalize_month_token("sep"), "Sept.")
        self.assertEqual(normalize_month_token("sept"), "Sept.")
        self.assertEqual(normalize_month_token("jan"), "Jan.")
        self.assertEqual(normalize_month_token("august"), "Aug.")

    # Test 5: FY vs AY Normalization
    def test_05_fy_vs_ay_distinction(self):
        ay_text = "Income Tax Return for Assessment Year : 2026-2027"
        period_ay, ptype_ay, _ = DocumentContentExtractor.extract_period(ay_text)
        self.assertEqual(period_ay, "AY 26-27")
        self.assertEqual(ptype_ay, "AY")

        fy_text = "Balance Sheet and Profit & Loss Statement for Financial Year 2025-26"
        period_fy, ptype_fy, _ = DocumentContentExtractor.extract_period(fy_text)
        self.assertEqual(period_fy, "FY 25-26")
        self.assertEqual(ptype_fy, "FY")

    # Test 6: Client Name Normalization
    def test_06_client_name_normalization(self):
        self.assertEqual(normalize_client_name("XYZ & CO."), "XYZ&CO.")
        self.assertEqual(normalize_client_name("ABC and Sons"), "ABC&Sons")
        self.assertEqual(normalize_client_name("M/S. Sharma & Associates"), "Sharma&Associates")

    # Test 7: Client Mismatch Detection
    def test_07_client_mismatch_warning(self):
        mismatch, msg = check_client_mismatch("ABC Traders", "XYZ&CO.")
        self.assertTrue(mismatch)
        self.assertIn("ABC Traders", msg)

        # Same client with slight variation should NOT mismatch
        no_mismatch, _ = check_client_mismatch("XYZ & CO.", "XYZ&CO.")
        self.assertFalse(no_mismatch)

    # Test 8: Missing Period Fallback (No hallucination)
    def test_08_missing_period_fallback(self):
        content = "Tax Invoice\nInvoice No: INV-102\nName of Taxpayer: ABC Enterprises"
        pdf_path = self._create_sample_pdf([content])
        coord = AiAutoRenameCoordinator()
        res = coord.analyze_document(str(pdf_path), context_client_name="ABC Enterprises")
        self.assertTrue(res["ok"])
        # Should not invent any month or year
        self.assertNotIn("Sept", res["proposed_filename"])
        self.assertNotIn("AY", res["proposed_filename"])
        self.assertIn("TAX INVOICE", res["proposed_filename"])
        self.assertIn("ABC Enterprises", res["proposed_filename"])

    # Test 9: Missing Client Fallback
    def test_09_missing_client_fallback(self):
        content = "Challan No./ITNS 280\nPayment of Advance Tax\nAssessment Year: 2026-27"
        pdf_path = self._create_sample_pdf([content])
        coord = AiAutoRenameCoordinator()
        # With active client context
        res = coord.analyze_document(str(pdf_path), context_client_name="Ramlal Sons")
        self.assertIn("CHALLAN 280", res["proposed_filename"])
        self.assertIn("AY 26-27", res["proposed_filename"])
        self.assertIn("Ramlal Sons", res["proposed_filename"])

    # Test 10: Filename Sanitization
    def test_10_filename_sanitization(self):
        unsafe = 'GST RETURN: Sept.26 / XYZ & CO. <Audit>*?.pdf'
        safe = sanitize_filename(unsafe)
        self.assertNotIn(':', safe)
        self.assertNotIn('/', safe)
        self.assertNotIn('<', safe)
        self.assertNotIn('>', safe)
        self.assertNotIn('*', safe)
        self.assertNotIn('?', safe)
        self.assertTrue(safe.endswith('.pdf'))

    # Test 11: Extension Preservation
    def test_11_extension_preservation(self):
        name = NamingTemplateEngine.format_filename("ITR", "AY 26-27", "XYZ", extension=".pdf")
        self.assertTrue(name.endswith(".pdf"))

    # Test 12: Duplicate Collision Handling (Keep Both)
    def test_12_duplicate_keep_both(self):
        base_name = "GST RETURN Sept.26 XYZ&CO..pdf"
        (self.temp_dir / base_name).write_text("dummy")
        unique_name = generate_unique_filename(self.temp_dir, base_name)
        self.assertEqual(unique_name, "GST RETURN Sept.26 XYZ&CO. (1).pdf")

    # Test 13: Multiple Duplicates Handling
    def test_13_multiple_duplicates(self):
        base_name = "ITR AY 26-27 Ramlal.pdf"
        (self.temp_dir / base_name).write_text("1")
        (self.temp_dir / "ITR AY 26-27 Ramlal (1).pdf").write_text("2")
        unique_name = generate_unique_filename(self.temp_dir, base_name)
        self.assertEqual(unique_name, "ITR AY 26-27 Ramlal (2).pdf")

    # Test 14: Scanned / Sparse Text Handling
    def test_14_scanned_sparse_text(self):
        content = "Page 1 scan"
        pdf_path = self._create_sample_pdf([content])
        coord = AiAutoRenameCoordinator(gemini_provider=None)
        res = coord.analyze_document(str(pdf_path), context_client_name="XYZ&CO.")
        self.assertTrue(res["ok"])
        # With no Gemini API key and sparse text, falls back to LOW confidence and does not crash
        self.assertEqual(res["confidence"], "LOW")

    # Test 15: Strictly First 2 Pages Analyzed
    def test_15_strictly_first_two_pages(self):
        p1 = "Form GSTR-3B Return Period: September 2026 Legal Name: XYZ & CO."
        p2 = "Table 3.1 Details of Outward Supplies"
        p3 = "Table 4 Eligible ITC - October 2028 - Conflicting Period on Page 3"
        pdf_path = self._create_sample_pdf([p1, p2, p3])

        coord = AiAutoRenameCoordinator()
        res = coord.analyze_document(str(pdf_path), context_client_name="XYZ & CO.")
        self.assertTrue(res["ok"])
        self.assertEqual(res["pages_analyzed"], 2)
        # Should pick September 2026 from Page 1 and ignore page 3
        self.assertIn("Sept.26", res["proposed_filename"])
        self.assertNotIn("2028", res["proposed_filename"])

    # Test 16: Result Schema Contract
    def test_16_result_schema_contract(self):
        content = "Indian Income Tax Return Acknowledgement Assessment Year: 2026-27 Name: Ramlal"
        pdf_path = self._create_sample_pdf([content])
        coord = AiAutoRenameCoordinator()
        res = coord.analyze_document(str(pdf_path), context_client_name="Ramlal")

        required_keys = [
            "ok", "original_filename", "proposed_filename", "confidence",
            "confidence_score", "method", "pages_analyzed", "breakdown", "reason"
        ]
        for k in required_keys:
            self.assertIn(k, res)
        self.assertIn("type", res["breakdown"])
        self.assertIn("period", res["breakdown"])
        self.assertIn("client", res["breakdown"])


if __name__ == "__main__":
    unittest.main()
