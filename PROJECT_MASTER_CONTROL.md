# PROJECT MASTER CONTROL: VS DATABASE 2.0
## Executive Architecture, Multi-Agent Governance & Production Ledger

**Project Name:** VS Database 2.0 — Tauri Migration  
**Governance Authority:** Main Chat (CEO + CTO + Principal Senior Developer + Multi-Agent Orchestrator)  
**Workspace Root:** `D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration`  
**Original Application Root:** `D:\AntiGravity Automation\VS Desktop App` *(Read-Only Baseline)*  
**Current Branch:** `migration/tauri-v2`  
**Latest Verified Commit:** `c61698a`  
**Current Phase:** Phase 11 Complete / Awaiting Phase 12 Authorization  
**Operational Framework:** Gravitas Verification Hierarchy & Antigravity Native Specialist Swarm

---

## 1. System Architecture Overview

VS Database 2.0 replaces the legacy Python + `pywebview` + localhost HTTP desktop stack with a modern, high-performance, and secure **Tauri 2 + Rust + Python Standalone Sidecar** architecture.

```mermaid
flowchart TD
    subgraph DesktopShell["Tauri 2 Desktop Shell (Rust - vs-database.exe)"]
        NativeWindow["Frameless Glassmorphic Window (WebView2)"]
        Supervisor["Supervisor & Process Monitor"]
        IPCHandshake["Loopback Token Injection (X-VS-Handshake-Token)"]
        LifecycleManager["Lifecycle & UI Detach Controller"]
    end

    subgraph Frontend["Frontend Client Layer"]
        HTML["index.html + Glassmorphic CSS"]
        AppJS["app.js + Feature Modules"]
        TauriBridge["tauri-bridge.js (IPC & File Dialogs)"]
    end

    subgraph Sidecar["Standalone Backend Sidecar (server_sidecar.exe - PyInstaller)"]
        ServerCore["server.py (HTTP Router / Zero-Trust Loopback)"]
        AuthContext["Auth Context & Token Verifier"]
        Engines["Engines: PDF Studio, DocIR, Automation, VS-AI"]
        ExtIntegrations["Integrations: Tally Prime XML/MCP, Gemini AI, Google Drive"]
    end

    subgraph Storage["Data Tier (Strict Isolation)"]
        PrimaryDB[("vs_database_desktop.db (SQLite WAL)")]
        ForensicDB[("vs_database_desktop_forensic_28rows.db")]
        IsolatedTestDB[("Isolated Test Replicas (db_replicator.py)")]
    end

    NativeWindow --> Frontend
    Frontend -->|HTTP / Handshake Token| ServerCore
    Supervisor -->|Spawns & Supervises| Sidecar
    Supervisor -->|Lifecycle Query| LifecycleManager
    ServerCore --> AuthContext
    AuthContext --> Engines
    Engines --> Storage
    ServerCore -->|LAN Connections (Token Auth)| ExternalLAN["Office LAN Clients & Chrome Companion"]
```

### Architectural Key Characteristics:
1. **Host-Decoupled IPC & Zero-Trust Localhost:** Localhost requests must supply an ephemeral `X-VS-Handshake-Token` generated at launch by the Rust supervisor or provide a cryptographically verified session token. Local processes cannot access privileged routes without credentials (`SEC-001`).
2. **Self-Contained Backend Sidecar:** The Python backend is frozen into a 108.8 MB standalone binary (`server_sidecar.exe`) containing all 28 project dependencies and native DLLs. Clean workstations do not require Python to be installed (`DEF-002`).
3. **Office LAN & Companion Lifecycle Decoupling:** Closing the Tauri desktop window checks `/api/desktop/lifecycle-policy`. If LAN clients or the companion browser extension are active, the UI issues a detach signal, leaving the sidecar running as a network service (`DEF-003`).
4. **ComCtl32 v6 Embedded Manifest:** The native executable embeds an application manifest declaring `Microsoft.Windows.Common-Controls` v6.0.0.0, resolving `TaskDialogIndirect` natively on Windows 10/11 (`DEF-001`).
5. **Database Immutability Protocol:** The original production database remains strictly untouched. Tests run exclusively against ephemeral replicas via `db_replicator.py` (`DAT-001`).

---

## 2. Multi-Agent Organization & Responsibilities

The Main Chat retains single-point executive and engineering accountability. Specialist agents are defined and deployed via Antigravity native sub-agent capabilities:

