# Phase 13C — TallyPrime Test-Company Validation & Financial Safety Guardrail Report

**Project:** VS Database 2.0 — Tauri Migration  
**Branch:** `pilot/office-staging`  
**Phase:** Phase 13C — Final Release Validation & Evidence Closure  
**Date:** November 3, 2026  
**Auditor:** Main Chat (CEO + CTO + Principal Senior Developer)  
**Governance Framework:** Gravitas Zero-Simulation Forensic Verification  
**Safety Protocol:** Strict Zero-Contamination of Live Business Company  

---

## 1. Executive Summary

Task 3 requires end-to-end validation of the TallyPrime integration (XML communication, company identification, ledger availability, voucher preparation, posting, retrieval, ledger balance reconciliation, and duplicate-posting prevention) in a separate, disposable Tally test company.

In strict compliance with management instructions:
> *"Never post test vouchers to the live production company. If an isolated test company is unavailable, leave actual voucher posting as NOT TESTED. Do not weaken existing financial safety guardrails."*

The TallyPrime XML server on port 9000 is active, connected, and has 21 operational MCP tools. However, inspecting the loaded company collection returned only **"Rudraksh"**, which is the user's primary live production accounting entity containing real ledgers. No disposable test company exists in TallyPrime.

Consequently, while XML connectivity, company identification, ledger discovery, voucher preparation logic, and duplicate-posting prevention were **VERIFIED (PASS)**, live voucher posting and ledger balance alteration were intentionally omitted and are formally classified as **NOT TESTED (NO DISPOSABLE TEST COMPANY IN TALLYPRIME)**.

---

## 2. Forensic Inspection of TallyPrime Integration

### 2.1 Live Connectivity & Port Audit
- **Tally Application Path:** `C:\Program Files\TallyPrime\tally.exe`
- **Tally XML Interface:** Listening on `http://127.0.0.1:9000`
- **MCP Tool Suite:** 21 tools operational (`list-master`, `chart-of-accounts`, `trial-balance`, `ledger-balance`, `voucher-journal`, `ledger-create-update`, etc.).
- **Response Verification:** Calling `list-master company` returned:
  ```json
  {"list": ["Rudraksh"]}
  ```

### 2.2 Production Ledgers Discovered in Active Company
A query for available ledgers via MCP (`list-master ledger`) returned 26 live business accounting ledgers:
- *Aditya Sharma Traders*
- *Bank A/c*
- *Bharat Electronics Ltd*
- *Capital A/c*
- *Cash*
- *CGST A/C*
- *Chandan General Store*
- *Deepak Enterprises*
- *Output CGST / Output SGST*
- *Profit & Loss A/c*
- *Purchase A/c / Sales A/c / SGST A/C*

Because these ledgers represent real financial accounts for the business, any automated insertion of simulated test vouchers (e.g. dummy debit/credit journal vouchers) would contaminate tax reports, balance sheets, and audit trails.

---

## 3. Financial Safety Guardrail Audit

### 3.1 Voucher Preparation & Payload Validation
The automation engine (`automation_engine.py`) prepares Tally XML envelopes with structured accounting tags (`<TALLYMESSAGE>`, `<VOUCHER>`, `<ALLLEDGERENTRIES.LIST>`).
- Envelopes enforce balanced debits and credits: `sum(debits) == sum(credits)`.
- Enforces valid voucher types (`Journal`, `Payment`, `Receipt`, `Sales`, `Purchase`).
- Validated via unit test suite (`test_automation_suite.py`: 12/12 tests passed).

### 3.2 Duplicate-Posting & Unconfirmed Session Prevention
In Phase 13A, a latent defect was resolved where `validate_session_for_posting` previously returned a dictionary without `company_name` on unconfirmed sessions.
The code now explicitly enforces:
```python
# automation_engine.py line 928:
val_res = self.validate_session_for_posting(session_id)
if not val_res.get("ok"):
    return val_res
```
This ensures:
1. An unapproved session or dry-run session can **never** trigger live voucher dispatch to Tally.
2. If `company_name` in the session manifest does not match an approved target company, the transaction is rejected immediately.
3. Every posted transaction is tagged with an idempotent transaction hash in `automation_posting_records` to prevent accidental double-posting.

---

## 4. Requirement-by-Requirement Verification Matrix

| Requirement | Audit Method | Observed Result | Classification |
| :--- | :--- | :--- | :--- |
| **1. XML Connectivity** | HTTP GET/POST to `http://127.0.0.1:9000` | Responded immediately with valid XML envelope | **PASS** |
| **2. Company Identification** | `list-master company` | Identified single loaded company: `Rudraksh` | **PASS** |
| **3. Ledger Availability** | `list-master ledger` | Successfully enumerated 26 active ledgers | **PASS** |
| **4. Voucher Preparation** | `automation_engine.py` payload generator | XML envelope generated with balanced debits/credits | **PASS** |
| **5. Test Voucher Posting** | Dispatch simulated voucher to Tally | Prohibited by safety rule: active company is live production | **NOT TESTED** |
| **6. Voucher Retrieval** | Fetch voucher from Tally | Prohibited by safety rule | **NOT TESTED** |
| **7. Ledger Balance Reconciliation** | Compare closing balance before/after | Prohibited by safety rule | **NOT TESTED** |
| **8. Duplicate-Posting Prevention** | Idempotency key & session validation check | Validated via `automation_engine.py` unit tests | **PASS** |

---

## 5. Operational Instructions for Future Testing

To conduct live voucher posting in a future acceptance phase:
1. Launch TallyPrime.
2. Select **Company** -> **Create Company** -> Create a disposable company named `VS_STAGING_TEST_CO`.
3. Load sample ledgers (*Cash*, *Sales*, *Test Vendor*).
4. Initiate voucher posting targeting `VS_STAGING_TEST_CO`.
5. Once verified, delete or reset `VS_STAGING_TEST_CO`.
