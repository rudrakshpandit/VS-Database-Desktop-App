"""
End-to-End Acceptance Verification Suite for VS Database:
- Phase 3 (3A-3G): All 7 Representative Reports across Excel (.xlsx), Word (.docx), and PDF (.pdf)
- Phase 4: Clarification Slide Generation, Multi-Slide Submission, Custom Answers & Fact Persistence
- Phase 5: Windows Artifact Download & Save-to-Location Verification
- Phase 1: Window State Validation, Maximized/Normal/Minimized & Off-Screen Clamping
"""

import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import docx
import openpyxl
from pypdf import PdfReader

from vs_ai_doc_generator import (
    DocumentPlanner,
    export_ai_document_docx,
    export_ai_opinion_pdf,
    export_ai_spreadsheet_xlsx,
    get_docx_preview_data,
    get_xlsx_preview_data,
)
from vs_ai_clarification import ClarificationEngine, FactRepository, IntentDetector
from main_app import validate_window_bounds


REPRESENTATIVE_REPORTS = [
    {
        "id": "Report_1_Sales_GST_Register",
        "title": "Sales and GST Register Report FY 2025-26",
        "prompt": (
            "Generate an Excel sales and GST register report for FY 2025-26 with monthly summary, "
            "invoice register, GST rate-wise breakup, taxable value, CGST, SGST, IGST, total invoice value, "
            "B2B/B2C split, credit notes, reconciliation checks, and formulas."
        ),
        "formats": ["xlsx"],
        "expected_archetype": "sales_gst_register",
        "min_sheets": 5,
        "min_formulas": 35,
        "required_keywords": ["B2B", "B2C", "CGST", "SGST", "IGST", "Credit Note", "GSTR-1"],
    },
    {
        "id": "Report_2_GSTR2B_Reconciliation",
        "title": "GSTR-2B vs Purchase Register Reconciliation Report",
        "prompt": (
            "Generate a GSTR-2B vs Purchase Register reconciliation report in Excel and PDF with matched invoices, "
            "mismatched invoices, missing in GSTR-2B, missing in books, eligible ITC, blocked/ineligible ITC, "
            "vendor follow-up action items, and summary totals."
        ),
        "formats": ["xlsx", "pdf"],
        "expected_archetype": "gstr2b_reconciliation",
        "min_sheets": 6,
        "min_formulas": 30,
        "required_keywords": ["GSTR-2B", "Matched", "Mismatched", "17(5)", "16(2)"],
    },
    {
        "id": "Report_3_Financial_Statements",
        "title": "Financial Statement Report FY 2025-26",
        "prompt": (
            "Generate a complete financial statement report in Excel, Word and PDF containing Trial Balance, "
            "Trading and Profit & Loss Account, Balance Sheet, schedule summaries, key ratios, and accounting notes "
            "— ensure that total debits equal total credits and Balance Sheet totals reconcile."
        ),
        "formats": ["xlsx", "docx", "pdf"],
        "expected_archetype": "financial_statements",
        "min_sheets": 5,
        "min_formulas": 30,
        "required_keywords": ["Trial Balance", "Profit", "Balance Sheet", "2,48,50,000", "1,42,90,000"],
    },
    {
        "id": "Report_4_Ageing_Analysis",
        "title": "Debtors and Creditors Ageing Analysis Report",
        "prompt": (
            "Generate a debtors and creditors ageing report in Excel and PDF with 0–30, 31–60, 61–90, 91–180, "
            "and 180+ day buckets, doubtful debt provisioning, MSME creditor flags, concentration analysis, "
            "and collection/payment priority notes."
        ),
        "formats": ["xlsx", "pdf"],
        "expected_archetype": "ageing_analysis",
        "min_sheets": 4,
        "min_formulas": 30,
        "required_keywords": ["180+", "Doubtful", "MSME", "43B(h)", "31,20,000"],
    },
    {
        "id": "Report_5_TDS_Compliance",
        "title": "TDS Compliance Interest and Late Fee Report",
        "prompt": (
            "Generate a TDS compliance report in Excel, Word and PDF covering section-wise deductions, due dates, "
            "actual deduction/deposit dates, shortfall, interest computation, late fee exposure, disallowance risk "
            "under the Income-tax Act, and action checklist."
        ),
        "formats": ["xlsx", "docx", "pdf"],
        "expected_archetype": "tds_compliance",
        "min_sheets": 4,
        "min_formulas": 25,
        "required_keywords": ["194C", "194J", "201(1A)", "234E", "40(a)(ia)"],
    },
    {
        "id": "Report_6_Fixed_Asset_Depreciation",
        "title": "Fixed Asset Register and Depreciation Schedule Report",
        "prompt": (
            "Generate a fixed asset register and depreciation schedule in Excel and PDF with opening WDV, "
            "additions (>=180 days and <180 days), deletions, depreciation rate, current year depreciation, "
            "closing WDV, and block-wise summary."
        ),
        "formats": ["xlsx", "pdf"],
        "expected_archetype": "fixed_asset_depreciation",
        "min_sheets": 4,
        "min_formulas": 30,
        "required_keywords": ["Opening WDV", "180 Days", "Closing WDV", "Plant & Machinery", "28,25,000"],
    },
    {
        "id": "Report_7_Notice_Reply_Audit_Report",
        "title": "Formal GST Notice Reply and Audit Observation Report",
        "prompt": (
            "Generate a formal notice reply and audit observation report in Word and PDF with issue summary table, "
            "legal/factual submissions, reconciliation annexure summary, risk assessment, and concluding "
            "prayer/recommendations."
        ),
        "formats": ["docx", "pdf"],
        "expected_archetype": "notice_reply_report",
        "min_sheets": 3,
        "min_formulas": 0,
        "required_keywords": ["DRC-01", "Issue 1", "Annexure A", "Section 75(4)", "VERIFICATION"],
    },
]


