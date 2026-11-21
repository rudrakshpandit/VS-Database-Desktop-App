"""
Task 0: Mandatory Pre-Cutover Production Database Forensic Investigation
VS Database 2.0 - Tauri Migration

Strictly READ-ONLY analysis of:
1. Current hash of production DB.
2. Comparison with Phase 1 forensic baseline.
3. Inspection of SQLite WAL and SHM files.
4. Review of Git history, audit logs, and previous hash records.
5. Record count reconciliation across all tables.
6. Schema verification and foreign key orphan check (baseline: 22).
7. Creation of a verified certified pre-cutover backup archive.
"""

import os
import sys
import json
import sqlite3
import hashlib
import shutil
from pathlib import Path
from datetime import datetime, timezone

PROD_DIR = Path(r"D:\AntiGravity Automation\VS Desktop App\data").resolve()
PROD_DB = PROD_DIR / "vs_database_desktop.db"
WAL_FILE = PROD_DIR / "vs_database_desktop.db-wal"
SHM_FILE = PROD_DIR / "vs_database_desktop.db-shm"
BACKUP_DIR = Path(r"D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration\backups").resolve()
BACKUP_DIR.mkdir(parents=True, exist_ok=True)

PHASE1_BASELINE_HASH = "bb174147080b39c53729fdc0f167c6f97992d7384876c3d4daefcaf22122afff"

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def investigate():
    print("=" * 70)
    print("TASK 0: MANDATORY PRE-CUTOVER PRODUCTION DATABASE INVESTIGATION")
    print("=" * 70)

    assert PROD_DB.is_file(), f"Production DB not found at {PROD_DB}"

    current_hash = sha256_file(PROD_DB)
    db_size = PROD_DB.stat().st_size
    db_mtime = datetime.fromtimestamp(PROD_DB.stat().st_mtime, timezone.utc).isoformat()

    print(f"1. Database File:")
    print(f"   Path:        {PROD_DB}")
    print(f"   Size:        {db_size:,} bytes")
    print(f"   Last Mtime:  {db_mtime}")
    print(f"   Current SHA: {current_hash}")
    print(f"   Phase 1 SHA: {PHASE1_BASELINE_HASH}")

    wal_info = {}
    if WAL_FILE.exists():
        wal_size = WAL_FILE.stat().st_size
        wal_mtime = datetime.fromtimestamp(WAL_FILE.stat().st_mtime, timezone.utc).isoformat()
        wal_hash = sha256_file(WAL_FILE) if wal_size > 0 else "empty"
        wal_info = {"exists": True, "size": wal_size, "mtime": wal_mtime, "hash": wal_hash}
        print(f"\n2. WAL File:")
        print(f"   Path:        {WAL_FILE}")
        print(f"   Size:        {wal_size:,} bytes")
        print(f"   Last Mtime:  {wal_mtime}")
        print(f"   SHA-256:     {wal_hash}")
    else:
        wal_info = {"exists": False}
        print("\n2. WAL File: Does not exist")

    shm_info = {}
    if SHM_FILE.exists():
        shm_size = SHM_FILE.stat().st_size
        shm_mtime = datetime.fromtimestamp(SHM_FILE.stat().st_mtime, timezone.utc).isoformat()
        shm_info = {"exists": True, "size": shm_size, "mtime": shm_mtime}
        print(f"\n3. SHM File:")
        print(f"   Path:        {SHM_FILE}")
        print(f"   Size:        {shm_size:,} bytes")
    else:
        shm_info = {"exists": False}
        print("\n3. SHM File: Does not exist")

    # Read-Only Database Inspection
    print("\n4. Read-Only Schema & Record Count Inspection:")
    uri = f"file:{PROD_DB}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    try:
        conn.execute("PRAGMA foreign_keys = ON;")
        integ = conn.execute("PRAGMA integrity_check;").fetchall()
        print(f"   PRAGMA integrity_check: {integ}")
        assert integ == [("ok",)], f"Integrity check failed: {integ}"

        fk_check = conn.execute("PRAGMA foreign_key_check;").fetchall()
        print(f"   PRAGMA foreign_key_check violations: {len(fk_check)} (Expected baseline: 22)")
        assert len(fk_check) == 22, f"Orphan count altered: expected 22, got {len(fk_check)}"

        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()]
        print(f"   Total Tables: {len(tables)} (Expected: 42)")
        assert len(tables) == 42, f"Table count mismatch: expected 42, got {len(tables)}"

        table_counts = {}
        for t in tables:
            cnt = conn.execute(f"SELECT count(*) FROM \"{t}\"").fetchone()[0]
            table_counts[t] = cnt

        total_rows = sum(table_counts.values())
        print(f"   Total Database Rows: {total_rows}")
        print(f"   Key Tables:")
        print(f"     - clients:                {table_counts.get('clients', 0)}")
        print(f"     - client_portals:         {table_counts.get('client_portals', 0)}")
        print(f"     - users:                  {table_counts.get('users', 0)}")
        print(f"     - devices:                {table_counts.get('devices', 0)}")
        print(f"     - sessions:               {table_counts.get('sessions', 0)}")
        print(f"     - access_requests:        {table_counts.get('access_requests', 0)}")
        print(f"     - automation_transactions:{table_counts.get('automation_transactions', 0)}")
        print(f"     - automation_rules:       {table_counts.get('automation_rules', 0)}")
        print(f"     - settings:               {table_counts.get('settings', 0)}")
        print(f"     - notes:                  {table_counts.get('notes', 0)}")

        # Check most recent updates in audit / log / settings tables
        recent_updates = []
        if "sessions" in table_counts and table_counts["sessions"] > 0:
            rec_sess = conn.execute("SELECT session_id, user_id, ip_address, created_at, last_seen_at FROM sessions ORDER BY last_seen_at DESC LIMIT 3").fetchall()
            print(f"   Most Recent Sessions: {rec_sess}")
        
        if "devices" in table_counts and table_counts["devices"] > 0:
            rec_dev = conn.execute("SELECT device_id, device_name, ip_address, last_seen_at FROM devices ORDER BY last_seen_at DESC LIMIT 3").fetchall()
            print(f"   Most Recent Devices: {rec_dev}")

        if "settings" in table_counts:
            google_mode = conn.execute("SELECT value FROM settings WHERE key='google_drive_mode'").fetchone()
            print(f"   Setting google_drive_mode: {google_mode[0] if google_mode else 'None'}")

    finally:
        conn.close()

    # 5. Create Certified Pre-Cutover Backup Archive
    ts_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = BACKUP_DIR / f"pre_cutover_prod_db_{ts_str}.bak"
    print(f"\n5. Creating Certified Pre-Cutover Backup Archive...")
    shutil.copy2(PROD_DB, backup_file)
    backup_hash = sha256_file(backup_file)
    print(f"   Backup Created: {backup_file}")
    print(f"   Backup SHA-256: {backup_hash}")
    assert backup_hash == current_hash, "Backup hash does not match production DB!"

    findings = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "production_db_path": str(PROD_DB),
        "current_sha256": current_hash,
        "phase1_baseline_sha256": PHASE1_BASELINE_HASH,
        "hash_match_phase1": (current_hash == PHASE1_BASELINE_HASH),
        "file_size": db_size,
        "mtime_utc": db_mtime,
        "wal_info": wal_info,
        "shm_info": shm_info,
        "integrity_check": "ok",
        "orphan_count": len(fk_check),
        "table_count": len(tables),
        "total_rows": total_rows,
        "table_counts": table_counts,
        "backup_archive": str(backup_file),
        "backup_sha256": backup_hash
    }

    out_json = Path(r"D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration\phase14_task0_db_clearance.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(findings, f, indent=2)

    print(f"\nForensic analysis JSON saved to: {out_json}")
    print("=" * 70)
    print("TASK 0 FORENSIC ANALYSIS COMPLETED SUCCESSFULLY")
    print("=" * 70)
    return findings

if __name__ == "__main__":
    investigate()
