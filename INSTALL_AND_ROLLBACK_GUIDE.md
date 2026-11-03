# VS Database 2.0 — Installation, Uninstallation & Rollback Guide
**Project:** VS Database 2.0 — Tauri Migration  
**Target Release:** 2.0.0 (Windows 10/11 x64)  
**Installer Package:** `VS Database_2.0.0_x64-setup.exe` (141.51 MiB, NSIS)  
**Date:** November 2026  

---

## 1. System Requirements & Prerequisites
1. **Operating System:** Windows 10 (version 1809+) or Windows 11 64-bit.
2. **Runtime Engine:** Microsoft Edge WebView2 Evergreen Runtime (pre-installed on Windows 10/11; automatically verified by installer).
3. **Python Runtime:** **NONE REQUIRED.** The application sidecar (`server_sidecar.exe`) is pre-compiled as a standalone binary with all 28 Python dependencies, native C extensions (PyMuPDF, cryptography, greenlet), and DLLs bundled.
4. **Office Network (LAN Mode):** Ethernet or Wi-Fi connected to the office local area network (`192.168.1.0/24`).

---

## 2. Release Package Hashes (Forensic Verification)

Prior to installation on any host workstation, verify SHA-256 integrity:

| Artifact | Size | SHA-256 Hash |
| :--- | :--- | :--- |
| `VS Database_2.0.0_x64-setup.exe` | 141.51 MiB | `9D50002CCF7A76901EEC0E7AEFC6A4425E416C336F149FB5ADFF7E22B3BEF8E1` |
| `vs-database.exe` (Tauri Main) | 51.67 MiB | `6F6B99966E3857446A879B8D09808EFA28698340EBFF0081799963D61D22736B` |
| `server_sidecar.exe` (Backend) | 108.84 MiB | `B638B92483A9BF55FE918D315D9A8055BCCD0624E0F20DD95E2A3773409301AB` |

Verify via PowerShell:
```powershell
Get-FileHash "VS Database_2.0.0_x64-setup.exe" -Algorithm SHA256
```

---

## 3. Installation Procedure

### For Host Station (Staging Primary PC):
1. Copy `VS Database_2.0.0_x64-setup.exe` to the Host PC.
2. Double-click the installer.
3. Follow the NSIS setup wizard:
   - Default installation directory: `%LOCALAPPDATA%\Programs\VS Database`
   - Data & Database directory: `%LOCALAPPDATA%\vs-database\data\`
4. Check the desktop shortcut "VS Database" created by the installer.
5. Launch the application:
   - The frameless glassmorphic native shell opens.
   - The background supervisor automatically starts `server_sidecar.exe` on port `8767` with a dynamic cryptographically random handshake token.
   - The application binds to both `127.0.0.1:8767` and your LAN IP (e.g., `192.168.1.50:8767`).

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
   - The device will prompt for user authentication.
   - Device pairing and session creation are recorded in `sessions` and `devices` tables.
   - Upon authentication, full access to Client records, PDF Studio, File Router, and Document Studio is enabled.
5. **Host UI Decoupling Protection (DEF-003):**
   - The Host operator may close the desktop window at any time.
   - If staff members have active sessions, the Python backend **will NOT terminate**. It remains running in the background to serve office workstations.
   - To completely stop the server, use the in-app "Exit & Stop Server" menu command from the host, or close the window when no staff workstations are connected.

---

## 5. Uninstallation Procedure

To completely remove the Tauri 2 staging installation without impacting any legacy application data:
1. Open Windows **Settings** -> **Apps** -> **Installed apps**.
2. Locate **VS Database** and click **Uninstall**.
3. Confirm uninstallation. The NSIS uninstaller will remove all application binaries, libraries, and shortcuts.
4. *Optional Data Cleanup:* If you wish to delete test staging databases, remove the folder:
   ```text
   %LOCALAPPDATA%\vs-database\
   ```

---

## 6. Immediate Rollback to Legacy Application

Because Phase 1 and all subsequent phases enforced **absolute read-only immutability** of the original application, rollback is immediate, safe, and guarantees zero data loss.

### Step 1: Ensure Tauri Process is Terminated
```powershell
Get-Process -Name "vs-database", "server_sidecar" -ErrorAction SilentlyContinue | Stop-Process -Force
```

### Step 2: Launch the Original Application
Navigate to the original untouched application directory and run the launcher:
```powershell
cd "D:\AntiGravity Automation\VS Desktop App"
.\Run_VS_Database.bat
```
The original Python 3 + pywebview application will immediately start on port 8767 with all historical database records, clients, and configurations 100% intact.

### Step 3: Database Synchronization (If New Staging Records Must Be Preserved)
If operational test records were added during staging that must be imported into the original database:
1. Verify the staging database integrity:
   ```powershell
   python -c "import sqlite3; con = sqlite3.connect(r'D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration\data\vs_database_desktop.db'); print(con.execute('PRAGMA integrity_check;').fetchall())"
   ```
2. Create a timestamped backup of the production database:
   ```powershell
   Copy-Item "D:\AntiGravity Automation\VS Desktop App\data\vs_database_desktop.db" "D:\AntiGravity Automation\VS Desktop App\data\vs_database_desktop_pre_sync.bak"
   ```
3. Checkpoint WAL and copy database across:
   ```powershell
   python -c "import sqlite3; con = sqlite3.connect(r'D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration\data\vs_database_desktop.db'); con.execute('PRAGMA wal_checkpoint(TRUNCATE);'); con.close()"
   Copy-Item "D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration\data\vs_database_desktop.db" "D:\AntiGravity Automation\VS Desktop App\data\vs_database_desktop.db" -Force
   ```
4. Verify the 42 tables and 13,115+ rows in the original application.
