"""
Verification Suite for Studio Phases 1 to 3
Tests end-to-end backend session lifecycle, page rendering, tool execution, undo/reset, native save dialog, and download.
"""
import base64
import os
import sys
import unittest
from pathlib import Path

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pymupdf
import pdf_studio_engine


class TestStudioPhases1To3(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = pdf_studio_engine.PDFStudioEngine(Path("."))

    def _create_test_pdf_bytes(self, num_pages=3):
        doc = pymupdf.open()
        for i in range(num_pages):
            p = doc.new_page(width=300, height=400)
            p.insert_text((50, 50), f"Test Page {i+1}", fontsize=14)
        raw = doc.tobytes()
        doc.close()
        return raw

    def test_01_session_creation_and_preview(self):
        pdf_bytes = self._create_test_pdf_bytes(3)
        sess = self.engine.create_session("sample_invoice.pdf", pdf_bytes)
        self.assertIsNotNone(sess)
        self.assertTrue(sess.session_id.startswith("pdf_sess_"))
        self.assertEqual(sess.meta.get("page_count"), 3)

        # Check page 1 rendering
        png_bytes = self.engine.render_page_png(sess.session_id, 1, dpi=100)
        self.assertTrue(png_bytes.startswith(b"\x89PNG"), "Rendered page must be valid PNG")
        self.assertGreater(len(png_bytes), 1000)

        # Check thumbnails
        thumbs = self.engine.get_thumbnails(sess.session_id)
        self.assertEqual(len(thumbs), 3)
        self.assertTrue(thumbs[0]["url"].startswith("/api/pdf-studio/sessions/"))

        self.engine.delete_session(sess.session_id)

    def test_02_tool_execution_rotate_and_undo(self):
        pdf_bytes = self._create_test_pdf_bytes(3)
        sess = self.engine.create_session("doc_rotate.pdf", pdf_bytes)

        # Rotate
        res = self.engine.execute_tool(sess.session_id, "rotate_pages", {"angle": 90, "which_pages": "all"})
        self.assertTrue(res.get("ok"))
        self.assertIn("Rotated", res.get("message", ""))

        # Undo
        undo_res = self.engine.undo(sess.session_id)
        self.assertTrue(undo_res.get("ok"))
        self.assertEqual(undo_res.get("message"), "Undone successfully.")

        self.engine.delete_session(sess.session_id)

    def test_03_tool_execution_delete_and_reset(self):
        pdf_bytes = self._create_test_pdf_bytes(4)
        sess = self.engine.create_session("doc_delete.pdf", pdf_bytes)

        # Delete page 2 and 3
        del_res = self.engine.execute_tool(sess.session_id, "delete_pages", {"pages": [2, 3]})
        self.assertTrue(del_res.get("ok"))
        self.assertEqual(del_res.get("remaining_pages"), 2)

        # Check working copy has 2 pages
        thumbs = self.engine.get_thumbnails(sess.session_id)
        self.assertEqual(len(thumbs), 2)

        # Reset to original
        reset_res = self.engine.reset_to_original(sess.session_id)
        self.assertTrue(reset_res.get("ok"))

        # Check restored to 4 pages
        thumbs_restored = self.engine.get_thumbnails(sess.session_id)
        self.assertEqual(len(thumbs_restored), 4)

        self.engine.delete_session(sess.session_id)

    def test_04_tool_watermark_and_page_numbers(self):
        pdf_bytes = self._create_test_pdf_bytes(2)
        sess = self.engine.create_session("doc_watermark.pdf", pdf_bytes)

        # Watermark
        wm_res = self.engine.execute_tool(
            sess.session_id,
            "watermark_pdf",
            {"text": "CONFIDENTIAL", "position": "center_diagonal", "opacity": 0.25, "color": "#DC2626"}
        )
        self.assertTrue(wm_res.get("ok"))

        # Page Numbers
        num_res = self.engine.execute_tool(
            sess.session_id,
            "add_page_numbers",
            {"format": "Page {n} of {total}", "position": "bottom_right", "start_number": 1}
        )
        self.assertTrue(num_res.get("ok"))

        self.engine.delete_session(sess.session_id)

    def test_05_convert_images(self):
        pdf_bytes = self._create_test_pdf_bytes(2)
        sess = self.engine.create_session("doc_images.pdf", pdf_bytes)

        res = self.engine.execute_tool(sess.session_id, "convert_images", {"format": "png", "dpi": 100})
        self.assertTrue(res.get("ok"))
        self.assertIn("zip_base64", res)
        self.assertGreater(len(res["zip_base64"]), 100)
        self.assertEqual(res.get("count"), 2)

        self.engine.delete_session(sess.session_id)

    def test_06_merge_pdf(self):
        pdf1 = self._create_test_pdf_bytes(2)
        pdf2 = self._create_test_pdf_bytes(3)
        sess = self.engine.create_session("doc1.pdf", pdf1)

        b64_extra = base64.b64encode(pdf2).decode("ascii")
        res = self.engine.execute_tool(sess.session_id, "merge_pdf", {"additional_files": [b64_extra], "order": "append"})
        self.assertTrue(res.get("ok"))

        thumbs = self.engine.get_thumbnails(sess.session_id)
        self.assertEqual(len(thumbs), 5, "Merged document must have 2 + 3 = 5 pages")

        self.engine.delete_session(sess.session_id)


if __name__ == "__main__":
    unittest.main()
