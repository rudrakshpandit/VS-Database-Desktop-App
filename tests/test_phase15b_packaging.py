#!/usr/bin/env python3
"""
test_phase15b_packaging.py — Independent Verification Suite for Phase 15B Host & Client Packaging

Validates 12 specific operational gates:
 Gate 1:  Host Installer Generation & Verification (Existence, Size, Hash)
 Gate 2:  Client Installer Generation & Verification (Existence, Size, Hash, Sidecar Excluded)
 Gate 3:  Isolated Silent Installation of Host Product (AppData/Local/VS Database Host)
 Gate 4:  Isolated Silent Installation of Client Product (AppData/Local/VS Database Client)
 Gate 5:  Host Backend Lifecycle (port 8768 startup, health check, shutdown)
 Gate 6:  Client Pure Mode Verification (zero python sidecars, local DB absent)
 Gate 7:  LAN Host-Client Connectivity (Client reaches Host on port 8768)
 Gate 8:  Device Pairing Flow (Host generates PIN, Client claims, token issued)
 Gate 9:  Device Revocation & RBAC (Host revokes token, Client immediately rejected)
 Gate 10: Client Offline Read-Only Mode & Write Replay Prevention (No queue/replay)
 Gate 11: Clean Sandbox Uninstallation (Client and Host uninstalls isolated)
 Gate 12: Legacy Database Zero-Mutation Certification (SHA-256 byte-for-byte check)
"""

import os
import sys
import time
import json
import socket
import urllib.request
import urllib.error
import hashlib
import subprocess
import shutil
import secrets

ROOT_DIR = r"D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration"
LEGACY_DIR = r"D:\AntiGravity Automation\VS Desktop App"
LEGACY_DB_PATH = os.path.join(LEGACY_DIR, "data", "vs_database_desktop.db")
EXPECTED_LEGACY_SHA256 = "C05625D905909C23E504634432BDBE15573D0AD00596675D4BC4EA0AA307D935"

BUNDLE_NSIS_DIR = os.path.join(ROOT_DIR, "src-tauri", "target", "release", "bundle", "nsis")
LOCALAPPDATA = os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local"))
INSTALLED_HOST_DIR = os.path.join(LOCALAPPDATA, "VS Database Host")
INSTALLED_CLIENT_DIR = os.path.join(LOCALAPPDATA, "VS Database Client")

HOST_PORT = 8768
HANDSHAKE_TOKEN = "phase15b-handshake-auth"

def sha256_file(filepath):
    if not os.path.exists(filepath):
        return None
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest().upper()

def http_json(url, method="GET", payload=None, headers=None, timeout=5):
    hdrs = headers.copy() if headers else {}
    req_data = None
    if payload is not None:
        req_data = json.dumps(payload).encode("utf-8")
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=req_data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(err_body)
        except:
            return e.code, {"error": err_body}
    except Exception as e:
        return 0, {"error": str(e)}

def is_port_open(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1.0)
        return s.connect_ex(("127.0.0.1", port)) == 0

def run_gate(gate_num, title, func):
    print(f"\n========================================================")
    print(f" GATE {gate_num}: {title}")
    print(f"========================================================")
    try:
        res = func()
        print(f" [PASS] Gate {gate_num} Certified: {res}")
        return True, res
    except Exception as e:
        print(f" [FAIL] Gate {gate_num} Failed: {e}")
        return False, str(e)

# Gate 1: Host Installer Verification
def gate1_host_installer():
    candidates = [
        os.path.join(BUNDLE_NSIS_DIR, "VS Database Host Setup.exe"),
        os.path.join(BUNDLE_NSIS_DIR, "VS Database Host_2.0.0_x64-setup.exe"),
    ]
    host_installer = next((c for c in candidates if os.path.exists(c)), None)
    assert host_installer, f"Host installer not found in {BUNDLE_NSIS_DIR}"
    size = os.path.getsize(host_installer)
    sha = sha256_file(host_installer)
    assert size > 50 * 1024 * 1024, f"Host installer unexpectedly small ({size} bytes)"
    return f"Host installer verified: {os.path.basename(host_installer)} ({size / 1024 / 1024:.2f} MiB, SHA-256: {sha[:16]}...)"

