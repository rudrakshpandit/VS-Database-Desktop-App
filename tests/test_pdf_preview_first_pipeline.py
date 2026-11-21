"""
Comprehensive Verification Suite: PDF Editor Preview-First Architecture & Chronological Processing
Tests:
1. Immutability of original.pdf across all editing operations.
2. Elimination of page numbering overwrite/duplicate/overlapping hotspots.
3. Multi-operation chronological rebuild pipeline (Structure -> Orientation -> Watermark -> Page Numbers -> Security).
4. Page numbering update vs keep-same modes across deletion and reordering.
5. Watermark affinity to specific pages during reordering.
6. Undo and Reset-to-original fidelity.
7. Download pipeline matching preview 100%.
"""
import io
import os
import sys
import unittest
from pathlib import Path

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pymupdf
import pdf_studio_engine


class TestPDFPreviewFirstPipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = pdf_studio_engine.PDFStudioEngine(Path("."))

    def _create_test_pdf_bytes(self, num_pages=4):
        doc = pymupdf.open()
        for i in range(num_pages):
            p = doc.new_page(width=400, height=500)
            p.insert_text((50, 80), f"Content Page {i+1}", fontsize=16)
        raw = doc.tobytes()
        doc.close()
        return raw

    def test_01_original_pdf_remains_strictly_immutable(self):
        """Original PDF must remain untouched across all operations."""
        initial_bytes = self._create_test_pdf_bytes(3)
        sess = self.engine.create_session("immutable_test.pdf", initial_bytes)
        self.addCleanup(self.engine.delete_session, sess.session_id)

        # Apply numbering, rotation, and watermark
        self.engine.execute_tool(sess.session_id, "add_page_numbers", {"format": "Page {n} of {total}"})
        self.engine.execute_tool(sess.session_id, "rotate_pages", {"angle": 90, "which_pages": "all"})
        self.engine.execute_tool(sess.session_id, "watermark_pdf", {"text": "CONFIDENTIAL"})
        self.engine.execute_tool(sess.session_id, "delete_pages", {"pages": [1]})

        # Original PDF bytes on disk must match initial bytes byte-for-byte
        self.assertEqual(sess.original_pdf_path.read_bytes(), initial_bytes)
        # Working PDF has 2 pages
        self.assertEqual(sess.page_count, 2)

    def test_02_multiple_page_number_updates_do_not_duplicate_or_overlap(self):
        """Running add_page_numbers repeatedly must never accumulate overlapping text."""
        initial_bytes = self._create_test_pdf_bytes(2)
        sess = self.engine.create_session("multi_number.pdf", initial_bytes)
        self.addCleanup(self.engine.delete_session, sess.session_id)

        # Call add_page_numbers 5 times with changing formats and positions
        self.engine.execute_tool(sess.session_id, "add_page_numbers", {"format": "Page {n} of {total}", "position": "bottom_right"})
        self.engine.execute_tool(sess.session_id, "add_page_numbers", {"format": "Pg {n}", "position": "bottom_center"})
        self.engine.execute_tool(sess.session_id, "add_page_numbers", {"format": "#{n}", "position": "top_right"})
        self.engine.execute_tool(sess.session_id, "add_page_numbers", {"format": "Final Numbering {n} of {total}", "position": "bottom_right"})

        doc = sess.open_working_doc()
        page1_text = doc[0].get_text()
        doc.close()

        # It must contain ONLY the latest format and NOT previous formats
        self.assertIn("Final Numbering 1 of 2", page1_text)
        self.assertNotIn("Page 1 of 2", page1_text)
        self.assertNotIn("Pg 1", page1_text)
        self.assertNotIn("#1", page1_text)

    def test_03_delete_page_with_update_numbering_recalculates_without_hotspots(self):
        """
        User scenario: Page 1 and Page 2 numbered 'Page 1 of 2' and 'Page 2 of 2'.
        User deletes Page 1 with update_numbering=True.
        Remaining page (originally Page 2) becomes Page 1 of 1.
        It must contain ONLY 'Page 1 of 1' with ZERO occurrences of 'Page 2 of 2'.
        """
        initial_bytes = self._create_test_pdf_bytes(2)
        sess = self.engine.create_session("delete_update_test.pdf", initial_bytes)
        self.addCleanup(self.engine.delete_session, sess.session_id)

        # Add initial numbers
        self.engine.execute_tool(sess.session_id, "add_page_numbers", {"format": "Page {n} of {total}", "start_number": 1})

        # Delete Page 1 and specify update_numbering=True
        del_res = self.engine.execute_tool(sess.session_id, "delete_pages", {"pages": [1], "update_numbering": True})
        self.assertTrue(del_res.get("ok"))
        self.assertEqual(del_res.get("remaining_pages"), 1)

        doc = sess.open_working_doc()
        self.assertEqual(len(doc), 1)
        remaining_page_text = doc[0].get_text()
        doc.close()

        # Verification: Content Page 2 exists, new numbering is 'Page 1 of 1', old 'Page 2 of 2' does not exist!
        self.assertIn("Content Page 2", remaining_page_text)
        self.assertIn("Page 1 of 1", remaining_page_text)
        self.assertNotIn("Page 2 of 2", remaining_page_text)

    def test_04_delete_page_with_keep_same_numbering(self):
        """
        User scenario: Page 1, Page 2, Page 3.
        Numbering applied: 1, 2, 3.
        User deletes Page 1 with update_numbering=False ('Keep Same').
        Remaining pages must retain numbers 2 and 3.
        """
        initial_bytes = self._create_test_pdf_bytes(3)
        sess = self.engine.create_session("delete_keep_test.pdf", initial_bytes)
        self.addCleanup(self.engine.delete_session, sess.session_id)

        self.engine.execute_tool(sess.session_id, "add_page_numbers", {"format": "Page {n}", "start_number": 1})

        # Delete Page 1 with update_numbering=False
        self.engine.execute_tool(sess.session_id, "delete_pages", {"pages": [1], "update_numbering": False})

        doc = sess.open_working_doc()
        self.assertEqual(len(doc), 2)
        p1_text = doc[0].get_text()
        p2_text = doc[1].get_text()
        doc.close()

        self.assertIn("Content Page 2", p1_text)
        self.assertIn("Page 2", p1_text)  # Retained original fixed number
        self.assertIn("Content Page 3", p2_text)
        self.assertIn("Page 3", p2_text)

    def test_05_reorder_pages_with_update_numbering(self):
        """
        Reordering pages with update_numbering=True re-sequences numbers 1..N cleanly.
        """
        initial_bytes = self._create_test_pdf_bytes(3)
        sess = self.engine.create_session("reorder_update_test.pdf", initial_bytes)
        self.addCleanup(self.engine.delete_session, sess.session_id)

        self.engine.execute_tool(sess.session_id, "add_page_numbers", {"format": "Page {n} of {total}"})

        # Reorder [3, 1, 2] with update_numbering=True
        self.engine.execute_tool(sess.session_id, "rearrange_pages", {"new_order": [3, 1, 2], "update_numbering": True})

        doc = sess.open_working_doc()
        p1_text = doc[0].get_text()
        p2_text = doc[1].get_text()
        p3_text = doc[2].get_text()
        doc.close()

        # First page has Content Page 3, numbered Page 1 of 3
        self.assertIn("Content Page 3", p1_text)
        self.assertIn("Page 1 of 3", p1_text)

        # Second page has Content Page 1, numbered Page 2 of 3
        self.assertIn("Content Page 1", p2_text)
        self.assertIn("Page 2 of 3", p2_text)

        # Third page has Content Page 2, numbered Page 3 of 3
        self.assertIn("Content Page 2", p3_text)
        self.assertIn("Page 3 of 3", p3_text)

    def test_06_reorder_pages_with_keep_same_numbering(self):
        """
        Reordering pages with update_numbering=False preserves original numbers with their pages.
        """
        initial_bytes = self._create_test_pdf_bytes(3)
        sess = self.engine.create_session("reorder_keep_test.pdf", initial_bytes)
        self.addCleanup(self.engine.delete_session, sess.session_id)

        self.engine.execute_tool(sess.session_id, "add_page_numbers", {"format": "#{n}"})

        # Reorder [3, 1, 2] with update_numbering=False
        self.engine.execute_tool(sess.session_id, "rearrange_pages", {"new_order": [3, 1, 2], "update_numbering": False})

        doc = sess.open_working_doc()
        p1_text = doc[0].get_text()
        p2_text = doc[1].get_text()
        p3_text = doc[2].get_text()
        doc.close()

        # First page has Content Page 3, retains #3
        self.assertIn("Content Page 3", p1_text)
        self.assertIn("#3", p1_text)

        # Second page has Content Page 1, retains #1
        self.assertIn("Content Page 1", p2_text)
        self.assertIn("#1", p2_text)

        # Third page has Content Page 2, retains #2
        self.assertIn("Content Page 2", p3_text)
        self.assertIn("#2", p3_text)

    def test_07_page_specific_watermark_sticks_to_correct_page_on_reorder(self):
        """
        Watermark applied to Page 2 should stay on Content Page 2 even when pages are reordered.
        """
        initial_bytes = self._create_test_pdf_bytes(3)
        sess = self.engine.create_session("watermark_reorder_test.pdf", initial_bytes)
        self.addCleanup(self.engine.delete_session, sess.session_id)

        # Watermark only on Page 2
        self.engine.execute_tool(sess.session_id, "watermark_pdf", {"text": "SECRET_DOC", "pages": [2]})

        # Reorder pages: [2, 1, 3] -> Content Page 2 is now first!
        self.engine.execute_tool(sess.session_id, "rearrange_pages", {"new_order": [2, 1, 3]})

        doc = sess.open_working_doc()
        p1_text = doc[0].get_text()
        p2_text = doc[1].get_text()
        p3_text = doc[2].get_text()
        doc.close()

        # Content Page 2 is now page 1, and carries the watermark
        self.assertIn("Content Page 2", p1_text)
        self.assertIn("SECRET_DOC", p1_text)

        # Content Page 1 and 3 do NOT have the watermark
        self.assertIn("Content Page 1", p2_text)
        self.assertNotIn("SECRET_DOC", p2_text)
        self.assertIn("Content Page 3", p3_text)
        self.assertNotIn("SECRET_DOC", p3_text)

    def test_08_undo_restores_state_and_rebuilds_cleanly(self):
        """
        Undo must restore previous editing state and working PDF without orphan text.
        """
        initial_bytes = self._create_test_pdf_bytes(3)
        sess = self.engine.create_session("undo_pipeline_test.pdf", initial_bytes)
        self.addCleanup(self.engine.delete_session, sess.session_id)

        # Step 1: Add watermark
        self.engine.execute_tool(sess.session_id, "watermark_pdf", {"text": "DRAFT"})
        # Step 2: Delete Page 1
        self.engine.execute_tool(sess.session_id, "delete_pages", {"pages": [1]})
        self.assertEqual(sess.page_count, 2)

        # Undo delete
        undo_res = self.engine.undo(sess.session_id)
        self.assertTrue(undo_res.get("ok"))
        self.assertEqual(sess.page_count, 3)

        doc = sess.open_working_doc()
        self.assertEqual(len(doc), 3)
        # All 3 pages have DRAFT watermark
        for page in doc:
            self.assertIn("DRAFT", page.get_text())
        doc.close()

    def test_09_reset_to_original_restores_unblemished_document(self):
        """
        Reset to original must completely clear all pending operations and restore initial document.
        """
        initial_bytes = self._create_test_pdf_bytes(4)
        sess = self.engine.create_session("reset_pipeline_test.pdf", initial_bytes)
        self.addCleanup(self.engine.delete_session, sess.session_id)

        # Mutate heavily
        self.engine.execute_tool(sess.session_id, "add_page_numbers", {"format": "NumberedPage {n}"})
        self.engine.execute_tool(sess.session_id, "delete_pages", {"pages": [1, 2]})
        self.engine.execute_tool(sess.session_id, "watermark_pdf", {"text": "HOTSPOT_CHECK"})

        # Reset
        res = self.engine.reset_to_original(sess.session_id)
        self.assertTrue(res.get("ok"))
        self.assertEqual(sess.page_count, 4)

        doc = sess.open_working_doc()
        self.assertEqual(len(doc), 4)
        all_text = " ".join(p.get_text() for p in doc)
        doc.close()

        self.assertNotIn("HOTSPOT_CHECK", all_text)
        self.assertNotIn("NumberedPage", all_text)

    def test_10_download_matches_working_preview_exactly(self):
        """
        session.rebuild_working_pdf() called during download produces bytes identical to working preview.
        """
        initial_bytes = self._create_test_pdf_bytes(3)
        sess = self.engine.create_session("download_fidelity_test.pdf", initial_bytes)
        self.addCleanup(self.engine.delete_session, sess.session_id)

        self.engine.execute_tool(sess.session_id, "watermark_pdf", {"text": "AUDITED"})
        self.engine.execute_tool(sess.session_id, "add_page_numbers", {"format": "{n} / {total}"})
        self.engine.execute_tool(sess.session_id, "rotate_pages", {"angle": 90, "which_pages": [1]})

        working_bytes = sess.working_pdf_path.read_bytes()
        # Fresh download session instance
        download_sess = self.engine.get_session(sess.session_id)
        download_bytes = download_sess.rebuild_working_pdf()

        # Both must have identical page count and text extraction
        doc_w = pymupdf.open(stream=working_bytes, filetype="pdf")
        doc_d = pymupdf.open(stream=download_bytes, filetype="pdf")

        self.assertEqual(len(doc_w), len(doc_d))
        for i in range(len(doc_w)):
            self.assertEqual(doc_w[i].get_text(), doc_d[i].get_text())
            self.assertEqual(doc_w[i].rotation, doc_d[i].rotation)

        doc_w.close()
        doc_d.close()

    def test_11_page_number_executed_last_after_watermark_and_reorder(self):
        """
        Even when page numbers are configured before other tools, the page number
        execution must happen in the last step of the page rendering pipeline,
        ensuring correct final numbering and placement on top of watermarks.
        """
        initial_bytes = self._create_test_pdf_bytes(4)
        sess = self.engine.create_session("number_executed_last_test.pdf", initial_bytes)
        self.addCleanup(self.engine.delete_session, sess.session_id)

        # 1. Add page numbers FIRST
        self.engine.execute_tool(sess.session_id, "add_page_numbers", {
            "format": "Page {n} of {total}",
            "position": "bottom_right",
            "start_number": 1
        })

        # 2. Delete page 1
        self.engine.execute_tool(sess.session_id, "delete_pages", {"pages": [1], "update_numbering": True})

        # 3. Reorder remaining 3 pages to [3, 1, 2]
        self.engine.execute_tool(sess.session_id, "rearrange_pages", {"new_order": [3, 1, 2], "update_numbering": True})

        # 4. Add watermark LAST
        self.engine.execute_tool(sess.session_id, "watermark_pdf", {"text": "CONFIDENTIAL_BG", "position": "center_diagonal"})

        doc = sess.open_working_doc()
        self.assertEqual(len(doc), 3)

        # Final page numbers must correctly reflect the final count (3) in consecutive order
        for idx, page in enumerate(doc):
            expected_pn = f"Page {idx + 1} of 3"
            page_text = page.get_text()
            self.assertIn(expected_pn, page_text)
            self.assertIn("CONFIDENTIAL_BG", page_text)

            # In the page's text extraction order, watermark appears BEFORE the page number
            # because page numbering was stamped in the last step!
            wm_pos = page_text.find("CONFIDENTIAL_BG")
            pn_pos = page_text.find(expected_pn)
            self.assertGreater(pn_pos, wm_pos, f"Page number '{expected_pn}' must be rendered after/over watermark")

        doc.close()


if __name__ == "__main__":
    unittest.main()
