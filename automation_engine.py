"""
Automation Business Engine for VS Database
Coordinates:
1. Bank statement import sessions & transactions persistence
2. Ledger suggestions (Exact rules -> Deterministic party matching -> Gemini recommendations)
3. Bulk ledger assignments & user mapping rules
4. Double-entry voucher construction & accounting validation
5. Controlled posting engine with duplicate prevention & audit records
6. Read-only Ask Tally conversational Q&A grounded with live Tally data & Gemini API
"""

from __future__ import annotations
import os
import re
import math
import json
import uuid
import sqlite3
import logging
import hashlib
import threading
from decimal import Decimal
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from statement_parser import BankStatementParser
from tally_mcp_client import TallyMCPClient
import vs_ai_engine

logger = logging.getLogger("vs_database.automation_engine")

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def is_valid_tally_edu_date(date_str: str) -> bool:
    """Checks if date is accepted by Tally Educational Mode (1st, 2nd, and 31st only)."""
    try:
        parts = str(date_str).strip().split('-')
        day = int(parts[2])
        return day in (1, 2, 31)
    except Exception:
        return False

def remap_to_tally_edu_date(date_str: str) -> str:
    """Safely maps date to valid Tally educational date in same month without altering original transaction records."""
    try:
        parts = str(date_str).strip().split('-')
        year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
        has_31 = month in (1, 3, 5, 7, 8, 10, 12)
        if day == 1:
            target_day = 1
        elif day == 31 and has_31:
            target_day = 31
        else:
            target_day = 2
        return f"{year:04d}-{month:02d}-{target_day:02d}"
    except Exception:
        return date_str

def compute_txn_fingerprint(bank_ledger: str, date_str: str, dr: Decimal, cr: Decimal, ref_no: str, narration: str, occurrence: int = 1) -> str:
    """Computes a deterministic transaction fingerprint for cross-session idempotency and duplicate detection."""
    clean_narr = re.sub(r'\[VS-TXN:[a-f0-9]+(?::\d+)?\]', '', narration or '').strip().lower()[:60]
    b_led = (bank_ledger or '').strip().lower()
    r_no = str(ref_no or '').strip()
    if occurrence <= 1:
        raw = f"{b_led}|{str(date_str).strip()}|{float(dr):.2f}|{float(cr):.2f}|{r_no}|{clean_narr}"
    else:
        raw = f"{b_led}|{str(date_str).strip()}|{float(dr):.2f}|{float(cr):.2f}|{r_no}|{clean_narr}|occ:{occurrence}"
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]

def normalize_pattern(narration: str) -> str:
    if not narration:
        return ""
    # Remove common bank transaction noise, channel codes, and delimiters
    cleaned = re.sub(r'\b(upi|neft|rtgs|imps|pos|ach|cms|chq|inb|mb|ref|txn|dr|cr|trf|e-transfer|paytm|phonepe|gpay|razorpay)\b', ' ', narration, flags=re.IGNORECASE)
    cleaned = re.sub(r'[/\\_\-:–—#@*+]', ' ', cleaned)
    cleaned = re.sub(r'\b\d+\b', ' ', cleaned) # Remove reference/account numbers and numeric tokens
    cleaned = re.sub(r'\s+', ' ', cleaned).strip().lower()
    return cleaned