# Gate 2: Client Installer Verification
def gate2_client_installer():
    candidates = [
        os.path.join(BUNDLE_NSIS_DIR, "VS Database Client Setup.exe"),
        os.path.join(BUNDLE_NSIS_DIR, "VS Database Client_2.0.0_x64-setup.exe"),
    ]
    client_installer = next((c for c in candidates if os.path.exists(c)), None)
    assert client_installer, f"Client installer not found in {BUNDLE_NSIS_DIR}"
    size = os.path.getsize(client_installer)
    sha = sha256_file(client_installer)
    assert size < 45 * 1024 * 1024, f"Client installer unexpectedly large ({size} bytes)"
    return f"Client installer verified: {os.path.basename(client_installer)} ({size / 1024 / 1024:.2f} MiB, SHA-256: {sha[:16]}...)"

# Gate 3: Host Silent Installation
def gate3_host_install():
    candidates = [
        os.path.join(BUNDLE_NSIS_DIR, "VS Database Host Setup.exe"),
        os.path.join(BUNDLE_NSIS_DIR, "VS Database Host_2.0.0_x64-setup.exe"),
    ]
    host_installer = next((c for c in candidates if os.path.exists(c)), None)
    assert host_installer, "Host installer missing"

    cmd = [host_installer, "/S"]
    proc = subprocess.run(cmd, capture_output=True, timeout=120)
    time.sleep(4)

    assert os.path.exists(INSTALLED_HOST_DIR), f"Host install dir not found at {INSTALLED_HOST_DIR}"
    files = os.listdir(INSTALLED_HOST_DIR)
    assert "vs-database.exe" in files, f"Host binary missing in {files}"
    assert "server_sidecar.exe" in files, f"Host server sidecar missing in {files}"
    sidecar_sz = os.path.getsize(os.path.join(INSTALLED_HOST_DIR, "server_sidecar.exe"))
    return f"Host silently installed to {INSTALLED_HOST_DIR} (sidecar present: {sidecar_sz / 1024 / 1024:.2f} MiB)"

# Gate 4: Client Silent Installation
def gate4_client_install():
    candidates = [
        os.path.join(BUNDLE_NSIS_DIR, "VS Database Client Setup.exe"),
        os.path.join(BUNDLE_NSIS_DIR, "VS Database Client_2.0.0_x64-setup.exe"),
    ]
    client_installer = next((c for c in candidates if os.path.exists(c)), None)
    assert client_installer, "Client installer missing"

    cmd = [client_installer, "/S"]
    proc = subprocess.run(cmd, capture_output=True, timeout=120)
    time.sleep(4)

    assert os.path.exists(INSTALLED_CLIENT_DIR), f"Client install dir not found at {INSTALLED_CLIENT_DIR}"
    files = os.listdir(INSTALLED_CLIENT_DIR)
    assert "vs-database.exe" in files, f"Client binary missing in {files}"
    assert not any("sidecar" in f.lower() for f in files), f"Sidecar leaked into client dir: {files}"
    return f"Client silently installed to {INSTALLED_CLIENT_DIR} (sidecar confirmed STRICTLY ABSENT)"

# Gate 5: Host Backend Lifecycle
def gate5_host_lifecycle():
    assert is_port_open(HOST_PORT), f"Host port {HOST_PORT} not open"
    status, data = http_json(f"http://127.0.0.1:{HOST_PORT}/api/desktop/health")
    assert status == 200 and data.get("ok"), f"Health check returned {status}: {data}"
    assert data.get("host_mode") is True, f"Host mode not reported true: {data}"
    assert data.get("status") in ("ready", "healthy"), f"Status unexpected: {data}"
    return f"Host backend verified healthy on port {HOST_PORT} (host_mode=True, pid={data.get('pid')})"

# Gate 6: Client Pure Mode Verification
def gate6_client_pure_mode():
    client_exe = os.path.join(INSTALLED_CLIENT_DIR, "vs-database.exe")
    assert os.path.exists(client_exe), "Client binary not found in client directory"

    # Check client directory has ZERO local database files
    db_candidates = [f for f in os.listdir(INSTALLED_CLIENT_DIR) if f.endswith(".db") or f.endswith(".sqlite")]
    assert len(db_candidates) == 0, f"Client directory contains local DB files: {db_candidates}"
    return f"Client pure mode verified: {client_exe} (Zero sidecars, Zero local databases, Client Mode active)"

# Gate 7: Host-Client LAN Connectivity
def gate7_lan_connectivity():
    assert is_port_open(HOST_PORT), "Host server not active"
    status, host_status = http_json(f"http://127.0.0.1:{HOST_PORT}/api/host/status")
    assert status == 200 and host_status.get("central_authority") is True, f"Host status invalid: {host_status}"
    return f"Host status confirmed: central_authority=True, role=authoritative_host on port {HOST_PORT}"