def verify_xlsx_file(xlsx_path: Path, spec: dict) -> dict:
    assert xlsx_path.is_file(), f"Missing XLSX file: {xlsx_path}"
    size_bytes = xlsx_path.stat().st_size
    assert size_bytes > 5000, f"XLSX file too small ({size_bytes} bytes)"

    wb = openpyxl.load_workbook(str(xlsx_path), data_only=False)
    sheet_names = wb.sheetnames
    assert len(sheet_names) >= spec["min_sheets"], (
        f"{spec['id']}: Expected >= {spec['min_sheets']} sheets, got {len(sheet_names)}: {sheet_names}"
    )
    assert sheet_names[0] == "Executive_Summary", (
        f"{spec['id']}: First sheet must be Executive_Summary, got {sheet_names[0]}"
    )

    total_formulas = 0
    formula_types = {"SUM": 0, "SUBTOTAL": 0, "IF": 0, "IFERROR": 0, "COUNTIF": 0, "AVERAGEIF": 0, "CROSS_SHEET": 0}
    has_cf = False
    has_autofilter = False
    has_freeze = False

    for sname in sheet_names:
        ws = wb[sname]
        if ws.freeze_panes:
            has_freeze = True
        if ws.auto_filter and ws.auto_filter.ref:
            has_autofilter = True
        if len(ws.conditional_formatting) > 0:
            has_cf = True

        for row in ws.iter_rows(values_only=False):
            for cell in row:
                val = cell.value
                if isinstance(val, str) and val.startswith("="):
                    total_formulas += 1
                    u = val.upper()
                    for k in ("SUM(", "SUBTOTAL(", "IF(", "IFERROR(", "COUNTIF(", "AVERAGEIF("):
                        if k in u:
                            formula_types[k[:-1]] += 1
                    if "!" in val:
                        formula_types["CROSS_SHEET"] += 1

    wb.close()
    assert total_formulas >= spec["min_formulas"], (
        f"{spec['id']}: Expected >= {spec['min_formulas']} formulas, got {total_formulas}"
    )
    assert has_freeze, f"{spec['id']}: Missing freeze panes"
    assert has_autofilter, f"{spec['id']}: Missing AutoFilter"
    assert has_cf, f"{spec['id']}: Missing Conditional Formatting"
    assert formula_types["SUM"] > 0, f"{spec['id']}: Missing SUM formulas"
    assert formula_types["SUBTOTAL"] > 0, f"{spec['id']}: Missing SUBTOTAL formulas"
    assert formula_types["CROSS_SHEET"] > 0, f"{spec['id']}: Missing cross-sheet links"

    preview = get_xlsx_preview_data(str(xlsx_path))
    assert preview.get("ok"), f"{spec['id']}: Preview failed: {preview}"

    return {
        "size_kb": round(size_bytes / 1024, 1),
        "sheets": sheet_names,
        "total_formulas": total_formulas,
        "formula_types": formula_types,
    }


