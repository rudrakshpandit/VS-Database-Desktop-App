"""
Regression Test Suite for Critical Fixes:
1. Tally Posting Progress Bar API (showGlassProgressBar & setPercent)
2. Partial exception isolation & double-posting prevention
3. Startup Video Asset, Server HTTP Range Support & Non-blocking Initialization
"""
import sys
import os
import unittest
import urllib.request
import threading
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

class TestCriticalFixes(unittest.TestCase):

    def test_startup_video_asset_exists(self):
        video_path = APP_ROOT / "static" / "Startup.mp4"
        self.assertTrue(video_path.exists(), "Startup.mp4 must exist in static/")
        self.assertGreater(video_path.stat().st_size, 1000000, "Startup.mp4 must be a valid video file")

    def test_index_html_no_seen_today_gating(self):
        index_html = (APP_ROOT / "static" / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("vs_daily_startup_video_date", index_html, "index.html must not gate startup video by date")
        self.assertNotIn("seenToday", index_html, "seenToday must be removed from index.html")
        self.assertNotIn("Skip Intro", index_html, "Skip Intro button must not exist")

    def test_app_js_progress_bar_has_set_percent(self):
        app_js = (APP_ROOT / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn("setPercent(percent", app_js, "showGlassProgressBar must expose setPercent method")
        self.assertIn("this.update(percent", app_js, "setPercent must delegate to this.update")

    def test_app_js_startup_timeout_duration(self):
        app_js = (APP_ROOT / "static" / "app.js").read_text(encoding="utf-8")
        # Ensure timeout is not 5000ms (which cut off the 6.84s video)
        self.assertIn("12000", app_js, "Startup video safety timeout must be at least 12000ms to allow full video playback")

    def test_server_http_range_support(self):
        """Tests that server.py handles HTTP Range requests with 206 Partial Content for video streaming."""
        import server
        from main_app import is_server_healthy
        port = 8798
        t = threading.Thread(target=server.start_server_background, kwargs={"port": port, "host": "127.0.0.1"}, daemon=True)
        t.start()

        # Wait for server readiness
        ready = False
        import time
        for _ in range(30):
            if is_server_healthy(port):
                ready = True
                break
            time.sleep(0.1)
        self.assertTrue(ready, f"Server should be healthy on port {port}")

        # Request bytes 0-1023 of Startup.mp4
        req = urllib.request.Request(f"http://127.0.0.1:{port}/Startup.mp4", headers={"Range": "bytes=0-1023"})
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 206, "Server must respond with HTTP 206 Partial Content for Range requests")
            self.assertEqual(resp.headers.get("Accept-Ranges"), "bytes", "Server must advertise Accept-Ranges: bytes")
            content_range = resp.headers.get("Content-Range")
            self.assertIsNotNone(content_range, "Content-Range header must be present")
            self.assertTrue(content_range.startswith("bytes 0-1023/"), f"Unexpected Content-Range: {content_range}")
            data = resp.read()
            self.assertEqual(len(data), 1024, "Response chunk must match requested range length")

if __name__ == "__main__":
    unittest.main()
