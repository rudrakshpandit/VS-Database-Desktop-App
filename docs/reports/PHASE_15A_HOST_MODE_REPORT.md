# PHASE 15A — HOST MODE ARCHITECTURE & CENTRAL AUTHORITY REPORT

**Project:** VS Database 2.0 — Tauri Migration  
**Architecture Specification:** ADR-015  
**Designated Host Authority:** Primary Host PC (`192.168.1.50`, Port `8768`)  
**Database File:** `D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration\data\vs_database_desktop.db`  
**Status:** **CERTIFIED OPERATIONAL**

---

## 1. Host Role & Responsibilities

In compliance with **ADR-015 Section 3**, the Host system is the sole authoritative custodian of business operations:
1. **Authoritative SQLite Database:** Operates `vs_database_desktop.db` in Write-Ahead Logging (`WAL`) mode with full ACID transaction guarantees and foreign key enforcement.
2. **Centralized API Service:** Hosts the Python backend sidecar bound to port `8768` (physical interface `0.0.0.0:8768`).
3. **Identity & Session Gateway:** Validates all client device identities (`X-VS-Device-Id`), issues cryptographic session tokens, and maintains the `sessions` table.
4. **Device Pairing Authority:** Generates cryptographically secure 6-digit one-time PINs with 5-minute expiries for registering new office workstations.
5. **Instant Revocation Authority:** Immediately marks devices as `revoked` in `devices` and revokes all active sessions in `sessions`, causing subsequent API requests to fail with HTTP 403 Forbidden.
6. **Central Audit Trails:** Logs all administrative and business operations in `activity_log` and `ai_audit_log`.
7. **Automated Backups:** Manages scheduled 60-minute automated database backups to the central backup vault.

---

## 2. Host CLI & Startup Configuration

The backend `server.py` was enhanced to support the explicit `--host-mode` flag:

```python
HOST_MODE = "--host-mode" in sys.argv or "--host" in sys.argv or os.environ.get("VS_HOST_MODE") in ("1", "true", "True")

def _resolve_port():
    for _i, _arg in enumerate(sys.argv):
        if _arg in ("--port", "-p") and _i + 1 < len(sys.argv) and sys.argv[_i + 1].isdigit():
            return int(sys.argv[_i + 1])
        if _arg.startswith("--port=") and _arg.split("=", 1)[1].isdigit():
            return int(_arg.split("=", 1)[1])
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        return int(sys.argv[1])
    if "PORT" in os.environ and os.environ["PORT"].isdigit():
        return int(os.environ["PORT"])
    return 8768 if HOST_MODE else 8767

PORT = _resolve_port()
```

When launched with `--host-mode`, the backend defaults to port `8768`, preventing port collisions with the legacy application on port `8767`.

---

## 3. Host API Endpoint Verification

The following endpoints were verified during Phase 15A automated testing:

### 3.1. Health Check (`GET /api/desktop/health`)
- **URL:** `http://127.0.0.1:8768/api/desktop/health`
- **Response:**
  ```json
  {
    "ok": true,
    "service": "VS Database Desktop",
    "version": "2.0.0",
    "port": 8768,
    "status": "ready",
    "mode": "host",
    "host_mode": true,
    "central_authority": true
  }
  ```
- **Verification:** Certified in Gate 1 test execution.

### 3.2. Host Status (`GET /api/host/status`)
- **URL:** `http://127.0.0.1:8768/api/host/status`
- **Response:**
  ```json
  {
    "ok": true,
    "host_mode": true,
    "port": 8768,
    "central_authority": true,
    "active_sessions": 106,
    "registered_devices": 25,
    "server_time": "2026-11-03T10:30:49+00:00"
  }
  ```
- **Verification:** Certified in Gate 1 test execution.

### 3.3. Device Pairing Endpoints
- `POST /api/host/pairing/generate-pin`: Generates 6-digit PIN with 300-second expiration.
- `POST /api/host/pairing/claim-pin`: Validates and marks PIN used, registers device, returns session token.
- `POST /api/host/devices/revoke`: Revokes device ID and associated sessions.
- `GET /api/host/devices`: Lists all registered devices and approval statuses.

---

## 4. Concurrency & Database Safety

Host database integrity was verified under multi-client concurrency in Gate 9:
- **Concurrent Readers:** 5 worker threads executing 75 total requests simultaneously.
- **Failures / Lock Errors (`SQLITE_BUSY`):** Exactly 0.
- **Database Journal Mode:** `wal` (verified via `PRAGMA journal_mode;`).
- **Database Integrity:** `ok` (verified via `PRAGMA integrity_check;`).

---

## 5. Certification Verdict

**VERDICT: PASS — HOST MODE OPERATIONAL AS CENTRAL AUTHORITATIVE HUB**
