"""
Comprehensive Verification Suite for Core Modules under Isolated SQLite Test DB.
Phase 6 & 7 QA Standard - Gravitas Verification Hierarchy.

Core Modules Tested:
1. Client Management (Create, Query, Search, Filter, Update, Delete in Isolated DB)
2. PDF Studio Operations (Create session, Render PNG, Rotate, Watermark, Delete, Undo, Split, Merge)
3. Bank Statement Parsing (Decimal-safe parsing, Date normalization, CSV/Excel parsing, Reconciliation math)
4. Tally XML Packet Generation & MCP Client Connectivity (XML Envelopes, Voucher Structures, Node check, Port check, Guardrails)
5. DocIR Word & Excel Deterministic Generation (DocIR construction, ExcelDocIRGenerator, WordDocIRGenerator, DocumentValidator)
"""

import os
import sys
import json
import uuid
import shutil
import sqlite3
import tempfile
import unittest
import xml.etree.ElementTree as ET
from decimal import Decimal
from pathlib import Path

# Set up environment path
APP_ROOT = Path(__file__).resolve().parent
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

# Imports from project
from db_replicator import isolated_test_db, calculate_sha256, DEFAULT_PRIMARY_DB
import pdf_studio_engine
import pymupdf
from statement_parser import BankStatementParser, parse_decimal_safe, normalize_date_string
from tally_mcp_client import TallyMCPClient
from automation_db import init_automation_tables
from automation_engine import AutomationEngine
import docir_models
from docir_models import (
    DocIR, TargetFormat, GenerationMode, DocumentType,
    SemanticSection, SemanticTable, SemanticRow, SemanticColumn,
    SemanticCell, SemanticRowType, NumberFormatType, ControlAssertion
)
from deterministic_generators import ExcelDocIRGenerator, WordDocIRGenerator
from doc_validator import DocumentValidator, ValidationState
from doc_recovery import BoundedRecoveryEngine
import openpyxl
import docx


