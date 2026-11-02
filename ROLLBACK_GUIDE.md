# VS Database 2.0 — Disaster Recovery & Rollback Guide

---

## 1. Absolute Preservation Principles

Because **Phase 1** enforced strict isolation and read-only protection of the original application, rollback to the legacy Python/pywebview application is instantaneous and risk-free:
1. **Original Project is Untouched:**
   - Directory: [`D:\AntiGravity Automation\VS Desktop App`](file:///D:/AntiGravity%20Automation/VS%20Desktop%20App)
   - The original code, launchers (`Run_VS_Database.bat`), PyInstaller binaries (`VS_Database.exe`), and configurations were **never edited, renamed, or modified**.
2. **Production Database is Untouched:**
   - The live production SQLite database in [`D:\AntiGravity Automation\VS Desktop App\data\vs_database_desktop.db`](file:///D:/AntiGravity%20Automation/VS%20Desktop%20App/data/vs_database_desktop.db) was preserved in its pristine state.
   - All migration testing used isolated replicas created with [`db_replicator.py`](file:///D:/AntiGravity%20Automation/VS%20Database%202.0%20-%20Tauri%20Migration/db_replicator.py).

---

## 2. Immediate Rollback Procedures

If an unresolvable issue occurs with the Tauri 2 build during operational evaluation:

### Step 1: Terminate Any Running Tauri 2 Processes
Open PowerShell and terminate any running Tauri or sidecar instances:
```powershell
Get-Process -Name "vs-database", "pythonw" -ErrorAction SilentlyContinue | Where-Object { $_.Path -match "Tauri Migration" } | Stop-Process -Force
```

### Step 2: Relaunch Original VS Database Desktop App
Simply run the original batch launcher:
```powershell
cd "D:\AntiGravity Automation\VS Desktop App"
.\Run_VS_Database.bat
```
The legacy Python 3 + pywebview application will launch immediately on port 8767 with all historical records and settings intact.

---

## 3. Data Synchronization Check (If Migrated DB was Used)

If the migrated database in `VS Database 2.0 - Tauri Migration/data/vs_database_desktop.db` accumulated new client records during testing that need to be merged back into the legacy app:
1. Verify database integrity using `PRAGMA integrity_check`:
   ```powershell
   python -c "import sqlite3; con = sqlite3.connect(r'D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration\data\vs_database_desktop.db'); print(con.execute('PRAGMA integrity_check;').fetchall())"
   ```
2. Create a timestamped backup before any transfer:
   ```powershell
   Copy-Item "D:\AntiGravity Automation\VS Desktop App\data\vs_database_desktop.db" "D:\AntiGravity Automation\VS Desktop App\data\vs_database_desktop_pre_rollback.bak"
   ```
3. Copy the database file across with WAL checkpoints completed:
   ```powershell
   python -c "import sqlite3; con = sqlite3.connect(r'D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration\data\vs_database_desktop.db'); con.execute('PRAGMA wal_checkpoint(TRUNCATE);'); con.close()"
   Copy-Item "D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration\data\vs_database_desktop.db" "D:\AntiGravity Automation\VS Desktop App\data\vs_database_desktop.db" -Force
   ```
4. Start the original application and verify that the 43 tables load smoothly.
