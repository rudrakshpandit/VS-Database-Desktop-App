# PHASE 15B — HOST VS. CLIENT PRODUCT FEATURE COMPARISON

**Project:** VS Database 2.0 — Tauri Migration  
**Architecture Reference:** ADR-015 (`ADR_015_HOST_CLIENT_OFFLINE_ARCHITECTURE.md`)  
**Product Version:** 2.0.0  
**Date:** 2026-11-04  

---

## 1. Architectural Role Overview

| Dimension | VS Database Host (`VS Database Host Setup.exe`) | VS Database Client (`VS Database Client Setup.exe`) |
| :--- | :--- | :--- |
| **Primary Role** | Central Authority, Authoritative Database, API Gateway, Backup Master | Office Staff Workstation Application, Remote Business Client |
| **Deployment Target** | Single Designated Host PC (`192.168.1.50`) | Multiple Staff Workstations (`192.168.1.6`, `192.168.1.120`, etc.) |
| **Executable Name** | `vs-database.exe` (Title: "VS Database Host") | `vs-database.exe` (Title: "VS Database Client") |
| **Default Install Directory** | `%LOCALAPPDATA%\VS Database Host` | `%LOCALAPPDATA%\VS Database Client` |
| **Installer Size** | **141.53 MiB** (148,402,260 bytes) | **33.68 MiB** (35,316,335 bytes) — **76.2% smaller** |
| **Python Sidecar Included** | **YES** (`server_sidecar.exe` — 108.84 MiB) | **NO** (Strictly excluded from bundle and installer) |
| **Python Processes Spawned** | Yes (Background multi-threaded HTTP server) | **Zero (0)** (No sidecars or python processes launched) |
| **Authoritative Local DB** | **YES** (`vs_database_v2.db` with WAL mode) | **NO** (Never creates or maintains local business DB) |
| **Listening Network Port** | Default `0.0.0.0:8768` (Configurable LAN Host) | None (Outbound HTTP client only) |

---

## 2. Detailed Capability & Security Comparison Matrix

| Feature / Capability | VS Database Host | VS Database Client | Architecture Constraint (ADR-015) |
| :--- | :---: | :---: | :--- |
| **Central Business Data Authority** | Full | None | Host is sole authority for all records |
| **Record Creation, Update, Deletion** | Local & Authoritative | Remote via Host API | Client sends all mutations to Host |
| **Offline Operation Mode** | Central Server (Always Local) | Read-Only Encrypted Cache | Client cannot write while disconnected |
| **Offline Cache Storage** | Authoritative SQLite Database | AES-GCM-256 Encrypted Storage | Client decrypts using device-bound key |
| **Offline Mutation Policy** | Standard DB Transactions | **Blocked & Locked in UI** | **Zero mutation queue; NO replay on reconnect** |
| **Cache Expiration (TTL)** | Persistent | **12-Hour Enforced TTL** | Stale cache purged automatically |
| **Device Pairing & Administration** | Issues 6-Digit One-Time PINs | Claims PIN to acquire Token | Secure handshake prevents rogue access |
| **Device Access Revocation** | Host Admin Revocation UI | Instant Rejection (401/403) | Revoked device immediately purges session |
| **Central Automated Backups** | Active (Hourly snapshots & WAL) | Blocked | Clients never execute DB backups |
| **Tally Integration & Posting** | Active on Host (LAN Tally bridge) | Proxied through Host API | Centralized accounting sync |
| **Background Cron & Automation Jobs** | Active on Host Sidecar | None | Sidecar jobs only run on central Host |
| **Graceful Desktop Window Lifecycle** | Preserves Host API for LAN | Quits instantly on window close | Client window destruction does not kill Host |
| **Legacy App (Port 8767) Isolation** | Complete (Runs on port 8768) | Complete (Connects to Host port) | Port 8767 strictly reserved for legacy app |

---

## 3. Product Boundary Verification

### 3.1. What Happens When Client Loses Network?
1. `VSOfflineManager` detects 2 consecutive heartbeat failures within 4.0 seconds.
2. The UI switches to `OFFLINE` status:
   - Top amber warning banner: *"OFFLINE READ-ONLY MODE: Host unreachable. Modifying records is prohibited."*
   - All mutation buttons ("Add Client", "Save Changes", "Delete", "Import") are disabled in DOM.
   - Any programmatic `POST`, `PUT`, `DELETE` is intercepted and rejected with an explanatory error.
3. Cached client records decrypted from AES-GCM-256 storage display an amber `POTENTIALLY STALE` warning badge.
4. When connectivity restores, the Client revalidates its session token with the Host. **No offline writes are queued, stored, or replayed.**

### 3.2. What Happens When Host UI is Closed?
1. The Host Rust supervisor checks `can_shutdown_backend()`.
2. If LAN client connections are active or companion mode is enabled, the backend Python sidecar remains alive in the background on port 8768 to service office workstations.
3. If no active clients are connected and shutdown is confirmed, a graceful SIGTERM/shutdown signal is sent via `/api/desktop/shutdown`.

---

## 4. Conclusion

The dual-product packaging guarantees strict compliance with ADR-015:
- **VS Database Host** provides complete central authority, database management, backups, and pairing controls.
- **VS Database Client** provides lightweight, secure, and sidecar-free workstation access with hardened offline read-only capabilities and zero local business database risk.
