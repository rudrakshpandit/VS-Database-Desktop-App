"""
VS Database - Standalone Windows Desktop Application
Powered by Python & Microsoft WebView2 (EdgeChromium)
"""
from __future__ import annotations
import multiprocessing
import os
import sys
import time
import urllib.request
import ctypes

# 1. CRITICAL: Windows freeze_support to prevent any child process recursion
if __name__ == "__main__":
    multiprocessing.freeze_support()

# 2. Set AppUserModelID so Windows Taskbar associates the window with our custom application and icon
if sys.platform == "win32":
    try:
        myappid = "vsdatabase.officeautomation.desktopapp.1.0"
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(myappid)
    except Exception:
        pass

# 3. Determine Application Directory
if getattr(sys, "frozen", False):
    BUNDLE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    APP_DIR = os.path.dirname(sys.executable)
else:
    BUNDLE_DIR = os.path.dirname(os.path.abspath(__file__))
    APP_DIR = BUNDLE_DIR

os.chdir(APP_DIR)
sys.path.insert(0, APP_DIR)
if BUNDLE_DIR not in sys.path:
    sys.path.insert(0, BUNDLE_DIR)

# Ensure user site-packages and system site-packages are available for external dependencies (PyMuPDF, etc.)
import site
try:
    user_sp = site.getusersitepackages()
    if user_sp and os.path.exists(user_sp) and user_sp not in sys.path:
        sys.path.append(user_sp)
except Exception:
    pass

appdata = os.environ.get("APPDATA", "")
if appdata:
    py_roaming = os.path.join(appdata, "Python")
    if os.path.exists(py_roaming):
        for entry in os.listdir(py_roaming):
            sp = os.path.join(py_roaming, entry, "site-packages")
            if os.path.exists(sp) and sp not in sys.path:
                sys.path.append(sp)

for pdir in [r"C:\Python314\Lib\site-packages", r"C:\Python313\Lib\site-packages", r"C:\Python312\Lib\site-packages", r"C:\Python314"]:
    if os.path.exists(pdir) and pdir not in sys.path:
        sys.path.append(pdir)

# 4. Safely handle stdout/stderr for GUI windowed binary
try:
    log_dir = os.path.join(APP_DIR, "data")
    os.makedirs(log_dir, exist_ok=True)
    out_f = open(os.path.join(log_dir, "stdout.log"), "a", encoding="utf-8", buffering=1)
    err_f = open(os.path.join(log_dir, "stderr.log"), "a", encoding="utf-8", buffering=1)
    sys.stdout = out_f
    sys.stderr = err_f
    print(f"\n--- Application Launched at {time.ctime()} (frozen={getattr(sys, 'frozen', False)}) ---")
    sys.stdout.flush()
except Exception as log_exc:
    pass

import logging
try:
    logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
    logging.getLogger("pywebview").setLevel(logging.DEBUG)
except Exception:
    pass

try:
    import server
    print("[Main] imported server successfully", flush=True)
    import webview
    print("[Main] imported webview successfully", flush=True)
except Exception as exc:
    print(f"[Main Import Error] {exc}", flush=True)
    import traceback
    traceback.print_exc()
    sys.stdout.flush()

import socket
import json

DESKTOP_PORT = 8767