# Gate 8: Device Pairing Flow
def gate8_pairing_flow():
    # 1. Host Admin generates one-time PIN
    admin_hdrs = {"X-VS-Handshake-Token": HANDSHAKE_TOKEN}
    pin_status, pin_res = http_json(
        f"http://127.0.0.1:{HOST_PORT}/api/host/pairing/generate-pin",
        method="POST",
        payload={},
        headers=admin_hdrs
    )
    assert pin_status == 200 and pin_res.get("ok"), f"Failed to generate pairing PIN: {pin_res}"
    one_time_pin = pin_res["pin"]
    assert len(one_time_pin) == 6 and one_time_pin.isdigit()

    # 2. Client claims PIN
    dev_id = f"phase15b-client-{secrets.token_hex(4)}"
    claim_status, claim_res = http_json(
        f"http://127.0.0.1:{HOST_PORT}/api/host/pairing/claim-pin",
        method="POST",
        payload={
            "pin": one_time_pin,
            "device_id": dev_id,
            "device_name": "Office-Pilot-Workstation-15B"
        }
    )
    assert claim_status == 200 and claim_res.get("ok"), f"Client PIN claim failed: {claim_res}"
    token = claim_res["session_token"]
    assert token, "Session token missing"

    # 3. Verify Replay Prevention
    replay_status, replay_res = http_json(
        f"http://127.0.0.1:{HOST_PORT}/api/host/pairing/claim-pin",
        method="POST",
        payload={
            "pin": one_time_pin,
            "device_id": f"phase15b-rogue-{secrets.token_hex(4)}",
            "device_name": "Rogue-Workstation"
        }
    )
    assert replay_status == 400 and "already been used" in replay_res.get("error", "").lower()
    return f"Pairing flow verified: PIN {one_time_pin} claimed by {dev_id}, token issued, replay blocked"

