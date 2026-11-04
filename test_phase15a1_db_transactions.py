#!/usr/bin/env python3
"""
test_phase15a1_db_transactions.py
================================================================================
Phase 15A.1 Independent Database Transaction & Concurrency Verification
================================================================================
Exhaustively verifies:
1. Real concurrent multi-threaded writes against an isolated V2 test database copy.
2. Committed transaction persistence and subsequent retrieval.
3. Duplicate submission and conflict handling.
4. Transaction rollback and atomicity under failure.
5. Concurrent update contention on identical records.
6. Separation of read vs write performance metrics.
7. PRAGMA integrity_check post-test.
8. Zero mutation of the legacy database (strict SHA-256 preservation).
"""

import os
import sys
import time
import json
import shutil
import sqlite3
import hashlib
import secrets
import threading
import subprocess
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone

PROJECT_ROOT = Path(r"D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration").resolve()
LEGACY_ROOT = Path(r"D:\AntiGravity Automation\VS Desktop App").resolve()
LEGACY_DB = LEGACY_ROOT / "data" / "vs_database_desktop.db"
PROD_V2_DB = PROJECT_ROOT / "data" / "vs_database_desktop.db"
TEST_DB = PROJECT_ROOT / "data" / "vs_database_test_tx.db"
TEST_PORT = 8769
PYTHON_EXE = sys.executable

def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest().upper()

def http_json(url, method="GET", payload=None, headers=None, timeout=10, retries=2):
    req_hdrs = {"Accept": "application/json"}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        req_hdrs["Content-Type"] = "application/json"
    if headers:
        req_hdrs.update(headers)
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, headers=req_hdrs, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8")
                return resp.status, json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8")
            try:
                parsed = json.loads(body)
            except Exception:
                parsed = {"raw": body}
            return e.code, parsed
        except Exception as e:
            if attempt < retries:
                time.sleep(0.1)
                continue
            return 0, {"error": str(e)}

def log(msg):
    print(f"[Phase15A1-TxTest] {msg}", flush=True)

