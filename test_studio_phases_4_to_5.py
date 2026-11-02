"""
Verification Suite for Studio Phases 4 & 5
Tests Save to Client staging handoff and Page Organizer backend contracts.
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
import staging_manager


class TestStudioPhases4And5(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = pdf_studio_engine.PDFStudioEngine(Path("."))
        cls.staging_mgr = staging_manager.StagingSessionManager(Path("."))

    def _create_test_pdf_bytes(self, num_pages=4):
        doc = pymupdf.open()
        for i in range(num_pages):
            p = doc.new_page(width=300, height=400)
            p.insert_text((50, 50), f"Page {i+1} Test", fontsize=14)
        raw = doc.tobytes()
        doc.close()
        return raw

    def test_01_save_to_client_staging_handoff(self):
        # 1. Create a staging session
        stg_sess = self.staging_mgr.get_or_create_session()
        stg_id = stg_sess["session_id"]
        self.assertTrue(stg_id.startswith("stg_"))

        # 2. Create a studio session
        pdf_bytes = self._create_test_pdf_bytes(2)
        studio_sess = self.engine.create_session("Client_Invoice.pdf", pdf_bytes)

        # 3. Simulate apply-to-staging replacement
        rep_res = self.staging_mgr.replace_files_with_processed_result(
            session_id=stg_id,
            replace_staged_ids=[],
            result_filename="Client_Invoice_Processed.pdf",
            result_bytes=studio_sess.working_pdf_path.read_bytes(),
            badge="✓ PDF Studio",
            lineage_operation="Processed in PDF Studio",
            pdf_studio_session_id=studio_sess.session_id
        )
        self.assertIsNotNone(rep_res)
        self.assertIn("manifest", rep_res)
        self.assertEqual(len(rep_res["manifest"]["files"]), 1)
        self.assertEqual(rep_res["manifest"]["files"][0]["name"], "Client_Invoice_Processed.pdf")
        self.assertEqual(rep_res["manifest"]["files"][0]["badge"], "✓ PDF Studio")

        # Cleanup
        self.staging_mgr.clear_session(stg_id)
        self.engine.delete_session(studio_sess.session_id)

    def test_02_organizer_reorder_pages(self):
        pdf_bytes = self._create_test_pdf_bytes(4)
        sess = self.engine.create_session("reorder_doc.pdf", pdf_bytes)

        # Reorder pages to [4, 1, 3, 2]
        res = self.engine.execute_tool(sess.session_id, "rearrange_pages", {"new_order": [4, 1, 3, 2]})
        self.assertTrue(res.get("ok"))

        # Verify page count remains 4
        thumbs = self.engine.get_thumbnails(sess.session_id)
        self.assertEqual(len(thumbs), 4)

        self.engine.delete_session(sess.session_id)

    def test_03_organizer_delete_pages(self):
        pdf_bytes = self._create_test_pdf_bytes(5)
        sess = self.engine.create_session("delete_doc.pdf", pdf_bytes)

        # Delete pages [2, 4]
        res = self.engine.execute_tool(sess.session_id, "delete_pages", {"pages": [2, 4]})
        self.assertTrue(res.get("ok"))
        self.assertEqual(res.get("remaining_pages"), 3)

        thumbs = self.engine.get_thumbnails(sess.session_id)
        self.assertEqual(len(thumbs), 3)

        self.engine.delete_session(sess.session_id)

    def test_04_organizer_extract_pages(self):
        pdf_bytes = self._create_test_pdf_bytes(5)
        sess = self.engine.create_session("extract_doc.pdf", pdf_bytes)

        # Extract pages 1 and 4
        res = self.engine.execute_tool(sess.session_id, "split_pdf", {"mode": "extract_range", "page_range": "1,4"})
        self.assertTrue(res.get("ok"))
        self.assertEqual(res.get("page_count"), 2)

        thumbs = self.engine.get_thumbnails(sess.session_id)
        self.assertEqual(len(thumbs), 2)

        self.engine.delete_session(sess.session_id)


if __name__ == "__main__":
    unittest.main()