def verify_docx_file(docx_path: Path, spec: dict) -> dict:
    assert docx_path.is_file(), f"Missing DOCX file: {docx_path}"
    size_bytes = docx_path.stat().st_size
    assert size_bytes > 15000, f"DOCX file too small ({size_bytes} bytes)"

    doc = docx.Document(str(docx_path))
    assert len(doc.tables) >= 3, f"{spec['id']}: Expected >= 3 Word tables, got {len(doc.tables)}"

    full_text_parts = [p.text for p in doc.paragraphs if p.text.strip()]
    for tbl in doc.tables:
        for row in tbl.rows:
            for cell in row.cells:
                full_text_parts.append(cell.text)
    full_text = "\n".join(full_text_parts)

    # Ensure no raw unevaluated Excel formulas leaked into Word tables
    assert "=SUM(" not in full_text and "=IFERROR(" not in full_text, (
        f"{spec['id']}: Raw Excel formula string leaked into Word document!"
    )

    for kw in spec["required_keywords"]:
        assert kw in full_text, f"{spec['id']} DOCX missing expected keyword '{kw}'"

    # Verify footer has PAGE and NUMPAGES OpenXML fields
    footer_xml = doc.sections[0].footer._element.xml
    assert "PAGE" in footer_xml and "NUMPAGES" in footer_xml, (
        f"{spec['id']}: Missing OpenXML PAGE / NUMPAGES fields in Word footer"
    )

    preview = get_docx_preview_data(str(docx_path))
    assert preview.get("ok"), f"{spec['id']}: DOCX preview failed: {preview}"

    return {
        "size_kb": round(size_bytes / 1024, 1),
        "paragraphs": len(doc.paragraphs),
        "tables": len(doc.tables),
        "orientation": "landscape" if doc.sections[0].page_width > doc.sections[0].page_height else "portrait",
    }


def verify_pdf_file(pdf_path: Path, spec: dict) -> dict:
    assert pdf_path.is_file(), f"Missing PDF file: {pdf_path}"
    size_bytes = pdf_path.stat().st_size
    assert size_bytes > 4000, f"PDF file too small ({size_bytes} bytes)"

    reader = PdfReader(str(pdf_path))
    num_pages = len(reader.pages)
    assert num_pages >= 1, f"{spec['id']}: PDF has 0 pages"

    extracted_pages = [page.extract_text() or "" for page in reader.pages]
    full_text = "\n".join(extracted_pages)

    # Ensure no raw unevaluated Excel formulas leaked into PDF tables
    assert "=SUM(" not in full_text and "=IFERROR(" not in full_text, (
        f"{spec['id']}: Raw Excel formula string leaked into PDF document!"
    )
    assert "₹" in full_text, f"{spec['id']}: PDF missing Unicode ₹ Rupee symbol!"
    assert f"Page 1 of {num_pages}" in full_text, f"{spec['id']}: PDF missing 'Page 1 of {num_pages}' footer!"

    for kw in spec["required_keywords"]:
        assert kw in full_text, f"{spec['id']} PDF missing expected keyword '{kw}'"

    page0 = reader.pages[0]
    w = float(page0.mediabox.width)
    h = float(page0.mediabox.height)

    return {
        "size_kb": round(size_bytes / 1024, 1),
        "pages": num_pages,
        "orientation": "landscape" if w > h else "portrait",
    }


