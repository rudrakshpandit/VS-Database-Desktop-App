"""
Test Suite for Controlled Correction:
1. Educational Mode Pre-Flight Validation
2. Consent-Based Date Remapping with Original Date Preservation
3. Persistent Idempotency & Duplicate Prevention
4. Scalable Batch Chunking (1, 50, 51, 75, 100, 120 transactions)
5. Partial Failure Handling & Per-Transaction Diagnostic Tracking
6. Accurate Reconciliation & Completion Invariants
7. In-Flight Concurrent Session Locking
"""

import os
import sys
import json
import uuid
import socket
import sqlite3
import unittest
from pathlib import Path
from decimal import Decimal
from unittest.mock import MagicMock, patch

# Ensure application path is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from automation_engine import (
    AutomationEngine,
    is_valid_tally_edu_date,
    remap_to_tally_edu_date,
    compute_txn_fingerprint,
    now_iso
)

class TestControlledCorrection(unittest.TestCase):

    def setUp(self):
        self.db_path = Path("data/vs_database_desktop.db")
        self.engine = AutomationEngine.get_instance(self.db_path)
        self.test_session_id = f"test_ctrl_{uuid.uuid4().hex[:8]}"
        self.company_name = "Rudraksh Traders(Test)"
        self.bank_ledger = "Demo National Bank"

        # Create isolated test session
        with sqlite3.connect(self.db_path) as con:
            con.execute("""
                INSERT INTO automation_import_sessions (
                    session_id, company_name, bank_account_ledger, source_filename,
                    file_format, opening_balance, closing_balance, total_debits,
                    total_credits, transaction_count, posted_count, failed_count,
                    posting_status, created_at, updated_at
                ) VALUES (?, ?, ?, 'test_statement.pdf', 'pdf', 100000.0, 150000.0, 50000.0, 100000.0, 0, 0, 0, 'unposted', ?, ?)
            """, (self.test_session_id, self.company_name, self.bank_ledger, now_iso(), now_iso()))
            con.commit()

    def tearDown(self):
        # Clean up test session data
        with sqlite3.connect(self.db_path) as con:
            con.execute("DELETE FROM automation_import_sessions WHERE session_id=?", (self.test_session_id,))
            con.execute("DELETE FROM automation_transactions WHERE session_id=?", (self.test_session_id,))
            con.execute("DELETE FROM automation_posting_records WHERE session_id=?", (self.test_session_id,))
            con.commit()

    def _create_test_transactions(self, count: int, mixed_dates: bool = False):
        """Helper to create N transactions in test session."""
        now_t = now_iso()
        rows = []
        for i in range(1, count + 1):
            if mixed_dates:
                # Alternate between 01, 02 (valid EDU) and 15, 30 (invalid EDU)
                day = 1 if i % 4 == 1 else (2 if i % 4 == 2 else (15 if i % 4 == 3 else 30))
            else:
                day = 1 if i % 2 == 1 else 2
            
            txn_date = f"2026-04-{day:02d}"
            dr = 1000.0 if i % 2 == 1 else 0.0
            cr = 0.0 if i % 2 == 1 else 2000.0
            net = cr - dr
            rows.append((
                f"txn_{self.test_session_id}_{i}",
                self.test_session_id,
                i,
                txn_date,
                f"Test Narration Transaction {i}",
                f"test narration transaction {i}",
                f"REF{10000 + i}",
                dr,
                cr,
                net,
                "ABC Wholesale" if dr > 0 else "Customer Receipts Control",
                "Payment" if dr > 0 else "Receipt",
                0,
                "pending",
                now_t,
                now_t
            ))

        with sqlite3.connect(self.db_path) as con:
            con.executemany("""
                INSERT INTO automation_transactions (
                    transaction_id, session_id, row_index, txn_date, original_narration,
                    normalized_narration, ref_number, debit_amount, credit_amount, net_amount,
                    assigned_ledger, assigned_voucher_type, is_excluded, posting_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, rows)
            con.execute("UPDATE automation_import_sessions SET transaction_count=? WHERE session_id=?", (count, self.test_session_id))
            con.commit()

    # -------------------------------------------------------------------------
    # TEST 1: Educational Mode Pre-Flight Validation
    # -------------------------------------------------------------------------
    def test_01_edu_mode_pre_flight_blocks_unsupported_dates(self):
        """Confirms that transactions with dates unsupported in Educational Mode are blocked before posting."""
        self._create_test_transactions(10, mixed_dates=True)
        val = self.engine.validate_session_for_posting(self.test_session_id, is_educational_mode=True)
        
        self.assertTrue(val["has_edu_date_conflicts"], "Should detect EDU date conflicts")
        self.assertGreater(val["edu_conflicting_count"], 0)
        self.assertFalse(val["is_ready_for_posting"], "Should NOT be ready for posting in EDU mode with conflicts")
        self.assertTrue(any("Educational Mode" in e for e in val["validation_errors"]))

        # Posting attempt without consent should fail pre-flight cleanly
        post_res = self.engine.post_approved_session_to_tally(
            self.test_session_id,
            is_educational_mode=True,
            remap_edu_dates=False
        )
        self.assertFalse(post_res["ok"])
        self.assertIn("Tally Educational Mode Date Conflict", post_res["error"])

    # -------------------------------------------------------------------------
    # TEST 2: Consent-Based Remapping Preserves Original Date
    # -------------------------------------------------------------------------
    def test_02_consent_based_remapping_preserves_original_date(self):
        """Confirms remapping works with explicit consent, preserving original date in database."""
        self._create_test_transactions(4, mixed_dates=True)
        
        # Test helper functions directly
        self.assertTrue(is_valid_tally_edu_date("2026-04-01"))
        self.assertTrue(is_valid_tally_edu_date("2026-04-02"))
        self.assertFalse(is_valid_tally_edu_date("2026-04-30"))
        self.assertEqual(remap_to_tally_edu_date("2026-04-30"), "2026-04-02")
        self.assertEqual(remap_to_tally_edu_date("2026-05-31"), "2026-05-31")

        # Mock Tally MCP response for successful creation
        with patch.object(self.engine.tally_client, 'call_tool') as mock_call, \
             patch.object(self.engine.tally_client, 'get_connection_status') as mock_conn, \
             patch.object(self.engine.tally_client, 'get_company_masters') as mock_masters, \
             patch.object(self.engine.tally_client, 'get_ledger_balance') as mock_bal:
            
            mock_conn.return_value = {"tally_port_open": True}
            mock_masters.return_value = {"ledgers": ["Demo National Bank", "ABC Wholesale", "Customer Receipts Control"]}
            mock_call.return_value = {"ok": True, "data": {"CREATED": 4, "ERRORS": 0, "EXCEPTIONS": 0}}
            mock_bal.return_value = {"ok": True, "amount": -102000.0}

            post_res = self.engine.post_approved_session_to_tally(
                self.test_session_id,
                is_educational_mode=True,
                remap_edu_dates=True,
                user_confirmed_remap=True,
                batch_size=50
            )

            self.assertTrue(post_res["ok"])
            self.assertEqual(post_res["verified_total"], 4)

            # Verify that original dates in automation_transactions table are INTACT
            with sqlite3.connect(self.db_path) as con:
                dates = [r[0] for r in con.execute("SELECT txn_date FROM automation_transactions WHERE session_id=? ORDER BY row_index", (self.test_session_id,)).fetchall()]
                # Mixed dates sequence was: 01, 02, 15, 30
                self.assertEqual(dates, ["2026-04-01", "2026-04-02", "2026-04-15", "2026-04-30"])

    # -------------------------------------------------------------------------
    # TEST 3: Persistent Idempotency & Duplicate Prevention
    # -------------------------------------------------------------------------
    def test_03_persistent_idempotency_prevents_duplicate_vouchers(self):
        """Confirms that re-running post on already posted transactions skips duplicates and does not call Tally create again."""
        self._create_test_transactions(5, mixed_dates=False)
        
        with patch.object(self.engine.tally_client, 'call_tool') as mock_call, \
             patch.object(self.engine.tally_client, 'get_connection_status') as mock_conn, \
             patch.object(self.engine.tally_client, 'get_company_masters') as mock_masters, \
             patch.object(self.engine.tally_client, 'get_ledger_balance') as mock_bal:
            
            mock_conn.return_value = {"tally_port_open": True}
            mock_masters.return_value = {"ledgers": ["Demo National Bank", "ABC Wholesale", "Customer Receipts Control"]}
            mock_call.return_value = {"ok": True, "data": {"CREATED": 5, "ERRORS": 0, "EXCEPTIONS": 0}}
            mock_bal.return_value = {"ok": True, "amount": -103000.0}

            # First post run
            res1 = self.engine.post_approved_session_to_tally(self.test_session_id, batch_size=50)
            self.assertTrue(res1["ok"])
            self.assertEqual(res1["batch_posted"], 5)
            self.assertEqual(mock_call.call_count, 1)

            # Immediate second post run (e.g. repeated click or retry)
            res2 = self.engine.post_approved_session_to_tally(self.test_session_id, batch_size=50)
            self.assertTrue(res2["ok"])
            self.assertEqual(res2["batch_posted"], 0)
            self.assertEqual(res2["verified_total"], 5)
            # Tally call_tool for voucher creation should NOT be called again
            self.assertEqual(mock_call.call_count, 1, "Duplicate creation call to Tally should be prevented")

    # -------------------------------------------------------------------------
    # TEST 4: Scalable Batch Chunking (1, 50, 51, 75, 100, 120 Transactions)
    # -------------------------------------------------------------------------
    def test_04_scalable_batch_chunking_counts(self):
        """Tests processing across counts of 1, 50, 51, 75, 100, 120 transactions."""
        test_counts = [1, 50, 51, 75, 100, 120]
        
        for count in test_counts:
            sub_sess_id = f"test_scale_{count}_{uuid.uuid4().hex[:6]}"
            with sqlite3.connect(self.db_path) as con:
                con.execute("""
                    INSERT INTO automation_import_sessions (
                        session_id, company_name, bank_account_ledger, source_filename,
                        file_format, opening_balance, closing_balance, transaction_count,
                        posting_status, created_at, updated_at
                    ) VALUES (?, ?, ?, 'scale.pdf', 'pdf', 0, 0, ?, 'unposted', ?, ?)
                """, (sub_sess_id, self.company_name, self.bank_ledger, count, now_iso(), now_iso()))
                
                rows = []
                for i in range(1, count + 1):
                    day = 1 if i % 2 == 1 else 2
                    rows.append((
                        f"txn_{sub_sess_id}_{i}", sub_sess_id, i, f"2026-04-{day:02d}",
                        f"Narration {i}", f"narration {i}", 100.0, 0.0, -100.0,
                        "ABC Wholesale", "Payment", 0, "pending", now_iso(), now_iso()
                    ))
                con.executemany("""
                    INSERT INTO automation_transactions (
                        transaction_id, session_id, row_index, txn_date, original_narration,
                        normalized_narration, debit_amount, credit_amount, net_amount,
                        assigned_ledger, assigned_voucher_type, is_excluded, posting_status,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, rows)
                con.commit()

            with patch.object(self.engine.tally_client, 'call_tool') as mock_call, \
                 patch.object(self.engine.tally_client, 'get_connection_status') as mock_conn, \
                 patch.object(self.engine.tally_client, 'get_company_masters') as mock_masters, \
                 patch.object(self.engine.tally_client, 'get_ledger_balance') as mock_bal:
                
                mock_conn.return_value = {"tally_port_open": True}
                mock_masters.return_value = {"ledgers": ["Demo National Bank", "ABC Wholesale"]}
                mock_bal.return_value = {"ok": True, "amount": float(-100 * count)}
                
                def side_effect(tool_name, args, **kwargs):
                    if tool_name == "voucher-journal":
                        v_len = len(args.get("vouchers", []))
                        return {"ok": True, "data": {"CREATED": v_len, "ERRORS": 0, "EXCEPTIONS": 0}}
                    return {"ok": True}
                
                mock_call.side_effect = side_effect

                res = self.engine.post_approved_session_to_tally(
                    sub_sess_id,
                    batch_size=50,
                    run_all=True
                )
                self.assertTrue(res["ok"], f"Failed for count {count}")
                self.assertEqual(res["verified_total"], count)
                self.assertTrue(res["is_complete"])
                self.assertEqual(res["failed_total"], 0)

            # Cleanup
            with sqlite3.connect(self.db_path) as con:
                con.execute("DELETE FROM automation_import_sessions WHERE session_id=?", (sub_sess_id,))
                con.execute("DELETE FROM automation_transactions WHERE session_id=?", (sub_sess_id,))
                con.execute("DELETE FROM automation_posting_records WHERE session_id=?", (sub_sess_id,))
                con.commit()

    # -------------------------------------------------------------------------
    # TEST 5: Partial Failure & Per-Transaction Diagnostic Tracking
    # -------------------------------------------------------------------------
    def test_05_partial_failure_diagnostic_tracking(self):
        """Confirms that partial rejections record precise error messages and do not falsely claim reconciliation."""
        self._create_test_transactions(10, mixed_dates=False)
        
        with patch.object(self.engine.tally_client, 'call_tool') as mock_call, \
             patch.object(self.engine.tally_client, 'get_connection_status') as mock_conn, \
             patch.object(self.engine.tally_client, 'get_company_masters') as mock_masters, \
             patch.object(self.engine.tally_client, 'get_ledger_balance') as mock_bal:
            
            mock_conn.return_value = {"tally_port_open": True}
            mock_masters.return_value = {"ledgers": ["Demo National Bank", "ABC Wholesale", "Customer Receipts Control"]}
            mock_bal.return_value = {"ok": True, "amount": -10000.0}

            def side_effect(tool_name, args, **kwargs):
                if tool_name == "voucher-journal":
                    vchs = args.get("vouchers", [])
                    if len(vchs) > 1:
                        # Batch reports partial outcome
                        return {"ok": True, "data": {"CREATED": 6, "ERRORS": 0, "EXCEPTIONS": 4}}
                    else:
                        # Individual fallback
                        v = vchs[0]
                        if "REF10008" in v.get("voucherNumber", "") or "REF10009" in v.get("voucherNumber", ""):
                            return {"ok": False, "data": {"CREATED": 0, "EXCEPTIONS": 1, "LINEERROR": "Tally simulated voucher exception"}}
                        return {"ok": True, "data": {"CREATED": 1, "ERRORS": 0, "EXCEPTIONS": 0}}
                return {"ok": True}

            mock_call.side_effect = side_effect

            res = self.engine.post_approved_session_to_tally(self.test_session_id, batch_size=50)
            self.assertTrue(res["ok"])
            self.assertEqual(res["verified_total"], 8)
            self.assertEqual(res["failed_total"], 2)
            self.assertTrue(res["has_failures"])
            self.assertFalse(res["is_complete"])
            self.assertEqual(len(res["failed_transactions"]), 2)
            self.assertIn("Tally simulated voucher exception", res["failed_transactions"][0]["error"])
            
            # Reconciliation MUST NOT be considered reconciled when partial failures exist
            self.assertFalse(res["reconciliation"]["is_reconciled"])

    # -------------------------------------------------------------------------
    # TEST 6: In-Flight Concurrent Session Locking
    # -------------------------------------------------------------------------
    def test_06_in_flight_session_lock(self):
        """Confirms that duplicate concurrent requests on the same session are rejected."""
        self._create_test_transactions(5, mixed_dates=False)
        
        # Simulate active lock
        with self.engine._session_lock:
            self.engine._in_flight_sessions.add(self.test_session_id)
        
        try:
            res = self.engine.post_approved_session_to_tally(self.test_session_id)
            self.assertFalse(res["ok"])
            self.assertIn("already in progress", res["error"])
        finally:
            with self.engine._session_lock:
                self.engine._in_flight_sessions.discard(self.test_session_id)

    # -------------------------------------------------------------------------
    # TEST 7: Live Tally Health & Balance Integration (Real Environment)
    # -------------------------------------------------------------------------
    def test_07_real_tally_connection_and_company(self):
        """Tests live Tally port 9000 against actual running Tally via fast socket."""
        port_open = self.engine.tally_client.check_tally_port_reachable(timeout=1.0)
        if not port_open:
            self.skipTest("Tally XML server port 9000 is offline; skipping live socket check.")
        res = self.engine.tally_client.list_companies()
        self.assertTrue(res.get("ok"))

if __name__ == "__main__":
    unittest.main()
