import unittest
import json
import os
import sys
import winreg
import urllib.request
import time

import server

class TestWindowsAutostart(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Start server on dynamic test port
        cls.test_port = 8788
        server.start_server_background(port=cls.test_port, host="127.0.0.1")
        time.sleep(1.0)

    @classmethod
    def tearDownClass(cls):
        server.stop_server()

    def test_01_paths_and_server_registration(self):
        paths = server.get_windows_autostart_paths()
        self.assertIn("server_cmd", paths)
        self.assertIn("app_cmd", paths)
        self.assertTrue("launch_background.vbs" in paths["server_cmd"])

        reg_ok = server.ensure_server_autostart_registered()
        self.assertTrue(reg_ok)

        # Inspect HKCU\...\Run
        run_key = r"Software\Microsoft\Windows\CurrentVersion\Run"
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, run_key, 0, winreg.KEY_READ) as key:
            val, _ = winreg.QueryValueEx(key, "VSDatabaseServer")
            self.assertEqual(val, paths["server_cmd"])

    def test_02_get_and_set_app_autostart(self):
        # Enable app autostart
        res_enable = server.set_app_autostart(True)
        self.assertTrue(res_enable["ok"])
        self.assertTrue(res_enable["app_autostart"])
        self.assertTrue(res_enable["server_autostart"])

        # Verify registry has VSDatabaseApp
        run_key = r"Software\Microsoft\Windows\CurrentVersion\Run"
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, run_key, 0, winreg.KEY_READ) as key:
            val_app, _ = winreg.QueryValueEx(key, "VSDatabaseApp")
            self.assertTrue(bool(val_app))
            val_srv, _ = winreg.QueryValueEx(key, "VSDatabaseServer")
            self.assertTrue(bool(val_srv))

        # Check status function
        status = server.get_autostart_status()
        self.assertTrue(status["app_autostart"])
        self.assertTrue(status["server_autostart"])

        # Disable app autostart
        res_disable = server.set_app_autostart(False)
        self.assertTrue(res_disable["ok"])
        self.assertFalse(res_disable["app_autostart"])
        self.assertTrue(res_disable["server_autostart"])

        # Verify registry no longer has VSDatabaseApp, but STILL has VSDatabaseServer
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, run_key, 0, winreg.KEY_READ) as key:
            with self.assertRaises(OSError):
                winreg.QueryValueEx(key, "VSDatabaseApp")
            val_srv, _ = winreg.QueryValueEx(key, "VSDatabaseServer")
            self.assertTrue(bool(val_srv))

    def test_03_http_api_endpoints(self):
        # GET /api/system/autostart
        url_get = f"http://127.0.0.1:{self.test_port}/api/system/autostart"
        req_get = urllib.request.Request(url_get)
        with urllib.request.urlopen(req_get, timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode())
            self.assertTrue(data["ok"])
            self.assertTrue(data["server_autostart"])
            self.assertIn("app_autostart", data)

        # POST /api/system/autostart (enable)
        url_post = f"http://127.0.0.1:{self.test_port}/api/system/autostart"
        payload_on = json.dumps({"app_autostart": True}).encode()
        req_on = urllib.request.Request(url_post, data=payload_on, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req_on, timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            data_on = json.loads(resp.read().decode())
            self.assertTrue(data_on["ok"])
            self.assertTrue(data_on["app_autostart"])

        # POST /api/system/autostart (disable)
        payload_off = json.dumps({"app_autostart": False}).encode()
        req_off = urllib.request.Request(url_post, data=payload_off, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req_off, timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            data_off = json.loads(resp.read().decode())
            self.assertTrue(data_off["ok"])
            self.assertFalse(data_off["app_autostart"])

        # GET /api/settings
        url_settings = f"http://127.0.0.1:{self.test_port}/api/settings"
        req_settings = urllib.request.Request(url_settings)
        with urllib.request.urlopen(req_settings, timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            data_st = json.loads(resp.read().decode())
            self.assertTrue(data_st["server_autostart"])
            self.assertIn("app_autostart", data_st)

if __name__ == "__main__":
    unittest.main()
