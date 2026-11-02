"""
Unit tests for ₹590 reconciliation discrepancy fix, occurrence-aware fingerprinting,
and audit status enforcement.
"""

import unittest
import sqlite3
import tempfile
import shutil
from pathlib import Path
from decimal import Decimal
from unittest.mock import MagicMock, patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))

from automation_engine import AutomationEngine, compute_txn_fingerprint, is_valid_tally_edu_date

class TestReconciliationDiscrepancy(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.db_path = Path(self.test_dir) / "test_recon.db"
        self._init_db(self.db_path)
        self.engine = AutomationEngine(self.db_path)
        self.engine.tally_client = MagicMock()

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def _init_db(self, db_p: Path):
        with sqlite3.connect(db_p) as con:
            con.execute("""
                CREATE TABLE automation_import_sessions (
                    session_id TEXT PRIMARY KEY,
                    company_name TEXT,
                    financial_year TEXT,
                    bank_account_ledger TEXT,
                    source_filename TEXT,
                    file_format TEXT,
                    file_size_bytes INTEGER,
                    file_path TEXT,
                    statement_from_date TEXT,
                    statement_to_date TEXT,
                    opening_balance REAL,
                    closing_balance REAL,
                    total_debits REAL,
                    total_credits REAL,
                    calculated_difference REAL,
                    extraction_status TEXT,
                    reconciliation_status TEXT,
                    review_status TEXT,
                    posting_status TEXT,
                    transaction_count INTEGER,
                    posted_count INTEGER,
                    failed_count INTEGER,
                    error_message TEXT,
                    created_at TEXT,
                    updated_at TEXT
                )
            """)
            con.execute("""
                CREATE TABLE automation_transactions (
                    transaction_id TEXT PRIMARY KEY,
                    session_id TEXT,
                    row_index INTEGER,
                    txn_date TEXT,
                    value_date TEXT,
                    original_narration TEXT,
                    normalized_narration TEXT,
                    ref_number TEXT,
                    cheque_number TEXT,
                    debit_amount REAL,
                    credit_amount REAL,
                    net_amount REAL,
                    running_balance REAL,
                    suggested_ledger TEXT,
                    assigned_ledger TEXT,
                    suggested_voucher_type TEXT,
                    assigned_voucher_type TEXT,
                    confidence_category TEXT,
                    suggestion_reason TEXT,
                    matched_rule_id TEXT,
                    validation_status TEXT,
                    validation_errors TEXT,
                    duplicate_status TEXT,
                    duplicate_details TEXT,
                    is_excluded INTEGER DEFAULT 0,
                    exclusion_reason TEXT,
                    posting_status TEXT,
                    tally_voucher_number TEXT,
                    tally_guid TEXT,
                    created_at TEXT,
                    updated_at TEXT,
                    is_ai_assigned INTEGER DEFAULT 0,
                    suggestion_status TEXT,
                    suggestion_source TEXT
                )
            """)
            con.execute("""
                CREATE TABLE automation_posting_records (
                    record_id TEXT PRIMARY KEY,
                    session_id TEXT,
                    transaction_id TEXT,
                    company_name TEXT,
                    voucher_type TEXT,
                    voucher_date TEXT,
                    voucher_payload TEXT,
                    attempt_number INTEGER DEFAULT 1,
                    status TEXT,
                    tally_response TEXT,
                    tally_voucher_id TEXT,
                    error_details TEXT,
                    posted_at TEXT
                )
            """)
            con.commit()

    def test_occurrence_fingerprinting_distinctness_and_backward_compatibility(self):
        """Verify occurrence 1 matches base hash and occurrence 2 produces distinct hash."""
        h1 = compute_txn_fingerprint("Demo National Bank", "2026-03-31", Decimal("590"), Decimal("0"), "", "BANK CHARGES/ACCOUNT SERVICE", occurrence=1)
        h2 = compute_txn_fingerprint("Demo National Bank", "2026-03-31", Decimal("590"), Decimal("0"), "", "BANK CHARGES/ACCOUNT SERVICE", occurrence=2)

        # Occurrence 1 matches the exact hash previously posted to Tally for Row 6
        self.assertEqual(h1, "4406c7b7f82cad39")
        # Occurrence 2 is distinct
        self.assertNotEqual(h1, h2)
        self.assertEqual(len(h1), 16)
        self.assertEqual(len(h2), 16)

    def test_multi_chunk_duplicate_charges_both_posted(self):
        """Simulate statement where Row 6 and Row 69 have identical ₹590 charge across chunk boundary."""
        session_id = "test_sess_590"
        with sqlite3.connect(self.db_path) as con:
            con.execute("""
                INSERT INTO automation_import_sessions (
                    session_id, company_name, bank_account_ledger, statement_from_date, statement_to_date,
                    opening_balance, closing_balance, total_debits, total_credits, transaction_count
                ) VALUES (?, 'Ani', 'Demo National Bank', '2026-03-01', '2026-03-31', 125000.0, 602195.0, 1180.0, 0.0, 2)
            """, (session_id,))
            # Row 6
            con.execute("""
                INSERT INTO automation_transactions (
                    transaction_id, session_id, row_index, txn_date, original_narration,
                    debit_amount, credit_amount, assigned_ledger, assigned_voucher_type,
                    validation_status, posting_status, is_excluded
                ) VALUES ('txn_row_6', ?, 6, '2026-03-31', 'BANK CHARGES/ACCOUNT SERVICE', 590.0, 0.0, 'Bank Charges', 'Payment', 'valid', 'approved', 0)
            """, (session_id,))
            # Row 69
            con.execute("""
                INSERT INTO automation_transactions (
                    transaction_id, session_id, row_index, txn_date, original_narration,
                    debit_amount, credit_amount, assigned_ledger, assigned_voucher_type,
                    validation_status, posting_status, is_excluded
                ) VALUES ('txn_row_69', ?, 69, '2026-03-31', 'BANK CHARGES/ACCOUNT SERVICE', 590.0, 0.0, 'Bank Charges', 'Payment', 'valid', 'approved', 0)
            """, (session_id,))
            con.commit()

        # Mock Tally client
        self.engine.tally_client.get_connection_status.return_value = {"tally_port_open": True}
        self.engine.tally_client.get_company_masters.return_value = {"ledgers": ["Bank Charges", "Demo National Bank"]}
        self.engine.tally_client.call_tool.return_value = {
            "ok": True,
            "data": {"CREATED": 1, "ERRORS": 0, "EXCEPTIONS": 0}
        }
        self.engine.tally_client.get_ledger_balance.return_value = {
            "ok": True,
            "amount": -602195.0
        }

        # Run posting with batch_size=1 so each row is in its own chunk
        res = self.engine.post_approved_session_to_tally(session_id, batch_size=1, run_all=True, is_educational_mode=False)

        self.assertTrue(res.get("ok"))
        self.assertEqual(res.get("verified_total"), 2)
        self.assertEqual(res.get("failed_total"), 0)

        # Both transactions must be marked posted and clean
        with sqlite3.connect(self.db_path) as con:
            rows = con.execute("""
                SELECT transaction_id, posting_status, duplicate_status FROM automation_transactions WHERE session_id=?
            """, (session_id,)).fetchall()
            self.assertEqual(len(rows), 2)
            for r in rows:
                self.assertEqual(r[1], "posted")
                self.assertEqual(r[2], "clean")

            # Both must have records in automation_posting_records
            recs = con.execute("SELECT transaction_id FROM automation_posting_records WHERE session_id=?", (session_id,)).fetchall()
            self.assertEqual(len(recs), 2)
            posted_tids = {r[0] for r in recs}
            self.assertIn("txn_row_6", posted_tids)
            self.assertIn("txn_row_69", posted_tids)

    def test_reconciliation_calculation_strict_reconciled_status(self):
        """Verify strict reconciliation difference detection and is_reconciled flag."""
        session_id = "test_recon_status"
        with sqlite3.connect(self.db_path) as con:
            con.execute("""
                INSERT INTO automation_import_sessions (
                    session_id, company_name, bank_account_ledger, statement_from_date, statement_to_date,
                    opening_balance, closing_balance, total_debits, total_credits, transaction_count
                ) VALUES (?, 'Ani', 'Demo National Bank', '2026-03-01', '2026-03-31', 125000.0, 602195.0, 311985.0, 789180.0, 75)
            """, (session_id,))
            con.execute("""
                INSERT INTO automation_transactions (
                    transaction_id, session_id, row_index, txn_date, original_narration,
                    debit_amount, credit_amount, assigned_ledger, posting_status, is_excluded
                ) VALUES ('t1', ?, 1, '2026-03-31', 'Debits', 311985.0, 0.0, 'Expenses', 'posted', 0)
            """, (session_id,))
            con.execute("""
                INSERT INTO automation_transactions (
                    transaction_id, session_id, row_index, txn_date, original_narration,
                    debit_amount, credit_amount, assigned_ledger, posting_status, is_excluded
                ) VALUES ('t2', ?, 2, '2026-03-31', 'Credits', 0.0, 789180.0, 'Income', 'posted', 0)
            """, (session_id,))
            con.commit()

        # Case 1: Tally reports 602785 (590 difference)
        self.engine.tally_client.get_ledger_balance.return_value = {
            "ok": True,
            "amount": -602785.0
        }
        report = self.engine.calculate_reconciliation_report(session_id, "Ani", "Demo National Bank")
        self.assertEqual(report["expected_closing_balance"], 602195.0)
        self.assertEqual(report["actual_tally_balance"], 602785.0)
        self.assertEqual(report["difference"], 590.0)
        self.assertFalse(report["is_reconciled"])

        # Case 2: Tally reports exact 602195 (0 difference)
        self.engine.tally_client.get_ledger_balance.return_value = {
            "ok": True,
            "amount": -602195.0
        }
        report2 = self.engine.calculate_reconciliation_report(session_id, "Ani", "Demo National Bank")
        self.assertEqual(report2["expected_closing_balance"], 602195.0)
        self.assertEqual(report2["actual_tally_balance"], 602195.0)
        self.assertEqual(report2["difference"], 0.0)
        self.assertTrue(report2["is_reconciled"])

        # Case 3: Tally is offline / returns None
        self.engine.tally_client.get_ledger_balance.return_value = {
            "ok": False,
            "error": "Timeout"
        }
        report3 = self.engine.calculate_reconciliation_report(session_id, "Ani", "Demo National Bank")
        self.assertFalse(report3["is_reconciled"])

if __name__ == "__main__":
    unittest.main()
