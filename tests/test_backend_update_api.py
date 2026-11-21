"""
Backend Update API & License Verification Test Suite for VS Database Release v2.2.2
"""
import sys
import os
import json
import threading
import urllib.request
from http.server import HTTPServer
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from server import check_for_system_updates, Handler

def test_backend_direct_calls():
    print("\n--- 1. Testing check_for_system_updates() directly ---")
    
    # 1a) Outdated installation (2.2.1)
    res_221 = check_for_system_updates("2.2.1")
    print(f"cur_version='2.2.1' result:\n{json.dumps(res_221, indent=2)}")
    
    assert res_221["update_available"] is True, "Expected update_available=True for v2.2.1"
    assert res_221["latest_version"] == "2.2.2", f"Expected latest_version='2.2.2', got {res_221['latest_version']}"
    assert "VS.Database.Host.Setup.exe" in res_221["host_download_url"], f"Host download url does not point to VS.Database.Host.Setup.exe: {res_221['host_download_url']}"
    assert "releases/download/v2.2.2" in res_221["host_download_url"], f"Host download url not pointing to v2.2.2 release: {res_221['host_download_url']}"
    assert "VS.Database.Client.Setup.exe" in res_221["client_download_url"], f"Client download url does not point to VS.Database.Client.Setup.exe: {res_221['client_download_url']}"
    assert "releases/download/v2.2.2" in res_221["client_download_url"], f"Client download url not pointing to v2.2.2 release: {res_221['client_download_url']}"
    assert res_221.get("release_notes") and len(res_221["release_notes"].strip()) > 0, "Expected release_notes to be non-empty"
    print("✓ PASS: Outdated v2.2.1 properly detects v2.2.2 update, release assets, and release notes.")

    # 1b) Current installation (2.2.2)
    res_222 = check_for_system_updates("2.2.2")
    print(f"\ncur_version='2.2.2' result:\n{json.dumps(res_222, indent=2)}")
    
    assert res_222["update_available"] is False, "Expected update_available=False for v2.2.2"
    assert res_222["latest_version"] == "2.2.2", f"Expected latest_version='2.2.2', got {res_222['latest_version']}"
    assert "up to date" in res_222["message"].lower(), f"Expected message indicating up to date: {res_222['message']}"
    print("✓ PASS: Up-to-date v2.2.2 reports update_available=False.")

def test_live_http_server():
    print("\n--- 2. Testing HTTP endpoint /api/system/check-updates ---")
    server = HTTPServer(('127.0.0.1', 0), Handler)
    port = server.server_port
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    
    try:
        # Request for 2.2.1
        url_221 = f"http://127.0.0.1:{port}/api/system/check-updates?version=2.2.1"
        req = urllib.request.Request(url_221)
        with urllib.request.urlopen(req, timeout=5) as resp:
            assert resp.status == 200, f"Expected 200 OK, got {resp.status}"
            data_221 = json.loads(resp.read().decode())
        
        assert data_221["update_available"] is True
        assert data_221["latest_version"] == "2.2.2"
        assert "VS.Database.Host.Setup.exe" in data_221["host_download_url"]
        assert "VS.Database.Client.Setup.exe" in data_221["client_download_url"]
        print(f"✓ PASS: HTTP GET /api/system/check-updates?version=2.2.1 returned update_available=True (v{data_221['latest_version']}).")

        # Request for 2.2.2
        url_222 = f"http://127.0.0.1:{port}/api/system/check-updates?version=2.2.2"
        req = urllib.request.Request(url_222)
        with urllib.request.urlopen(req, timeout=5) as resp:
            assert resp.status == 200, f"Expected 200 OK, got {resp.status}"
            data_222 = json.loads(resp.read().decode())

        assert data_222["update_available"] is False
        assert data_222["latest_version"] == "2.2.2"
        print(f"✓ PASS: HTTP GET /api/system/check-updates?version=2.2.2 returned update_available=False.")
    finally:
        server.shutdown()
        server.server_close()

def test_license_file():
    print("\n--- 3. Testing License file in repository root ---")
    license_path = PROJECT_ROOT / "License"
    assert license_path.exists(), f"License file does not exist at {license_path}"
    
    with open(license_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    
    assert len(lines) >= 4, "License file is shorter than expected"
    line_3 = lines[2].strip()
    line_4 = lines[3].strip()
    print(f"Line 3: {line_3}")
    print(f"Line 4: {line_4}")
    
    assert "Software:         VS Database, Version 2.2.3" in lines[2], f"Line 3 does not match expected version 2.2.3: '{lines[2]}'"
    assert "2026" in line_4 and "Copyright" in line_4, f"Line 4 does not state Copyright 2026: '{line_4}'"
    print("✓ PASS: License file correctly states 'Software: VS Database, Version 2.2.3', Copyright 2026.")

if __name__ == "__main__":
    test_backend_direct_calls()
    test_live_http_server()
    test_license_file()
    print("\n==============================================")
    print("ALL BACKEND & LICENSE VERIFICATION TESTS PASSED")
    print("==============================================")
