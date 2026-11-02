"""
Comprehensive End-to-End Verification Suite for the 6 Targeted Enhancements:
1. Adaptive Portrait & Landscape Document Orientation (Default = Portrait)
2. Eliminate Unrequested Factual Assumptions in Notice Replies + 5-Slide Document-Upload & Reference-Format Clarification Workflow
3. Strict Chat Memory Isolation vs. Explicit "Remember" Consent
4. Startup & Exit Intro Video Aspect Ratio (No Stretching in Full-Screen Mode)
5. Maximized Window Clamped to Monitor Work Area (Windows Taskbar Always Visible)
6. Interactive Document Preview Button + Select-Area-to-Revise AI Workflow
"""
import os
import sys
import json
import uuid
import sqlite3
import threading
import urllib.request
import unittest
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import vs_ai_doc_generator
import vs_ai_clarification
import vs_ai_engine
import main_app
import server


class TestSixEnhancements(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        server.initialise()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "httpd") and cls.httpd:
            cls.httpd.shutdown()
            cls.httpd.server_close()

    def _http_post_json(self, path: str, payload: dict) -> tuple[int, dict]:
        req = urllib.request.Request(
            f"{self.base_url}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=45) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))

    def _http_get_json(self, path: str) -> tuple[int, dict]:
        req = urllib.request.Request(f"{self.base_url}{path}", method="GET")
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))

    # ------------------------------------------------------------------
    # WORKSTREAM 1: Adaptive Portrait & Landscape Orientation (Default Portrait)
    # ------------------------------------------------------------------
    def test_1_default_portrait_and_adaptive_landscape(self):
        # 1a. Notice reply with a 4-column or 6-column table MUST default to Portrait
        notice_md = """# Reply to Form GST DRC-01 Show Cause Notice

## 1. Preliminary Submissions
The taxpayer respectfully submits this reply to the Show Cause Notice issued for FY 2022-23.

## 2. Reconciliation Summary
| Sr. No. | Return Period | GSTR-3B ITC | GSTR-2B ITC | Difference | Remarks |
|---|---|---|---|---|---|
| 1 | Apr-2022 | ₹1,20,000 | ₹1,20,000 | ₹0 | Matched |
| 2 | May-2022 | ₹85,000 | ₹80,000 | ₹5,000 | Circular 183 |
"""
        orient_notice = vs_ai_doc_generator.DocumentPlanner.resolve_orientation(
            "Reply to Form GST DRC-01 Show Cause Notice",
            notice_md,
            {"archetype": "notice_reply_report"},
        )
        self.assertEqual(orient_notice, "portrait")

        pdf_res = vs_ai_doc_generator.export_ai_opinion_pdf(
            title="Reply to Form GST DRC-01 Show Cause Notice",
            content=notice_md,
            citations=[],
        )
        self.assertTrue(pdf_res.get("ok"), pdf_res)
        self.assertEqual(pdf_res.get("orientation"), "portrait")
        from pypdf import PdfReader
        reader = PdfReader(pdf_res["file_path"])
        mb = reader.pages[0].mediabox
        self.assertLess(float(mb.width), float(mb.height), "Default PDF must be Portrait (width < height)")

        # 1b. Word (.docx) export also defaults to Portrait
        docx_res = vs_ai_doc_generator.export_ai_document_docx(
            title="Reply to Income Tax Notice u/s 143(2)",
            content=notice_md,
            citations=[],
        )
        self.assertTrue(docx_res.get("ok"), docx_res)
        self.assertEqual(docx_res.get("orientation"), "portrait")

        # 1c. Wide 10-column register without notice/opinion title switches adaptively to Landscape
        wide_md = """# Consolidated Multi-Branch Asset & Depreciation Register

| Sr | Asset ID | Category | Branch | Opening Gross | Additions | Deletions | Closing Gross | Dep Rate | Closing WDV |
|---|---|---|---|---|---|---|---|---|---|
| 1 | FA-01 | Computers | Pune | 500000 | 100000 | 0 | 600000 | 40% | 360000 |
"""
        orient_wide = vs_ai_doc_generator.DocumentPlanner.resolve_orientation(
            "Consolidated Multi-Branch Asset & Depreciation Register",
            wide_md,
            {"archetype": "custom_analytical_report"},
        )
        self.assertEqual(orient_wide, "landscape")
        wide_pdf = vs_ai_doc_generator.export_ai_opinion_pdf(
            title="Consolidated Multi-Branch Asset & Depreciation Register",
            content=wide_md,
            citations=[],
        )
        self.assertTrue(wide_pdf.get("ok"))
        self.assertEqual(wide_pdf.get("orientation"), "landscape")
        reader_w = PdfReader(wide_pdf["file_path"])
        mb_w = reader_w.pages[0].mediabox
        self.assertGreater(float(mb_w.width), float(mb_w.height), "Wide register PDF must be Landscape")

        # 1d. Glued *italic***bold** and raw < > & characters must never cause ReportLab XML Parse Error
        glued_md = (
            "# Reply to Notice\n\n"
            "*(Partner, Authorized Representative)***Contact & Communication Details:**\n"
            "- Invoice ageing < 180 days & amount > ₹50,000\n"
        )
        glued_pdf = vs_ai_doc_generator.export_ai_opinion_pdf(
            title="Reply to Notice XML Escaping Check",
            content=glued_md,
            citations=[],
        )
        self.assertTrue(glued_pdf.get("ok"))

    # ------------------------------------------------------------------
    # WORKSTREAM 2: No Unrequested Assumptions + 5-Slide Notice Clarification
    # ------------------------------------------------------------------
    def test_2_notice_reply_clarification_and_zero_fabricated_assumptions(self):
        engine = vs_ai_clarification.ClarificationEngine(str(server.DB_PATH))
        for idx, prompt in enumerate([
            "Draft me a reply because I received an income tax notice",
            "Generate a show cause notice reply in PDF",
            "Prepare a reply to DRC-01 notice",
        ]):
            analysis = vs_ai_clarification.IntentDetector.analyze(prompt)
            self.assertEqual(analysis.get("domain"), "notice_handling", f"Expected notice_handling for: {prompt}")

            conv_id = f"conv_notice_clarif_test_{idx}_{uuid.uuid4().hex[:8]}"
            needs_c, q_list, _, dom = engine.evaluate_materiality(prompt, conv_id)
            self.assertTrue(needs_c, f"Expected needs_clarification=True for: {prompt}")
            self.assertEqual(dom, "notice_handling")
            q_ids = [q.get("id") for q in q_list]
            self.assertIn("notice_type_section", q_ids)
            self.assertIn("notice_issue_category", q_ids)
            self.assertIn("notice_filing_authority", q_ids)
            self.assertIn("notice_supporting_documents", q_ids)
            self.assertIn("preferred_document_format", q_ids)

            q_md = engine.format_clarification_message(q_list)
            self.assertIn("ID: notice_supporting_documents", q_md)
            self.assertIn("ID: preferred_document_format", q_md)
            self.assertIn("upload", q_md.lower())

        # 2b. Verify validate_and_enrich_content NEVER overwrites real notice reply content with fabricated ₹11,40,000 or 27AABCA8921K1Z4
        user_notice_draft = """# Reply to Income Tax Notice under Section 143(2)

## 1. Facts of the Case
The assessee received a notice dated [Date as per Notice] for Assessment Year 2024-25 regarding verification of deductions claimed under Chapter VI-A.

## 2. Submissions on Merits
The assessee submits that all deductions claimed in the return of income are supported by documentary evidence enclosed herewith.

## 3. Prayer
It is prayed that the assessment proceedings be concluded accepting the returned income without any adverse addition.
"""
        enriched = vs_ai_doc_generator.DocumentPlanner.validate_and_enrich_content(
            "Reply to Income Tax Notice under Section 143(2)",
            user_notice_draft,
            {"archetype": "notice_reply_report"},
            "pdf",
        )
        self.assertNotIn("11,40,000", enriched)
        self.assertNotIn("27AABCA8921K1Z4", enriched)
        self.assertIn("Chapter VI-A", enriched)

        # 2c. Verify system instruction strictly forbids fabricating amounts/GSTINs
        orchestrator = vs_ai_engine.AIModelOrchestrator(server.DB_PATH)
        sys_inst = orchestrator.build_system_instruction(False, False, True, "pdf")
        self.assertIn("STRICT PROHIBITION AGAINST INVENTING PROFESSIONAL CREDENTIALS OR NOTICE FACTS", sys_inst)
        self.assertIn("Strictly NEVER invent or assume specific tax demand figures", sys_inst)
        self.assertIn("ADAPTING TO UPLOADED NOTICE PDFs & PREFERRED REFERENCE FORMATS", sys_inst)

    # ------------------------------------------------------------------
    # WORKSTREAM 3: Strict Chat Memory Isolation vs Explicit "Remember" Consent
    # ------------------------------------------------------------------
    def test_3_chat_memory_isolation_and_explicit_remember(self):
        mem_mgr = vs_ai_engine.ExplicitMemoryManager(server.DB_PATH)
        conn = sqlite3.connect(str(server.DB_PATH))
        try:
            mem_mgr._ensure_tables(conn)
            conn.execute("DELETE FROM ai_memory WHERE category = 'user_saved_fact'")
            conn.commit()
        finally:
            conn.close()

        # 3a. Normal chat message with a GSTIN or name MUST NOT be saved to memory
        normal_msg = "Draft a reply for GSTIN 27AABCU9603R1ZM regarding FY 2023-24 mismatch of Rs 4,50,000"
        res_normal = mem_mgr.detect_and_save_explicit_memory(normal_msg)
        self.assertFalse(res_normal.get("saved"))
        saved_mems = mem_mgr.get_user_saved_memories()
        self.assertEqual(len(saved_mems), 0, "Normal chat turn must NEVER save facts to long-term memory")

        # 3b. Explicit 'remember this' command saves to ai_memory
        explicit_msg = "Please remember that our firm registration number is FRN 128901W and signatory is CA R. K. Verma"
        res_save = mem_mgr.detect_and_save_explicit_memory(explicit_msg)
        self.assertTrue(res_save.get("saved"))

        saved_mems_after = mem_mgr.get_user_saved_memories()
        self.assertEqual(len(saved_mems_after), 1)
        self.assertIn("FRN 128901W", saved_mems_after[0]["value"])

        # 3c. In a new conversation, saved memory context instructs AI to ask confirmation before applying
        ctx_prompt = mem_mgr.format_memories_for_prompt()
        self.assertIn("FRN 128901W", ctx_prompt)
        self.assertIn("do you want to use it for this task or not?", ctx_prompt.lower())

        conn = sqlite3.connect(str(server.DB_PATH))
        try:
            conn.execute("DELETE FROM ai_memory WHERE category = 'user_saved_fact'")
            conn.commit()
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # WORKSTREAM 4: Startup & Exit Intro Video Aspect Ratio (No Stretching)
    # ------------------------------------------------------------------
    def test_4_startup_and_exit_video_aspect_ratio_preserved(self):
        base_dir = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(base_dir, "static", "index.html"), "r", encoding="utf-8") as f:
            index_html = f.read()
        with open(os.path.join(base_dir, "static", "app.css"), "r", encoding="utf-8") as f:
            app_css = f.read()

        self.assertIn("object-fit: contain", index_html)
        self.assertNotIn("width: 100vw;\n      height: 100vh;\n      object-fit: cover;", index_html)
        self.assertIn("object-fit: contain;", app_css)

    # ------------------------------------------------------------------
    # WORKSTREAM 5: Maximized Window Keeps Windows Taskbar Visible
    # ------------------------------------------------------------------
    def test_5_maximized_window_clamped_to_work_area(self):
        self.assertTrue(callable(getattr(main_app, "_get_monitor_work_area_for_hwnd", None)))
        self.assertTrue(callable(getattr(main_app, "maximize_window_to_work_area", None)))

        wl, wt, wr, wb = main_app._get_primary_work_area()
        self.assertGreater(wr - wl, 600)
        self.assertGreater(wb - wt, 400)

        max_res = main_app.maximize_window_to_work_area(None)
        self.assertTrue(max_res.get("taskbar_preserved"))
        self.assertGreater(max_res.get("width", 0), 600)
        self.assertGreater(max_res.get("height", 0), 400)

    # ------------------------------------------------------------------
    # WORKSTREAM 6: Interactive Preview Button + Select-Area-to-Revise API
    # ------------------------------------------------------------------
    def test_6_interactive_preview_and_select_area_to_revise_workflow(self):
        initial_md = """# Reply to Form GST DRC-01 Show Cause Notice

## 1. Preliminary Objections
The Show Cause Notice dated 14-08-2025 is barred by limitation under Section 73(10).

## 2. Submission on ITC Reconciliation
The taxpayer claimed Input Tax Credit of ₹4,80,000 in Form GSTR-3B, which is fully supported by tax invoices and supplier declarations under Circular No. 183/15/2022-GST.

## 3. Prayer
It is respectfully prayed that the proposed demand be dropped in entirety and a personal hearing be granted.
"""
        status_exp, exp_data = self._http_post_json(
            "/api/ai/export-pdf",
            {
                "title": "Reply to Form GST DRC-01 Show Cause Notice",
                "content": initial_md,
                "citations": [],
            },
        )
        self.assertEqual(status_exp, 200)
        self.assertTrue(exp_data.get("ok"))
        self.assertEqual(exp_data.get("orientation"), "portrait")
        artifact_id = exp_data.get("artifact_id")
        self.assertTrue(artifact_id)

        # Fetch JSON preview with selectable sections
        status_prev, prev_json = self._http_get_json(f"/api/ai/artifacts/{artifact_id}/preview?format=json")
        self.assertEqual(status_prev, 200)
        self.assertTrue(prev_json.get("ok"))
        self.assertEqual(prev_json.get("orientation"), "portrait")
        sections = prev_json.get("sections") or []
        self.assertGreaterEqual(len(sections), 3)
        self.assertTrue(any("Submission on ITC Reconciliation" in s["heading"] for s in sections))

        # Revise a selected area via /api/ai/revise-document-area and verify a new document artifact is generated
        status_rev, rev_data = self._http_post_json(
            "/api/ai/revise-document-area",
            {
                "artifact_id": artifact_id,
                "title": "Reply to Form GST DRC-01 Show Cause Notice",
                "format": "pdf",
                "full_content": initial_md,
                "selected_area": "The taxpayer claimed Input Tax Credit of ₹4,80,000 in Form GSTR-3B, which is fully supported by tax invoices and supplier declarations under Circular No. 183/15/2022-GST.",
                "section_heading": "2. Submission on ITC Reconciliation",
                "instruction": "Update the Input Tax Credit figure to ₹3,25,000 and add that payment to suppliers was made within 180 days through banking channels.",
            },
        )
        self.assertEqual(status_rev, 200)
        self.assertTrue(rev_data.get("ok"), rev_data)
        self.assertTrue(rev_data.get("artifact_id"))
        self.assertNotEqual(rev_data.get("artifact_id"), artifact_id)
        self.assertTrue(os.path.isfile(rev_data.get("file_path")))
        self.assertGreater(os.path.getsize(rev_data.get("file_path")), 1500)
        self.assertIn("Preliminary Objections", rev_data.get("revised_content", ""))
        self.assertIn("Prayer", rev_data.get("revised_content", ""))

        # Verify static/vs-ai.js has .btn-card-preview, openInteractiveDocumentPreviewModal, and .vs-ai-btn-clarif-upload
        base_dir = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(base_dir, "static", "vs-ai.js"), "r", encoding="utf-8") as f:
            vs_ai_js = f.read()
        self.assertIn("btn-card-preview", vs_ai_js)
        self.assertIn("openInteractiveDocumentPreviewModal", vs_ai_js)
        self.assertIn("vs-ai-btn-clarif-upload", vs_ai_js)
        self.assertIn("/api/ai/revise-document-area", vs_ai_js)


if __name__ == "__main__":
    unittest.main(verbosity=2)