| Specialist Role | Agent Type | Primary Scope & Responsibilities |
|---|---|---|
| **CTO / System Architect** | `system_architect` | Architectural boundaries, API route mapping, system dependencies, component contracts |
| **Senior Frontend Developer** | `frontend_engineer` | UI/UX, glassmorphism, DOM, keyboard navigation, `tauri-bridge.js`, IPC wrappers |
| **Senior Python Backend Developer** | `python_backend_engineer` | `server.py`, business engines, DocIR, PDF Studio, Tally Prime integration, Google sync |
| **Senior Rust / Tauri Developer** | `rust_tauri_engineer` | `src-tauri` shell, window controls, process supervision, lifecycle hooks, OS integration |
| **Database Engineer** | `sql_database_engineer` | SQLite schema, WAL mode, transaction safety, replication isolation, forensic audits |
| **Security Engineer** | `security_reviewer` | Zero-trust localhost, CORS policies, handshake tokens, session auth, deep links |
| **QA Automation Engineer** | `qa_engineer` | Automated test suites, isolated DB replication testing, regression verification |
| **DevOps / Release Engineer** | `devops_release` | PyInstaller sidecar freezing, NSIS installers, Windows DLL bundling, clean PC verification |
| **Independent Code Reviewer** | `code_reviewer` | Strict independent verification of implementation diffs, preventing self-certified regressions |

---

## 3. Project Phase Roadmap

| Phase | Description | Status | Verification Reference |
|---|---|---|---|
| **Phase 1** | Protect & Duplicate Existing Application | **VERIFIED** | SHA-256 bitwise file verification; Read-Only enforcement |
| **Phase 2** | Orchestration & Multi-Agent Architecture | **VERIFIED** | Native sub-agent definitions & Gravitas reasoning runtime |
| **Phase 3** | Technical Audit & Route Inventory | **VERIFIED** | `AUDIT_REPORT.md` (225 routes inventoried) |
| **Phase 4** | Database Schema Audit & Replication Safe Guard | **VERIFIED** | `DATABASE_AUDIT_REPORT.md` (42 tables, `db_replicator.py`) |
| **Phase 5** | Tauri 2 Desktop Shell & Frontend Adaptation | **VERIFIED** | `src-tauri` initialized, glassmorphic window, `tauri-bridge.js` |
| **Phase 6** | Functional Regression Testing | **VERIFIED** | `FUNCTIONAL_TEST_REPORT.md` (82/82 functional tests passed) |
| **Phase 7** | Non-Regressive Core Business Verification | **VERIFIED** | `REGRESSION_TEST_REPORT.md` (DocIR, PDF Studio, Tally XML) |
| **Phase 8** | Security Audit & Threat Modeling | **VERIFIED** | `SECURITY_REVIEW.md` |
| **Phase 9** | Documentation & Packaging Pre-Flight | **VERIFIED** | `KNOWN_ISSUES.md`, installation manifests |
| **Phase 10** | Production Readiness & Forensic Verification Audit | **VERIFIED** | `PHASE_10_PRODUCTION_READINESS_AUDIT.md` (Uncovered DEF-001..003) |
| **Phase 11** | Critical Blocker Remediation | **VERIFIED** | `PHASE_11_BLOCKER_REMEDIATION_REPORT.md` (Commit `c61698a`) |
| **Phase 12** | Controlled Office Staging & Pilot Deployment | **PENDING** | *Awaiting User Explicit Authorization* |
| **Phase 13** | Production Multi-Workstation Rollout | **PLANNED** | End-of-project final delivery |

---

## 4. Phase 11 Remediations & Technical Decisions Ledger

### Architectural Decisions (ADR):
1. **ADR-01: Common-Controls v6 Manifest Binding (DEF-001)**
   - *Problem:* Windows failed to find `TaskDialogIndirect` in legacy `comctl32.dll`.
   - *Decision:* Embed Microsoft Common-Controls v6 manifest directly into `vs-database.exe`.
   - *Result:* 0 missing symbols across all 425 imports; clean GUI launch without dialog errors.
2. **ADR-02: `windows_slim_errors` Rustcfg (DEF-001)**
   - *Problem:* `RoOriginateErrorW` missing in Windows 11 `api-ms-win-core-winrt-error-l1-1-0.dll` (`0xC0000139`).
   - *Decision:* Add `[build] rustflags = ["--cfg", "windows_slim_errors"]` to `src-tauri/.cargo/config.toml`.
   - *Result:* Bad symbol linkage eliminated completely.