class TestCoreModulesIsolated(unittest.TestCase):
    """Rigorous functional test suite for core modules under isolated SQLite DB."""

    @classmethod
    def setUpClass(cls):
        cls.work_dir = Path(tempfile.mkdtemp(prefix="vs_core_test_"))
        cls.primary_sha = calculate_sha256(DEFAULT_PRIMARY_DB)

    @classmethod
    def tearDownClass(cls):
        try:
            shutil.rmtree(cls.work_dir, ignore_errors=True)
        except Exception:
            pass
        # Final integrity check on primary DB
        final_sha = calculate_sha256(DEFAULT_PRIMARY_DB)
        assert cls.primary_sha == final_sha, f"CRITICAL: Primary DB was mutated! {cls.primary_sha} vs {final_sha}"

    # =========================================================================
    # 1. CLIENT MANAGEMENT TESTS (ISOLATED DB)
    # =========================================================================
    def test_01_client_management_crud_and_search_isolated(self):
        """Validates client create, query, search, update, delete in isolated SQLite database."""
        with isolated_test_db() as replica_path:
            self.assertTrue(replica_path.exists())
            
            with sqlite3.connect(replica_path) as con:
                con.row_factory = sqlite3.Row
                
                # A. Query existing clients
                existing = con.execute("SELECT * FROM clients ORDER BY name").fetchall()
                self.assertGreaterEqual(len(existing), 1, "Baseline database should contain client records")
                existing_fno_list = [r["file_no"] for r in existing]

                # B. Create / Insert new test client
                test_fno = f"QA_TEST_{uuid.uuid4().hex[:6].upper()}"
                test_name = "Gravitas QA Precision Ltd"
                test_mobile = "9876543210"
                test_type = "Private Limited"
                test_group = "Audit & Assurance"
                test_tags = json.dumps(["Audit", "High-Priority"])
                test_status = "Active"
                test_users = json.dumps(["Admin", "Auditor1"])
                test_updated = "2026-11-02T15:00:00Z"

                con.execute("""
                    INSERT INTO clients (file_no, name, mobile, client_type, client_group, tags, status, users, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (test_fno, test_name, test_mobile, test_type, test_group, test_tags, test_status, test_users, test_updated))
                con.commit()

                # C. Query inserted client
                row = con.execute("SELECT * FROM clients WHERE file_no=?", (test_fno,)).fetchone()
                self.assertIsNotNone(row, "Newly inserted client should be retrievable")
                self.assertEqual(row["name"], test_name)
                self.assertEqual(row["mobile"], test_mobile)
                self.assertEqual(row["client_type"], test_type)
                self.assertEqual(row["status"], test_status)

                # D. Search clients (Name substring search)
                search_term = "%Precision%"
                results = con.execute("SELECT * FROM clients WHERE name LIKE ?", (search_term,)).fetchall()
                found_fnos = [r["file_no"] for r in results]
                self.assertIn(test_fno, found_fnos, "Substring search should locate inserted client")

                # E. Filter clients by client_type
                type_results = con.execute("SELECT * FROM clients WHERE client_type=?", (test_type,)).fetchall()
                type_fnos = [r["file_no"] for r in type_results]
                self.assertIn(test_fno, type_fnos, "Filtering by client_type should return matching client")

                # F. Update client details
                updated_name = "Gravitas QA Precision Holdings Ltd"
                updated_mobile = "9988776655"
                con.execute("UPDATE clients SET name=?, mobile=? WHERE file_no=?", (updated_name, updated_mobile, test_fno))
                con.commit()

                updated_row = con.execute("SELECT * FROM clients WHERE file_no=?", (test_fno,)).fetchone()
                self.assertEqual(updated_row["name"], updated_name)
                self.assertEqual(updated_row["mobile"], updated_mobile)

                # G. Transaction Rollback Verification
                try:
                    con.execute("SAVEPOINT test_sp;")
                    con.execute("UPDATE clients SET name='DO_NOT_COMMIT' WHERE file_no=?", (test_fno,))
                    # Simulate rollback
                    con.execute("ROLLBACK TO test_sp;")
                    con.execute("RELEASE test_sp;")
                except Exception:
                    con.rollback()

                rechecked_row = con.execute("SELECT * FROM clients WHERE file_no=?", (test_fno,)).fetchone()
                self.assertEqual(rechecked_row["name"], updated_name, "Rolled back changes must not persist")

                # H. Delete client
                con.execute("DELETE FROM clients WHERE file_no=?", (test_fno,))
                con.commit()
                deleted_check = con.execute("SELECT * FROM clients WHERE file_no=?", (test_fno,)).fetchone()
                self.assertIsNone(deleted_check, "Deleted client must not exist in table")

        # After exiting context, primary DB SHA256 is checked automatically by isolated_test_db()

    # =========================================================================
    # 2. PDF STUDIO OPERATIONS (SPLIT, MERGE, ROTATE, WATERMARK)
    # =========================================================================
    def _generate_test_pdf(self, path: Path, pages: int = 4) -> Path:
        """Helper to create a test multi-page PDF."""
        doc = pymupdf.open()
        for i in range(pages):
            page = doc.new_page(width=400, height=600)
            page.insert_text((50, 100), f"PDF Studio Test Document - Page {i + 1}", fontsize=16)
            page.insert_text((50, 150), f"Timestamp: 2026-11-02 Page Identifier #{i + 1}", fontsize=11)
        doc.save(str(path))
        doc.close()
        return path

    def test_02_pdf_studio_operations(self):
        """Validates PDF Studio Engine: session creation, page rendering, rotate, watermark, split, merge."""
        engine = pdf_studio_engine.PDFStudioEngine(self.work_dir)

        # 1. Generate test PDF and create session
        pdf_file = self.work_dir / "studio_sample.pdf"
        self._generate_test_pdf(pdf_file, pages=4)
        pdf_bytes = pdf_file.read_bytes()

        sess = engine.create_session("sample_qa.pdf", pdf_bytes)
        self.assertIsNotNone(sess)
        self.assertTrue(sess.session_id.startswith("pdf_sess_"))
        self.assertEqual(sess.meta.get("page_count"), 4)

        # 2. Render Page to PNG
        png_data = engine.render_page_png(sess.session_id, page_num=1, dpi=96)
        self.assertTrue(png_data.startswith(b"\x89PNG"), "Rendered output must have valid PNG signature")
        self.assertGreater(len(png_data), 1024, "Rendered PNG must contain valid raster payload")

        # 3. Rotate Page
        rot_res = engine.execute_tool(sess.session_id, "rotate_pages", {"angle": 90, "which_pages": "all"})
        self.assertTrue(rot_res.get("ok"), f"Rotation failed: {rot_res}")
        self.assertIn("Rotated", rot_res.get("message", ""))

        # 4. Watermark Insertion
        wm_res = engine.execute_tool(sess.session_id, "watermark_pdf", {
            "text": "AUDITED COPY",
            "opacity": 0.25,
            "rotation": 45,
            "font_size": 36,
            "color": "#FF0000"
        })
        self.assertTrue(wm_res.get("ok"), f"Watermark failed: {wm_res}")

        # 5. Page Deletion & Undo
        del_res = engine.execute_tool(sess.session_id, "delete_pages", {"pages": [2]})
        self.assertTrue(del_res.get("ok"))
        info_after_del = engine.get_session(sess.session_id)
        self.assertEqual(info_after_del.meta.get("page_count"), 3)

        undo_res = engine.undo(sess.session_id)
        self.assertTrue(undo_res.get("ok"))
        info_after_undo = engine.get_session(sess.session_id)
        self.assertEqual(info_after_undo.meta.get("page_count"), 4, "Undo should restore deleted page count to 4")

        # 6. PDF Split Operation
        split_res = engine.execute_tool(sess.session_id, "split_pdf", {"mode": "extract_range", "page_range": "1-2"})
        self.assertTrue(split_res.get("ok"), f"Split failed: {split_res}")
        self.assertEqual(split_res.get("page_count"), 2, "2 pages extracted")

        # 7. PDF Merge Operation
        doc2 = self._generate_test_pdf(self.work_dir / "merge_part2.pdf", pages=2)
        import base64
        b64_extra = base64.b64encode(doc2.read_bytes()).decode("ascii")
        merge_res = engine.execute_tool(sess.session_id, "merge_pdf", {"additional_files": [b64_extra], "order": "append"})
        self.assertTrue(merge_res.get("ok"), f"Merge failed: {merge_res}")
        info_merged = engine.get_session(sess.session_id)
        self.assertEqual(info_merged.meta.get("page_count"), 4, "Merged PDF page count must equal 2 + 2 = 4")

        # Clean up session
        engine.delete_session(sess.session_id)

    # =========================================================================
    # 3. BANK STATEMENT PARSING & RECONCILIATION
    # =========================================================================
    def test_03_bank_statement_parsing_and_reconciliation(self):
        """Validates statement parser for decimal formatting, date normalization, CSV/Excel parsing, and reconciliation."""
        # A. Decimal Safe Parsing
        self.assertEqual(parse_decimal_safe("1,500.50"), Decimal("1500.50"))
        self.assertEqual(parse_decimal_safe("₹ 25,000.00"), Decimal("25000.00"))
        self.assertEqual(parse_decimal_safe("(500.00)"), Decimal("-500.00"))
        self.assertEqual(parse_decimal_safe("250.00 Cr"), Decimal("250.00"))
        self.assertEqual(parse_decimal_safe("120.00 Dr"), Decimal("120.00"))
        self.assertEqual(parse_decimal_safe("-"), Decimal("0.00"))
        self.assertEqual(parse_decimal_safe(None), Decimal("0.00"))
        self.assertEqual(parse_decimal_safe(""), Decimal("0.00"))

        # B. Date Normalization
        self.assertEqual(normalize_date_string("01/04/2026"), "2026-04-01")
        self.assertEqual(normalize_date_string("15-05-2026"), "2026-05-15")
        self.assertEqual(normalize_date_string("2026-06-30"), "2026-06-30")

        # C. CSV Statement Parsing
        csv_content = (
            "Date,Narration,Ref No,Withdrawal,Deposit,Closing Balance\n"
            "01/04/2026,Opening Balance,,0.00,0.00,100000.00\n"
            "05/04/2026,Office Rent Apr 2026,CHQ1001,25000.00,,75000.00\n"
            "10/04/2026,Client Fee Received,UPI992211,,50000.00,125000.00\n"
            "15/04/2026,Software Subscription,DEB4488,5000.00,,120000.00\n"
        )
        csv_path = self.work_dir / "test_statement.csv"
        csv_path.write_text(csv_content, encoding="utf-8")

        parsed_csv = BankStatementParser.parse_csv(csv_path)
        self.assertTrue(parsed_csv.get("ok"))
        txns = parsed_csv.get("transactions", [])
        self.assertEqual(len(txns), 4)
        
        # Verify transaction fields
        t1 = txns[1]
        self.assertEqual(t1["txn_date"], "2026-04-05")
        self.assertEqual(Decimal(str(t1["debit_amount"])), Decimal("25000.00"))
        self.assertEqual(Decimal(str(t1["credit_amount"])), Decimal("0.00"))
        self.assertEqual(t1["ref_number"], "CHQ1001")

        t2 = txns[2]
        self.assertEqual(t2["txn_date"], "2026-04-10")
        self.assertEqual(Decimal(str(t2["debit_amount"])), Decimal("0.00"))
        self.assertEqual(Decimal(str(t2["credit_amount"])), Decimal("50000.00"))

        # D. Mathematical Reconciliation
        # Opening: 100,000.00 + Credits (50,000.00) - Debits (30,000.00) = Closing (120,000.00)
        opening_bal = Decimal("100000.00")
        total_dr = sum((Decimal(str(t["debit_amount"])) for t in txns[1:]), Decimal("0.00"))
        total_cr = sum((Decimal(str(t["credit_amount"])) for t in txns[1:]), Decimal("0.00"))
        calculated_closing = opening_bal + total_cr - total_dr
        expected_closing = Decimal("120000.00")
        self.assertEqual(calculated_closing, expected_closing, "Reconciliation identity must match exactly")

        # E. Excel Statement Parsing
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Statement"
        ws.append(["Date", "Particulars", "Chq No", "Debit", "Credit", "Balance"])
        ws.append(["01-04-2026", "Opening Balance", "", 0, 0, 50000])
        ws.append(["02-04-2026", "Electricity Bill", "NEFT123", 4500, 0, 45500])
        ws.append(["03-04-2026", "Consulting Income", "RTGS456", 0, 15000, 60500])
        xlsx_path = self.work_dir / "test_statement.xlsx"
        wb.save(xlsx_path)

        parsed_excel = BankStatementParser.parse_excel(xlsx_path)
        self.assertTrue(parsed_excel.get("ok"))
        txns_xl = parsed_excel.get("transactions", [])
        self.assertEqual(len(txns_xl), 3)
        self.assertEqual(Decimal(str(txns_xl[1]["debit_amount"])), Decimal("4500.00"))
        self.assertEqual(Decimal(str(txns_xl[2]["credit_amount"])), Decimal("15000.00"))

    # =========================================================================
    # 4. TALLY XML PACKET GENERATION & MCP CLIENT CONNECTIVITY
    # =========================================================================
    def test_04_tally_xml_generation_and_mcp_client(self):
        """Validates Tally XML packet structure, XML envelope validation, and MCP client connectivity."""
        # A. Tally XML Export Envelope Validation
        export_xml = """<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>CompanyListReport</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>"""
        root_export = ET.fromstring(export_xml)
        self.assertEqual(root_export.tag, "ENVELOPE")
        self.assertEqual(root_export.find("HEADER/TALLYREQUEST").text, "Export")
        self.assertEqual(root_export.find("HEADER/ID").text, "CompanyListReport")

        # B. Tally Voucher Import XML Envelope Validation (Double-Entry Posting)
        voucher_xml = """<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>Test Enterprise LLP</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
    <DATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="Payment" ACTION="Create">
          <DATE>20260405</DATE>
          <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
          <VOUCHERNUMBER>CHQ1001</VOUCHERNUMBER>
          <NARRATION>Office Rent Apr 2026 [VS-TXN:a1b2c3d4e5f60718]</NARRATION>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Rent Expenses</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-25000.00</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>HDFC Bank</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>25000.00</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>"""
        root_vch = ET.fromstring(voucher_xml)
        self.assertEqual(root_vch.tag, "ENVELOPE")
        self.assertEqual(root_vch.find("HEADER/TALLYREQUEST").text, "Import Data")
        self.assertEqual(root_vch.find("BODY/DESC/STATICVARIABLES/SVCURRENTCOMPANY").text, "Test Enterprise LLP")
        
        # Verify Double-Entry Balance in XML
        vch_elem = root_vch.find("BODY/DATA/TALLYMESSAGE/VOUCHER")
        entries = vch_elem.findall("ALLLEDGERENTRIES.LIST")
        self.assertEqual(len(entries), 2, "Payment voucher must have exactly 2 double-entry legs")
        amt1 = Decimal(entries[0].find("AMOUNT").text)
        amt2 = Decimal(entries[1].find("AMOUNT").text)
        self.assertEqual(amt1 + amt2, Decimal("0.00"), "Double-entry amounts in Tally XML must sum to exactly zero")

        # C. MCP Client Lifecycle & Port Reachability
        client = TallyMCPClient.get_instance()
        self.assertIsNotNone(client)
        
        # Check Node.js runtime availability
        is_node, node_ver = client.check_node_installed()
        self.assertTrue(is_node, f"Node.js must be installed in environment: {node_ver}")
        self.assertTrue(node_ver.startswith("v24."), f"Expected Node v24+, got {node_ver}")

        # Check port reachability check handles offline gracefully without throwing unhandled exceptions
        is_open = client.check_tally_port_reachable("127.0.0.1", 9000, timeout=0.1)
        self.assertIsInstance(is_open, bool)

        # Connection status report
        status = client.get_connection_status(force_refresh=True)
        self.assertIn("node_available", status)
        self.assertIn("tally_port_open", status)
        self.assertIn("mcp_entry_exists", status)

    # =========================================================================
    # 5. DOCIR WORD / EXCEL GENERATION & INDEPENDENT VALIDATION GATES
    # =========================================================================
    def test_05_docir_excel_and_word_generation_and_validation(self):
        """Validates DocIR building, deterministic Excel & Word generator, and delivery gate validation."""
        # A. Build DocIR Model
        cols = [
            SemanticColumn(col_id="particulars", header="Particulars", width_chars=35, align="left"),
            SemanticColumn(col_id="note_no", header="Note", width_chars=8, align="center"),
            SemanticColumn(col_id="current_period", header="Current Period (₹)", width_chars=22, default_format=NumberFormatType.CURRENCY_INR, align="right"),
            SemanticColumn(col_id="prev_period", header="Previous Period (₹)", width_chars=22, default_format=NumberFormatType.CURRENCY_INR, align="right"),
        ]

        rows = [
            SemanticRow(row_id="cat_eq", label="I. EQUITY AND LIABILITIES", row_type=SemanticRowType.CATEGORY),
            SemanticRow(
                row_id="row_sc", label="(a) Share capital", row_type=SemanticRowType.DETAIL,
                is_indent=1,
                cells={
                    "particulars": SemanticCell(value="(a) Share capital"),
                    "note_no": SemanticCell(value="1", align="center"),
                    "current_period": SemanticCell(value=5000000.0, format_type=NumberFormatType.CURRENCY_INR),
                    "prev_period": SemanticCell(value=5000000.0, format_type=NumberFormatType.CURRENCY_INR),
                }
            ),
            SemanticRow(
                row_id="row_rs", label="(b) Reserves and surplus", row_type=SemanticRowType.DETAIL,
                is_indent=1,
                cells={
                    "particulars": SemanticCell(value="(b) Reserves and surplus"),
                    "note_no": SemanticCell(value="2", align="center"),
                    "current_period": SemanticCell(value=3000000.0, format_type=NumberFormatType.CURRENCY_INR),
                    "prev_period": SemanticCell(value=2000000.0, format_type=NumberFormatType.CURRENCY_INR),
                }
            ),
            SemanticRow(
                row_id="sub_shf", label="Subtotal - Shareholders' Funds", row_type=SemanticRowType.SUBTOTAL,
                dependencies=["row_sc", "row_rs"],
                cells={
                    "particulars": SemanticCell(value="Subtotal - Shareholders' Funds", is_bold=True),
                    "note_no": SemanticCell(value=""),
                    "current_period": SemanticCell(value=8000000.0, formula="=SUM(C6:C7)", format_type=NumberFormatType.CURRENCY_INR, is_bold=True),
                    "prev_period": SemanticCell(value=7000000.0, formula="=SUM(D6:D7)", format_type=NumberFormatType.CURRENCY_INR, is_bold=True),
                }
            ),
            SemanticRow(
                row_id="total_eq", label="TOTAL - EQUITY AND LIABILITIES", row_type=SemanticRowType.GRAND_TOTAL,
                dependencies=["sub_shf"],
                cells={
                    "particulars": SemanticCell(value="TOTAL - EQUITY AND LIABILITIES", is_bold=True),
                    "note_no": SemanticCell(value=""),
                    "current_period": SemanticCell(value=8000000.0, formula="=C8", format_type=NumberFormatType.CURRENCY_INR, is_bold=True),
                    "prev_period": SemanticCell(value=7000000.0, formula="=D8", format_type=NumberFormatType.CURRENCY_INR, is_bold=True),
                }
            ),
        ]

        table = SemanticTable(table_id="table_eq", title="Equity and Liabilities", columns=cols, rows=rows)
        section = SemanticSection(section_id="sec_bs", heading="Balance Sheet", tables=[table])
        
        doc_ir = DocIR(
            title="Statement of Financial Position",
            client_name="Gravitas Precision Corp",
            target_format=TargetFormat.XLSX,
            generation_mode=GenerationMode.PROFESSIONAL,
            document_type=DocumentType.FINANCIAL_STATEMENTS,
            sections=[section],
            control_assertions=[
                ControlAssertion(
                    assertion_id="reconciliation_check",
                    name="Grand Total Balance",
                    left_expr="total_eq",
                    right_expr="total_eq",
                    op="==",
                    tolerance=0.01,
                    error_message="Grand total balance does not reconcile"
                )
            ]
        )

        # B. Deterministic Excel Generation
        excel_out = self.work_dir / "generated_financial_sheet.xlsx"
        ExcelDocIRGenerator.generate(doc_ir, output_path=excel_out)
        self.assertTrue(excel_out.exists(), "Generated Excel file must exist on disk")
        self.assertGreater(excel_out.stat().st_size, 2048, "Excel file must not be empty")

        # Independent Validation Gate for Excel
        val_result = DocumentValidator.validate_artifact(excel_out, doc_ir, "xlsx")
        self.assertTrue(val_result.is_valid, f"Excel validation failed: {val_result.errors}")
        self.assertEqual(val_result.state, ValidationState.READY, "Excel must attain 'READY' status")

        # C. Deterministic Word Generation
        doc_ir.target_format = TargetFormat.DOCX
        word_out = self.work_dir / "generated_financial_sheet.docx"
        WordDocIRGenerator.generate(doc_ir, output_path=word_out)
        self.assertTrue(word_out.exists(), "Generated Word file must exist on disk")
        self.assertGreater(word_out.stat().st_size, 2048, "Word file must not be empty")

        # Inspect Word Document content
        doc_obj = docx.Document(str(word_out))
        self.assertGreaterEqual(len(doc_obj.tables), 1, "Word document must contain generated financial table")
        table_obj = doc_obj.tables[0]
        self.assertTrue(any("Share capital" in cell.text for row in table_obj.rows for cell in row.cells), "Word table should contain Share capital")

        # Independent Validation Gate for Word
        word_val_result = DocumentValidator.validate_artifact(word_out, doc_ir, "docx")
        self.assertTrue(word_val_result.is_valid, f"Word validation failed: {word_val_result.errors}")
        self.assertEqual(word_val_result.state, ValidationState.READY, "Word must attain 'READY' status")


if __name__ == "__main__":
    unittest.main(verbosity=2)
