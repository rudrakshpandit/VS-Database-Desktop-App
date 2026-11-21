import urllib.request
import json
import time
import subprocess
import sys
import os

TEST_PORT = 8799
SERVER_PY = os.path.join(os.path.dirname(__file__), "server.py")
ENV = os.environ.copy()
ENV["VS_PORT"] = str(TEST_PORT)
ENV["VS_HOST"] = "127.0.0.1"

print(f"Starting server on port {TEST_PORT} for testing...")
proc = subprocess.Popen([sys.executable, SERVER_PY, f"--port={TEST_PORT}"], env=ENV)

try:
    time.sleep(2)
    base_url = f"http://127.0.0.1:{TEST_PORT}"
    
    # 1. Test CORS Preflight OPTIONS /api/auth/setup-host
    print("\n--- Test 1: CORS Preflight OPTIONS /api/auth/setup-host ---")
    req = urllib.request.Request(
        f"{base_url}/api/auth/setup-host",
        method="OPTIONS"
    )
    req.add_header("Origin", "http://tauri.localhost")
    req.add_header("Access-Control-Request-Method", "POST")
    req.add_header("Access-Control-Request-Headers", "content-type,x-vs-app-mode,x-vs-device-id")
    with urllib.request.urlopen(req) as resp:
        print(f"Status: {resp.status}")
        cors_headers = {k.lower(): v for k, v in resp.headers.items()}
        print(f"Access-Control-Allow-Origin: {cors_headers.get('access-control-allow-origin')}")
        print(f"Access-Control-Allow-Headers: {cors_headers.get('access-control-allow-headers')}")
        assert resp.status == 204 or resp.status == 200, f"Expected 204/200, got {resp.status}"
        assert cors_headers.get("access-control-allow-origin") == "http://tauri.localhost", "Origin header mismatch"
        allowed_headers = cors_headers.get("access-control-allow-headers", "").lower()
        assert "x-vs-app-mode" in allowed_headers, "Missing x-vs-app-mode in allowed headers"
    print("PASS: CORS Preflight succeeded with x-vs-app-mode allowed!")

    # 2. Test Setup Host with X-VS-App-Mode: host
    print("\n--- Test 2: Setup Host POST /api/auth/setup-host ---")
    setup_data = json.dumps({
        "user_id": "TestAdmin",
        "full_name": "Test Administrator",
        "password": "Password123",
        "device_id": "host-device-001",
        "device_name": "Host PC"
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/api/auth/setup-host",
        data=setup_data,
        method="POST"
    )
    req.add_header("Content-Type", "application/json")
    req.add_header("Origin", "http://tauri.localhost")
    req.add_header("X-VS-App-Mode", "host")
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        print("Response:", data)
        assert data.get("ok") is True, f"Expected ok: True, got {data}"
        assert data.get("role") == "host", "Expected role: host"
        assert "token" in data or "session_token" in data, "Expected auth token in response"
        host_token = data.get("session_token") or data.get("token")
    print("PASS: Host setup succeeded and auto-activated immediate host session!")

    # 3. Test Host Login
    print("\n--- Test 3: Host Sign In POST /api/auth/login ---")
    login_data = json.dumps({
        "user_id": "TestAdmin",
        "password": "Password123",
        "device_id": "host-device-001"
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/api/auth/login",
        data=login_data,
        method="POST"
    )
    req.add_header("Content-Type", "application/json")
    req.add_header("Origin", "http://tauri.localhost")
    req.add_header("X-VS-App-Mode", "host")
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        print("Response:", data)
        assert data.get("ok") is True
        assert data.get("role") == "host"
    print("PASS: Host login immediately grants access!")

    # 4. Test Client Registration -> Pending Status
    print("\n--- Test 4: Client Registration POST /api/auth/register ---")
    reg_data = json.dumps({
        "user_id": "ClientUser1",
        "full_name": "Client Operator",
        "password": "ClientPassword123",
        "device_id": "client-device-001",
        "device_name": "Front Desk PC"
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/api/auth/register",
        data=reg_data,
        method="POST"
    )
    req.add_header("Content-Type", "application/json")
    req.add_header("Origin", "http://tauri.localhost")
    req.add_header("X-VS-App-Mode", "client")
    req.add_header("X-VS-Device-Id", "client-device-001")
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        print("Response:", data)
        assert data.get("ok") is True
        assert data.get("status") == "pending", f"Expected pending status, got {data.get('status')}"
    print("PASS: Client register creates pending request waiting for Host approval!")

    # 5. Host views pending requests and approves with PIN
    print("\n--- Test 5: Host views requests & approves client with PIN ---")
    req = urllib.request.Request(f"{base_url}/api/admin/users", method="GET")
    req.add_header("X-VS-Session-Token", host_token)
    req.add_header("X-VS-App-Mode", "host")
    with urllib.request.urlopen(req) as resp:
        admin_data = json.loads(resp.read().decode("utf-8"))
        requests = admin_data.get("requests", [])
        print(f"Pending requests count: {len(requests)}")
        client_req = next((r for r in requests if r.get("user_id") == "ClientUser1"), None)
        assert client_req is not None, "Pending client request not found"
        req_id = client_req["request_id"]
        print(f"Found request ID: {req_id}")

    approve_data = json.dumps({"request_id": req_id, "role": "staff"}).encode("utf-8")
    req = urllib.request.Request(f"{base_url}/api/admin/requests/approve", data=approve_data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-VS-Session-Token", host_token)
    req.add_header("X-VS-App-Mode", "host")
    with urllib.request.urlopen(req) as resp:
        app_res = json.loads(resp.read().decode("utf-8"))
        print("Approve response:", app_res)
        assert app_res.get("ok") is True
        pin = app_res.get("pin")
        assert pin and len(str(pin)) == 6, f"Expected 6-digit PIN, got {pin}"
        print(f"Generated 6-digit approval PIN: {pin}")

    # 6. Client enters PIN to verify and activate
    print("\n--- Test 6: Client verifies PIN POST /api/auth/verify-approval-pin ---")
    pin_data = json.dumps({
        "user_id": "ClientUser1",
        "device_id": "client-device-001",
        "pin": pin
    }).encode("utf-8")
    req = urllib.request.Request(f"{base_url}/api/auth/verify-approval-pin", data=pin_data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Origin", "http://tauri.localhost")
    req.add_header("X-VS-App-Mode", "client")
    req.add_header("X-VS-Device-Id", "client-device-001")
    with urllib.request.urlopen(req) as resp:
        pin_res = json.loads(resp.read().decode("utf-8"))
        print("Pin verification response:", pin_res)
        assert pin_res.get("ok") is True
        assert "token" in pin_res or "session_token" in pin_res
        client_token = pin_res.get("session_token") or pin_res.get("token")
        print("PASS: Client logged in with verified PIN, token acquired!")

    # 7. Consecutive Sync Fast Poll Test
    print("\n--- Test 7: Consecutive Sync Speed & Versioning ---")
    req = urllib.request.Request(f"{base_url}/api/sync/version", method="GET")
    req.add_header("X-VS-Session-Token", client_token)
    req.add_header("X-VS-App-Mode", "client")
    t0 = time.time()
    with urllib.request.urlopen(req) as resp:
        sync_res = json.loads(resp.read().decode("utf-8"))
        elapsed_ms = (time.time() - t0) * 1000
        print(f"Sync version response in {elapsed_ms:.2f}ms:", sync_res)
        assert "version" in sync_res
        assert elapsed_ms < 500, f"Sync check took {elapsed_ms}ms, should be <500ms"
    print("PASS: Fast sync endpoint responded instantly!")

    print("\n========================================================")
    print("ALL 7 SUITE TESTS PASSED DETERMINISTICALLY WITH 0 ERRORS!")
    print("========================================================")

finally:
    proc.terminate()
    try:
        proc.wait(timeout=3)
    except Exception:
        proc.kill()