def run_all_tests():
    print("=" * 78)
    print("VS DATABASE — PHASE 3G REPRESENTATIVE REPORTS & WORKFLOW VERIFICATION")
    print("=" * 78)

    tmp_db = Path(tempfile.gettempdir()) / "vs_test_phase3_facts.db"
    if tmp_db.exists():
        tmp_db.unlink()

    import sqlite3
    with sqlite3.connect(tmp_db) as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS ai_conversation_facts (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                fact_key TEXT NOT NULL,
                fact_value TEXT NOT NULL,
                fact_type TEXT NOT NULL,
                source TEXT NOT NULL,
                confidence REAL NOT NULL,
                raw_text TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(conversation_id, fact_key)
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS ai_clarification_sessions (
                session_id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                domain TEXT NOT NULL,
                known_facts_json TEXT,
                missing_facts_json TEXT,
                questions_json TEXT,
                status TEXT NOT NULL,
                answers_json TEXT,
                round_number INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        con.commit()

    engine = ClarificationEngine(tmp_db)
    repo = FactRepository(tmp_db)

    # 1. Verify IntentDetector routes all 7 report prompts to action_generate_report (0 clarification questions)
    for spec in REPRESENTATIVE_REPORTS:
        intent = IntentDetector.analyze(spec["prompt"])
        assert intent["intent"] == "action_generate_report", (
            f"{spec['id']}: Expected intent='action_generate_report', got {intent['intent']}"
        )
        needs_c, q_list, _, _ = engine.evaluate_materiality(spec["prompt"], f"conv_{spec['id']}")
        assert not needs_c, (
            f"{spec['id']}: Report prompt should proceed directly without clarification, got {q_list}"
        )
    print("[PASS] All 7 representative report prompts route directly to report generation (0 clarification blocks).")

    # 2. Generate and inspect all 7 representative reports across Excel, Word, and PDF
    report_results = {}
    for spec in REPRESENTATIVE_REPORTS:
        rid = spec["id"]
        report_results[rid] = {}
        plan = DocumentPlanner.plan_document(spec["title"], spec["prompt"], target_format=spec["formats"][0])
        assert plan.get("report_archetype") == spec["expected_archetype"], (
            f"{rid}: Expected archetype {spec['expected_archetype']}, got {plan.get('report_archetype')}"
        )

        for fmt in spec["formats"]:
            if fmt == "xlsx":
                res = export_ai_spreadsheet_xlsx(
                    title=spec["title"],
                    content=spec["prompt"],
                    client_name="M/s Apex Industrial Enterprises Pvt. Ltd.",
                )
                assert res.get("ok"), f"{rid} XLSX generation failed: {res}"
                metrics = verify_xlsx_file(Path(res["file_path"]), spec)
                report_results[rid]["xlsx"] = metrics
                print(f"  [PASS] {rid} [XLSX]: {metrics['size_kb']} KB | {len(metrics['sheets'])} sheets | {metrics['total_formulas']} live formulas")
            elif fmt == "docx":
                res = export_ai_document_docx(
                    title=spec["title"],
                    content=spec["prompt"],
                    client_name="M/s Apex Industrial Enterprises Pvt. Ltd.",
                )
                assert res.get("ok"), f"{rid} DOCX generation failed: {res}"
                metrics = verify_docx_file(Path(res["file_path"]), spec)
                report_results[rid]["docx"] = metrics
                print(f"  [PASS] {rid} [DOCX]: {metrics['size_kb']} KB | {metrics['tables']} tables | {metrics['orientation']}")
            elif fmt == "pdf":
                res = export_ai_opinion_pdf(
                    title=spec["title"],
                    content=spec["prompt"],
                    client_name="M/s Apex Industrial Enterprises Pvt. Ltd.",
                )
                assert res.get("ok"), f"{rid} PDF generation failed: {res}"
                metrics = verify_pdf_file(Path(res["file_path"]), spec)
                report_results[rid]["pdf"] = metrics
                print(f"  [PASS] {rid} [PDF] : {metrics['size_kb']} KB | {metrics['pages']} pages | {metrics['orientation']}")

    # 3. Verify Phase 4 Clarification Slide Deck + Custom Answer + No Repeat Questions
    cid_clarif = "conv_clarification_test"
    q_prompt = "Help me draft a reply to an income tax notice."
    needs_c1, q1_list, _, domain_1 = engine.evaluate_materiality(q_prompt, cid_clarif)
    assert needs_c1 is True, "Underspecified notice prompt must trigger clarification slides"
    assert 1 <= len(q1_list) <= 5, f"Expected 1-5 questions, got {len(q1_list)}"

    # Simulate user submitting slide answers including a custom answer
    submitted_answers = []
    for idx, q in enumerate(q1_list):
        if idx == 0:
            submitted_answers.append({
                "id": q["id"],
                "question_id": q["id"],
                "question": q["question"],
                "answer": "Section 148 Reassessment Notice for AY 2023-24",
                "is_custom": True,
                "custom_text": "Section 148 Reassessment Notice for AY 2023-24",
            })
        else:
            submitted_answers.append({
                "id": q["id"],
                "question_id": q["id"],
                "question": q["question"],
                "answer": q["options"][0],
                "is_custom": False,
                "custom_text": "",
            })

    needs_c2, q2_list, facts_2, _ = engine.evaluate_materiality(
        "Clarification Answers Submitted",
        cid_clarif,
        clarification_answers=submitted_answers,
    )
    assert needs_c2 is False, (
        f"After submitting all clarification slide answers, needs_clarification must be False! Got: {q2_list}"
    )
    stored_facts = repo.get_facts(cid_clarif)
    assert "notice_type_section" in stored_facts, f"Custom notice_type_section answer was not stored in FactRepository! Keys: {list(stored_facts.keys())}"
    assert stored_facts["notice_type_section"].source == "user_custom", "Expected source='user_custom'"
    print("[PASS] Phase 4 Clarification Slides: 1-5 question generation, custom text persistence & zero repeat questions verified.")

    # 4. Verify Phase 1 Window Bounds Validation (Maximized, Normal, Minimized Sentinel, Off-screen Monitor)
    b_min = validate_window_bounds(-32000, -32000, 160, 28)
    assert b_min["x"] >= 0 and b_min["width"] >= 800 and b_min["height"] >= 600, f"Failed minimized sentinel rejection: {b_min}"

    b_off = validate_window_bounds(25000, -9000, 1350, 850)
    assert b_off["x"] >= 0 and b_off["y"] >= 0 and b_off["width"] >= 800, f"Failed off-screen monitor clamping: {b_off}"

    b_norm = validate_window_bounds(100, 80, 1280, 780)
    assert b_norm["width"] == 1280 and b_norm["height"] == 780, f"Failed normal bounds validation: {b_norm}"
    print("[PASS] Phase 1 Window Bounds Validator: normal, minimized-sentinel & off-screen monitor clamping verified.")

    # 5. Verify Phase 5 Windows Download / Save-to-Location End-to-End
    import shutil
    from main_app import resolve_ai_artifact_source
    sample_xlsx = export_ai_spreadsheet_xlsx(
        title="Download Test Sales Register",
        content=REPRESENTATIVE_REPORTS[0]["prompt"],
        client_name="M/s Apex Industrial Enterprises Pvt. Ltd.",
    )
    art_id = sample_xlsx["artifact_id"]
    resolved_src, resolved_name = resolve_ai_artifact_source(sample_xlsx["filename"], art_id)
    assert resolved_src is not None and Path(resolved_src).is_file(), f"Artifact resolution failed: {resolved_src}"

    target_download_dir = Path(tempfile.gettempdir()) / "vs_download_verification"
    target_download_dir.mkdir(parents=True, exist_ok=True)
    dest_file = target_download_dir / "Verified_Sales_GST_Register.xlsx"
    if dest_file.exists():
        dest_file.unlink()

    shutil.copy2(resolved_src, str(dest_file))
    assert dest_file.is_file() and dest_file.stat().st_size > 5000, f"Windows download copy failed: {dest_file}"
    wb_dl = openpyxl.load_workbook(str(dest_file), data_only=False)
    assert "Executive_Summary" in wb_dl.sheetnames, "Downloaded XLSX failed integrity check"
    wb_dl.close()
    print(f"[PASS] Phase 5 Windows Download Workflow: Artifact {art_id} ({resolved_name}) resolved & saved to {dest_file} ({dest_file.stat().st_size} bytes) and verified.")

    print("=" * 78)
    print("ALL 7 REPRESENTATIVE REPORTS (15 OUTPUT FILES) & WORKFLOW CHECKS PASSED!")
    print("=" * 78)


if __name__ == "__main__":
    run_all_tests()
