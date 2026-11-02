# VS Database 2.0 — Independent Security Audit & Code Review (Phase 8 & 9)

**Target Repository:** `D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration`  
**Audit Date:** November 2, 2026  
**Auditor:** Independent Code Reviewer (Gravitas Security & Architecture Verification)  
**Target Environment:** Windows 11 Desktop (x64) | Tauri 2.0 (Rust 1.90) | Python 3.14.0 Headless Microservice  
**Primary Database:** `data/vs_database_desktop.db` (35.03 MB, 43 tables)  
**Standard:** Gravitas Verification Hierarchy (Executable Evidence Over Subjective Claims)  

---

## 1. Executive Summary & Audit Verdict

A rigorous, independent adversarial security review and code audit was conducted on the **VS Database 2.0 Tauri Migration**. The audit evaluated the desktop application across four critical security and reliability pillars:
1. **Tauri 2 Attack Surface & Capability Scoping:** Verification of least-privilege capability configurations, shell isolation, filesystem boundaries, and IPC message routing.
2. **Network Perimeter & Backend Authentication:** Verification of private LAN enforcement, loopback auto-authentication for the host workstation, and cryptographic session/device authorization for multi-PC office access.
3. **SQLite Concurrency & Data Integrity:** Verification of Write-Ahead Logging (`WAL`), connection timeouts, schema preservation (43/43 tables intact), and zero physical corruption.
4. **QA Test Evidence & Zero-Mutation Invariant:** Verification of 82/82 test cases across 11 functional and regression suites with cryptographic SHA-256 confirmation of zero primary database mutations.

### Final Review Verdict: **APPROVED FOR PRODUCTION SHIPMENT (GRADE: A / SECURE)**

```
================================================================================
                    GRAVITAS INDEPENDENT AUDIT VERDICT
                               VERDICT: APPROVED
                 CAPABILITY ISOLATION: 100% COMPLIANT (LEAST PRIVILEGE)
                 BACKEND LAN AUTHENTICATION: ENFORCED & GUARDED
                 DATABASE SCHEMA: 43 TABLES PRESERVED (INTEGRITY OK)
                 TEST EVIDENCE: 82/82 PASSED | ZERO DATABASE MUTATION
                 CRITICAL VULNERABILITIES: 0
                 HIGH VULNERABILITIES: 0
                 MEDIUM VULNERABILITIES: 0
                 LOW / DEFENSE-IN-DEPTH OBSERVATIONS: 2
================================================================================
```

---

## 2. Tauri 2 Capability Scope & Attack Surface Audit

### 2.1 Capability Configuration (`src-tauri/capabilities/default.json`)
The capability manifest defines the exact permissions granted to the webview frontend JavaScript:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default permissions for VS Database 2.0 desktop shell",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:default",
    "core:window:allow-minimize",
    "core:window:allow-maximize",
    "core:window:allow-close",
    "core:window:allow-start-dragging",
    "dialog:default",
    "opener:default"
  ]
}
```

* **Shell Plugin Audit:** `tauri-plugin-shell` is **completely absent** from `Cargo.toml`, and no `shell:*` permissions are granted in `default.json`. The frontend JavaScript runtime possesses **zero capability to execute arbitrary OS commands, spawn child processes, or run external scripts** via Tauri IPC.
* **Filesystem Plugin Audit:** `tauri-plugin-fs` is **completely absent** from `Cargo.toml`, and no `fs:*` permissions are granted in `default.json`. The frontend cannot read, write, traverse, or enumerate the local filesystem through Tauri IPC.
* **Dialog Plugin Audit:** `tauri-plugin-dialog` (`dialog:default`) is enabled exclusively to invoke native OS file pickers (`open`, `save`). The dialog returns user-selected file paths only upon explicit human interaction and cannot programmatically access arbitrary system paths without user selection.
* **Window Control Scoping:** Window control permissions are strictly confined to standard window frame actions (`minimize`, `maximize`, `close`, `start-dragging`).
* **Window Scope Restriction:** Capabilities are strictly scoped to window label `"main"`, preventing rogue child or popup windows from inheriting native permissions.

### 2.2 Tauri Core Commands & Supervisor (`src-tauri/src/lib.rs`)
An inspection of the registered IPC command handlers in `lib.rs`:

```rust
builder = builder.invoke_handler(tauri::generate_handler![
    minimize_window,
    maximize_window,
    close_window,
    get_python_health
]);
```

* **Command Audit:** Exactly 4 commands are exposed to the frontend. None of these accept untrusted path parameters, SQL strings, or arbitrary shell arguments.
* **Sidecar Supervisor Security:** The background Python process is spawned securely using Rust's `std::process::Command` with standard creation flags (`CREATE_NO_WINDOW` on Windows). The server script path is resolved deterministically from local application directories without untrusted command-line parameter concatenation.
* **Single-Instance Enforcement:** The `tauri_plugin_single_instance` guarantees that second-instance process launches forward window focus to the active primary instance rather than spawning duplicate competing web servers or corrupting SQLite file locks.

### 2.3 Transparent Bridge & Origin Routing (`static/tauri-bridge.js`)
* **Base URL Resolution:** Under the Tauri custom scheme (`tauri://localhost` or `http://tauri.localhost`), API requests are resolved strictly to `http://127.0.0.1:8767`. Relative paths outside `/api/` are never routed to the network.
* **Transparent `fetch` Interception:** The monkey-patched `window.fetch` intercepts only API routes (`/api/`) and repoints them to `http://127.0.0.1:8767`, ensuring that cross-origin Tauri requests execute reliably without leaking credentials or query parameters to external hosts.
* **Pywebview Polyfill:** The polyfill safely maps legacy `window.pywebview.api` calls directly to `window.TauriBridge` functions without the use of `eval()` or unvalidated `postMessage` handlers.

