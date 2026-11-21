"""
Comprehensive Test Suite for Backend Update & Download Engine in server.py
Tests:
  1. Initial and dynamic update progress state
  2. Asynchronous chunked download execution (Host and Client)
  3. Seamless fallback to local Build_Latest / target release bundles
  4. HTTP GET /api/system/update-progress
  5. HTTP POST /api/system/start-update-download
  6. HTTP GET /api/system/download-update (for both Host & Client)
  7. HTTP POST /api/system/execute-update-restart
  8. CORS and Content-Disposition headers
"""
import sys
import os
import json
import time
import threading
import urllib.request
from http.server import HTTPServer
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# Prevent self-termination during test execution
os.environ["VS_TEST_NO_EXIT"] = "1"

from server import (
    Handler,
    get_update_download_state,
    start_background_update_download,
    execute_restart_update,
    _update_download_state,
    _update_download_lock
)


def test_state_schema_and_direct_download():
    print("\n--- 1. Testing get_update_download_state() schema ---")
    state = get_update_download_state()
    print(f"Current state: {state}")
    expected_keys = [
        "status", "percentage", "downloaded_bytes", "total_bytes",
        "speed_kbps", "target_version", "installer_path", "error"
    ]
    for key in expected_keys:
        assert key in state, f"Missing key '{key}' in _update_download_state"
    print("✓ PASS: Update progress state contains all required schema keys.")

    print("\n--- 2. Testing start_background_update_download('2.2.2', 'host') ---")
    start_res = start_background_update_download(target_ver="2.2.2", product="host")
    assert start_res.get("ok") is True, f"Failed to start download: {start_res}"
    assert start_res.get("status") == "downloading"
    print("✓ PASS: Background download initiated successfully.")

    # Poll until completed or timeout
    max_wait = 15.0
    start_t = time.time()
    observed_intermediate = False
    final_state = None

    while time.time() - start_t < max_wait:
        cur = get_update_download_state()
        if cur["status"] == "downloading" and cur["downloaded_bytes"] > 0:
            observed_intermediate = True
        if cur["status"] in ("complete", "error"):
            final_state = cur
            break
        time.sleep(0.05)

    assert final_state is not None, "Timed out waiting for download to complete"
    print(f"Final state: {final_state}")
    assert final_state["status"] == "complete", f"Download failed with status: {final_state}"
    assert final_state["percentage"] == 100, f"Expected 100%, got {final_state['percentage']}"
    assert final_state["total_bytes"] > 0, "Expected total_bytes > 0"
    assert final_state["downloaded_bytes"] == final_state["total_bytes"]
    assert final_state["installer_path"], "Installer path was not recorded"
    assert os.path.isfile(final_state["installer_path"]), f"Installer file does not exist at {final_state['installer_path']}"
    print(f"✓ PASS: Host installer successfully downloaded/staged at: {final_state['installer_path']} ({final_state['downloaded_bytes']} bytes)")


def test_execute_restart_update():
    print("\n--- 3. Testing execute_restart_update() ---")
    state = get_update_download_state()
    inst_path = state.get("installer_path")
    assert inst_path and os.path.isfile(inst_path), "Valid installer_path required from previous step"

    # 3a: Non-existent file should raise FileNotFoundError
    try:
        execute_restart_update("C:\\non_existent_path_update_setup.exe")
        assert False, "Expected FileNotFoundError for non-existent installer"
    except FileNotFoundError:
        print("✓ PASS: execute_restart_update properly rejected non-existent installer path.")

    # 3b: Valid installer file with VS_TEST_NO_EXIT=1
    res = execute_restart_update(inst_path)
    assert res.get("ok") is True
    assert "Restarting application" in res.get("message", "")
    print(f"✓ PASS: execute_restart_update successfully spawned detached batch runner for {inst_path}.")


