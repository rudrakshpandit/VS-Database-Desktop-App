import os
import sys
import sqlite3
import hashlib
from pathlib import Path
from datetime import datetime, timezone

PROJECT_ROOT = Path(r"D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration").resolve()
LEGACY_ROOT = Path(r"D:\AntiGravity Automation\VS Desktop App").resolve()

legacy_db = LEGACY_ROOT / "data" / "vs_database_desktop.db"
v2_db = PROJECT_ROOT / "data" / "vs_database_desktop.db"

def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while c := f.read(65536):
            h.update(c)
    return h.hexdigest().upper()

print("=== PRE-OBSERVATION SAFETY AUDIT (PHASE 14C) ===")
print("1. Legacy DB Path:", legacy_db, "Exists:", legacy_db.exists())
print("   Size:", legacy_db.stat().st_size, "SHA-256:", sha256(legacy_db))
print("2. V2 DB Path:    ", v2_db, "Exists:", v2_db.exists())
print("   Size:", v2_db.stat().st_size, "SHA-256:", sha256(v2_db))

with sqlite3.connect(legacy_db) as l_con:
    l_integ = l_con.execute("PRAGMA integrity_check").fetchall()[0][0]
    l_orph = len(l_con.execute("PRAGMA foreign_key_check").fetchall())
    l_table_names = [r[0] for r in l_con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()]
    l_tables = len(l_table_names)
    l_rows = sum(l_con.execute(f"SELECT count(*) FROM [{t}]").fetchone()[0] for t in l_table_names)

with sqlite3.connect(v2_db) as v_con:
    v_integ = v_con.execute("PRAGMA integrity_check").fetchall()[0][0]
    v_orph = len(v_con.execute("PRAGMA foreign_key_check").fetchall())
    v_table_names = [r[0] for r in v_con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()]
    v_tables = len(v_table_names)
    v_rows = sum(v_con.execute(f"SELECT count(*) FROM [{t}]").fetchone()[0] for t in v_table_names)

print(f"\n3. Legacy DB: Integrity={l_integ}, Tables={l_tables}, Total Rows={l_rows}, Baseline Orphans={l_orph}")
print(f"4. V2 DB:     Integrity={v_integ}, Tables={v_tables}, Total Rows={v_rows}, Baseline Orphans={v_orph}")

assert l_integ == "ok" and v_integ == "ok"
assert l_orph == 22 and v_orph == 22

# Check active ports
import socket
def check_port(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1.0)
        return s.connect_ex(("127.0.0.1", port)) == 0

p8767 = check_port(8767)
p8768 = check_port(8768)
p9000 = check_port(9000)

print(f"\n5. Port Status: Port 8767 (Legacy) Active: {p8767}")
print(f"   Port Status: Port 8768 (V2) Active:     {p8768}")
print(f"   Port Status: Port 9000 (Tally) Active:  {p9000}")

# Rollback executable check
legacy_exe = LEGACY_ROOT / "VS_Database.exe"
print(f"6. Legacy Rollback Executable: {legacy_exe} (Exists: {legacy_exe.exists()})")
assert legacy_exe.exists()

# Pre-cutover backup check
backup_archive = PROJECT_ROOT / "backups" / "pre_cutover_prod_db_20261103_140738.bak"
print(f"7. Pre-Cutover Backup Archive: {backup_archive} (Exists: {backup_archive.exists()})")
assert backup_archive.exists()

print("\n[PASS] All Mandatory Pre-Observation Safety Checks Succeeded.")