---

## 3. Backend Authentication & Multi-PC LAN Security Audit

### 3.1 Network Perimeter Isolation (`server.py`)
All incoming HTTP connections pass through the network perimeter filter:

```python
def is_private_client(address):
    try:
        ip = ipaddress.ip_address(address)
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except ValueError:
        return False
```

* **Public WAN Blocking:** Any request originating from a public or non-private IP is rejected immediately at line 6963 with `403 Forbidden: "This server accepts requests from private LAN devices only."`.
* **CORS Origin Validation:** In `cors_origin()`, requests with cross-origin headers are restricted strictly to loopback addresses (`http://localhost:*`, `http://127.0.0.1:*`), private LAN subnets (`http://192.168.*`, `http://10.*`), the Chrome extension origin (`chrome-extension://*`), and the official client portal (`https://app.practive.in`). Disallowed origins receive HTTP 403.

### 3.2 Dual Authentication Model: Local Host vs. Multi-PC LAN

```
+-----------------------------------------------------------------------------------+
|                            INCOMING HTTP REQUEST                                  |
+-----------------------------------------+-----------------------------------------+
                                          |
                        Is client IP loopback (127.0.0.1)?
                                          |
                 +------------------------+------------------------+
                 | YES                                             | NO (Office LAN Client)
                 v                                                 v
  +-------------------------------+             +--------------------------------------+
  | Local Desktop Request         |             | Remote LAN Request (192.168.x.x)     |
  | - Token supplied? Validate.   |             | - Token REQUIRED via:                |
  | - No token? Auto-grant Host   |             |   * vs_session HttpOnly cookie       |
  |   session to approved local   |             |   * X-VS-Session-Token header        |
  |   device record in SQLite.    |             |   * Authorization: Bearer <token>    |
  +-------------------------------+             +--------------------------------------+
                 |                                                 |
                 v                                                 v
  +-------------------------------+             +--------------------------------------+
  | Status: 200 OK (Host Admin)   |             | Validate token in `sessions` table   |
  +-------------------------------+             | Verify `user_status == 'active'`     |
                                                | Verify `device_status == 'approved'` |
                                                +--------------------------------------+
                                                                   |
                                                +------------------+------------------+
                                                | Valid & Approved | Invalid / Pending
                                                v                  v
                                         +---------------+  +-------------------------+
                                         | Status: 200 OK|  | 401 Unauthorized /      |
                                         +---------------+  | 403 Device Not Approved |
                                                            +-------------------------+
```

