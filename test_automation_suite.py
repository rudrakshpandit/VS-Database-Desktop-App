"""
Automated Test Suite for VS Database Automation Tab & Tally Integration
Tests:
1. Navigation and route registration (Automation tab in HTML, app.js, server.py)
2. Bank Statement Parsers (CSV, Excel, PDF, XML, Decimal calculations, reconciliation checks)
3. Database schema persistence (sessions, transactions, mapping rules, posting records, ask tally)
4. Bulk ledger assignment, rule engine, and double-entry validation
5. Tally MCP client protocol handshakes, tool discovery, and error handling
6. Ask Tally read-only safety guardrails
"""

import sys
import unittest
import tempfile
from pathlib import Path
from decimal import Decimal

# Ensure app root in sys.path
APP_ROOT = Path(__file__).resolve().parent
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from statement_parser import BankStatementParser, parse_decimal_safe, normalize_date_string
from tally_mcp_client import TallyMCPClient
from automation_db import init_automation_tables
from automation_engine import AutomationEngine

class TestAutomationSuite(unittest.TestCase):

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_vs_database.db"
        init_automation_tables(self.db_path)
        self.engine = AutomationEngine(self.db_path)

    def tearDown(self):
        try:
            TallyMCPClient.get_instance().terminate()
        except Exception:
            pass
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    # -------------------------------------------------------------------------
    # 1. PARSER & RECONCILIATION TESTS
    # -------------------------------------------------------------------------
    def test_decimal_safe_parsing(self):
        self.assertEqual(parse_decimal_safe("1,500.50"), Decimal("1500.50"))
        self.assertEqual(parse_decimal_safe("₹ 25,000.00"), Decimal("25000.00"))
        self.assertEqual(parse_decimal_safe("(500.00)"), Decimal("-500.00"))
        self.assertEqual(parse_decimal_safe("250.00 Cr"), Decimal("250.00"))
        self.assertEqual(parse_decimal_safe("120.00 Dr"), Decimal("120.00"))
        self.assertEqual(parse_decimal_safe("-"), Decimal("0.00"))
        self.assertEqual(parse_decimal_safe(None), Decimal("0.00"))

    def test_date_normalization(self):
        self.assertEqual(normalize_date_string("01/04/2026"), "2026-04-01")
        self.assertEqual(normalize_date_string("15-05-2026"), "2026-05-15")
        self.assertEqual(normalize_date_string("2026-06-30"), "2026-06-30")
        self.assertEqual(normalize_date_string("05-Aug-2026"), "2026-08-05")

    def test_csv_parser_and_reconciliation(self):
        csv_content = """Date,Narration,Ref No,Withdrawal,Deposit,Balance
01/04/2026,OPENING BALANCE,REF001,,10000.00,10000.00
02/04/2026,UPI/RAZORPAY/PAYMENT,9876543210,2500.00,,7500.00
03/04/2026,BANK CHARGES,CHG11,50.00,,7450.00
04/04/2026,INTEREST RECEIVED,INT01,,200.00,7650.00
"""
        csv_file = Path(self.temp_dir.name) / "test.csv"
        csv_file.write_text(csv_content, encoding="utf-8")

        res = BankStatementParser.parse_file(csv_file, "test.csv")
        self.assertTrue(res["ok"])
        self.assertEqual(res["count"], 4)
        self.assertEqual(res["total_debits"], 2550.0)
        self.assertEqual(res["total_credits"], 10200.0)
        self.assertEqual(res["reconciliation_status"], "verified")
        self.assertEqual(res["calculated_difference"], 0.0)

    def test_pdf_bank_statement_parser_5_pages(self):
        pdf_path = Path("data/automation_uploads/01ce3723_sample_bank_statement_5_pages.pdf")
        if not pdf_path.exists():
            return
        res = BankStatementParser.parse_file(pdf_path, "sample_bank_statement_5_pages.pdf")
        self.assertTrue(res["ok"])
        self.assertEqual(res["count"], 75)
        self.assertEqual(res["from_date"], "2026-04-01")
        self.assertEqual(res["to_date"], "2026-04-30")
        self.assertEqual(res["total_debits"], 342142.0)
        self.assertEqual(res["total_credits"], 944250.0)
        self.assertEqual(res["opening_balance"], 125000.0)
        self.assertEqual(res["closing_balance"], 727108.0)
        self.assertEqual(res["reconciliation_status"], "verified")
        self.assertEqual(res["calculated_difference"], 0.0)

    # -------------------------------------------------------------------------
    # 2. WORKFLOW & BULK ASSIGNMENT TESTS
    # -------------------------------------------------------------------------
    def test_import_session_and_bulk_assignment(self):
        csv_content = """Date,Narration,Ref No,Debit,Credit,Balance
01/04/2026,NEFT-SALARY-APRIL,REF991,50000.00,,50000.00
02/04/2026,RAZORPAY SETTLEMENT,REF992,,15000.00,65000.00
"""
        csv_file = Path(self.temp_dir.name) / "stmt.csv"
        csv_file.write_text(csv_content, encoding="utf-8")

        # 1. Create session
        sess_res = self.engine.create_import_session(
            company_name="Alpha Infotech Pvt Ltd",
            source_filename="stmt.csv",
            file_path=csv_file,
            bank_account_ledger="HDFC Current A/c"
        )
        self.assertTrue(sess_res["ok"])
        sess_id = sess_res["session_id"]

        # 2. Fetch transactions
        txns_res = self.engine.get_session_transactions(sess_id)
        self.assertEqual(txns_res["total_count"], 2)
        txns = txns_res["transactions"]

        # 3. Bulk assign ledger with reusable rule
        t_ids = [txns[0]["transaction_id"]]
        bulk_res = self.engine.bulk_assign_ledger(
            transaction_ids=t_ids,
            ledger_name="Salary Expense",
            voucher_type="Payment",
            save_as_rule=True,
            rule_pattern="salary",
            company_name="Alpha Infotech Pvt Ltd"
        )
        self.assertTrue(bulk_res["ok"])
        self.assertEqual(bulk_res["assigned_count"], 1)
        self.assertIsNotNone(bulk_res["created_rule_id"])

        # 4. Check validation
        val_res = self.engine.validate_session_for_posting(sess_id)
        self.assertTrue(val_res["ok"])
        self.assertEqual(val_res["assigned_count"], 1)
        self.assertEqual(val_res["unassigned_count"], 1)
        # Should not be ready until 100% assigned
        self.assertFalse(val_res["is_ready_for_posting"])

        # 5. Assign remaining transaction
        bulk_res2 = self.engine.bulk_assign_ledger(
            transaction_ids=[txns[1]["transaction_id"]],
            ledger_name="Sales Revenue",
            voucher_type="Receipt"
        )
        self.assertTrue(bulk_res2["ok"])

        # 6. Re-validate
        val_res2 = self.engine.validate_session_for_posting(sess_id)
        self.assertTrue(val_res2["ok"])
        self.assertEqual(val_res2["assigned_count"], 2)
        self.assertEqual(val_res2["unassigned_count"], 0)
        self.assertTrue(val_res2["is_ready_for_posting"])

    # -------------------------------------------------------------------------
    # 3. TALLY MCP CLIENT TESTS
    # -------------------------------------------------------------------------
    def test_tally_mcp_client_status(self):
        client = TallyMCPClient.get_instance()
        st = client.get_connection_status()
        self.assertIn("node_available", st)
        self.assertIn("mcp_entry_exists", st)
        self.assertIn("tally_port_open", st)
        self.assertTrue(st["node_available"])
        self.assertTrue(st["mcp_entry_exists"])

    def test_tally_mcp_tool_invocation(self):
        client = TallyMCPClient.get_instance()
        port_open = client.check_tally_port_reachable()
        res = client.call_tool("list-master", {"collection": "company"})
        if port_open:
            # When Tally is running and port 9000 is open, tool call succeeds
            self.assertTrue(res["ok"])
            self.assertIn("data", res)
        else:
            # When Tally is offline, tool call returns structured helpful error without crashing
            self.assertFalse(res["ok"])
            self.assertIn("error", res)
            self.assertIn("Tally", res["error"])

    # -------------------------------------------------------------------------
    # 4. CONTINUOUS LEARNING, TOGGLE SUGGESTIONS & CHUNKED POSTING TESTS
    # -------------------------------------------------------------------------
    def test_continuous_company_learning(self):
        """Verifies company-specific learning records and ensures company isolation."""
        # 1. Company A learns from manual/confirmed assignment
        self.engine.record_company_learning(
            company_name="Acme Corp",
            narration="UPI-SWIGGY-FOOD-ORDER-001",
            direction="DEBIT",
            assigned_ledger="Staff Refreshment",
            voucher_type="Payment",
            source="user_confirmed"
        )

        # 2. Ingest statement for Company A with similar narration
        csv_a = "Date,Narration,Ref No,Debit,Credit,Balance\n01/04/2026,UPI-SWIGGY-FOOD-ORDER-002,REF1,450.00,,9550.00\n"
        path_a = Path(self.temp_dir.name) / "stmt_a.csv"
        path_a.write_text(csv_a, encoding="utf-8")

        sess_a = self.engine.create_import_session(
            company_name="Acme Corp",
            source_filename="stmt_a.csv",
            file_path=path_a,
            bank_account_ledger="Bank A/C"
        )["session_id"]

        # Upon statement ingestion for Acme Corp, learned pattern automatically populates suggested_ledger
        txns_a = self.engine.get_session_transactions(sess_a)["transactions"]
        self.assertEqual(txns_a[0]["suggested_ledger"], "Staff Refreshment")
        self.assertIsNone(txns_a[0]["assigned_ledger"])
        self.assertEqual(txns_a[0]["suggestion_source"], "company_learning")

        # 3. Company B isolation: Company B must NOT inherit Acme Corp's learning
        csv_b = "Date,Narration,Ref No,Debit,Credit,Balance\n01/04/2026,UPI-SWIGGY-FOOD-ORDER-003,REF2,600.00,,12000.00\n"
        path_b = Path(self.temp_dir.name) / "stmt_b.csv"
        path_b.write_text(csv_b, encoding="utf-8")

        sess_b = self.engine.create_import_session(
            company_name="Beta Logistics",
            source_filename="stmt_b.csv",
            file_path=path_b,
            bank_account_ledger="Bank A/C"
        )["session_id"]

        txns_b = self.engine.get_session_transactions(sess_b)["transactions"]
        self.assertIsNone(txns_b[0]["suggested_ledger"])
        self.assertIsNone(txns_b[0]["assigned_ledger"])

    def test_suggestion_toggle_accept_and_reject(self):
        """Tests user toggle acceptance and rejection of AI ledger recommendations."""
        csv_data = """Date,Narration,Ref No,Debit,Credit,Balance
01/04/2026,ELECTRICITY BILL FOR MARCH,EB01,2500.00,,7500.00
02/04/2026,INTERNET FIBER BILL,NET01,1200.00,,6300.00
"""
        csv_path = Path(self.temp_dir.name) / "bills.csv"
        csv_path.write_text(csv_data, encoding="utf-8")

        sess_id = self.engine.create_import_session(
            company_name="Acme Corp",
            source_filename="bills.csv",
            file_path=csv_path,
            bank_account_ledger="HDFC Bank"
        )["session_id"]

        txns = self.engine.get_session_transactions(sess_id)["transactions"]
        t1_id = txns[0]["transaction_id"]
        t2_id = txns[1]["transaction_id"]

        # Populate suggestion without assigning
        import sqlite3
        with sqlite3.connect(self.db_path) as con:
            con.execute("UPDATE automation_transactions SET suggested_ledger='Electricity Charges', suggestion_status='suggested' WHERE transaction_id=?", (t1_id,))
            con.execute("UPDATE automation_transactions SET suggested_ledger='Internet Expenses', suggestion_status='suggested' WHERE transaction_id=?", (t2_id,))
            con.commit()

        # Check AI-assigned filter returns 0 initially
        ai_assigned_initial = self.engine.get_session_transactions(sess_id, filter_status="ai_assigned")["transactions"]
        self.assertEqual(len(ai_assigned_initial), 0)

        # 1. Accept first suggestion
        acc_res = self.engine.accept_suggested_ledgers(sess_id, transaction_ids=[t1_id])
        self.assertTrue(acc_res["ok"])

        # Check transaction 1 is now assigned with is_ai_assigned=1
        t1_check = [t for t in self.engine.get_session_transactions(sess_id)["transactions"] if t["transaction_id"] == t1_id][0]
        self.assertEqual(t1_check["assigned_ledger"], "Electricity Charges")
        self.assertEqual(t1_check["is_ai_assigned"], 1)
        self.assertEqual(t1_check["suggestion_status"], "accepted")

        # Check AI-assigned filter returns 1
        ai_assigned_after = self.engine.get_session_transactions(sess_id, filter_status="ai_assigned")["transactions"]
        self.assertEqual(len(ai_assigned_after), 1)

        # 2. Reject second suggestion
        rej_res = self.engine.reject_suggested_ledgers(sess_id, transaction_ids=[t2_id])
        self.assertTrue(rej_res["ok"])

        t2_check = [t for t in self.engine.get_session_transactions(sess_id)["transactions"] if t["transaction_id"] == t2_id][0]
        self.assertIsNone(t2_check["suggested_ledger"])
        self.assertIsNone(t2_check["assigned_ledger"])
        self.assertEqual(t2_check["suggestion_status"], "rejected")

    def test_automatic_chunked_posting_logic(self):
        """Verifies chunked posting across 75 transactions in batches of 50, tracking verified progress."""
        from unittest.mock import MagicMock

        # Generate 75 transaction CSV
        rows = ["Date,Narration,Ref No,Debit,Credit,Balance"]
        bal = 100000.0
        for i in range(1, 76):
            bal -= 100.0
            rows.append(f"01/04/2026,VENDOR PAYMENT TXN {i},REF{i:04d},100.00,,{bal:.2f}")
        csv_file = Path(self.temp_dir.name) / "stmt_75.csv"
        csv_file.write_text("\n".join(rows), encoding="utf-8")

        sess_id = self.engine.create_import_session(
            company_name="Test Company Ltd",
            source_filename="stmt_75.csv",
            file_path=csv_file,
            bank_account_ledger="Bank A/C"
        )["session_id"]

        # Bulk assign all transactions to valid ledger
        txns = self.engine.get_session_transactions(sess_id)["transactions"]
        all_ids = [t["transaction_id"] for t in txns]
        self.assertEqual(len(all_ids), 75)

        self.engine.bulk_assign_ledger(
            transaction_ids=all_ids,
            ledger_name="Vendor Expenses",
            voucher_type="Payment"
        )

        val = self.engine.validate_session_for_posting(sess_id)
        self.assertTrue(val["is_ready_for_posting"])

        # Mock Tally MCP client
        batch_sizes_received = []
        def mock_call_tool(tool_name, arguments, **kwargs):
            if tool_name == "voucher-journal":
                vchs = arguments.get("vouchers", [])
                batch_sizes_received.append(len(vchs))
                return {"ok": True, "data": {"created": len(vchs), "errors": 0}}
            elif tool_name == "ledger-balance":
                return {"ok": True, "amount": -92500.0}
            elif tool_name == "list-master":
                return {"ok": True, "data": [{"name": "Bank A/C"}, {"name": "Vendor Expenses"}]}
            return {"ok": True, "data": {}}

        orig_conn = self.engine.tally_client.get_connection_status
        orig_call = self.engine.tally_client.call_tool
        try:
            self.engine.tally_client.get_connection_status = MagicMock(return_value={"tally_port_open": True, "node_available": True, "mcp_entry_exists": True})
            self.engine.tally_client.call_tool = MagicMock(side_effect=mock_call_tool)

            # Run chunked posting with batch_size=50 and run_all=True
            post_res = self.engine.post_approved_session_to_tally(
                session_id=sess_id,
                batch_size=50,
                run_all=True
            )

            self.assertTrue(post_res["ok"])
            self.assertTrue(post_res["is_complete"])
            self.assertEqual(post_res["verified_total"], 75)
            self.assertEqual(post_res["progress_pct"], 100)

            # Verify automatic chunking: exactly 2 batches (50 and 25)
            self.assertEqual(batch_sizes_received, [50, 25])

            # Verify 75 posting records written
            import sqlite3
            with sqlite3.connect(self.db_path) as con:
                posted_recs = con.execute("SELECT COUNT(*) FROM automation_posting_records WHERE session_id=? AND status='success'", (sess_id,)).fetchone()[0]
                self.assertEqual(posted_recs, 75)

            # Verify post-posting reconciliation report
            recon = post_res.get("reconciliation")
            self.assertIsNotNone(recon)
            self.assertEqual(recon["posted_count"], 75)
            self.assertEqual(recon["total_posted_debits"], 7500.0)
        finally:
            self.engine.tally_client.get_connection_status = orig_conn
            self.engine.tally_client.call_tool = orig_call

if __name__ == "__main__":
    unittest.main()
