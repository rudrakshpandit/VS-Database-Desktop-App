# VS Database 2.0 — Installation, Uninstallation & Controlled Rollback Guide
**Project:** VS Database 2.0 — Tauri Migration  
**Target Release:** 2.0.0 (Windows 10/11 x64)  
**Installer Package:** `VS Database_2.0.0_x64-setup.exe` (141.51 MiB, NSIS)  
**Governance Authority:** Main Chat (CEO + CTO + Principal Senior Developer)  
**Safety Protocol:** Strict Zero-Data-Loss & Record-Level Boundary  
**Date:** November 2026 (Revised Post-Audit Phase 13A)  

---

## 1. System Requirements & Prerequisites
1. **Operating System:** Windows 10 (version 1809+) or Windows 11 64-bit.
2. **Runtime Engine:** Microsoft Edge WebView2 Evergreen Runtime (pre-installed on modern Windows; verified by installer).
3. **Python Runtime:** **NONE REQUIRED.** The application sidecar (`server_sidecar.exe`) is pre-compiled as a standalone binary with all 28 Python dependencies, native C extensions (PyMuPDF, cryptography, greenlet), and DLLs bundled.
4. **Office Network (LAN Mode):** Ethernet or Wi-Fi connected to the office local area network (`192.168.1.0/24`).

---

## 2. Release Package Hashes (Forensic Verification)

Prior to installation on any workstation, independently verify SHA-256 integrity:

| Artifact | File Size | SHA-256 Checksum |
| :--- | :--- | :--- |
| `VS Database_2.0.0_x64-setup.exe` | 141.51 MiB | `9D50002CCF7A76901EEC0E7AEFC6A4425E416C336F149FB5ADFF7E22B3BEF8E1` |
| `vs-database.exe` (Tauri Main Shell) | 51.67 MiB | `6F6B99966E3857446A879B8D09808EFA28698340EBFF0081799963D61D22736B` |
| `server_sidecar.exe` (Backend Sidecar) | 108.84 MiB | `B638B92483A9BF55FE918D315D9A8055BCCD0624E0F20DD95E2A3773409301AB` |

Verify via PowerShell:
```powershell
Get-FileHash "VS Database_2.0.0_x64-setup.exe" -Algorithm SHA256
```

---

## 3. Installation Procedure

### For Host Station (Staging Primary PC):
1. Copy `VS Database_2.0.0_x64-setup.exe` to the Host PC.
2. Run the NSIS setup installer.
3. Follow the setup wizard:
   - Default installation directory: `%LOCALAPPDATA%\Programs\VS Database`
   - Data & Working Database directory: `%LOCALAPPDATA%\vs-database\data\`
4. Launch the application from the desktop shortcut:
   - The frameless glassmorphic native shell opens.
   - The background supervisor automatically starts `server_sidecar.exe` on port `8767` with a dynamic cryptographically random handshake token.
   - The application binds to both `127.0.0.1:8767` and your physical LAN IP (e.g., `192.168.1.50:8767`).

---

## 4. Multi-PC LAN Client Configuration (Staff Workstations)

1. Ensure the Host PC is running VS Database.
2. Open a modern web browser (Edge, Chrome, Brave) on any staff PC connected to the office LAN.
3. Navigate to:
   ```text
   http://<HOST_IP>:8767
   ```
   *(Example: `http://192.168.1.50:8767`)*
4. First-time connection prompt:
   - The device will prompt for staff authentication.
   - Device pairing and session creation are recorded in `sessions` and `devices` tables.
   - Upon authentication, full access to Client records, PDF Studio, File Router, and Document Studio is enabled.
5. **Host UI Decoupling Protection (DEF-003):**
   - The Host operator may close the desktop window at any time.
   - If staff members have active sessions, the Python backend **will NOT terminate**. It remains running in the background to serve office workstations.
   - To completely stop the server, use the in-app "Exit & Stop Server" menu command from the host, or close the window when no staff workstations are connected.

---

## 5. Uninstallation Procedure & Data Safety

> [!IMPORTANT]
> **Data Preservation Rule:** Uninstallation of the application binaries **must NEVER silently delete or alter user databases, backup archives, or persistent business data**.

To cleanly remove the application binaries without risking data loss:
1. Open Windows **Settings** -> **Apps** -> **Installed apps**.
2. Locate **VS Database** and select **Uninstall**.
3. Confirm uninstallation. The NSIS uninstaller will remove:
   - The Tauri binary executable (`vs-database.exe`)
   - The bundled Python sidecar (`server_sidecar.exe`)
   - Shortcuts, registry keys, and installation dependencies.