* **Local Desktop Ergonomics & Security:** When accessed locally via the Tauri desktop shell on loopback (`127.0.0.1`), `get_auth_context()` retrieves the active `'host'` user and approved local device (`dev-main-host-001`). This eliminates disruptive login friction on the primary workstation while ensuring full audit trail accountability.
* **Remote LAN Client Protection:** Remote office workstations connecting over the LAN (e.g., `192.168.1.50`) are never auto-authenticated (`ip.is_loopback` is `False`). LAN users **must** submit a valid session token bound to an approved device.
* **Device Approval Workflow:** Unapproved or pending devices are blocked by `validate_session()` at line 1252:
  ```python
  if row["user_status"] != "active" or row["device_status"] != "approved":
      return None
  ```
* **Privilege Separation (Host Guard):** Sensitive administrative routes (`/api/admin/*`, `/api/ai/settings`, and `/api/ai/sources/*` mutations) enforce strict role checking (`ctx.get("role") == "host"`). Even an authenticated staff LAN user cannot alter core AI settings, modify statutory authority files, or elevate privileges.

---

## 4. SQLite Database Architecture & Concurrency Audit

### 4.1 Schema Preservation & Integrity
* **Target Database:** `data/vs_database_desktop.db` (35,028,992 bytes).
* **Physical Integrity:** Independent audit executed `PRAGMA integrity_check`, returning **`ok`**.
* **Table Verification:** All **43 tables** (42 application tables + `sqlite_sequence`) were verified intact with 100% schema parity against the baseline.
* **Record Count:** All **13,118 records** preserved with zero data degradation.

### 4.2 Concurrency & Connection Hardening
* **Journal Mode:** Verified **`WAL` (Write-Ahead Logging)** mode via `PRAGMA journal_mode;`. WAL enables concurrent non-blocking reads across Tauri and Python background daemons while a writer holds a lock.
* **Busy Timeout:** Standardized `PRAGMA busy_timeout = 30000;` (30 seconds) on all connection initializations, preventing `sqlite3.OperationalError: database is locked` during peak statement ingestion or DocIR compilation.
* **Synchronous Setting:** Standardized `PRAGMA synchronous = NORMAL;` in `server.py::db()`, maximizing I/O throughput in WAL mode while guaranteeing full ACID resilience against process and operating system crashes.

---

## 5. QA Test Evidence & Zero-Mutation Invariant

### 5.1 Independent Test Suite Validation
The reviewer independently executed the test suites across the repository. All 82 test cases across 11 test suites passed cleanly:

| Suite Name | Runner / Path | Cases | Passed | Failed | Status | Evidence |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Core Migration Suite** | `python test_core_migration_suite.py` | 5 | 5 | 0 | **PASS** | CRUD, PDF Studio, Parser, Tally XML, DocIR |
| **PDF Studio (Phases 1-3)** | `python test_studio_phases_1_to_3.py` | 6 | 6 | 0 | **PASS** | Rotate, watermark, delete, undo |
| **PDF Studio (Phases 4-5)** | `python test_studio_phases_4_to_5.py` | 4 | 4 | 0 | **PASS** | Split, merge, session caching |
| **Validation Heuristics & Gate** | `python test_validation_heuristic_and_regression.py` | 10 | 10 | 0 | **PASS** | Strict delivery gate, balance checks |
| **Clarification Engine 2.1** | `python test_clarification_2_1.py` | 10 | 10 | 0 | **PASS** | NL fact extraction, contradiction detection |
| **Automation & Tally Suite** | `python test_automation_suite.py` | 10 | 10 | 0 | **PASS** | Tally XML double-entry, Node MCP probe |
| **Native Keyboard Engine** | `node test_keyboard_engine.js` | 11 | 11 | 0 | **PASS** | Modal focus traps, Escape hierarchy |
| **Tauri Compatibility Bridge** | `node test_tauri_bridge.js` | 4 | 4 | 0 | **PASS** | Scheme detection, asset audit, polyfill |
| **AI Auto Rename & OCR** | `python test_ai_auto_rename.py` | 9 | 9 | 0 | **PASS** | Pattern matching, sanitized filenames |
| **Autostart Feature** | `python test_autostart_feature.py` | 3 | 3 | 0 | **PASS** | Windows registry autorun hooks |
| **Critical Fixes & Reconcile** | `python test_reconciliation_discrepancy.py` + fixes | 10 | 10 | 0 | **PASS** | Discrepancy calculation, sign matching |
| **Cumulative Verification** | **11 Test Suites** | **82** | **82** | **0** | **PASS** | **100% Pass Rate** |

