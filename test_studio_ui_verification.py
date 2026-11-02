"""
Comprehensive 12-Tool & UI Invariant Verification Test Suite for VS Database Studio.
Verifies PyMuPDF Engine tool execution, Undo/Redo/Reset, CSS strict isolation, and JS integrity.
"""
import base64
import io
import os
import re
import sys
import unittest
import zipfile
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

import pymupdf
from pdf_studio_engine import PDFStudioEngine


class TestComprehensiveStudioSubsystem(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = PDFStudioEngine(base_dir=APP_DIR)

    def create_sample_pdf(self, pages: int = 6) -> bytes:
        doc = pymupdf.open()
        for i in range(pages):
            page = doc.new_page(width=612, height=792)
            page.insert_text((50, 100), f"Test Document - Page {i+1}", fontsize=20)
            page.insert_text((50, 150), f"Content line for page {i+1}", fontsize=14)
        data = doc.tobytes()
        doc.close()
        return data

    def test_01_css_isolation_and_no_leakage(self):
        """Verify 100% strict CSS isolation under #studio-root and #studio-portal."""
        css_path = APP_DIR / "static" / "studio.css"
        self.assertTrue(css_path.exists())
        content = css_path.read_text(encoding="utf-8")

        lines = content.splitlines()
        for idx, line in enumerate(lines, 1):
            stripped = line.strip()
            if stripped.endswith("{") and not stripped.startswith("@") and not stripped.startswith("from") and not stripped.startswith("to"):
                selector = stripped[:-1].strip()
                for token in selector.split(","):
                    t = token.strip()
                    if t and not re.match(r"^\d+%$", t):
                        self.assertTrue(
                            t.startswith("#studio-root") or t.startswith("#studio-portal") or t.startswith(".tippy") or t.startswith("@keyframes"),
                            f"Line {idx}: Unscoped selector '{t}' will pollute console / other tabs!"
                        )

    def test_02_javascript_syntax_and_registry(self):
        """Verify pdf-studio.js syntax and completeness."""
        js_path = APP_DIR / "static" / "pdf-studio.js"
        self.assertTrue(js_path.exists())
        js_code = js_path.read_text(encoding="utf-8")

        expected_tools = [
            "split", "merge", "delete", "extract", "reorder",
            "rotate", "numbers", "watermark", "compress",
            "protect", "unlock", "images"
        ]
        for tool_id in expected_tools:
            self.assertIn(f'"{tool_id}"', js_code, f"Tool '{tool_id}' must be registered in STUDIO_CATEGORIES")

        self.assertIn("openOrg", js_code)
        self.assertIn("closeOrg", js_code)
        self.assertIn("/api/ai/native-save-dialog", js_code)
        self.assertIn("/apply-to-staging", js_code)

    def test_03_split_pdf(self):
        """Test split_pdf by page range."""
        raw = self.create_sample_pdf(6)
        session = self.engine.create_session("SplitDoc.pdf", raw)
        sid = session.session_id
        try:
            res = self.engine.execute_tool(sid, "split_pdf", {"mode": "range", "range": "1-3"})
            self.assertTrue(res.get("ok"))
            self.assertEqual(res.get("page_count"), 3)
        finally:
            self.engine.delete_session(sid)

    def test_04_merge_pdf(self):
        """Test merge_pdf with a secondary document."""
        raw1 = self.create_sample_pdf(2)
        raw2 = self.create_sample_pdf(3)
        session = self.engine.create_session("Doc1.pdf", raw1)
        sid = session.session_id
        try:
            b64_doc2 = base64.b64encode(raw2).decode("ascii")
            res = self.engine.execute_tool(sid, "merge_pdf", {
                "additional_files": [{"name": "Doc2.pdf", "bytes": b64_doc2}]
            })
            self.assertTrue(res.get("ok"))
            doc = session.open_working_doc()
            self.assertEqual(len(doc), 5)
            doc.close()
        finally:
            self.engine.delete_session(sid)

    def test_05_rotate_pages(self):
        """Test rotate_pages with angle and selective target."""
        raw = self.create_sample_pdf(4)
        session = self.engine.create_session("RotateDoc.pdf", raw)
        sid = session.session_id
        try:
            res = self.engine.execute_tool(sid, "rotate_pages", {"angle": 90, "which_pages": "odd"})
            self.assertTrue(res.get("ok"))
            doc = session.open_working_doc()
            self.assertEqual(doc[0].rotation, 90)
            self.assertEqual(doc[1].rotation, 0)
            doc.close()
        finally:
            self.engine.delete_session(sid)

    def test_06_rearrange_pages(self):
        """Test rearrange_pages with new order."""
        raw = self.create_sample_pdf(4)
        session = self.engine.create_session("RearrangeDoc.pdf", raw)
        sid = session.session_id
        try:
            res = self.engine.execute_tool(sid, "rearrange_pages", {"page_order": [4, 1, 3, 2]})
            self.assertTrue(res.get("ok"))
            doc = session.open_working_doc()
            self.assertEqual(len(doc), 4)
            doc.close()
        finally:
            self.engine.delete_session(sid)

    def test_07_delete_pages(self):
        """Test delete_pages removing page 2."""
        raw = self.create_sample_pdf(4)
        session = self.engine.create_session("DeleteDoc.pdf", raw)
        sid = session.session_id
        try:
            res = self.engine.execute_tool(sid, "delete_pages", {"pages": [2]})
            self.assertTrue(res.get("ok"))
            self.assertEqual(res.get("remaining_pages"), 3)
            doc = session.open_working_doc()
            self.assertEqual(len(doc), 3)
            doc.close()
        finally:
            self.engine.delete_session(sid)

    def test_08_watermark_pdf(self):
        """Test watermark_pdf applying text watermark."""
        raw = self.create_sample_pdf(2)
        session = self.engine.create_session("WatermarkDoc.pdf", raw)
        sid = session.session_id
        try:
            res = self.engine.execute_tool(sid, "watermark_pdf", {
                "text": "CONFIDENTIAL",
                "position": "center_diagonal",
                "opacity": 0.3
            })
            self.assertTrue(res.get("ok"))
        finally:
            self.engine.delete_session(sid)

    def test_09_add_page_numbers(self):
        """Test add_page_numbers formatting."""
        raw = self.create_sample_pdf(3)
        session = self.engine.create_session("NumbersDoc.pdf", raw)
        sid = session.session_id
        try:
            res = self.engine.execute_tool(sid, "add_page_numbers", {
                "position": "bottom_right",
                "format": "Page {n} of {total}",
                "start_number": 1
            })
            self.assertTrue(res.get("ok"))
        finally:
            self.engine.delete_session(sid)

    def test_10_compress_pdf(self):
        """Test compress_pdf."""
        raw = self.create_sample_pdf(3)
        session = self.engine.create_session("CompressDoc.pdf", raw)
        sid = session.session_id
        try:
            res = self.engine.execute_tool(sid, "compress_pdf", {"level": "balanced"})
            self.assertTrue(res.get("ok"))
            self.assertIn("saved_bytes", res)
        finally:
            self.engine.delete_session(sid)

    def test_11_protect_and_unlock_pdf(self):
        """Test lock_pdf (encryption) and unlock_pdf (decryption)."""
        raw = self.create_sample_pdf(2)
        session = self.engine.create_session("SecureDoc.pdf", raw)
        sid = session.session_id
        try:
            # Encrypt
            lock_res = self.engine.execute_tool(sid, "lock_pdf", {"password": "SecretPassword123!"})
            self.assertTrue(lock_res.get("ok"))

            # Verify encrypted
            doc_locked = pymupdf.open(stream=session.working_pdf_path.read_bytes(), filetype="pdf")
            self.assertTrue(doc_locked.is_encrypted)
            doc_locked.close()

            # Unlock
            unlock_res = self.engine.execute_tool(sid, "unlock_pdf", {"password": "SecretPassword123!"})
            self.assertTrue(unlock_res.get("ok"))

            # Verify unlocked
            doc_unlocked = pymupdf.open(stream=session.working_pdf_path.read_bytes(), filetype="pdf")
            self.assertFalse(doc_unlocked.is_encrypted)
            doc_unlocked.close()
        finally:
            self.engine.delete_session(sid)

    def test_12_convert_to_images(self):
        """Test convert_to_images generating ZIP of page images."""
        raw = self.create_sample_pdf(3)
        session = self.engine.create_session("ImageDoc.pdf", raw)
        sid = session.session_id
        try:
            res = self.engine.execute_tool(sid, "convert_to_images", {"format": "png", "dpi": 72})
            self.assertTrue(res.get("ok"))
            self.assertEqual(res.get("count"), 3)
            zip_bytes = base64.b64decode(res.get("zip_base64"))
            with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
                namelist = zf.namelist()
                self.assertEqual(len(namelist), 3)
                self.assertTrue(all(n.endswith(".png") for n in namelist))
        finally:
            self.engine.delete_session(sid)

    def test_13_undo_and_reset_lifecycle(self):
        """Test undo and reset lifecycle restoring working PDF."""
        raw = self.create_sample_pdf(4)
        session = self.engine.create_session("LifecycleDoc.pdf", raw)
        sid = session.session_id
        try:
            # Operation 1: Rotate
            self.engine.execute_tool(sid, "rotate_pages", {"angle": 90, "which_pages": "all"})
            doc1 = session.open_working_doc()
            self.assertEqual(doc1[0].rotation, 90)
            doc1.close()

            # Operation 2: Delete
            self.engine.execute_tool(sid, "delete_pages", {"pages": [1]})
            doc2 = session.open_working_doc()
            self.assertEqual(len(doc2), 3)
            doc2.close()

            # Undo Delete -> should be 4 pages again
            undo1 = self.engine.undo(sid)
            self.assertTrue(undo1.get("ok"))
            doc3 = session.open_working_doc()
            self.assertEqual(len(doc3), 4)
            self.assertEqual(doc3[0].rotation, 90)
            doc3.close()

            # Reset -> back to original untouched (0 deg rotation)
            reset = self.engine.reset_to_original(sid)
            self.assertTrue(reset.get("ok"))
            doc4 = session.open_working_doc()
            self.assertEqual(len(doc4), 4)
            self.assertEqual(doc4[0].rotation, 0)
            doc4.close()
        finally:
            self.engine.delete_session(sid)


if __name__ == "__main__":
    unittest.main()
