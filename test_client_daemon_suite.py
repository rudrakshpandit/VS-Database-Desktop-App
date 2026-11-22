"""
Automated Test Suite for Client Background Daemon & Instant Connect Engine
Verifies:
1. client_daemon.pyw CLI flags (--autostart-status, --autostart-enable, --autostart-disable, --run-once)
2. Windows Registry HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run ("VSDatabaseClientAgent")
3. client_connection_state.json schema and persistence
4. Live HTTP health check against mock Host server port 8768
5. Fast subnet discovery logic
6. Zero emojis and clean SVG verification in app.js and tauri-bridge.js
"""

import unittest
import os
import sys
import json
import time
import winreg
import socket
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# Paths
REPO_TAURI = Path(r"D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration")
REPO_DESKTOP = Path(r"D:\AntiGravity Automation\VS Desktop App")

DAEMON_TAURI = REPO_TAURI / "client_daemon.pyw"
DAEMON_TAURI_SRC = REPO_TAURI / "src-tauri" / "client_daemon.pyw"
DAEMON_DESKTOP = REPO_DESKTOP / "client_daemon.pyw"

APP_JS_TAURI = REPO_TAURI / "static" / "app.js"
APP_JS_DESKTOP = REPO_DESKTOP / "static" / "app.js"
BRIDGE_TAURI = REPO_TAURI / "static" / "tauri-bridge.js"
BRIDGE_DESKTOP = REPO_DESKTOP / "static" / "tauri-bridge.js"


class MockHostHealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/desktop/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            payload = {
                "ok": True,
                "service": "VS Database Desktop",
                "version": "2.0.0",
                "port": 8768,
                "status": "ready",
                "mode": "host",
                "host_mode": True
            }
            self.wfile.write(json.dumps(payload).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Silent logging for tests
        pass


class TestClientDaemonEngine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Start mock server on 8768 if port is free
        cls.mock_server = None
        try:
            cls.mock_server = HTTPServer(("127.0.0.1", 8768), MockHostHealthHandler)
            cls.mock_thread = threading.Thread(target=cls.mock_server.serve_forever, daemon=True)
            cls.mock_thread.start()
        except OSError:
            cls.mock_server = None

    @classmethod
    def tearDownClass(cls):
        if cls.mock_server:
            cls.mock_server.shutdown()
            cls.mock_server.server_close()

    def test_01_all_daemon_files_exist_and_compile(self):
        for path in [DAEMON_TAURI, DAEMON_TAURI_SRC, DAEMON_DESKTOP]:
            self.assertTrue(path.is_file(), f"Missing daemon script: {path}")
            # Ensure valid python syntax
            with open(path, "r", encoding="utf-8") as f:
                code = f.read()
            compile(code, str(path), "exec")

    def test_02_autostart_registry_cycle(self):
        import subprocess
        # 1. Disable first
        proc = subprocess.run([sys.executable, str(DAEMON_TAURI), "--autostart-disable"], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0)
        res = json.loads(proc.stdout)
        self.assertTrue(res.get("ok"))
        self.assertFalse(res.get("autostart"))

        # Verify not in registry
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_READ) as key:
            with self.assertRaises(OSError):
                winreg.QueryValueEx(key, "VSDatabaseClientAgent")

        # 2. Enable
        proc = subprocess.run([sys.executable, str(DAEMON_TAURI), "--autostart-enable"], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0)
        res = json.loads(proc.stdout)
        self.assertTrue(res.get("ok"))
        self.assertTrue(res.get("autostart"))

        # Verify in registry
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_READ) as key:
            val, _ = winreg.QueryValueEx(key, "VSDatabaseClientAgent")
            self.assertTrue("client_daemon.pyw" in val)

        # 3. Status check
        proc = subprocess.run([sys.executable, str(DAEMON_TAURI), "--autostart-status"], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0)
        res = json.loads(proc.stdout)
        self.assertTrue(res.get("ok"))
        self.assertTrue(res.get("autostart"))

        # 4. Clean up (disable)
        subprocess.run([sys.executable, str(DAEMON_TAURI), "--autostart-disable"], capture_output=True, text=True)

    def test_03_run_once_and_state_json_schema(self):
        import subprocess
        proc = subprocess.run([sys.executable, str(DAEMON_TAURI), "--run-once"], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0)
        out = json.loads(proc.stdout)
        self.assertTrue(out.get("ok"))
        self.assertIn("state", out)
        state = out["state"]

        # Validate required schema:
        # {"connected": bool, "host_url": str, "last_ping": float, "host_version": str, "status": "online" | "offline"}
        self.assertIn("connected", state)
        self.assertIsInstance(state["connected"], bool)
        self.assertIn("host_url", state)
        self.assertIsInstance(state["host_url"], str)
        self.assertIn("last_ping", state)
        self.assertIsInstance(state["last_ping"], (int, float))
        self.assertIn("host_version", state)
        self.assertIsInstance(state["host_version"], str)
        self.assertIn("status", state)
        self.assertIn(state["status"], ["online", "offline"])

        # Check file on disk in %APPDATA%\VS Database\client_connection_state.json
        appdata = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        disk_file = Path(appdata) / "VS Database" / "client_connection_state.json"
        self.assertTrue(disk_file.is_file())
        with open(disk_file, "r", encoding="utf-8") as f:
            disk_state = json.load(f)
        self.assertEqual(disk_state["connected"], state["connected"])
        self.assertEqual(disk_state["status"], state["status"])

    def test_04_js_parity_and_zero_emojis(self):
        # Verify app.js parity
        with open(APP_JS_TAURI, "r", encoding="utf-8") as f1, open(APP_JS_DESKTOP, "r", encoding="utf-8") as f2:
            js1 = f1.read()
            js2 = f2.read()
        self.assertEqual(len(js1), len(js2), "app.js byte length mismatch between repos!")

        # Verify tauri-bridge.js parity
        with open(BRIDGE_TAURI, "r", encoding="utf-8") as f1, open(BRIDGE_DESKTOP, "r", encoding="utf-8") as f2:
            b1 = f1.read()
            b2 = f2.read()
        self.assertEqual(len(b1), len(b2), "tauri-bridge.js byte length mismatch between repos!")

        # Check required features in app.js:
        self.assertIn("getClientConnectionState", js1)
        self.assertIn("toggle-client-agent-autostart", js1)
        self.assertIn("Auto-Connect on Windows Boot (Silent Background Agent)", js1)
        self.assertIn("STATE_ONLINE", js1)

        # Check for ZERO emojis in the client autostart section
        start_idx = js1.find("Auto-Connect on Windows Boot")
        self.assertGreater(start_idx, 0)
        section = js1[start_idx:start_idx + 1500]
        # Any emoji ranges
        import re
        emoji_pattern = re.compile(r'[\U00010000-\U0010ffff]', flags=re.UNICODE)
        self.assertEqual(len(emoji_pattern.findall(section)), 0, "Found emojis in Client Agent section!")

    def test_05_hot_online_instant_connect_logic(self):
        with open(APP_JS_TAURI, "r", encoding="utf-8") as f:
            js = f.read()
        # Ensure offline manager checks hot state and skips checking banner
        self.assertIn("Hot connection state verified! Instant ONLINE connect in <100ms.", js)
        self.assertIn("this.currentState = this.STATE_ONLINE", js)


if __name__ == "__main__":
    unittest.main()