4. **Preservation of Staging / User Data:**
   - The database, logs, and backup archives located in `%LOCALAPPDATA%\vs-database\data\` are **retained by default**.
   - If manual deletion of staging test data is desired, it must be performed as an explicit manual administrative action only after verifying no required records exist:
     ```powershell
     # ONLY perform after administrative verification:
     # Remove-Item -Recurse -Force "%LOCALAPPDATA%\vs-database\data"
     ```

---

## 6. Immediate Rollback to Legacy Application (Zero-Risk)

> [!CAUTION]
> **ABSOLUTE RULE:** Immediate rollback to the legacy application involves **ONLY switching the running process**. 
> **NEVER copy, replace, or overwrite the production SQLite database file.**

Because the original application at [`D:\AntiGravity Automation\VS Desktop App`](file:///D:/AntiGravity%20Automation/VS%20Desktop%20App) remained **100% read-only and untouched** throughout development and staging, rollback is instantaneous, completely safe, and guarantees zero data corruption.

### Step 1: Terminate Any Running Tauri & Sidecar Processes
```powershell
Get-Process -Name "vs-database", "server_sidecar" -ErrorAction SilentlyContinue | Stop-Process -Force
```

### Step 2: Launch the Untouched Original Application
Navigate to the original untouched application directory and run the launcher:
```powershell
cd "D:\AntiGravity Automation\VS Desktop App"
.\Run_VS_Database.bat
```
The legacy Python 3 + pywebview application will immediately launch on port `8767` with its historical database records, schemas, and configurations 100% intact.

---

## 7. Controlled Record-Level Production Data Migration Protocol

> [!WARNING]
> **CRITICAL ARCHITECTURAL DIRECTIVE:**
> **Automated or manual full-database file copying (`Copy-Item staging.db production.db`) is STRICTLY PROHIBITED.**
> Full-database replacement destroys live production transactions, introduces unverified foreign-key inconsistencies, and violates SQLite WAL safety.

If operational test records or newly created client files were generated during staging that management approves to migrate into the legacy production database, the following **controlled record-level migration procedure** must be followed:

### Pre-Requisites & Management Sign-Off
1. Migration must be authorized in writing by the System Owner / Operations Manager.
2. Both staging and production applications must be completely stopped before starting.

### Step-by-Step Controlled Migration Workflow

#### 1. Pre-Migration Backups with SHA-256 Certification
Before touching any table, create verified timestamped backups of both databases:
```powershell
# 1. Truncate WAL journal on production DB
python -c "import sqlite3; c=sqlite3.connect(r'D:\AntiGravity Automation\VS Desktop App\data\vs_database_desktop.db'); c.execute('PRAGMA wal_checkpoint(TRUNCATE);'); c.close()"

# 2. Create certified pre-migration backup
Copy-Item "D:\AntiGravity Automation\VS Desktop App\data\vs_database_desktop.db" "D:\AntiGravity Automation\VS Desktop App\data\vs_database_pre_migration_backup.bak"

# 3. Record hash
Get-FileHash "D:\AntiGravity Automation\VS Desktop App\data\vs_database_pre_migration_backup.bak" -Algorithm SHA256
```

#### 2. Schema Comparison & Drift Analysis
Execute a table-by-table schema comparison between production and staging:
- Compare all table columns, data types, primary keys, and indexes.
- Ensure that no schema discrepancies exist between production (42 tables) and staging.

#### 3. Selective Record-Level Extraction & Insertion
Rather than copying database files, extract only the specific newly created business entities (e.g., new clients, client files) using structured queries:
```sql
-- Example: Identifying only newly created clients in staging not present in production
SELECT client_id, client_name, client_code, status, created_at, updated_at
FROM staging_db.clients
WHERE client_id NOT IN (SELECT client_id FROM prod_db.clients);
```

#### 4. Conflict & Duplicate Detection
- Verify that candidate records do not conflict with existing production Primary Keys (`client_id`, `id`, `file_id`).
- Verify that unique constraints (e.g. `pan_number`, `client_code`) are not violated.
- Reject any conflicting candidate records and log them for manual review.

#### 5. Foreign-Key Integrity Verification
Ensure that any new child records (e.g., documents, folders, sessions) reference valid, existing parents in the production database:
```sql
PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
```
Verify that the foreign-key check reports zero new violations and that the **22 legacy orphan records** remain exactly at their historical baseline count.

#### 6. Atomic Transactional Insertion & WAL Truncation
Insert approved records within a single atomic SQLite transaction:
```python
with sqlite3.connect(prod_db_path) as conn:
  conn.execute("PRAGMA foreign_keys = ON;")
  conn.execute("BEGIN TRANSACTION;")
  # Execute record-level insertions
  # ...
  conn.commit()
  conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
```

#### 7. Post-Migration Reconciliation & Integrity Audit
Verify post-migration integrity:
1. `PRAGMA integrity_check` returns `ok`.
2. Exact count of migrated records matches the pre-approved record manifest.
3. Legacy production records are completely unmodified.

#### 8. Rollback Protocol for Data Migration
If any anomaly or foreign-key failure is detected during or after data migration:
1. Immediately stop the application.
2. Restore the production database from the certified pre-migration backup:
   ```powershell
   Copy-Item "D:\AntiGravity Automation\VS Desktop App\data\vs_database_pre_migration_backup.bak" "D:\AntiGravity Automation\VS Desktop App\data\vs_database_desktop.db" -Force
   ```
3. Verify that the production SHA-256 hash matches the pre-migration baseline.