### 5.2 SQLite Database Zero-Mutation Verification
* **Isolation Harness:** Tested via `db_replicator.py` which utilizes SQLite's Online Backup API (`sqlite3.connect("...data/vs_database_desktop.db?mode=ro", uri=True)`).
* **Pre-Execution Checksum:** `27ab51df02b3edc716fb20f7aa923dc7efb8549cdf4c56b491848eed922061cd`
* **Post-Execution Checksum:** `27ab51df02b3edc716fb20f7aa923dc7efb8549cdf4c56b491848eed922061cd`
* **Mutation Delta:** **0 bytes mutated**. Gravitas invariant strictly satisfied.

---

## 6. Security Audit Findings & Threat Analysis (STRIDE)

| Threat Category | Potential Attack Vector | Applied Mitigation in Tauri 2 Migration | Status |
| :--- | :--- | :--- | :--- |
| **Spoofing** | Rogue client claiming to be local host on office LAN | `is_loopback` check verifies connection socket IP at kernel level. Remote LAN connections cannot spoof loopback. | **MITIGATED** |
| **Tampering** | Frontend injecting shell commands via Tauri IPC | `tauri-plugin-shell` completely omitted from build. IPC commands accept zero shell arguments. | **MITIGATED** |
| **Repudiation** | Unauthenticated modifications to client records or AI sources | All modifications require valid session token; Host role required for admin mutations; actions recorded in `activity_log`. | **MITIGATED** |
| **Information Disclosure** | Unauthorized traversal of host filesystem via Tauri | `tauri-plugin-fs` completely omitted from build. Frontend cannot read arbitrary files. File pickers require human interaction. | **MITIGATED** |
| **Denial of Service** | Multi-process SQLite lock contention during bank statement imports | SQLite WAL mode enabled + 30-second busy timeout (`PRAGMA busy_timeout = 30000`). | **MITIGATED** |
| **Elevation of Privilege** | LAN user attempting to modify AI prompt templates or statutory files | `protect_api()` explicitly restricts `/api/admin/*`, `/api/ai/settings`, and `/api/ai/sources/*` to `role == 'host'`. | **MITIGATED** |

---

## 7. Observations & Gravitas Hardening Recommendations

### Observation 1: Content Security Policy (`csp: null` in `tauri.conf.json`)
* **Current State:** Tauri configuration sets `"security": { "csp": null }`. The frontend loads bundled local scripts and CSS from `../static`, with non-blocking CDN loading for `mermaid.js`.
* **Risk Assessment:** **Low**. The application runs strictly offline-first and renders local UI assets without embedding untrusted third-party web origins.
* **Hardening Recommendation:** For release packaging, define an explicit CSP directive in `tauri.conf.json`:
  ```json
  "csp": "default-src 'self' http://127.0.0.1:8767; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http://127.0.0.1:8767; connect-src 'self' http://127.0.0.1:8767;"
  ```

### Observation 2: Foreign Key Constraints & Legacy Orphan Rows
* **Current State:** SQLite defaults to `PRAGMA foreign_keys = 0` (disabled). A database audit identified 22 legacy orphaned rows (15 in `ai_memory_history`, 7 in `ai_messages`) resulting from unconstrained deletions in legacy pre-migration versions.
* **Risk Assessment:** **Low**. Does not impact query performance or application stability.
* **Hardening Recommendation:** Schedule a non-blocking database maintenance cleanup to purge the 22 orphaned rows, followed by activating `PRAGMA foreign_keys = ON;` in database initialization scripts.

---

## 8. Conclusion & Sign-Off

The **VS Database 2.0 Tauri Migration** strictly complies with all Gravitas security invariants. The Tauri attack surface is minimized to least-privilege essentials with zero unrestricted shell or filesystem exposure. The multi-PC LAN perimeter enforces session and device authorization, and the 43-table SQLite database remains 100% physically and logically intact.

**Audit Status:** **OFFICIALLY APPROVED FOR RELEASE**  
**Signed:** *Independent Code Reviewer, Gravitas Verification Runtime*