class AutomationEngine:
    _instance: Optional[AutomationEngine] = None

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.tally_client = TallyMCPClient.get_instance()
        self._session_lock = threading.Lock()
        self._in_flight_sessions: set[str] = set()

    @classmethod
    def get_instance(cls, db_path: Path) -> AutomationEngine:
        if cls._instance is None:
            cls._instance = AutomationEngine(db_path)
        return cls._instance

    # -------------------------------------------------------------------------
    # IMPORT SESSIONS & STATEMENT INGESTION
    # -------------------------------------------------------------------------
    def create_import_session(
        self,
        company_name: str,
        source_filename: str,
        file_path: Path,
        bank_account_ledger: Optional[str] = None,
        financial_year: Optional[str] = None
    ) -> Dict[str, Any]:
        """Parses bank statement file, creates session and populates transactions."""
        # 1. Parse statement
        parse_res = BankStatementParser.parse_file(file_path, source_filename)
        if not parse_res.get("ok"):
            return parse_res

        session_id = f"st_sess_{uuid.uuid4().hex[:12]}"
        now_t = now_iso()
        file_size = file_path.stat().st_size if file_path.exists() else 0

        # 2. Persist session
        with sqlite3.connect(self.db_path, timeout=10) as con:
            con.execute("""
                INSERT INTO automation_import_sessions (
                    session_id, company_name, financial_year, bank_account_ledger,
                    source_filename, file_format, file_size_bytes, file_path,
                    statement_from_date, statement_to_date, opening_balance, closing_balance,
                    total_debits, total_credits, calculated_difference, extraction_status,
                    reconciliation_status, review_status, posting_status, transaction_count,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'extracted', ?, 'in_review', 'unposted', ?, ?, ?)
            """, (
                session_id, company_name, financial_year or "", bank_account_ledger or "",
                source_filename, source_filename.split(".")[-1].lower(), file_size, str(file_path),
                parse_res.get("from_date"), parse_res.get("to_date"),
                parse_res.get("opening_balance"), parse_res.get("closing_balance"),
                parse_res.get("total_debits", 0.0), parse_res.get("total_credits", 0.0),
                parse_res.get("calculated_difference", 0.0), parse_res.get("reconciliation_status", "unverified"),
                parse_res.get("count", 0), now_t, now_t
            ))

            # 3. Insert transactions with UNASSIGNED ledger by default
            txns = parse_res.get("transactions", [])
            for idx, t in enumerate(txns, start=1):
                t_id = f"txn_{uuid.uuid4().hex[:12]}"
                debit = Decimal(str(t["debit_amount"]))
                credit = Decimal(str(t["credit_amount"]))
                def_vch_type = "Payment" if debit > 0 else "Receipt"

                con.execute("""
                    INSERT INTO automation_transactions (
                        transaction_id, session_id, row_index, txn_date, value_date,
                        original_narration, normalized_narration, ref_number,
                        debit_amount, credit_amount, net_amount, running_balance,
                        suggested_voucher_type, assigned_voucher_type,
                        confidence_category, validation_status,
                        is_ai_assigned, suggestion_status, suggestion_source,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Unassigned', 'pending', 0, 'none', 'none', ?, ?)
                """, (
                    t_id, session_id, t.get("row_index", idx), t.get("txn_date"), t.get("value_date"),
                    t["original_narration"], t["normalized_narration"], t.get("ref_number", ""),
                    t["debit_amount"], t["credit_amount"], t["net_amount"], t.get("running_balance"),
                    def_vch_type, def_vch_type, now_t, now_t
                ))
            con.commit()

        # 4. Populate initial non-intrusive recommendations (Tier 1 Learning -> Tier 2 Rules -> Tier 3 Masters)
        # Keeps assigned_ledger empty so user has complete control and review
        try:
            self.apply_company_learning(session_id, company_name)
            self.apply_mapping_rules_to_session(session_id, company_name)
            self.apply_master_matching(session_id, company_name)
        except Exception as e:
            logger.warning(f"Initial classification notice for session {session_id}: {e}")

        return {
            "ok": True,
            "session_id": session_id,
            "transaction_count": len(txns),
            "total_debits": parse_res.get("total_debits"),
            "total_credits": parse_res.get("total_credits"),
            "reconciliation_status": parse_res.get("reconciliation_status"),
            "calculated_difference": parse_res.get("calculated_difference")
        }

    def get_import_session(self, session_id: str) -> Dict[str, Any]:
        """Retrieves session details and summary stats."""
        with sqlite3.connect(self.db_path, timeout=5) as con:
            con.row_factory = sqlite3.Row
            row = con.execute("SELECT * FROM automation_import_sessions WHERE session_id=?", (session_id,)).fetchone()
            if not row:
                return {"ok": False, "error": f"Import session {session_id} not found"}
            return {"ok": True, "session": dict(row)}

    def get_session_transactions(
        self,
        session_id: str,
        search: Optional[str] = None,
        filter_direction: Optional[str] = None, # DEBIT, CREDIT
        filter_status: Optional[str] = None, # unassigned, assigned, ai_assigned, error
        limit: int = 1000,
        offset: int = 0
    ) -> Dict[str, Any]:
        """Retrieves transactions for review table with search and filtering."""
        with sqlite3.connect(self.db_path, timeout=5) as con:
            con.row_factory = sqlite3.Row
            query = "SELECT * FROM automation_transactions WHERE session_id=?"
            params = [session_id]

            if search and search.strip():
                s = f"%{search.strip().lower()}%"
                query += " AND (LOWER(normalized_narration) LIKE ? OR LOWER(ref_number) LIKE ? OR LOWER(suggested_ledger) LIKE ? OR LOWER(assigned_ledger) LIKE ?)"
                params.extend([s, s, s, s])

            if filter_direction == "DEBIT":
                query += " AND debit_amount > 0"
            elif filter_direction == "CREDIT":
                query += " AND credit_amount > 0"

            if filter_status == "unassigned":
                query += " AND (assigned_ledger IS NULL OR assigned_ledger = '')"
            elif filter_status == "assigned":
                query += " AND assigned_ledger IS NOT NULL AND assigned_ledger != ''"
            elif filter_status == "ai_assigned":
                query += " AND is_ai_assigned = 1 AND assigned_ledger IS NOT NULL AND assigned_ledger != ''"
            elif filter_status == "error":
                query += " AND validation_status = 'error'"

            query += " ORDER BY row_index ASC LIMIT ? OFFSET ?"
            params.extend([limit, offset])

            rows = con.execute(query, params).fetchall()

            # Total matching count
            count_query = "SELECT COUNT(*) FROM automation_transactions WHERE session_id=?"
            count_params = [session_id]
            if search and search.strip():
                s = f"%{search.strip().lower()}%"
                count_query += " AND (LOWER(normalized_narration) LIKE ? OR LOWER(ref_number) LIKE ? OR LOWER(suggested_ledger) LIKE ? OR LOWER(assigned_ledger) LIKE ?)"
                count_params.extend([s, s, s, s])
            if filter_direction == "DEBIT": count_query += " AND debit_amount > 0"
            elif filter_direction == "CREDIT": count_query += " AND credit_amount > 0"
            if filter_status == "unassigned": count_query += " AND (assigned_ledger IS NULL OR assigned_ledger = '')"
            elif filter_status == "assigned": count_query += " AND assigned_ledger IS NOT NULL AND assigned_ledger != ''"
            elif filter_status == "ai_assigned": count_query += " AND is_ai_assigned = 1 AND assigned_ledger IS NOT NULL AND assigned_ledger != ''"
            elif filter_status == "error": count_query += " AND validation_status = 'error'"

            total_count = con.execute(count_query, count_params).fetchone()[0]

            return {
                "ok": True,
                "session_id": session_id,
                "total_count": total_count,
                "transactions": [dict(r) for r in rows]
            }

    # -------------------------------------------------------------------------
    # COMPANY LEARNING & ADAPTIVE MAPPING ENGINE
    # -------------------------------------------------------------------------
    def record_company_learning(
        self,
        company_name: str,
        narration: str,
        direction: str,
        assigned_ledger: str,
        voucher_type: str = "Payment",
        source: str = "user_confirmed",
        con: Optional[sqlite3.Connection] = None
    ):
        """Records user-confirmed or corrected mapping for company-specific continuous learning."""
        if not company_name or not assigned_ledger or not narration:
            return
        pat = normalize_pattern(narration)
        if len(pat) < 3:
            return

        now_t = now_iso()
        cond = (direction or "ALL").upper()
        if cond not in ("DEBIT", "CREDIT"):
            cond = "ALL"

        def _do_record(c):
            row = c.execute("""
                SELECT learning_id, usage_count FROM automation_company_learning
                WHERE company_name=? AND normalized_pattern=? AND direction_condition=?
            """, (company_name, pat, cond)).fetchone()

            if row:
                c.execute("""
                    UPDATE automation_company_learning
                    SET assigned_ledger=?, assigned_voucher_type=?, source=?,
                        usage_count = usage_count + 1, last_used_at=?, updated_at=?
                    WHERE learning_id=?
                """, (assigned_ledger, voucher_type, source, now_t, now_t, row[0]))
            else:
                learn_id = f"learn_{uuid.uuid4().hex[:10]}"
                c.execute("""
                    INSERT INTO automation_company_learning (
                        learning_id, company_name, normalized_pattern, direction_condition,
                        assigned_ledger, assigned_voucher_type, source, usage_count,
                        last_used_at, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                """, (learn_id, company_name, pat, cond, assigned_ledger, voucher_type, source, now_t, now_t, now_t))

        if con is not None:
            _do_record(con)
        else:
            with sqlite3.connect(self.db_path, timeout=10) as c:
                _do_record(c)
                c.commit()

    def apply_company_learning(self, session_id: str, company_name: str) -> int:
        """Applies adaptive learned company mappings to transactions without an assigned or suggested ledger."""
        with sqlite3.connect(self.db_path, timeout=10) as con:
            con.row_factory = sqlite3.Row
            learnings = con.execute("""
                SELECT * FROM automation_company_learning
                WHERE company_name=?
                ORDER BY usage_count DESC, updated_at DESC
            """, (company_name,)).fetchall()

            if not learnings:
                return 0

            txns = con.execute("""
                SELECT transaction_id, original_narration, normalized_narration, debit_amount, credit_amount, assigned_ledger, suggested_ledger
                FROM automation_transactions
                WHERE session_id=? AND (assigned_ledger IS NULL OR assigned_ledger = '')
            """, (session_id,)).fetchall()

            matched = 0
            now_t = now_iso()
            for t in txns:
                if t["assigned_ledger"] or t["suggested_ledger"]:
                    continue
                is_debit = float(t["debit_amount"] or 0) > 0
                is_credit = float(t["credit_amount"] or 0) > 0
                pat_t = normalize_pattern(t["normalized_narration"] or t["original_narration"] or "")

                for l in learnings:
                    cond = (l["direction_condition"] or "ALL").upper()
                    if cond == "DEBIT" and not is_debit:
                        continue
                    if cond == "CREDIT" and not is_credit:
                        continue

                    l_pat = l["normalized_pattern"]
                    if l_pat and (l_pat in pat_t or pat_t in l_pat):
                        vch = l["assigned_voucher_type"] or ("Payment" if is_debit else "Receipt")
                        con.execute("""
                            UPDATE automation_transactions
                            SET suggested_ledger=?, suggested_voucher_type=?,
                                confidence_category='High',
                                suggestion_reason='Learned from past confirmed mapping',
                                suggestion_source='company_learning',
                                suggestion_status='suggested',
                                updated_at=?
                            WHERE transaction_id=?
                        """, (l["assigned_ledger"], vch, now_t, t["transaction_id"]))
                        matched += 1
                        break
            con.commit()
            return matched

    def apply_mapping_rules_to_session(self, session_id: str, company_name: str) -> int:
        """Applies saved deterministic company mapping rules to suggest ledgers for unassigned transactions."""
        matched_count = 0
        with sqlite3.connect(self.db_path, timeout=10) as con:
            con.row_factory = sqlite3.Row
            rules = con.execute("""
                SELECT * FROM automation_mapping_rules
                WHERE company_name=? AND is_active=1
                ORDER BY priority ASC, updated_at DESC
            """, (company_name,)).fetchall()

            if not rules:
                return 0

            txns = con.execute("""
                SELECT transaction_id, normalized_narration, ref_number, debit_amount, credit_amount, assigned_ledger, suggested_ledger
                FROM automation_transactions
                WHERE session_id=?
            """, (session_id,)).fetchall()

            now_t = now_iso()
            for t in txns:
                # If user already manually assigned or has learning suggestion, skip overriding
                if t["assigned_ledger"] or t["suggested_ledger"]:
                    continue

                narr = (t["normalized_narration"] or "").lower()
                ref = (t["ref_number"] or "").lower()
                is_debit = float(t["debit_amount"] or 0) > 0
                is_credit = float(t["credit_amount"] or 0) > 0

                for r in rules:
                    cond = (r["direction_condition"] or "ALL").upper()
                    if cond == "DEBIT" and not is_debit:
                        continue
                    if cond == "CREDIT" and not is_credit:
                        continue

                    match_type = r["match_type"]
                    pat = (r["match_pattern"] or "").lower().strip()
                    is_match = False

                    if match_type == "exact_narration" and narr == pat:
                        is_match = True
                    elif match_type == "contains_narration" and pat in narr:
                        is_match = True
                    elif match_type == "starts_with" and narr.startswith(pat):
                        is_match = True
                    elif match_type == "ref_pattern" and pat in ref:
                        is_match = True

                    if is_match:
                        target_vch = r["voucher_type"] or ("Payment" if is_debit else "Receipt")
                        # Populates suggested_ledger non-intrusively
                        con.execute("""
                            UPDATE automation_transactions
                            SET suggested_ledger=?,
                                suggested_voucher_type=?,
                                confidence_category='High',
                                suggestion_reason=?,
                                matched_rule_id=?,
                                suggestion_source='company_rule',
                                suggestion_status='suggested',
                                updated_at=?
                            WHERE transaction_id=?
                        """, (
                            r["assigned_ledger"],
                            target_vch,
                            f"Matched Rule: {r['rule_name'] or r['match_pattern']}",
                            r["rule_id"], now_t, t["transaction_id"]
                        ))
                        con.execute("""
                            UPDATE automation_mapping_rules
                            SET match_count = match_count + 1, last_matched_at=?
                            WHERE rule_id=?
                        """, (now_t, r["rule_id"]))
                        matched_count += 1
                        break
            con.commit()
        return matched_count

    def apply_master_matching(self, session_id: str, company_name: str) -> int:
        """Matches unclassified transaction narrations directly against active Tally masters."""
        masters_res = self.tally_client.get_company_masters(company_name)
        available_ledgers = masters_res.get("ledgers", [])
        if not available_ledgers:
            return 0

        # Build clean mapping of ledger names, omitting generic heads
        candidates = []
        for l in available_ledgers:
            name = l if isinstance(l, str) else (l.get("name") or l.get("Name") or "")
            if not name:
                continue
            clean = name.strip()
            clean_low = clean.lower()
            if clean_low in ("cash", "cash-in-hand", "profit & loss a/c", "bank account", "bank a/c"):
                continue
            candidates.append((clean, clean_low))

        # Longest names first to prevent partial shadow matches
        candidates.sort(key=lambda x: len(x[1]), reverse=True)

        matched = 0
        now_t = now_iso()
        with sqlite3.connect(self.db_path, timeout=10) as con:
            con.row_factory = sqlite3.Row
            txns = con.execute("""
                SELECT transaction_id, original_narration, normalized_narration, debit_amount, credit_amount, assigned_ledger, suggested_ledger
                FROM automation_transactions
                WHERE session_id=? AND (assigned_ledger IS NULL OR assigned_ledger = '')
                  AND (suggested_ledger IS NULL OR suggested_ledger = '')
            """, (session_id,)).fetchall()

            for t in txns:
                narr = (t["normalized_narration"] or t["original_narration"] or "").lower()
                is_debit = float(t["debit_amount"] or 0) > 0

                for orig_name, cand_low in candidates:
                    if len(cand_low) >= 3 and cand_low in narr:
                        vch = "Payment" if is_debit else "Receipt"
                        con.execute("""
                            UPDATE automation_transactions
                            SET suggested_ledger=?, suggested_voucher_type=?,
                                confidence_category='High',
                                suggestion_reason='Matched Tally Accounts Master',
                                suggestion_source='master_match',
                                suggestion_status='suggested',
                                updated_at=?
                            WHERE transaction_id=?
                        """, (orig_name, vch, now_t, t["transaction_id"]))
                        matched += 1
                        break
            con.commit()
        return matched

    def bulk_assign_ledger(
        self,
        transaction_ids: List[str],
        ledger_name: str,
        voucher_type: Optional[str] = None,
        save_as_rule: bool = False,
        rule_pattern: Optional[str] = None,
        company_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """Bulk assigns a ledger master to selected transactions with validation and adaptive learning."""
        if not transaction_ids:
            return {"ok": False, "error": "No transactions selected"}
        if not ledger_name or not ledger_name.strip():
            return {"ok": False, "error": "Ledger name is required"}

        clean_ledger = ledger_name.strip()
        now_t = now_iso()

        with sqlite3.connect(self.db_path, timeout=10) as con:
            con.row_factory = sqlite3.Row
            placeholders = ",".join("?" for _ in transaction_ids)
            rows = con.execute(f"""
                SELECT transaction_id, debit_amount, credit_amount, suggested_voucher_type, original_narration
                FROM automation_transactions
                WHERE transaction_id IN ({placeholders})
            """, transaction_ids).fetchall()

            for r in rows:
                t_id = r["transaction_id"]
                dr = float(r["debit_amount"] or 0)
                cr = float(r["credit_amount"] or 0)
                cur_vch = r["suggested_voucher_type"]
                orig_narr = r["original_narration"] or ""
                target_vch = voucher_type or cur_vch or ("Payment" if dr > 0 else "Receipt")
                dir_str = "DEBIT" if dr > 0 else "CREDIT"

                con.execute("""
                    UPDATE automation_transactions
                    SET assigned_ledger=?, assigned_voucher_type=?,
                        is_ai_assigned=0,
                        suggestion_status='manual',
                        confidence_category='High',
                        suggestion_reason='User Bulk Assignment',
                        validation_status='valid',
                        updated_at=?
                    WHERE transaction_id=?
                """, (clean_ledger, target_vch, now_t, t_id))

                # Continual learning from user assignment
                if company_name:
                    self.record_company_learning(
                        company_name=company_name,
                        narration=orig_narr,
                        direction=dir_str,
                        assigned_ledger=clean_ledger,
                        voucher_type=target_vch,
                        source="user_confirmed",
                        con=con
                    )

            # Optionally create reusable rule
            rule_id = None
            if save_as_rule and rule_pattern and company_name:
                rule_id = f"rule_{uuid.uuid4().hex[:10]}"
                con.execute("""
                    INSERT INTO automation_mapping_rules (
                        rule_id, company_name, rule_name, match_type, match_pattern,
                        assigned_ledger, voucher_type, priority, is_active, created_at, updated_at
                    ) VALUES (?, ?, ?, 'contains_narration', ?, ?, ?, 100, 1, ?, ?)
                """, (
                    rule_id, company_name, f"Bulk: {clean_ledger}", rule_pattern.strip().lower(),
                    clean_ledger, voucher_type or "Payment", now_t, now_t
                ))

            con.commit()

        return {
            "ok": True,
            "assigned_count": len(transaction_ids),
            "ledger_name": clean_ledger,
            "created_rule_id": rule_id
        }

    # -------------------------------------------------------------------------
    # VS AI-ASSISTED MULTI-TIER LEDGER RECOMMENDATIONS
    # -------------------------------------------------------------------------
    def suggest_ledgers_with_gemini(
        self,
        session_id: str,
        company_name: str,
        sample_limit: int = 150,
        auto_assign: bool = False
    ) -> Dict[str, Any]:
        """Multi-tier suggestion pipeline: Company Learning -> Mapping Rules -> Master Matching -> Gemini."""
        # Tier 1: Adaptive Company Learning
        learn_count = self.apply_company_learning(session_id, company_name)
        # Tier 2: Reusable Company Mapping Rules
        rule_count = self.apply_mapping_rules_to_session(session_id, company_name)
        # Tier 3: Deterministic Accounts Master Matching
        master_count = self.apply_master_matching(session_id, company_name)

        # Retrieve available Tally masters for canonical validation and Gemini grounding
        masters_res = self.tally_client.get_company_masters(company_name)
        available_ledgers = masters_res.get("ledgers", [])
        ledger_names = [l if isinstance(l, str) else (l.get("name") or l.get("Name") or "") for l in available_ledgers if l]
        canonical_map = {l.strip().lower(): l.strip() for l in ledger_names if l.strip()}

        # Tier 4: For remaining transactions without a suggested_ledger and without assigned_ledger
        with sqlite3.connect(self.db_path, timeout=5) as con:
            con.row_factory = sqlite3.Row
            unassigned = con.execute("""
                SELECT transaction_id, original_narration, normalized_narration, debit_amount, credit_amount
                FROM automation_transactions
                WHERE session_id=? AND (assigned_ledger IS NULL OR assigned_ledger = '')
                  AND (suggested_ledger IS NULL OR suggested_ledger = '') AND is_excluded=0
                LIMIT ?
            """, (session_id, sample_limit)).fetchall()

        gemini_count = 0
        if unassigned and ledger_names:
            ai_eng = vs_ai_engine.get_ai_engine(self.db_path)
            gemini = ai_eng.gemini
            api_key = gemini.get_api_key()

            if api_key:
                prompt = f"""You are a Chartered Accountant assistant reviewing bank transactions for company '{company_name}'.
Available Tally Ledgers:
{json.dumps(ledger_names[:250], ensure_ascii=False)}

CRITICAL RULE:
You MUST recommend a ledger strictly from the "Available Tally Ledgers" list above.
Do NOT invent new ledger names. If no exact match is suitable, choose the closest matching ledger or standard clearing account from the list.

Transactions to classify:
{json.dumps([{'id': r['transaction_id'], 'narration': r['original_narration'] or r['normalized_narration'], 'debit': float(r['debit_amount'] or 0), 'credit': float(r['credit_amount'] or 0)} for r in unassigned], ensure_ascii=False)}

Respond ONLY with a valid JSON array in this exact structure:
[
  {{"id": "txn_...", "suggested_ledger": "Exact Name From Available Ledgers", "suggested_voucher_type": "Payment", "reason": "Brief reason", "confidence": "High"}}
]
"""
                try:
                    gemini_res = gemini.generate_content(prompt)
                    if isinstance(gemini_res, dict) and gemini_res.get("ok"):
                        raw_response = gemini_res.get("text", "")
                        # Robust JSON array extraction
                        cleaned = re.sub(r"^```(?:json)?\s*", "", raw_response.strip())
                        cleaned = re.sub(r"\s*```$", "", cleaned)
                        start_idx = cleaned.find("[")
                        end_idx = cleaned.rfind("]")
                        if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                            json_str = cleaned[start_idx:end_idx + 1]
                            suggestions = json.loads(json_str)
                            now_t = now_iso()
                            with sqlite3.connect(self.db_path, timeout=5) as con:
                                for s in suggestions:
                                    t_id = s.get("id")
                                    raw_s_ledger = str(s.get("suggested_ledger", "")).strip()
                                    s_vch = s.get("suggested_voucher_type")
                                    s_reason = s.get("reason", "VS AI Recommendation")
                                    conf = s.get("confidence", "Medium")
                                    if not t_id or not raw_s_ledger:
                                        continue

                                    # Canonicalize strictly against target company masters
                                    canonical_ledger = canonical_map.get(raw_s_ledger.lower())
                                    if not canonical_ledger:
                                        for cand_low, cand_name in canonical_map.items():
                                            if cand_low in raw_s_ledger.lower() or raw_s_ledger.lower() in cand_low:
                                                canonical_ledger = cand_name
                                                break

                                    if canonical_ledger:
                                        con.execute("""
                                            UPDATE automation_transactions
                                            SET suggested_ledger=?,
                                                suggested_voucher_type=COALESCE(?, suggested_voucher_type),
                                                confidence_category=?,
                                                suggestion_reason=?,
                                                suggestion_source='gemini',
                                                suggestion_status='suggested',
                                                updated_at=?
                                            WHERE transaction_id=? AND (assigned_ledger IS NULL OR assigned_ledger = '')
                                        """, (canonical_ledger, s_vch, conf, f"VS AI: {s_reason}", now_t, t_id))
                                        gemini_count += 1
                                con.commit()
                except Exception as e:
                    logger.warning(f"Gemini tier suggestion encountered notice: {e}")

        # If auto_assign was explicitly requested (e.g. testing flag), promote suggestions
        if auto_assign:
            self.accept_suggested_ledgers(session_id)

        total_suggested = learn_count + rule_count + master_count + gemini_count
        return {
            "ok": True,
            "suggested_count": total_suggested,
            "company_learning_matches": learn_count,
            "rule_matches": rule_count,
            "master_matches": master_count,
            "gemini_matches": gemini_count
        }

    def accept_suggested_ledgers(self, session_id: str, transaction_ids: Optional[List[str]] = None) -> Dict[str, Any]:
        """Promotes suggested ledgers to assigned ledgers and records confirmed mappings into company learning."""
        now_t = now_iso()
        with sqlite3.connect(self.db_path, timeout=10) as con:
            con.row_factory = sqlite3.Row
            sess = con.execute("SELECT company_name FROM automation_import_sessions WHERE session_id=?", (session_id,)).fetchone()
            company_name = sess["company_name"] if sess else ""

            if transaction_ids:
                placeholders = ",".join("?" for _ in transaction_ids)
                txns = con.execute(f"""
                    SELECT transaction_id, original_narration, debit_amount, credit_amount,
                           suggested_ledger, suggested_voucher_type
                    FROM automation_transactions
                    WHERE session_id = ? AND transaction_id IN ({placeholders})
                      AND suggested_ledger IS NOT NULL AND suggested_ledger != ''
                """, [session_id] + list(transaction_ids)).fetchall()
            else:
                txns = con.execute("""
                    SELECT transaction_id, original_narration, debit_amount, credit_amount,
                           suggested_ledger, suggested_voucher_type
                    FROM automation_transactions
                    WHERE session_id = ?
                      AND suggested_ledger IS NOT NULL AND suggested_ledger != ''
                      AND (assigned_ledger IS NULL OR assigned_ledger = '')
                """, (session_id,)).fetchall()

            for t in txns:
                dr = float(t["debit_amount"] or 0)
                vch = t["suggested_voucher_type"] or ("Payment" if dr > 0 else "Receipt")
                con.execute("""
                    UPDATE automation_transactions
                    SET assigned_ledger = suggested_ledger,
                        assigned_voucher_type = ?,
                        is_ai_assigned = 1,
                        suggestion_status = 'accepted',
                        validation_status = 'valid',
                        updated_at = ?
                    WHERE transaction_id = ?
                """, (vch, now_t, t["transaction_id"]))

                if company_name:
                    self.record_company_learning(
                        company_name=company_name,
                        narration=t["original_narration"] or "",
                        direction="DEBIT" if dr > 0 else "CREDIT",
                        assigned_ledger=t["suggested_ledger"],
                        voucher_type=vch,
                        source="user_confirmed",
                        con=con
                    )

            con.commit()
            return {
                "ok": True,
                "session_id": session_id,
                "assigned_count": len(txns)
            }

    def reject_suggested_ledgers(self, session_id: str, transaction_ids: Optional[List[str]] = None) -> Dict[str, Any]:
        """Rejects suggested ledgers for given transactions or session, returning them to unassigned."""
        now_t = now_iso()
        with sqlite3.connect(self.db_path, timeout=10) as con:
            if transaction_ids:
                placeholders = ",".join("?" for _ in transaction_ids)
                cur = con.execute(f"""
                    UPDATE automation_transactions
                    SET suggested_ledger = NULL,
                        assigned_ledger = NULL,
                        is_ai_assigned = 0,
                        suggestion_status = 'rejected',
                        suggestion_source = 'none',
                        updated_at = ?
                    WHERE session_id = ? AND transaction_id IN ({placeholders})
                """, [now_t, session_id] + list(transaction_ids))
            else:
                cur = con.execute("""
                    UPDATE automation_transactions
                    SET suggested_ledger = NULL,
                        assigned_ledger = NULL,
                        is_ai_assigned = 0,
                        suggestion_status = 'rejected',
                        suggestion_source = 'none',
                        updated_at = ?
                    WHERE session_id = ? AND (assigned_ledger IS NULL OR is_ai_assigned = 1)
                """, (now_t, session_id))
            rejected_count = cur.rowcount
            con.commit()

        return {
            "ok": True,
            "session_id": session_id,
            "rejected_count": rejected_count
        }

    # -------------------------------------------------------------------------
    # VALIDATION & DUPLICATE PROTECTION
    # -------------------------------------------------------------------------
    def validate_session_for_posting(self, session_id: str, is_educational_mode: bool = True) -> Dict[str, Any]:
        """Checks double-entry balance, missing ledgers, duplicate risks, and voucher readiness."""
        with sqlite3.connect(self.db_path, timeout=5) as con:
            con.row_factory = sqlite3.Row
            sess = con.execute("SELECT * FROM automation_import_sessions WHERE session_id=?", (session_id,)).fetchone()
            if not sess:
                return {"ok": False, "error": "Session not found"}

            txns = con.execute("SELECT * FROM automation_transactions WHERE session_id=?", (session_id,)).fetchall()

        total_txns = len(txns)
        assigned_txns = [t for t in txns if t["assigned_ledger"] and not t["is_excluded"]]
        unassigned_txns = [t for t in txns if not t["assigned_ledger"] and not t["is_excluded"]]
        excluded_txns = [t for t in txns if t["is_excluded"]]

        validation_errors = []
        if not sess["bank_account_ledger"]:
            validation_errors.append("Bank Account Ledger is not selected for this import session.")

        if unassigned_txns:
            validation_errors.append(f"{len(unassigned_txns)} transactions do not have an assigned Tally ledger.")

        # Educational mode pre-flight validation
        unsupported_edu_txns = [t for t in assigned_txns if not is_valid_tally_edu_date(t["txn_date"])]
        has_edu_date_conflicts = len(unsupported_edu_txns) > 0
        conflicting_dates = sorted(list(set(t["txn_date"] for t in unsupported_edu_txns)))
        edu_warning_msg = ""
        if has_edu_date_conflicts:
            edu_warning_msg = (
                f"{len(unsupported_edu_txns)} transaction(s) have dates ({', '.join(conflicting_dates[:3])}"
                f"{'...' if len(conflicting_dates) > 3 else ''}) that are not accepted by Tally in Educational Mode "
                f"(only the 1st, 2nd, and 31st of any month are accepted). Posting will fail unless run on a licensed Tally instance "
                f"or test date remapping is explicitly consented to."
            )
            if is_educational_mode:
                validation_errors.append(edu_warning_msg)

        total_debits = sum(Decimal(str(t["debit_amount"])) for t in assigned_txns)
        total_credits = sum(Decimal(str(t["credit_amount"])) for t in assigned_txns)

        is_ready = len(validation_errors) == 0 and len(assigned_txns) > 0

        # Construct preview items for final review screen
        vouchers_preview = []
        bank_ledger = sess["bank_account_ledger"]
        for t in assigned_txns:
            dr = float(t["debit_amount"])
            cr = float(t["credit_amount"])
            vch_type = t["assigned_voucher_type"] or ("Payment" if dr > 0 else "Receipt")
            vouchers_preview.append({
                "transaction_id": t["transaction_id"],
                "txn_date": t["txn_date"],
                "is_edu_compatible": is_valid_tally_edu_date(t["txn_date"]),
                "original_narration": t["original_narration"],
                "ref_number": t["ref_number"] or "",
                "debit_amount": dr,
                "credit_amount": cr,
                "assigned_ledger": t["assigned_ledger"],
                "bank_account_ledger": bank_ledger,
                "voucher_type": vch_type,
                "confidence_category": t["confidence_category"] or "High",
                "is_ai_assigned": bool(t["is_ai_assigned"])
            })

        return {
            "ok": True,
            "session_id": session_id,
            "company_name": sess["company_name"],
            "bank_account_ledger": sess["bank_account_ledger"],
            "total_transactions": total_txns,
            "assigned_count": len(assigned_txns),
            "unassigned_count": len(unassigned_txns),
            "excluded_count": len(excluded_txns),
            "has_edu_date_conflicts": has_edu_date_conflicts,
            "edu_conflicting_count": len(unsupported_edu_txns),
            "edu_conflicting_dates": conflicting_dates,
            "edu_warning_message": edu_warning_msg,
            "total_debits": float(total_debits),
            "total_credits": float(total_credits),
            "validation_errors": validation_errors,
            "is_ready_for_posting": is_ready,
            "vouchers_preview": vouchers_preview
        }

    # -------------------------------------------------------------------------
    # RESUMABLE CHUNKED POSTING ENGINE & RECONCILIATION
    # -------------------------------------------------------------------------
    def post_approved_session_to_tally(
        self,
        session_id: str,
        batch_size: int = 50,
        run_all: bool = True,
        is_educational_mode: bool = True,
        remap_edu_dates: bool = False,
        user_confirmed_remap: bool = False
    ) -> Dict[str, Any]:
        """Constructs balanced voucher payloads and posts them to TallyPrime in automatic resumable chunks with full idempotency."""
        with self._session_lock:
            if session_id in self._in_flight_sessions:
                return {
                    "ok": False,
                    "error": f"Posting is already in progress for session '{session_id}'. Please wait for completion."
                }
            self._in_flight_sessions.add(session_id)

        try:
            return self._execute_post_approved_session(
                session_id=session_id,
                batch_size=batch_size,
                run_all=run_all,
                is_educational_mode=is_educational_mode,
                remap_edu_dates=remap_edu_dates,
                user_confirmed_remap=user_confirmed_remap
            )
        finally:
            with self._session_lock:
                self._in_flight_sessions.discard(session_id)

    def _execute_post_approved_session(
        self,
        session_id: str,
        batch_size: int = 50,
        run_all: bool = True,
        is_educational_mode: bool = True,
        remap_edu_dates: bool = False,
        user_confirmed_remap: bool = False
    ) -> Dict[str, Any]:
        # 1. Pre-flight validation
        val_res = self.validate_session_for_posting(session_id, is_educational_mode=is_educational_mode)
        
        # If educational mode conflicts exist and user has not explicitly consented to remapping
        if is_educational_mode and not (remap_edu_dates and user_confirmed_remap):
            if val_res.get("has_edu_date_conflicts"):
                return {
                    "ok": False,
                    "error": "Tally Educational Mode Date Conflict: Unsupported dates detected before posting. " + val_res.get("edu_warning_message", ""),
                    "has_edu_date_conflicts": True,
                    "edu_conflicting_count": val_res.get("edu_conflicting_count", 0),
                    "edu_conflicting_dates": val_res.get("edu_conflicting_dates", [])
                }

        if not val_res.get("is_ready_for_posting"):
            # Check if only edu errors exist when remap is confirmed
            non_edu_errors = [e for e in val_res.get("validation_errors", []) if "Educational Mode" not in e]
            if non_edu_errors:
                return {
                    "ok": False,
                    "error": "Validation failed: " + "; ".join(non_edu_errors)
                }

        # 2. Check Tally connection
        conn = self.tally_client.get_connection_status()
        if not conn.get("tally_port_open"):
            return {
                "ok": False,
                "error": "Cannot post vouchers: TallyPrime is offline or XML server port 9000 is unreachable."
            }

        company = val_res["company_name"]
        bank_ledger = val_res["bank_account_ledger"]

        with sqlite3.connect(self.db_path, timeout=10) as con:
            con.row_factory = sqlite3.Row
            # All eligible transactions that haven't been posted yet
            pending_txns = con.execute("""
                SELECT * FROM automation_transactions
                WHERE session_id=? AND assigned_ledger IS NOT NULL AND assigned_ledger != ''
                  AND is_excluded=0 AND posting_status != 'posted'
                ORDER BY row_index ASC
            """, (session_id,)).fetchall()

            total_eligible = con.execute("""
                SELECT COUNT(*) FROM automation_transactions
                WHERE session_id=? AND assigned_ledger IS NOT NULL AND assigned_ledger != ''
                  AND is_excluded=0
            """, (session_id,)).fetchone()[0]

            already_posted = con.execute("""
                SELECT COUNT(*) FROM automation_transactions
                WHERE session_id=? AND posting_status = 'posted'
            """, (session_id,)).fetchone()[0]

        if not pending_txns:
            if already_posted > 0:
                rec = self.calculate_reconciliation_report(session_id, company, bank_ledger)
                return {
                    "ok": True,
                    "batch_posted": 0,
                    "verified_total": already_posted,
                    "failed_total": 0,
                    "total_selected": total_eligible,
                    "progress_pct": 100,
                    "is_complete": True,
                    "has_failures": False,
                    "failed_transactions": [],
                    "company_name": company,
                    "reconciliation": rec
                }
            return {"ok": False, "error": "No pending approved transactions to post."}

        # Canonicalize ledger names against active Tally masters
        masters = self.tally_client.get_company_masters(company)
        raw_masters = masters.get("ledgers", [])
        canonical_map = {}
        for lm in raw_masters:
            name = lm if isinstance(lm, str) else (lm.get("name") or lm.get("Name") or "")
            if name:
                canonical_map[name.strip().lower()] = name.strip()

        if bank_ledger and bank_ledger.strip().lower() in canonical_map:
            bank_ledger = canonical_map[bank_ledger.strip().lower()]

        # Query existing posted transaction fingerprints for this company
        existing_txn_fingerprints = set()
        with sqlite3.connect(self.db_path, timeout=10) as con:
            con.row_factory = sqlite3.Row
            rows = con.execute("""
                SELECT transaction_id, voucher_payload FROM automation_posting_records
                WHERE company_name=? AND status='success'
            """, (company,)).fetchall()
            for r in rows:
                p_text = r["voucher_payload"] or ""
                m = re.findall(r'\[VS-TXN:([a-f0-9]{16})\]', p_text)
                for h in m:
                    existing_txn_fingerprints.add(h)

        # Determine occurrence numbers for all transactions in this session to differentiate legitimate identical transactions
        occurrence_map: Dict[str, int] = {}
        with sqlite3.connect(self.db_path, timeout=10) as con:
            con.row_factory = sqlite3.Row
            all_sess_txns = con.execute("""
                SELECT transaction_id, row_index, txn_date, debit_amount, credit_amount, ref_number, original_narration
                FROM automation_transactions
                WHERE session_id=?
                ORDER BY row_index ASC
            """, (session_id,)).fetchall()
            seen_counts: Dict[str, int] = {}
            for r in all_sess_txns:
                tid = r["transaction_id"]
                t_date = r["txn_date"]
                t_dr = float(r["debit_amount"] or 0)
                t_cr = float(r["credit_amount"] or 0)
                t_ref = str(r["ref_number"] or "").strip()
                t_narr = re.sub(r'\[VS-TXN:[a-f0-9]+(?::\d+)?\]', '', r["original_narration"] or '').strip().lower()[:60]
                t_key = f"{(bank_ledger or '').strip().lower()}|{str(t_date).strip()}|{t_dr:.2f}|{t_cr:.2f}|{t_ref}|{t_narr}"
                seen_counts[t_key] = seen_counts.get(t_key, 0) + 1
                occurrence_map[tid] = seen_counts[t_key]

        # Chunk pending transactions into batches of batch_size (default 50)
        chunks = [pending_txns[i:i + batch_size] for i in range(0, len(pending_txns), batch_size)]
        if not run_all and len(chunks) > 1:
            chunks = chunks[:1]

        verified_this_run = 0
        now_t = now_iso()

        for chunk in chunks:
            vouchers_payload = []
            chunk_map = {}
            idempotent_skipped = []

            for t in chunk:
                dr = Decimal(str(t["debit_amount"]))
                cr = Decimal(str(t["credit_amount"]))
                target_party = (t["assigned_ledger"] or "").strip()
                if target_party.lower() in canonical_map:
                    target_party = canonical_map[target_party.lower()]

                vch_type = t["assigned_voucher_type"] or ("Payment" if dr > 0 else "Receipt")
                orig_narration = t["original_narration"] or "Bank Statement Import"
                orig_date = t["txn_date"]

                # Date resolution with preserved original date
                if remap_edu_dates and user_confirmed_remap:
                    vch_date = remap_to_tally_edu_date(orig_date)
                    narration = f"{orig_narration} [Orig Date: {orig_date}]" if vch_date != orig_date else orig_narration
                else:
                    vch_date = orig_date
                    narration = orig_narration

                # Deterministic transaction fingerprint with occurrence index for persistent duplicate prevention
                occ = occurrence_map.get(t["transaction_id"], 1)
                txn_hash = compute_txn_fingerprint(bank_ledger, orig_date, dr, cr, t["ref_number"], orig_narration, occurrence=occ)
                narration = f"{narration} [VS-TXN:{txn_hash}]"

                # Check if this exact transaction was already posted to this company (idempotency guard)
                if txn_hash in existing_txn_fingerprints:
                    idempotent_skipped.append((t["transaction_id"], txn_hash))
                    continue

                if dr > 0:
                    entry = [
                        {"ledgerName": target_party, "amount": float(-dr)},
                        {"ledgerName": bank_ledger, "amount": float(dr)}
                    ]
                else:
                    entry = [
                        {"ledgerName": bank_ledger, "amount": float(-cr)},
                        {"ledgerName": target_party, "amount": float(cr)}
                    ]

                vch_obj = {
                    "date": vch_date,
                    "voucherType": vch_type if vch_type in ("Journal", "Payment", "Receipt", "Contra") else "Journal",
                    "narration": narration,
                    "accountingEntry": entry
                }
                ref_num = str(t["ref_number"] or "").strip()
                if ref_num:
                    vch_obj["voucherNumber"] = ref_num

                vouchers_payload.append(vch_obj)
                chunk_map[len(vouchers_payload) - 1] = (t["transaction_id"], txn_hash)

            # Handle idempotent skipped vouchers immediately
            if idempotent_skipped:
                with sqlite3.connect(self.db_path, timeout=10) as con:
                    for s_tid, s_hash in idempotent_skipped:
                        con.execute("""
                            UPDATE automation_transactions
                            SET posting_status='posted', duplicate_status='idempotent_skip', validation_status='valid', updated_at=?
                            WHERE transaction_id=?
                        """, (now_t, s_tid))
                    con.commit()
                verified_this_run += len(idempotent_skipped)

            if not vouchers_payload:
                continue

            post_res = self.tally_client.call_tool("voucher-journal", {
                "targetCompany": company,
                "vouchers": vouchers_payload
            }, timeout=90)

            t_data = post_res.get("data", {})
            created_count = int(t_data.get("CREATED") or t_data.get("created") or 0) if isinstance(t_data, dict) else 0
            errors_count = int(t_data.get("ERRORS") or t_data.get("errors") or 0) if isinstance(t_data, dict) else 0
            exceptions_count = int(t_data.get("EXCEPTIONS") or t_data.get("exceptions") or 0) if isinstance(t_data, dict) else 0
            line_error = str(t_data.get("LINEERROR") or t_data.get("line_error") or "").strip() if isinstance(t_data, dict) else ""

            if post_res.get("ok") and created_count == len(vouchers_payload) and errors_count == 0 and exceptions_count == 0:
                # Clean batch success: All vouchers in chunk confirmed created
                with sqlite3.connect(self.db_path, timeout=10) as con:
                    for v_idx, (t_id, t_hash) in chunk_map.items():
                        con.execute("""
                            UPDATE automation_transactions
                            SET posting_status='posted', duplicate_status='clean', validation_status='valid', updated_at=?
                            WHERE transaction_id=?
                        """, (now_t, t_id))

                        con.execute("""
                            INSERT INTO automation_posting_records (
                                record_id, session_id, transaction_id, company_name,
                                voucher_type, voucher_date, voucher_payload, status,
                                tally_response, posted_at
                            ) VALUES (?, ?, ?, ?, 'Voucher', ?, ?, 'success', ?, ?)
                        """, (
                            f"post_{uuid.uuid4().hex[:10]}", session_id, t_id, company,
                            vouchers_payload[v_idx]["date"], json.dumps([vouchers_payload[v_idx]]), json.dumps(t_data), now_t
                        ))
                        existing_txn_fingerprints.add(t_hash)
                    con.commit()
                verified_this_run += created_count
            elif post_res.get("ok") and (created_count > 0 or errors_count > 0 or exceptions_count > 0):
                # Partial creation or exception occurred within the batch.
                # Fallback to individual posting to determine with 100% precision which transactions succeeded
                logger.info(f"Chunk reported partial outcome (CREATED={created_count}, ERRORS={errors_count}, EXCEPTIONS={exceptions_count}). Verifying transactions individually...")
                for vch_idx, vch_single in enumerate(vouchers_payload):
                    single_tid, single_hash = chunk_map[vch_idx]
                    single_res = self.tally_client.call_tool("voucher-journal", {
                        "targetCompany": company,
                        "vouchers": [vch_single]
                    }, timeout=30)
                    s_data = single_res.get("data", {})
                    s_created = int(s_data.get("CREATED") or s_data.get("created") or 0) if isinstance(s_data, dict) else 0
                    s_errors = int(s_data.get("ERRORS") or s_data.get("errors") or 0) if isinstance(s_data, dict) else 0
                    s_exceptions = int(s_data.get("EXCEPTIONS") or s_data.get("exceptions") or 0) if isinstance(s_data, dict) else 0
                    s_err_msg = str(s_data.get("LINEERROR") or s_data.get("line_error") or "").strip() if isinstance(s_data, dict) else ""

                    with sqlite3.connect(self.db_path, timeout=10) as con:
                        if single_res.get("ok") and s_created == 1 and s_errors == 0 and s_exceptions == 0:
                            con.execute("""
                                UPDATE automation_transactions
                                SET posting_status='posted', duplicate_status='clean', validation_status='valid', updated_at=?
                                WHERE transaction_id=?
                            """, (now_t, single_tid))
                            con.execute("""
                                INSERT INTO automation_posting_records (
                                    record_id, session_id, transaction_id, company_name,
                                    voucher_type, voucher_date, voucher_payload, status,
                                    tally_response, posted_at
                                ) VALUES (?, ?, ?, ?, 'Voucher', ?, ?, 'success', ?, ?)
                            """, (
                                f"post_{uuid.uuid4().hex[:10]}", session_id, single_tid, company,
                                vch_single["date"], json.dumps([vch_single]), json.dumps(s_data), now_t
                            ))
                            existing_txn_fingerprints.add(single_hash)
                            verified_this_run += 1
                        else:
                            fail_msg = s_err_msg or single_res.get("error") or f"Tally rejected voucher (ERRORS: {s_errors}, EXCEPTIONS: {s_exceptions})"
                            con.execute("""
                                UPDATE automation_transactions
                                SET posting_status='failed', validation_errors=?, updated_at=?
                                WHERE transaction_id=?
                            """, (json.dumps([fail_msg]), now_t, single_tid))
                            con.execute("""
                                INSERT INTO automation_posting_records (
                                    record_id, session_id, transaction_id, company_name,
                                    voucher_type, voucher_date, voucher_payload, status,
                                    error_details, tally_response, posted_at
                                ) VALUES (?, ?, ?, ?, 'Voucher', ?, ?, 'failure', ?, ?, ?)
                            """, (
                                f"post_{uuid.uuid4().hex[:10]}", session_id, single_tid, company,
                                vch_single["date"], json.dumps([vch_single]), fail_msg, json.dumps(s_data), now_t
                            ))
                        con.commit()
            else:
                err = post_res.get("error") or f"Tally reported {errors_count} error(s) during voucher creation."
                logger.error(f"Chunk posting failed for session {session_id}: {err}")
                # Mark chunk as failed with explicit reason
                with sqlite3.connect(self.db_path, timeout=10) as con:
                    for v_idx, (t_id, t_hash) in chunk_map.items():
                        con.execute("""
                            UPDATE automation_transactions
                            SET posting_status='failed', validation_errors=?, updated_at=?
                            WHERE transaction_id=?
                        """, (json.dumps([err]), now_t, t_id))
                    con.commit()
                break

        # Query comprehensive status from database
        with sqlite3.connect(self.db_path, timeout=10) as con:
            con.row_factory = sqlite3.Row
            total_posted = con.execute("SELECT COUNT(*) FROM automation_transactions WHERE session_id=? AND posting_status='posted'", (session_id,)).fetchone()[0]
            total_failed = con.execute("SELECT COUNT(*) FROM automation_transactions WHERE session_id=? AND posting_status='failed'", (session_id,)).fetchone()[0]
            failed_rows = con.execute("""
                SELECT row_index, txn_date, debit_amount, credit_amount, assigned_ledger, validation_errors
                FROM automation_transactions
                WHERE session_id=? AND posting_status='failed'
                ORDER BY row_index ASC
            """, (session_id,)).fetchall()

        is_complete = (total_posted >= total_eligible)
        has_failures = (total_failed > 0)
        progress_pct = int(math.floor(100.0 * total_posted / total_eligible)) if total_eligible > 0 else 100

        with sqlite3.connect(self.db_path, timeout=10) as con:
            sess_status = "posted" if is_complete else ("partial_success" if total_posted > 0 else "failed")
            con.execute("""
                UPDATE automation_import_sessions
                SET posting_status=?, posted_count=?, failed_count=?, updated_at=?
                WHERE session_id=?
            """, (sess_status, total_posted, total_failed, now_t, session_id))
            con.commit()

        reconciliation = self.calculate_reconciliation_report(session_id, company, bank_ledger)

        failed_txns_list = []
        for r in failed_rows:
            err_text = "Tally rejected voucher"
            if r["validation_errors"]:
                try:
                    err_parsed = json.loads(r["validation_errors"])
                    err_text = err_parsed[0] if isinstance(err_parsed, list) and err_parsed else str(err_parsed)
                except Exception:
                    err_text = str(r["validation_errors"])
            failed_txns_list.append({
                "row_index": r["row_index"],
                "txn_date": r["txn_date"],
                "debit_amount": float(r["debit_amount"]),
                "credit_amount": float(r["credit_amount"]),
                "assigned_ledger": r["assigned_ledger"] or "",
                "error": err_text
            })

        return {
            "ok": True,
            "batch_posted": verified_this_run,
            "verified_total": total_posted,
            "failed_total": total_failed,
            "total_selected": total_eligible,
            "progress_pct": progress_pct,
            "is_complete": is_complete,
            "has_failures": has_failures,
            "failed_transactions": failed_txns_list,
            "company_name": company,
            "reconciliation": reconciliation
        }

    def calculate_reconciliation_report(self, session_id: str, company_name: str, bank_ledger: str) -> Dict[str, Any]:
        """Calculates post-posting reconciliation between statement, posted vouchers, and live Tally balance."""
        with sqlite3.connect(self.db_path, timeout=5) as con:
            con.row_factory = sqlite3.Row
            sess = con.execute("SELECT * FROM automation_import_sessions WHERE session_id=?", (session_id,)).fetchone()
            posted_stats = con.execute("""
                SELECT
                    COALESCE(SUM(debit_amount), 0) as posted_debits,
                    COALESCE(SUM(credit_amount), 0) as posted_credits,
                    COUNT(*) as posted_count
                FROM automation_transactions
                WHERE session_id=? AND posting_status='posted'
            """, (session_id,)).fetchone()
            total_eligible = con.execute("""
                SELECT COUNT(*) FROM automation_transactions
                WHERE session_id=? AND is_excluded=0
            """, (session_id,)).fetchone()[0]
            failed_count = con.execute("""
                SELECT COUNT(*) FROM automation_transactions
                WHERE session_id=? AND posting_status='failed'
            """, (session_id,)).fetchone()[0]

        opening = float(sess["opening_balance"] or 0)
        statement_closing = float(sess["closing_balance"] or 0)
        posted_dr = float(posted_stats["posted_debits"] or 0)
        posted_cr = float(posted_stats["posted_credits"] or 0)
        posted_count = posted_stats["posted_count"]

        # Expected closing: In bank statement perspective, credits increase balance, debits decrease balance
        expected_closing = round(opening - posted_dr + posted_cr, 2)

        # Query live balance from Tally
        to_date = sess["statement_to_date"] or datetime.now().strftime("%Y-%m-%d")
        tally_bal_res = self.tally_client.get_ledger_balance(bank_ledger, to_date, company_name)
        actual_tally_raw = tally_bal_res.get("amount", 0.0) if tally_bal_res.get("ok") else None
        
        # In Tally: Negative is Debit (Assets), Positive is Credit (Liabilities)
        actual_tally_dr = abs(actual_tally_raw) if actual_tally_raw is not None else 0.0
        diff = round(abs(expected_closing - actual_tally_dr), 2) if actual_tally_raw is not None else 0.0
        
        # Audit completeness check: Can only be considered reconciled if ALL eligible transactions were posted
        # AND audit difference is strictly zero (< 0.01) AND live Tally balance was successfully retrieved
        is_fully_posted = (posted_count == total_eligible and failed_count == 0)
        is_reconciled = bool(is_fully_posted and diff < 0.01 and actual_tally_raw is not None)

        return {
            "opening_balance": opening,
            "statement_closing_balance": statement_closing,
            "total_source_debits": float(sess["total_debits"] or 0),
            "total_source_credits": float(sess["total_credits"] or 0),
            "total_posted_debits": posted_dr,
            "total_posted_credits": posted_cr,
            "total_eligible_count": total_eligible,
            "posted_count": posted_count,
            "failed_count": failed_count,
            "is_fully_posted": is_fully_posted,
            "expected_closing_balance": expected_closing,
            "actual_tally_balance": actual_tally_dr,
            "actual_tally_raw": actual_tally_raw,
            "difference": diff,
            "is_reconciled": is_reconciled
        }

    # -------------------------------------------------------------------------
    # ASK TALLY — READ-ONLY CONVERSATIONAL QUERY ENGINE
    # -------------------------------------------------------------------------
    def process_ask_tally_query(self, session_id: str, company_name: str, query: str) -> Dict[str, Any]:
        """Interprets natural language question, retrieves data via read-only tools, and answers via Gemini."""
        clean_q = query.strip()
        if not clean_q:
            return {"ok": False, "error": "Query cannot be blank"}

        # Check Tally connection
        conn = self.tally_client.get_connection_status()
        if not conn.get("tally_port_open"):
            return {
                "ok": False,
                "error": "Tally is currently offline. Please ensure TallyPrime is running with XML Server enabled on port 9000 to query accounting data."
            }

        # Step 1: Detect intent & appropriate read-only tool
        q_lower = clean_q.lower()
        tool_name = "chart-of-accounts"
        tool_args = {"targetCompany": company_name}

        if any(k in q_lower for k in ("trial balance", "tb")):
            tool_name = "trial-balance"
            tool_args["fromDate"] = "2026-04-01"
            tool_args["toDate"] = datetime.now().strftime("%Y-%m-%d")
        elif any(k in q_lower for k in ("profit and loss", "p&l", "profit", "loss", "income")):
            tool_name = "profit-loss"
            tool_args["fromDate"] = "2026-04-01"
            tool_args["toDate"] = datetime.now().strftime("%Y-%m-%d")
        elif any(k in q_lower for k in ("balance sheet", "asset", "liability")):
            tool_name = "balance-sheet"
            tool_args["fromDate"] = "2026-04-01"
            tool_args["toDate"] = datetime.now().strftime("%Y-%m-%d")
        elif any(k in q_lower for k in ("outstanding", "receivable", "debtor")):
            tool_name = "bills-outstanding"
            tool_args["nature"] = "receivable"
            tool_args["toDate"] = datetime.now().strftime("%Y-%m-%d")
        elif any(k in q_lower for k in ("payable", "creditor")):
            tool_name = "bills-outstanding"
            tool_args["nature"] = "payable"
            tool_args["toDate"] = datetime.now().strftime("%Y-%m-%d")
        elif any(k in q_lower for k in ("stock", "inventory", "godown")):
            tool_name = "stock-summary"
            tool_args["fromDate"] = "2026-04-01"
            tool_args["toDate"] = datetime.now().strftime("%Y-%m-%d")
        elif any(k in q_lower for k in ("ledger", "balance", "how much in")):
            # Check for specific ledger balance query
            tool_name = "chart-of-accounts"

        # Step 2: Call the read tool
        tally_res = self.tally_client.call_tool(tool_name, tool_args, timeout=25)
        if not tally_res.get("ok"):
            return {
                "ok": False,
                "error": f"Failed to retrieve data from Tally: {tally_res.get('error')}"
            }

        retrieved_data = tally_res.get("data")

        # Step 3: Pass retrieved data to Gemini for grounded interpretation
        ai_eng = vs_ai_engine.get_ai_engine(self.db_path)
        gemini = ai_eng.gemini
        api_key = gemini.get_api_key()

        if not api_key:
            # Fallback to direct structured data presentation without LLM
            return {
                "ok": True,
                "tool_used": tool_name,
                "company_name": company_name,
                "response_markdown": f"**Retrieved Tally Data for {company_name}**:\n\n```json\n{json.dumps(retrieved_data, indent=2)[:2000]}\n```"
            }

        prompt = f"""You are Ask Tally, an expert accounting copilot in VS Database.
User Question: "{clean_q}"
Company: {company_name}
Data Source: Retrieved directly from TallyPrime via tool '{tool_name}' with args {json.dumps(tool_args)}:

Retrieved Accounting Data:
{json.dumps(retrieved_data, ensure_ascii=False)[:4000]}

Instructions:
1. Ground your answer ENTIRELY in the retrieved Tally data above.
2. DO NOT fabricate, guess, or invent any balances or account numbers.
3. If figures are present, format them clearly with Indian Rupee formatting (e.g. ₹1,50,000.00) or tables.
4. State the reporting period and company name explicitly.
5. If the exact answer is not present in the retrieved records, state clearly that it was not found in Tally.
"""
        try:
            gemini_res = gemini.generate_content(prompt)
            if isinstance(gemini_res, dict):
                answer_text = gemini_res.get("text", "")
            else:
                answer_text = str(gemini_res)

            # Record in Ask Tally history
            now_t = now_iso()
            with sqlite3.connect(self.db_path, timeout=5) as con:
                con.execute("""
                    INSERT INTO automation_ask_tally_messages (
                        message_id, session_id, sender, content, tool_calls_json, tool_results_json, created_at
                    ) VALUES (?, ?, 'user', ?, NULL, NULL, ?)
                """, (f"msg_{uuid.uuid4().hex[:10]}", session_id, clean_q, now_t))

                con.execute("""
                    INSERT INTO automation_ask_tally_messages (
                        message_id, session_id, sender, content, tool_calls_json, tool_results_json, created_at
                    ) VALUES (?, ?, 'assistant', ?, ?, ?, ?)
                """, (
                    f"msg_{uuid.uuid4().hex[:10]}", session_id, answer_text,
                    json.dumps({"tool": tool_name, "args": tool_args}),
                    json.dumps(retrieved_data)[:2000] if retrieved_data else "",
                    now_t
                ))
                con.commit()

            return {
                "ok": True,
                "tool_used": tool_name,
                "company_name": company_name,
                "response_markdown": answer_text,
                "raw_data": retrieved_data
            }
        except Exception as e:
            return {"ok": False, "error": f"Failed to generate answer: {e}"}