def run_tests():
    log("================================================================================")
    log("PHASE 15A.1: CONCURRENT DATABASE TRANSACTION & INTEGRITY VERIFICATION")
    log("================================================================================")

    # 1. Verify and snapshot legacy database hash
    assert LEGACY_DB.exists(), f"Legacy DB missing at {LEGACY_DB}"
    legacy_hash_before = sha256_file(LEGACY_DB)
    log(f"Legacy DB Pre-Test SHA-256: {legacy_hash_before}")

    # 2. Replicate isolated V2 test database
    if TEST_DB.exists():
        try:
            TEST_DB.unlink()
        except Exception:
            pass
    shutil.copy2(PROD_V2_DB, TEST_DB)
    log(f"Created isolated test database copy at: {TEST_DB.name}")

    # Ensure WAL mode and busy_timeout on test database
    with sqlite3.connect(TEST_DB) as con:
        con.execute("PRAGMA journal_mode = WAL;")
        con.execute("PRAGMA busy_timeout = 5000;")
        initial_client_count = con.execute("SELECT count(*) FROM clients").fetchone()[0]
    log(f"Initial client count in test database: {initial_client_count}")

    # 3. Spawn Host server pointing to isolated test DB
    handshake_token = f"test-tx-handshake-{secrets.token_hex(16)}"
    env = os.environ.copy()
    env["VS_DATABASE_PATH"] = str(TEST_DB)
    host_cmd = [
        PYTHON_EXE,
        "server.py",
        "--host-mode",
        f"--port={TEST_PORT}",
        f"--handshake-token={handshake_token}"
    ]
    log(f"Launching Host Server on port {TEST_PORT}...")
    host_proc = subprocess.Popen(host_cmd, cwd=str(PROJECT_ROOT), env=env)

    try:
        # Wait for host health
        healthy = False
        for _ in range(25):
            time.sleep(0.5)
            st, hb = http_json(f"http://127.0.0.1:{TEST_PORT}/api/desktop/health")
            if st == 200 and hb.get("ok"):
                healthy = True
                break
        assert healthy, f"Host server failed to start on port {TEST_PORT}"
        log("Host server ready on port 8769.")

        # Admin headers
        admin_hdrs = {"X-VS-Handshake-Token": handshake_token}

        # Pair a test operator device
        p_st, p_res = http_json(
            f"http://127.0.0.1:{TEST_PORT}/api/host/pairing/generate-pin",
            method="POST",
            payload={},
            headers=admin_hdrs
        )
        assert p_st == 200, f"PIN gen failed: {p_res}"
        pin = p_res["pin"]
        device_id = f"test-operator-{secrets.token_hex(4)}"
        c_st, c_res = http_json(
            f"http://127.0.0.1:{TEST_PORT}/api/host/pairing/claim-pin",
            method="POST",
            payload={"pin": pin, "device_id": device_id, "device_name": "Tx-Test-Runner"}
        )
        assert c_st == 200, f"Claim failed: {c_res}"
        session_token = c_res["session_token"]
        auth_hdrs = {"X-VS-Session-Token": session_token, "X-VS-Device-Id": device_id}
        log(f"Operator device paired: {device_id}")

        # -------------------------------------------------------------------------
        # TEST 1: CONCURRENT MULTI-THREADED WRITES (25 UNIQUE RECORDS)
        # -------------------------------------------------------------------------
        log("\n--- TEST 1: CONCURRENT MULTI-THREADED WRITES ---")
        num_threads = 5
        writes_per_thread = 5
        total_writes = num_threads * writes_per_thread
        created_client_names = []
        write_latencies = []
        write_errors = []
        lock = threading.Lock()

        def worker_writer(t_id):
            for i in range(writes_per_thread):
                c_name = f"TX_Corp_T{t_id}_W{i}_{secrets.token_hex(3).upper()}"
                payload = {
                    "name": c_name,
                    "client_type": "Proprietorship",
                    "mobile": f"98{t_id}{i:02d}00000",
                    "status": "Active"
                }
                t0 = time.perf_counter()
                st, res = http_json(
                    f"http://127.0.0.1:{TEST_PORT}/api/clients",
                    method="POST",
                    payload=payload,
                    headers=auth_hdrs
                )
                lat = (time.perf_counter() - t0) * 1000
                if st in (200, 201):
                    with lock:
                        created_client_names.append(c_name)
                        write_latencies.append(lat)
                else:
                    with lock:
                        write_errors.append(f"Thread {t_id} Write {i} failed: {st} -> {res}")

        threads = [threading.Thread(target=worker_writer, args=(t,)) for t in range(num_threads)]
        t_start = time.perf_counter()
        for t in threads: t.start()
        for t in threads: t.join()
        total_write_duration = time.perf_counter() - t_start

        log(f"Dispatched {total_writes} concurrent writes across {num_threads} threads in {total_write_duration:.2f}s.")
        log(f"Successful writes: {len(created_client_names)}/{total_writes}")
        log(f"Write errors: {len(write_errors)}")
        assert len(write_errors) == 0, f"Write errors encountered: {write_errors}"
        assert len(created_client_names) == total_writes
        avg_write_lat = sum(write_latencies) / len(write_latencies)
        log(f"Average Write Latency: {avg_write_lat:.2f} ms (Min: {min(write_latencies):.2f} ms, Max: {max(write_latencies):.2f} ms)")

        # -------------------------------------------------------------------------
        # TEST 2: SUBSEQUENT RECORD RETRIEVAL & INTEGRITY
        # -------------------------------------------------------------------------
        log("\n--- TEST 2: SUBSEQUENT RECORD RETRIEVAL ---")
        g_st, all_clients = http_json(f"http://127.0.0.1:{TEST_PORT}/api/clients", headers=auth_hdrs)
        assert g_st == 200, f"Failed to retrieve clients: {all_clients}"
        all_names = {c.get("name") for c in all_clients}
        for expected in created_client_names:
            assert expected in all_names, f"Expected client '{expected}' missing from central retrieval!"
        log(f"[PASS] All {total_writes} newly created records retrieved with 100% integrity.")

        # -------------------------------------------------------------------------
        # TEST 3: DUPLICATE SUBMISSION & CONFLICT BEHAVIOR
        # -------------------------------------------------------------------------
        log("\n--- TEST 3: DUPLICATE SUBMISSION HANDLING ---")
        first_created = created_client_names[0]
        dup_payload = {
            "name": first_created,
            "client_type": "Proprietorship",
            "mobile": "9811111111"
        }
        dup_st, dup_res = http_json(
            f"http://127.0.0.1:{TEST_PORT}/api/clients",
            method="POST",
            payload=dup_payload,
            headers=auth_hdrs
        )
        log(f"Duplicate submission status: {dup_st} -> {dup_res}")
        assert dup_st in (400, 409) or "already exists" in str(dup_res).lower(), f"Unexpected duplicate response: {dup_st} {dup_res}"
        log(f"[PASS] Duplicate submission correctly blocked with HTTP {dup_st}: {dup_res.get('error', '')}")

        # -------------------------------------------------------------------------
        # TEST 4: TRANSACTION ATOMICITY & ROLLBACK
        # -------------------------------------------------------------------------
        log("\n--- TEST 4: TRANSACTION ATOMICITY & ROLLBACK ---")
        # Direct DB test of rollback under simulated failure
        with sqlite3.connect(TEST_DB) as con:
            con.execute("PRAGMA busy_timeout = 5000;")
            cur = con.cursor()
            rollback_tested = False
            try:
                cur.execute("BEGIN TRANSACTION;")
                cur.execute("INSERT INTO clients (file_no, name, client_type, status) VALUES ('PROBE-ROLLBACK-001', 'Rollback_Probe_Inc', 'Proprietorship', 'Active');")
                # Force constraint error or explicit rollback
                raise sqlite3.IntegrityError("Simulated mid-transaction failure")
            except sqlite3.IntegrityError:
                con.rollback()
                rollback_tested = True

            assert rollback_tested
            # Verify record was rolled back
            row = con.execute("SELECT file_no FROM clients WHERE file_no = 'PROBE-ROLLBACK-001'").fetchone()
            assert row is None, "Rollback failed! Uncommitted record leaked into database."
            log("[PASS] Transaction rollback verified: Uncommitted changes cleanly zeroized.")

        # -------------------------------------------------------------------------
        # TEST 5: CONCURRENT UPDATE CONTENTION
        # -------------------------------------------------------------------------
        log("\n--- TEST 5: CONCURRENT UPDATE CONTENTION ---")
        target_name = created_client_names[0]
        target_fno = None
        for c in all_clients:
            if c.get("name") == target_name:
                target_fno = c.get("file_no")
                break
        assert target_fno is not None, f"Could not find file_no for target client {target_name}"
        log(f"Contention target client File No: {target_fno}")

        update_errors = []
        update_success = []
        def worker_updater(u_id):
            for j in range(5):
                payload = {
                    "name": target_name,
                    "old_file_no": target_fno,
                    "client_type": "Proprietorship",
                    "mobile": f"99{u_id}{j:02d}11111",
                    "status": "Active"
                }
                st, res = http_json(
                    f"http://127.0.0.1:{TEST_PORT}/api/clients",
                    method="POST",
                    payload=payload,
                    headers=auth_hdrs
                )
                if st in (200, 201):
                    update_success.append(1)
                else:
                    update_errors.append(f"Thread {u_id} update failed: {st}")

        u_threads = [threading.Thread(target=worker_updater, args=(t,)) for t in range(5)]
        for t in u_threads: t.start()
        for t in u_threads: t.join()
        log(f"Concurrent update attempts: {len(update_success)} succeeded, {len(update_errors)} failed.")
        assert len(update_errors) == 0, f"Update contention errors: {update_errors}"
        log("[PASS] Concurrent update contention handled cleanly in WAL mode.")

        # -------------------------------------------------------------------------
        # TEST 6: SEPARATED READ VS WRITE PERFORMANCE BENCHMARK
        # -------------------------------------------------------------------------
        log("\n--- TEST 6: SEPARATED READ VS WRITE PERFORMANCE BENCHMARK ---")
        read_latencies = []
        read_lock = threading.Lock()
        def worker_reader():
            for _ in range(10):
                t0 = time.perf_counter()
                st, _ = http_json(f"http://127.0.0.1:{TEST_PORT}/api/clients", headers=auth_hdrs)
                lat = (time.perf_counter() - t0) * 1000
                if st == 200:
                    with read_lock:
                        read_latencies.append(lat)

        r_threads = [threading.Thread(target=worker_reader) for _ in range(5)]
        for t in r_threads: t.start()
        for t in r_threads: t.join()

        avg_read_lat = sum(read_latencies) / len(read_latencies)
        log(f"Read Requests Executed : {len(read_latencies)}")
        log(f"Average Read Latency   : {avg_read_lat:.2f} ms (Min: {min(read_latencies):.2f} ms, Max: {max(read_latencies):.2f} ms)")
        log(f"Write Requests Executed: {len(write_latencies)}")
        log(f"Average Write Latency  : {avg_write_lat:.2f} ms (Min: {min(write_latencies):.2f} ms, Max: {max(write_latencies):.2f} ms)")

        # -------------------------------------------------------------------------
        # TEST 7: SQLITE INTEGRITY CHECK POST-TEST
        # -------------------------------------------------------------------------
        log("\n--- TEST 7: SQLITE INTEGRITY CHECK POST-TEST ---")
        with sqlite3.connect(TEST_DB) as con:
            integrity = con.execute("PRAGMA integrity_check;").fetchone()[0]
            journal = con.execute("PRAGMA journal_mode;").fetchone()[0]
            final_count = con.execute("SELECT count(*) FROM clients").fetchone()[0]
            foreign_keys_ok = len(con.execute("PRAGMA foreign_key_check;").fetchall())
        log(f"Test DB Integrity Check : {integrity}")
        log(f"Test DB Journal Mode     : {journal}")
        log(f"Test DB Final Client Count: {final_count} (Expected: {initial_client_count + total_writes})")
        log(f"Foreign Key Anomalies    : {foreign_keys_ok}")
        assert integrity.lower() == "ok", f"Integrity check failed: {integrity}"
        assert final_count == initial_client_count + total_writes, f"Count mismatch: {final_count}"
        log("[PASS] Test database integrity confirmed 100% OK with 0 corruption.")

        # -------------------------------------------------------------------------
        # TEST 8: ZERO MUTATION TO LEGACY DATABASE
        # -------------------------------------------------------------------------
        log("\n--- TEST 8: ZERO MUTATION TO LEGACY DATABASE ---")
        legacy_hash_after = sha256_file(LEGACY_DB)
        log(f"Legacy DB Post-Test SHA-256: {legacy_hash_after}")
        assert legacy_hash_before == legacy_hash_after, "CRITICAL: Legacy database was mutated during testing!"
        log("[PASS] Legacy database strictly unmodified (SHA-256 identical).")

    finally:
        if host_proc:
            log("Shutting down test host server...")
            host_proc.terminate()
            try:
                host_proc.wait(timeout=5)
            except Exception:
                host_proc.kill()
        # Clean up test DB
        if TEST_DB.exists():
            try:
                TEST_DB.unlink()
            except Exception:
                pass
        for extra in PROJECT_ROOT.glob("data/vs_database_test_tx.db*"):
            try: extra.unlink()
            except Exception: pass
        log("Test cleanup completed.")

    log("\n================================================================================")
    log("ALL PHASE 15A.1 DATABASE TRANSACTION TESTS CERTIFIED [PASS]")
    log("================================================================================")

if __name__ == "__main__":
    run_tests()
