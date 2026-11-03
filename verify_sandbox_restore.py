"""
Phase 14B: Independent Sandbox Backup Restoration Verification
Tests complete restorability of V2 database into an isolated sandbox,
verifies integrity, foreign keys, table counts, row counts, and tests
that server_sidecar can run against the restored database on port 8769.
"""

import os
import sys
import time
import json
import secrets
import hashlib
import sqlite3
import shutil
import subprocess
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(r"D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration").resolve()
V2_DB = PROJECT_ROOT / "data" / "vs_database_desktop.db"
SANDBOX_DIR = PROJECT_ROOT / "backups" / "phase14b_sandbox_restore"
SANDBOX_DIR.mkdir(parents=True, exist_ok=True)

SIDECAR_EXE = PROJECT_ROOT / "dist" / "server_sidecar.exe"
TEST_PORT = 8769
TOKEN = secrets.token_hex(32)

def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest().upper()

def run_test():
    print("=== PHASE 14B: INDEPENDENT BACKUP RESTORATION TEST ===")
    
    # 1. Create Backup
    t_start = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    orig_hash = sha256_file(V2_DB)
    backup_file = SANDBOX_DIR / "v2_phase14b_backup.bak"
    shutil.copy2(V2_DB, backup_file)
    bak_hash = sha256_file(backup_file)
    print(f"1. Original V2 DB Hash:  {orig_hash}")
    print(f"   Backup File Hash:     {bak_hash}")
    assert orig_hash == bak_hash, "Backup file corrupted during copy!"

    # 2. Restore into Sandbox
    restored_db = SANDBOX_DIR / "vs_database_desktop.db"
    shutil.copy2(backup_file, restored_db)
    restored_hash = sha256_file(restored_db)
    print(f"2. Restored DB Hash:    {restored_hash}")
    assert bak_hash == restored_hash, "Restored file corrupted during copy!"

    # 3. Verify SQLite Integrity & Schema
    with sqlite3.connect(restored_db) as con:
        integ = con.execute("PRAGMA integrity_check;").fetchall()
        orphans = con.execute("PRAGMA foreign_key_check;").fetchall()
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';").fetchall()]
        row_count = sum(con.execute(f"SELECT count(*) FROM [{t}]").fetchone()[0] for t in tables)
        clients = con.execute("SELECT count(*) FROM clients;").fetchone()[0]

    print(f"3. Integrity Check:     {integ[0][0]}")
    print(f"   Baseline Orphans:    {len(orphans)} (Expected: 22)")
    print(f"   Tables:              {len(tables)} (Expected: 42)")
    print(f"   Total Rows:          {row_count} (Expected: 13,136)")
    print(f"   Clients:             {clients} (Expected: 5)")

    assert integ == [("ok",)], "Integrity check failed!"
    assert len(orphans) == 22, "Orphan count mismatch!"
    assert len(tables) == 42, "Table count mismatch!"
    assert row_count == 13136, "Row count mismatch!"
    assert clients == 5, "Client count mismatch!"

    # 4. Test Application Startup with Restored Database
    print(f"\n4. Spawning test sidecar on isolated port {TEST_PORT}...")
    # Setup isolated data dir in sandbox
    sandbox_data = SANDBOX_DIR / "data"
    sandbox_data.mkdir(parents=True, exist_ok=True)
    target_in_sandbox = sandbox_data / "vs_database_desktop.db"
    shutil.copy2(restored_db, target_in_sandbox)

    # Launch sidecar with cwd = SANDBOX_DIR
    env = os.environ.copy()
    env["PORT"] = str(TEST_PORT)
    env["VS_HANDSHAKE_TOKEN"] = TOKEN

    proc = subprocess.Popen(
        [str(SIDECAR_EXE), str(TEST_PORT), f"--handshake-token={TOKEN}"],
        cwd=str(SANDBOX_DIR),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env
    )
    time.sleep(2.5)

    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{TEST_PORT}/api/desktop/health",
            headers={"X-VS-Handshake-Token": TOKEN}
        )
        with urllib.request.urlopen(req, timeout=3) as r:
            h_data = json.loads(r.read().decode())
        print(f"   Health check: {h_data.get('ok')} ({h_data.get('name')})")
        assert h_data.get("ok") is True

        # Query clients from restored database
        c_req = urllib.request.Request(
            f"http://127.0.0.1:{TEST_PORT}/api/clients?limit=5",
            headers={"X-VS-Handshake-Token": TOKEN}
        )
        with urllib.request.urlopen(c_req, timeout=3) as cr:
            c_data = json.loads(cr.read().decode())
        c_list = c_data if isinstance(c_data, list) else c_data.get("clients", [])
        print(f"   Clients retrieved from restored DB: {len(c_list)}")
        assert len(c_list) == 5

        # Shutdown test sidecar
        s_req = urllib.request.Request(
            f"http://127.0.0.1:{TEST_PORT}/api/desktop/shutdown",
            data=json.dumps({"force": True}).encode(),
            headers={"Content-Type": "application/json", "X-VS-Handshake-Token": TOKEN}
        )
        try:
            urllib.request.urlopen(s_req, timeout=3)
        except Exception:
            pass
        proc.wait(timeout=5)
        print("   Test sidecar stopped cleanly.")

    finally:
        try:
            proc.terminate()
        except Exception:
            pass

    t_end = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    print(f"\n[PASS] Independent Sandbox Restoration Verification Passed at {t_end}")

if __name__ == "__main__":
    run_test()