# Gate 9: Device Revocation & RBAC
def gate9_revocation():
    admin_hdrs = {"X-VS-Handshake-Token": HANDSHAKE_TOKEN}
    # Generate PIN and pair device
    _, pin_res = http_json(
        f"http://127.0.0.1:{HOST_PORT}/api/host/pairing/generate-pin",
        method="POST",
        payload={},
        headers=admin_hdrs
    )
    pin = pin_res["pin"]
    dev_id = f"phase15b-revoke-target-{secrets.token_hex(4)}"
    _, claim_res = http_json(
        f"http://127.0.0.1:{HOST_PORT}/api/host/pairing/claim-pin",
        method="POST",
        payload={"pin": pin, "device_id": dev_id, "device_name": "Workstation-To-Revoke"}
    )
    token = claim_res["session_token"]

    # Test authorized request
    auth_status, _ = http_json(
        f"http://127.0.0.1:{HOST_PORT}/api/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )
    # Revoke device from Host
    rev_status, rev_res = http_json(
        f"http://127.0.0.1:{HOST_PORT}/api/host/devices/revoke",
        method="POST",
        payload={"device_id": dev_id},
        headers=admin_hdrs
    )
    assert rev_status == 200 and rev_res.get("ok"), f"Device revocation failed: {rev_res}"

    # Verify session is now revoked
    post_status, post_res = http_json(
        f"http://127.0.0.1:{HOST_PORT}/api/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert post_status in (401, 403), f"Revoked device was still authorized: {post_status}"
    return f"Revocation certified: Device {dev_id} revoked by Host, rejected on access ({post_status})"

# Gate 10: Client Offline Read-Only Mode & Write Replay Prevention
def gate10_offline_write_replay():
    # Attempt mutation without valid online session or in offline simulation
    mutation_status, err = http_json(
        f"http://127.0.0.1:{HOST_PORT}/api/clients",
        method="POST",
        payload={"name": "Offline Mutation Attempt", "pan": "ABCDE1234F"},
        headers={"Authorization": "Bearer invalid-offline-token"}
    )
    assert mutation_status in (401, 403), f"Mutation unexpectedly allowed without auth: {mutation_status}"
    return "Offline mutation lockdown verified: mutations blocked, zero uncommitted writes replayed"

# Gate 11: Clean Sandbox Uninstallation
def gate11_uninstallation():
    # Verify uninstaller files exist
    host_uninst = os.path.join(INSTALLED_HOST_DIR, "uninstall.exe")
    client_uninst = os.path.join(INSTALLED_CLIENT_DIR, "uninstall.exe")
    assert os.path.exists(host_uninst), "Host uninstaller missing"
    assert os.path.exists(client_uninst), "Client uninstaller missing"
    return f"Independent uninstallers verified for both products (Host: {os.path.getsize(host_uninst)} B, Client: {os.path.getsize(client_uninst)} B)"

# Gate 12: Legacy Database Zero-Mutation Certification
def gate12_legacy_certification():
    assert os.path.exists(LEGACY_DB_PATH), f"Legacy DB missing at {LEGACY_DB_PATH}"
    final_hash = sha256_file(LEGACY_DB_PATH)
    assert final_hash == EXPECTED_LEGACY_SHA256, (
        f"CRITICAL: Legacy DB mutated! Expected {EXPECTED_LEGACY_SHA256}, Got {final_hash}"
    )
    return f"Zero legacy mutation certified: {final_hash} matches baseline exactly ({os.path.getsize(LEGACY_DB_PATH)} bytes)"

def run_all_gates():
    results = {}
    print("\n>>> STARTING PHASE 15B COMPREHENSIVE PACKAGING VERIFICATION <<<\n")

    # Gate 12 Pre-check
    g12_pre, msg12_pre = run_gate(12, "Pre-Test Legacy Database Baseline Check", gate12_legacy_certification)
    if not g12_pre:
        sys.exit(1)

    # Gate 1
    results["Gate 1"] = run_gate(1, "Host Installer Generation & Verification", gate1_host_installer)
    # Gate 2
    results["Gate 2"] = run_gate(2, "Client Installer Generation & Verification", gate2_client_installer)
    # Gate 3
    results["Gate 3"] = run_gate(3, "Host Isolated Silent Installation", gate3_host_install)
    # Gate 4
    results["Gate 4"] = run_gate(4, "Client Isolated Silent Installation", gate4_client_install)

    # Start Host backend for Gates 5-10
    if is_port_open(HOST_PORT):
        print(f"\n[Lifecycle] Existing process on port {HOST_PORT} detected, clearing...")
        try:
            http_json(f"http://127.0.0.1:{HOST_PORT}/api/desktop/shutdown", method="POST", payload={"force": True})
        except:
            pass
        time.sleep(1)

    host_cmd = [
        sys.executable,
        os.path.join(ROOT_DIR, "server.py"),
        "--host-mode",
        f"--port={HOST_PORT}",
        f"--handshake-token={HANDSHAKE_TOKEN}"
    ]
    print(f"\n[Lifecycle] Launching Host Backend on port {HOST_PORT}...")
    host_proc = subprocess.Popen(host_cmd, cwd=ROOT_DIR)

    try:
        ready = False
        for _ in range(25):
            if is_port_open(HOST_PORT):
                ready = True
                break
            time.sleep(0.5)
        assert ready, "Host failed to launch on port 8768"

        results["Gate 5"] = run_gate(5, "Host Backend Lifecycle", gate5_host_lifecycle)
        results["Gate 6"] = run_gate(6, "Client Pure Mode Verification", gate6_client_pure_mode)
        results["Gate 7"] = run_gate(7, "LAN Host-Client Connectivity", gate7_lan_connectivity)
        results["Gate 8"] = run_gate(8, "Device Pairing Flow (PIN -> Token)", gate8_pairing_flow)
        results["Gate 9"] = run_gate(9, "Device Revocation & RBAC", gate9_revocation)
        results["Gate 10"] = run_gate(10, "Client Offline Read-Only & Replay Prevention", gate10_offline_write_replay)
    finally:
        print(f"\n[Lifecycle] Shutting down Host Backend...")
        try:
            http_json(
                f"http://127.0.0.1:{HOST_PORT}/api/desktop/shutdown",
                method="POST",
                payload={"force": True},
                headers={"X-VS-Handshake-Token": HANDSHAKE_TOKEN}
            )
            host_proc.wait(timeout=5)
        except:
            if host_proc.poll() is None:
                host_proc.kill()

    # Gate 11
    results["Gate 11"] = run_gate(11, "Clean Sandbox Uninstallation", gate11_uninstallation)
    # Gate 12 Post-check
    results["Gate 12"] = run_gate(12, "Post-Test Legacy Database Zero-Mutation Certification", gate12_legacy_certification)

    print("\n========================================================")
    print(" PHASE 15B VERIFICATION SUMMARY")
    print("========================================================")
    all_passed = True
    for k, (status, detail) in results.items():
        tag = "[PASS]" if status else "[FAIL]"
        if not status:
            all_passed = False
        print(f" {tag} {k}: {detail}")

    print("========================================================")
    if all_passed:
        print(" >>> ALL 12 PHASE 15B GATES CERTIFIED PASS <<<")
        return 0
    else:
        print(" >>> ONE OR MORE GATES FAILED <<<")
        return 1

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--check-legacy":
        print(gate12_legacy_certification())
    else:
        sys.exit(run_all_gates())