def test_live_http_endpoints():
    print("\n--- 4. Testing Live HTTP Endpoints for Update Engine ---")
    server = HTTPServer(('127.0.0.1', 0), Handler)
    port = server.server_port
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    base_url = f"http://127.0.0.1:{port}"

    try:
        # 4a: GET /api/system/update-progress
        print("\n--> 4a: GET /api/system/update-progress")
        req = urllib.request.Request(f"{base_url}/api/system/update-progress")
        with urllib.request.urlopen(req, timeout=5) as resp:
            assert resp.status == 200
            cors = resp.headers.get("Access-Control-Allow-Origin")
            assert cors is not None, "Missing Access-Control-Allow-Origin header"
            data = json.loads(resp.read().decode())
            assert "status" in data
            assert "percentage" in data
            print(f"✓ PASS: /api/system/update-progress returned 200 OK with CORS: {cors}")

        # 4b: GET /api/system/download-update?product=host
        print("\n--> 4b: GET /api/system/download-update?product=host")
        req_dl_host = urllib.request.Request(f"{base_url}/api/system/download-update?product=host")
        with urllib.request.urlopen(req_dl_host, timeout=5) as resp:
            assert resp.status == 200
            assert resp.headers.get("Content-Type") == "application/octet-stream"
            disp = resp.headers.get("Content-Disposition", "")
            assert "VS Database Host Setup.exe" in disp
            assert resp.headers.get("Access-Control-Expose-Headers") == "Content-Disposition"
            assert resp.headers.get("Access-Control-Allow-Origin") is not None
            cl = int(resp.headers.get("Content-Length", 0))
            assert cl > 1000000, f"Expected host installer size > 1MB, got {cl}"
            # Read first 1024 bytes to verify streaming works
            header_bytes = resp.read(1024)
            assert len(header_bytes) == 1024
            assert header_bytes[:2] == b"MZ", "Expected Windows PE executable MZ magic bytes"
            print(f"✓ PASS: /api/system/download-update?product=host served binary ({cl} bytes) with MZ signature & CORS headers.")

        # 4c: GET /api/system/download-update?product=client
        print("\n--> 4c: GET /api/system/download-update?product=client")
        req_dl_client = urllib.request.Request(f"{base_url}/api/system/download-update?product=client")
        with urllib.request.urlopen(req_dl_client, timeout=5) as resp:
            assert resp.status == 200
            assert resp.headers.get("Content-Type") == "application/octet-stream"
            disp = resp.headers.get("Content-Disposition", "")
            assert "VS Database Client Setup.exe" in disp
            assert resp.headers.get("Access-Control-Expose-Headers") == "Content-Disposition"
            assert resp.headers.get("Access-Control-Allow-Origin") is not None
            cl = int(resp.headers.get("Content-Length", 0))
            assert cl > 1000000, f"Expected client installer size > 1MB, got {cl}"
            header_bytes = resp.read(1024)
            assert header_bytes[:2] == b"MZ"
            print(f"✓ PASS: /api/system/download-update?product=client served binary ({cl} bytes) with MZ signature & CORS headers.")

        # 4d: POST /api/system/start-update-download
        print("\n--> 4d: POST /api/system/start-update-download")
        post_body = json.dumps({"version": "2.2.2", "product": "client"}).encode("utf-8")
        req_post_start = urllib.request.Request(
            f"{base_url}/api/system/start-update-download",
            data=post_body,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req_post_start, timeout=5) as resp:
            assert resp.status == 200
            data = json.loads(resp.read().decode())
            assert data.get("ok") is True
            assert data.get("status") == "downloading"
            print(f"✓ PASS: /api/system/start-update-download returned 200 OK with: {data}")

        # Wait for client download completion
        for _ in range(60):
            req_prog = urllib.request.Request(f"{base_url}/api/system/update-progress")
            with urllib.request.urlopen(req_prog, timeout=5) as resp:
                p_data = json.loads(resp.read().decode())
                if p_data["status"] in ("complete", "error"):
                    break
            time.sleep(0.05)

        assert p_data["status"] == "complete", f"Client download ended with: {p_data}"
        assert p_data["percentage"] == 100
        print(f"✓ PASS: Asynchronous client download completed at 100% via API polling.")

        # 4e: POST /api/system/execute-update-restart
        print("\n--> 4e: POST /api/system/execute-update-restart")
        post_restart = json.dumps({"installer_path": p_data["installer_path"]}).encode("utf-8")
        req_restart = urllib.request.Request(
            f"{base_url}/api/system/execute-update-restart",
            data=post_restart,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req_restart, timeout=5) as resp:
            assert resp.status == 200
            r_data = json.loads(resp.read().decode())
            assert r_data.get("ok") is True
            assert "Restarting application" in r_data.get("message", "")
            print(f"✓ PASS: /api/system/execute-update-restart returned 200 OK with: {r_data}")

    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    test_state_schema_and_direct_download()
    test_execute_restart_update()
    test_live_http_endpoints()
    print("\n=======================================================")
    print("ALL UPDATE & DOWNLOAD ENGINE VERIFICATION TESTS PASSED!")
    print("=======================================================")
