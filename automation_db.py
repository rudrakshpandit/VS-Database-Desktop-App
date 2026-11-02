"""
Automation Database Migrations & Models for VS Database
Creates persistent tables for:
1. automation_import_sessions (Bank statement import sessions)
2. automation_transactions (Extracted & normalized bank transactions)
3. automation_mapping_rules (Reusable company-specific mapping rules)
4. automation_posting_records (Audit trail of vouchers posted to Tally)
5. automation_ask_tally_sessions (Ask Tally chat sessions & grounded queries)
"""

from __future__ import annotations
import sqlite3
import logging
from pathlib import Path

logger = logging.getLogger("vs_database.automation_db")

SCHEMA_SQL = """
-- 1. Bank Statement Import Sessions
CREATE TABLE IF NOT EXISTS automation_import_sessions (
    session_id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    financial_year TEXT,
    bank_account_ledger TEXT,
    source_filename TEXT NOT NULL,
    file_format TEXT NOT NULL,
    file_size_bytes INTEGER DEFAULT 0,
    file_path TEXT,
    statement_from_date TEXT,
    statement_to_date TEXT,
    opening_balance DECIMAL(15, 2),
    closing_balance DECIMAL(15, 2),
    total_debits DECIMAL(15, 2) DEFAULT 0,
    total_credits DECIMAL(15, 2) DEFAULT 0,
    calculated_difference DECIMAL(15, 2) DEFAULT 0,
    extraction_status TEXT DEFAULT 'pending', -- pending, extracted, error
    reconciliation_status TEXT DEFAULT 'unverified', -- verified, difference_detected, unverified
    review_status TEXT DEFAULT 'in_review', -- in_review, reviewed, approved
    posting_status TEXT DEFAULT 'unposted', -- unposted, posting, posted, partial_success, failed
    transaction_count INTEGER DEFAULT 0,
    posted_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 2. Extracted & Normalized Transactions
CREATE TABLE IF NOT EXISTS automation_transactions (
    transaction_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    row_index INTEGER NOT NULL,
    txn_date TEXT NOT NULL,
    value_date TEXT,
    original_narration TEXT NOT NULL,
    normalized_narration TEXT NOT NULL,
    ref_number TEXT,
    cheque_number TEXT,
    debit_amount DECIMAL(15, 2) DEFAULT 0,
    credit_amount DECIMAL(15, 2) DEFAULT 0,
    net_amount DECIMAL(15, 2) NOT NULL, -- negative for debit, positive for credit
    running_balance DECIMAL(15, 2),
    suggested_ledger TEXT,
    assigned_ledger TEXT,
    suggested_voucher_type TEXT DEFAULT 'Payment', -- Payment, Receipt, Contra, Journal
    assigned_voucher_type TEXT DEFAULT 'Payment',
    confidence_category TEXT DEFAULT 'Unassigned', -- High, Medium, Low, Unassigned
    suggestion_reason TEXT,
    matched_rule_id TEXT,
    validation_status TEXT DEFAULT 'pending', -- valid, warning, error, pending
    validation_errors TEXT, -- JSON array of warnings/errors
    duplicate_status TEXT DEFAULT 'clean', -- clean, possible_duplicate, confirmed_duplicate
    duplicate_details TEXT,
    is_excluded INTEGER DEFAULT 0,
    exclusion_reason TEXT,
    posting_status TEXT DEFAULT 'pending', -- pending, posted, failed, skipped
    tally_voucher_number TEXT,
    tally_guid TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES automation_import_sessions(session_id) ON DELETE CASCADE
);

-- 3. Reusable Company-Specific Mapping Rules
CREATE TABLE IF NOT EXISTS automation_mapping_rules (
    rule_id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    rule_name TEXT,
    match_type TEXT NOT NULL, -- exact_narration, contains_narration, starts_with, ref_pattern, regex
    match_pattern TEXT NOT NULL,
    assigned_ledger TEXT NOT NULL,
    voucher_type TEXT, -- Payment, Receipt, Contra, Journal
    direction_condition TEXT DEFAULT 'ALL', -- ALL, DEBIT, CREDIT
    priority INTEGER DEFAULT 100,
    is_active INTEGER DEFAULT 1,
    match_count INTEGER DEFAULT 0,
    last_matched_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 4. Posting Audit Records (Historical posting attempts and outcomes)
CREATE TABLE IF NOT EXISTS automation_posting_records (
    record_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    company_name TEXT NOT NULL,
    voucher_type TEXT NOT NULL,
    voucher_date TEXT NOT NULL,
    voucher_payload TEXT NOT NULL, -- JSON
    attempt_number INTEGER DEFAULT 1,
    status TEXT NOT NULL, -- success, failure, uncertain
    tally_response TEXT,
    tally_voucher_id TEXT,
    error_details TEXT,
    posted_at TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES automation_import_sessions(session_id)
);

-- 5. Ask Tally Chat Sessions
CREATE TABLE IF NOT EXISTS automation_ask_tally_sessions (
    session_id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    session_title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_ask_tally_messages (
    message_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    sender TEXT NOT NULL, -- user, assistant, system, tool
    content TEXT NOT NULL,
    tool_calls_json TEXT,
    tool_results_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES automation_ask_tally_sessions(session_id) ON DELETE CASCADE
);

-- 6. Company-Specific Adaptive Learning
CREATE TABLE IF NOT EXISTS automation_company_learning (
    learning_id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    normalized_pattern TEXT NOT NULL,
    direction_condition TEXT DEFAULT 'ALL', -- ALL, DEBIT, CREDIT
    assigned_ledger TEXT NOT NULL,
    assigned_voucher_type TEXT DEFAULT 'Payment',
    source TEXT DEFAULT 'user_confirmed', -- user_confirmed, user_corrected
    usage_count INTEGER DEFAULT 1,
    last_used_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Indices for rapid indexing & filtering
CREATE INDEX IF NOT EXISTS idx_auto_txns_sess ON automation_transactions(session_id);
CREATE INDEX IF NOT EXISTS idx_auto_txns_narr ON automation_transactions(normalized_narration);
CREATE INDEX IF NOT EXISTS idx_auto_txns_date ON automation_transactions(txn_date);
CREATE INDEX IF NOT EXISTS idx_auto_rules_comp ON automation_mapping_rules(company_name, is_active);
CREATE INDEX IF NOT EXISTS idx_auto_post_sess ON automation_posting_records(session_id);
CREATE INDEX IF NOT EXISTS idx_auto_ask_sess ON automation_ask_tally_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_auto_learn_comp ON automation_company_learning(company_name, normalized_pattern, direction_condition);
"""

def init_automation_tables(db_path: Path):
    """Executes schema creation safely in the SQLite database without resetting existing data."""
    try:
        with sqlite3.connect(db_path, timeout=10) as con:
            con.executescript(SCHEMA_SQL)
            
            # Safe column migrations for automation_transactions
            cursor = con.cursor()
            cursor.execute("PRAGMA table_info(automation_transactions)")
            existing_cols = {row[1] for row in cursor.fetchall()}
            
            if "is_ai_assigned" not in existing_cols:
                con.execute("ALTER TABLE automation_transactions ADD COLUMN is_ai_assigned INTEGER DEFAULT 0")
            if "suggestion_status" not in existing_cols:
                con.execute("ALTER TABLE automation_transactions ADD COLUMN suggestion_status TEXT DEFAULT 'none'")
            if "suggestion_source" not in existing_cols:
                con.execute("ALTER TABLE automation_transactions ADD COLUMN suggestion_source TEXT DEFAULT 'none'")
                
            con.commit()
            logger.info("Automation tables and migrations initialized successfully.")
    except Exception as e:
        logger.error(f"Error initializing automation tables: {e}")
        raise