def find_available_port(start_port: int = 8767, max_port: int = 8799) -> int:
    """Finds the first available TCP port, strongly preferring start_port (8767) for extension bridge."""
    for _ in range(5):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(("127.0.0.1", start_port))
                return start_port
            except OSError:
                time.sleep(0.15)
                continue
    for p in range(start_port + 1, max_port + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    return start_port


class DesktopBridge:
    """Native Python APIs directly exposed to the JavaScript window (window.pywebview.api)."""
    def __init__(self):
        self.window = None
        self._is_maximized = False

    def set_window(self, window):
        self.window = window

    def minimize_window(self):
        if self.window:
            self.window.minimize()
            return {"ok": True}
        return {"ok": False}

    def maximize_window(self):
        if self.window:
            if self._is_maximized:
                self.window.restore()
                self._is_maximized = False
            else:
                self.window.maximize()
                self._is_maximized = True
            return {"ok": True, "maximized": self._is_maximized}
        return {"ok": False}

    def close_window(self):
        if self.window:
            self.window.destroy()
            return {"ok": True}
        return {"ok": False}

    def open_local_folder(self, folder_path: str):
        try:
            return {"ok": True, "path": server.open_in_file_manager(folder_path)}
        except Exception as exc:
            return {"error": str(exc)}

    def check_updates(self):
        try:
            return server.check_for_system_updates()
        except Exception as exc:
            return {"error": str(exc), "update_available": False}

    def apply_update(self):
        try:
            return server.apply_system_update()
        except Exception as exc:
            return {"error": str(exc), "ok": False}


def is_server_healthy(port: int) -> bool:
    """Checks the lightweight desktop health endpoint."""
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/desktop/health")
        with urllib.request.urlopen(req, timeout=0.4) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("ok") is True
    except Exception:
        pass
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/health")
        with urllib.request.urlopen(req, timeout=0.4) as resp:
            return resp.status == 200
    except Exception:
        return False


def main():
    global DESKTOP_PORT
    print(f"[Main] Entering main(), argv={sys.argv}", flush=True)

    # 1. Inspect CLI arguments for Windows protocol handler or Companion Extension launch
    is_from_ext = False
    for arg in sys.argv[1:]:
        arg_lower = str(arg).lower()
        if "from_extension" in arg_lower or "vs-database" in arg_lower or "extension" in arg_lower or "skip_animation" in arg_lower:
            is_from_ext = True
            break

    # 2. Single-Instance Guard: If application server is already active, attempt to focus existing window
    server_already_running = is_server_healthy(DESKTOP_PORT)
    print(f"[Main] server_already_running={server_already_running} on port {DESKTOP_PORT}", flush=True)
    if server_already_running:
        brought = False
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{DESKTOP_PORT}/api/desktop/bring_to_front",
                data=b"{}",
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=1.2) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    print(f"[Main] Existing server bring_to_front response: {data}", flush=True)
                    if data.get("ok") and data.get("brought_to_front"):
                        brought = True
        except Exception as b_exc:
            print(f"[Main] bring_to_front request error: {b_exc}", flush=True)
        if brought:
            print("[Main] Existing window brought to front. Exiting duplicate instance.")
            sys.exit(0)

    # 3. Start dedicated desktop server in background (only if not already running)
    if not server_already_running:
        DESKTOP_PORT = find_available_port(8767, 8799)
        print(f"[Main] Starting background server on port {DESKTOP_PORT}...")
        sys.stdout.flush()
        server.start_server_background(port=DESKTOP_PORT)
        for _ in range(50):
            time.sleep(0.06)
            if is_server_healthy(DESKTOP_PORT):
                print(f"[Main] Server verified healthy on port {DESKTOP_PORT}")
                sys.stdout.flush()
                break
    else:
        print(f"[Main] Reusing existing healthy server on port {DESKTOP_PORT} to open window.")
        sys.stdout.flush()

    # 4. Prepare window & icon
    bridge = DesktopBridge()
    icon_p = os.path.join(APP_DIR, "static", "app_icon.ico")
    if not os.path.exists(icon_p):
        icon_p = os.path.join(BUNDLE_DIR, "static", "app_icon.ico")

    extra_params = "&from_extension=1&skip_animation=1#save" if is_from_ext else ""
    target_url = f"http://127.0.0.1:{DESKTOP_PORT}/?desktop_app=1{extra_params}"
    print(f"[Main] Creating WebView2 window: {target_url}")
    sys.stdout.flush()

    window = webview.create_window(
        title="VS Database",
        url=target_url,
        js_api=None,
        width=1360,
        height=860,
        min_size=(1080, 700),
        background_color="#eef2ff",
        frameless=False,
        text_select=True,
        zoomable=True
    )

    # 5. Launch native Microsoft WebView2 container
    print("[Main] Starting webview container (edgechromium)...")
    sys.stdout.flush()
    try:
        webview.start(gui="edgechromium", debug=False, icon=icon_p, private_mode=False)
        print("[Main] webview.start finished cleanly")
    except Exception as exc:
        print(f"[Main] webview.start error: {exc}")
        import traceback
        traceback.print_exc()
    sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[Main Fatal Error] {exc}")
        import traceback
        traceback.print_exc()
        sys.stdout.flush()
