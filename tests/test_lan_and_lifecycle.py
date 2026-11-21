import subprocess
import time
import json
import sqlite3
import hashlib
import urllib.request
import urllib.error
from pathlib import Path

LAN_HOST = "192.168.1.50"
PORT = 8767
SECRET_HANDSHAKE = "pilot-secret-handshake-token-998877"

print("=================================================================")
print("PHASE 12 - TEST 2: LAN CONNECTIVITY & LIFECYCLE DECOUPLING AUDIT")
print("=================================================================")

# Path to standalone sidecar
sidecar_exe = Path("dist/server_sidecar.exe").resolve()
assert sidecar_exe.is_file(), f"Sidecar binary not found at {sidecar_exe}"

# Launch sidecar directly with handshake token
print(f"1. Spawning standalone sidecar: {sidecar_exe}")
sidecar_proc = subprocess.Popen([str(sidecar_exe), f"--handshake-token={SECRET_HANDSHAKE}"])
print(f"   Sidecar PID: {sidecar_proc.pid}")

try:
    # 2. Wait for health check on LAN IP
    print(f"\n2. Verifying health check on LAN interface: http://{LAN_HOST}:{PORT}/api/desktop/health")
    healthy = False
    for i in range(15):
        time.sleep(1)
        try:
            req = urllib.request.Request(f"http://{LAN_HOST}:{PORT}/api/desktop/health")
            with urllib.request.urlopen(req, timeout=2) as resp:
                data = json.loads(resp.read().decode())
                if data.get("ok"):
                    print(f"   [PASS] Responded on LAN interface: {data}")
                    healthy = True
                    break
        except Exception:
            pass

    if not healthy:
        raise RuntimeError("Sidecar failed to listen on LAN IP within 15 seconds")

    # 3. Test unauthenticated LAN access to privileged endpoint
    print(f"\n3. Testing unauthenticated LAN request to http://{LAN_HOST}:{PORT}/api/clients")
    unauth_req = urllib.request.Request(f"http://{LAN_HOST}:{PORT}/api/clients")
    try:
        with urllib.request.urlopen(unauth_req, timeout=2) as resp:
            print("   [CRITICAL FAIL] Unauthenticated LAN request was NOT rejected!")
    except urllib.error.HTTPError as e:
        print(f"   [PASS] Unauthenticated LAN request correctly rejected: HTTP {e.code} {e.reason}")

    # 4. Create an authorized LAN session for a client PC (IP: 192.168.1.120)
    print("\n4. Simulating approved LAN Client PC (192.168.1.120)...")
    raw_token = "pilot-lan-test-token-abcdef123456"
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    session_id = "test-lan-session-phase12"
    device_id = "test-lan-device-phase12"
    user_id = "test-lan-user-phase12"
    now_str = time.strftime("%Y-%m-%d %H:%M:%S")

    db_path = Path("data/vs_database_desktop.db").resolve()
    with sqlite3.connect(db_path) as conn:
        conn.execute("INSERT OR REPLACE INTO users (user_id, password_hash, salt, role, status, created_at, updated_at) VALUES (?, 'dummy', 'dummy', 'staff', 'active', ?, ?)", (user_id, now_str, now_str))
        conn.execute("INSERT OR REPLACE INTO devices (device_id, user_id, device_name, ip_address, status, created_at, updated_at, approved_at, last_seen_at) VALUES (?, ?, 'Office Workstation #2', '192.168.1.120', 'approved', ?, ?, ?, ?)", (device_id, user_id, now_str, now_str, now_str, now_str))
        conn.execute("INSERT OR REPLACE INTO sessions (session_id, token_hash, user_id, device_id, ip_address, session_type, created_at, last_seen_at, status) VALUES (?, ?, ?, ?, '192.168.1.120', 'web', ?, ?, 'active')", (session_id, token_hash, user_id, device_id, now_str, now_str))
        conn.commit()
    print("   [OK] Active LAN session record created in database.")

    # 5. Check lifecycle policy endpoint: can_terminate should now be False!
    print(f"\n5. Checking /api/desktop/lifecycle-policy with active LAN client...")
    req_pol = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/desktop/lifecycle-policy")
    with urllib.request.urlopen(req_pol, timeout=2) as resp:
        pol = json.loads(resp.read().decode())
        print(f"   Policy response: {pol}")
        if pol.get("active_lan_sessions") >= 1 and pol.get("can_terminate") is False:
            print("   [PASS] Lifecycle correctly signals can_terminate = FALSE because LAN workstation is connected!")
        else:
            print("   [FAIL] Lifecycle policy did not protect active LAN session!")

    # 6. Simulate Host Desktop Window Close with active LAN client: send /api/desktop/ui-detach
    print("\n6. Simulating Host Desktop Window Close: sending /api/desktop/ui-detach...")
    detach_req = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/api/desktop/ui-detach",
        data=json.dumps({"instance_id": "tauri-host-ui"}).encode(),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(detach_req, timeout=2) as resp:
        res = json.loads(resp.read().decode())
        print(f"   Detach response: {res}")

    # Wait 3 seconds to prove sidecar did NOT terminate
    time.sleep(3)
    if sidecar_proc.poll() is None:
        print("   [PASS] Sidecar remains running in background after desktop UI close!")
    else:
        print("   [FAIL] Sidecar terminated when desktop UI closed!")

    # 7. Verify LAN client can still perform operations against the detached backend
    print(f"\n7. Testing LAN health & query after host window closed...")
    with urllib.request.urlopen(f"http://{LAN_HOST}:{PORT}/api/desktop/health", timeout=2) as resp:
        print(f"   [PASS] Backend still responding over LAN: {resp.status}")

    # 8. Simulate Host UI Reopening: reconnecting to existing backend
    print("\n8. Simulating Host UI Reopening & reconnect...")
    health_req = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/api/desktop/health",
        headers={"X-VS-Handshake-Token": SECRET_HANDSHAKE}
    )
    with urllib.request.urlopen(health_req, timeout=2) as resp:
        data = json.loads(resp.read().decode())
        print(f"   [PASS] Reopened Host UI successfully reconnected to running backend: {data.get('service')}")

    # 9. Disconnect LAN client and verify can_terminate flips to True
    print("\n9. Disconnecting LAN Client (revoking session)...")
    with sqlite3.connect(db_path) as conn:
        conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM devices WHERE device_id = ?", (device_id,))
        conn.execute("DELETE FROM users WHERE user_id = ?", (user_id,))
        conn.commit()

    with urllib.request.urlopen(req_pol, timeout=2) as resp:
        pol2 = json.loads(resp.read().decode())
        print(f"   Policy response after client disconnect: {pol2}")
        if pol2.get("active_lan_sessions") == 0 and pol2.get("can_terminate") is True:
            print("   [PASS] can_terminate returned to TRUE after LAN client disconnected!")
        else:
            print("   [FAIL] Policy did not return to can_terminate = TRUE!")

    # 10. Explicit shutdown
    print("\n10. Sending explicit shutdown signal /api/desktop/shutdown...")
    shut_req = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/api/desktop/shutdown",
        data=json.dumps({"force": True}).encode(),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(shut_req, timeout=2) as resp:
        print(f"   Shutdown response: {resp.read().decode()}")

    # Wait for process exit
    try:
        sidecar_proc.wait(timeout=5)
        print("   [PASS] Sidecar exited cleanly on explicit shutdown.")
    except Exception:
        print("   [WARN] Process needed terminate signal.")
        sidecar_proc.terminate()

finally:
    if sidecar_proc.poll() is None:
        sidecar_proc.terminate()
        try:
            sidecar_proc.wait(timeout=3)
        except Exception:
            sidecar_proc.kill()
    # Clean up test rows
    with sqlite3.connect(db_path) as conn:
        conn.execute("DELETE FROM sessions WHERE session_id = 'test-lan-session-phase12'")
        conn.execute("DELETE FROM devices WHERE device_id = 'test-lan-device-phase12'")
        conn.execute("DELETE FROM users WHERE user_id = 'test-lan-user-phase12'")
        conn.commit()

print("\n=================================================================")
print("TEST 2: COMPLETE")
print("=================================================================")