3. **ADR-03: Frozen PyInstaller Standalone Sidecar (DEF-002)**
   - *Problem:* Clean workstations lack Python environments.
   - *Decision:* Freeze backend into standalone executable `dist/server_sidecar.exe` (108.8 MB) with embedded project dependencies.
   - *Result:* Backend runs autonomously on clean Windows machines.
4. **ADR-04: Dynamic Lifecycle Polling & Detached Daemon (DEF-003)**
   - *Problem:* Closing UI terminated backend while office LAN / Chrome companion needed it.
   - *Decision:* Tauri supervisor queries `/api/desktop/lifecycle-policy`. If LAN clients are active or LAN mode enabled, supervisor sends UI detach signal and leaves sidecar running.
   - *Result:* LAN workflows and companion extension uninterrupted.
5. **ADR-05: Ephemeral Handshake Token (SEC-001..003)**
   - *Problem:* Untrusted local processes could make unauthenticated calls to `127.0.0.1:8767`.
   - *Decision:* Rust supervisor generates cryptographically random token, passes it via `--handshake-token`, and verifies `X-VS-Handshake-Token`. Whitelist exact CORS origins.
   - *Result:* Untrusted local web apps and rogue Chrome extensions blocked with `401 Unauthorized`.
6. **ADR-06: Forensic Preservation of 28 Test Rows (DAT-001)**
   - *Problem:* 28 rows were added during early tests.
   - *Decision:* Archived `vs_database_desktop_forensic_28rows.db` (13,143 rows). Restored pristine primary DB (13,115 user rows, SHA-256 `bb174147...`).
   - *Result:* 100% data preservation and strict test isolation via `db_replicator.py`.

---

## 5. Verified Artifacts & Binary Inventory

| Artifact Path | Size / Details | SHA-256 / Checksum | Status |
|---|---|---|---|
| `src-tauri/target/release/vs-database.exe` | Tauri 2 Native GUI Shell | Verified PE Imports (425/425 resolved) | **VERIFIED / OPERATIONAL** |
| `dist/server_sidecar.exe` | Standalone Python Backend | 108.8 MB (114,132,846 bytes) | **VERIFIED / OPERATIONAL** |
| `src-tauri/binaries/server_sidecar-x86_64-pc-windows-gnu.exe` | Tauri External Binary Replica | 108.8 MB (114,132,846 bytes) | **VERIFIED / OPERATIONAL** |
| `data/vs_database_desktop.db` | Primary Production Database | `bb174147080b39c53729fdc0f167c6f97992d7384876c3d4daefcaf22122afff` | **PRISTINE (13,115 rows)** |
| `data/vs_database_desktop_forensic_28rows.db` | Forensic Preservation DB | `24c671e2d22000a2d998a0c9230fb0e57d21a2e324cd47128bf40f15ce3a1672` | **ARCHIVED (13,143 rows)** |

---

## 6. Phase 12 Controlled Office Pilot Results

Phase 12 completed on `pilot/office-staging` branch:
- **Clean Windows Execution:** PASS (No external Python required; sidecar starts autonomously).
- **LAN Protocol & Lifecycle Decoupling:** PASS (Interface binding `0.0.0.0:8767`; `can_terminate = false` protects active LAN workstations during host UI closure; UI reconnects cleanly).
- **Second Physical Device:** NOT TESTED (Single-host lab workstation; requires staging on office hardware).
- **Deep Security Matrix:** PASS (9/9 vectors PASS; unauthenticated requests, rogue ports, rogue extension IDs, and direct POST shutdown bypass all rejected with HTTP 401).
- **Core Business Workflows:** PASS (5/5 core migration tests, 10/10 automation/Tally tests, 8/8 workstream tests pass; fixed `vs_ai_engine.py` latent `NameError`).
- **Data Integrity & Backups:** PASS (13,115 rows across 42 tables verified; 22 legacy orphan rows match baseline 100%; encrypted `.vsbackup` created and verified).
- **Process Memory Profile:** PASS (Native Tauri shell: 58.55 MB; Sidecar: 114.61 MB; Total true tree inc. WebView2: 701.98 MB).

---

## 7. Current Project Status & Readiness

- **Workspace:** `D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration`
- **Active Branch:** `pilot/office-staging`
- **Baseline Branch:** `migration/tauri-v2` (`c61698a`)
- **Database Safety:** Zero mutations to primary databases during testing (SHA-256: `bb1741...`).
- **Original Application:** Untouched, read-only at `D:\AntiGravity Automation\VS Desktop App`.
- **Current Gate:** Phase 12 complete with Qualified Pass. Ready for On-Premise Staging / Phase 13 Rollout upon user authorization.
