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
import uuid
import threading
from datetime import datetime, timezone

DESKTOP_PORT = 8767


def get_backend_state(port: int = 8767, timeout: float = 0.5) -> dict | None:
    """Retrieves full backend lifecycle and UI attachment status."""
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/desktop/state")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode("utf-8"))
    except Exception:
        pass
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/desktop/health")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                return {"ok": True, "backend_state": "READY", "ui": {"attached": False}}
    except Exception:
        pass
    return None


def attach_ui(port: int, instance_id: str, pid: int, hwnd: int = None, force: bool = False) -> bool:
    try:
        payload = json.dumps({"instance_id": instance_id, "pid": pid, "hwnd": hwnd, "force": force}).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/desktop/ui-attach",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=1.0) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("ok") is True
    except Exception as exc:
        print(f"[Main] attach_ui notice: {exc}", flush=True)
    return False


def detach_ui(port: int, instance_id: str) -> bool:
    try:
        payload = json.dumps({"instance_id": instance_id}).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/desktop/ui-detach",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=0.8) as resp:
            return resp.status == 200
    except Exception:
        return False


def send_heartbeat(port: int, instance_id: str, pid: int, hwnd: int = None) -> bool:
    try:
        payload = json.dumps({"instance_id": instance_id, "pid": pid, "hwnd": hwnd}).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/desktop/heartbeat",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=0.8) as resp:
            return resp.status == 200
    except Exception:
        return False


def record_startup_telemetry(mode: str, t_first_window_ms: float, t_usable_dashboard_ms: float):
    try:
        telemetry_file = os.path.join(APP_DIR, "data", "startup_telemetry.log")
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "mode": mode,
            "time_to_first_window_ms": t_first_window_ms,
            "time_to_usable_dashboard_ms": t_usable_dashboard_ms,
            "python_version": sys.version.split()[0],
            "frozen": getattr(sys, "frozen", False)
        }
        with open(telemetry_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


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
    launch_start_time = time.perf_counter()
    ui_instance_id = uuid.uuid4().hex
    print(f"[Main] Entering main(), argv={sys.argv}, instance_id={ui_instance_id}", flush=True)

    # 1. Inspect CLI arguments for Windows protocol handler or Companion Extension launch
    is_from_ext = False
    target_route = None
    for arg in sys.argv[1:]:
        arg_str = str(arg)
        arg_lower = arg_str.lower()
        if any(k in arg_lower for k in ("from_extension", "vs-database", "extension", "skip_animation")):
            is_from_ext = True
        if "#save" in arg_lower or "route=save" in arg_lower:
            target_route = "#save"
        elif "#activity" in arg_lower:
            target_route = "#activity"
        elif "#clients" in arg_lower:
            target_route = "#clients"

    if is_from_ext and not target_route:
        target_route = "#save"

    # 2. Strict Single-Instance Windows Mutex Guard
    _instance_mutex = None
    is_duplicate = False
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        MUTEX_NAME = "Local\\VS_Database_Single_Instance_Mutex_2026"
        _instance_mutex = kernel32.CreateMutexW(None, False, MUTEX_NAME)
        last_error = kernel32.GetLastError()
        is_duplicate = (last_error in (183, 5))  # ERROR_ALREADY_EXISTS, ERROR_ACCESS_DENIED
    except Exception as m_err:
        print(f"[Main] Mutex initialization error: {m_err}", flush=True)

    # 3. Check existing backend state & active native window
    state = get_backend_state(DESKTOP_PORT)
    server_running = bool(state and state.get("ok"))

    user32 = ctypes.windll.user32
    existing_hwnd = user32.FindWindowW(None, "VS Database")
    window_alive = bool(existing_hwnd and user32.IsWindow(existing_hwnd))

    print(f"[Main] State check: is_duplicate={is_duplicate}, server_running={server_running}, window_alive={window_alive} on port {DESKTOP_PORT}", flush=True)

    # If an application window is actively alive, or backend is running WITH attached UI:
    if window_alive or (server_running and is_duplicate and state.get("ui", {}).get("attached")):
        print(f"[Main] Existing active application detected (window_alive={window_alive}). Routing target_route={target_route}", flush=True)
        if target_route:
            try:
                payload = json.dumps({"route": target_route}).encode("utf-8")
                req = urllib.request.Request(
                    f"http://127.0.0.1:{DESKTOP_PORT}/api/desktop/navigate",
                    data=payload,
                    headers={"Content-Type": "application/json"}
                )
                urllib.request.urlopen(req, timeout=1.0)
                print(f"[Main] Forwarded route {target_route} to primary instance.", flush=True)
            except Exception as e:
                print(f"[Main] Route forwarding notice: {e}", flush=True)
        else:
            try:
                req = urllib.request.Request(
                    f"http://127.0.0.1:{DESKTOP_PORT}/api/desktop/bring_to_front",
                    data=b"{}",
                    headers={"Content-Type": "application/json"}
                )
                urllib.request.urlopen(req, timeout=1.0)
            except Exception as e:
                print(f"[Main] Bring to front notice: {e}", flush=True)

        # Directly focus existing window before exit
        try:
            if existing_hwnd and user32.IsWindow(existing_hwnd):
                if user32.IsIconic(existing_hwnd):
                    user32.ShowWindow(existing_hwnd, 9)  # SW_RESTORE
                else:
                    user32.ShowWindow(existing_hwnd, 5)  # SW_SHOW
                user32.BringWindowToTop(existing_hwnd)
                user32.SetForegroundWindow(existing_hwnd)
                if hasattr(user32, "SwitchToThisWindow"):
                    user32.SwitchToThisWindow(existing_hwnd, True)
        except Exception:
            pass

        print("[Main] Secondary process exiting cleanly. Single instance preserved.", flush=True)
        sys.exit(0)

    # If mutex indicates duplicate but no window is alive and no server is running,
    # terminate any headless zombie VS_Database.exe processes (excluding current process)
    if is_duplicate and not window_alive and not server_running:
        print("[Main] Stale zombie detected with no window and no server. Cleaning up...", flush=True)
        try:
            import subprocess
            my_pid = os.getpid()
            subprocess.run(
                ["powershell", "-NoProfile", "-Command", f"Get-Process -Name VS_Database -ErrorAction SilentlyContinue | Where-Object {{ $_.Id -ne {my_pid} }} | Stop-Process -Force"],
                capture_output=True, timeout=3.0
            )
        except Exception as e:
            print(f"[Main] Zombie cleanup error: {e}", flush=True)

    # 4. Check whether to start backend or reuse existing
    if server_running:
        is_backend_owner = False
        launch_mode = "attach_ui"
        print(f"[Main] Reusing existing healthy backend on port {DESKTOP_PORT}.")
    else:
        is_backend_owner = True
        launch_mode = "fresh_backend"
        DESKTOP_PORT = find_available_port(8767, 8799)
        print(f"[Main] Starting dedicated backend server on port {DESKTOP_PORT}...")
        sys.stdout.flush()
        server.start_server_background(port=DESKTOP_PORT, host="0.0.0.0")

    # Bounded 5.0-second readiness poll (50 * 100ms)
    ready = False
    for _ in range(50):
        time.sleep(0.1)
        if is_server_healthy(DESKTOP_PORT):
            ready = True
            print(f"[Main] Backend verified healthy on port {DESKTOP_PORT}")
            sys.stdout.flush()
            break

    if not ready:
        print(f"[Main ERROR] Backend failed to start on port {DESKTOP_PORT} within 5.0s timeout!", flush=True)
        try:
            ctypes.windll.user32.MessageBoxW(
                0,
                f"VS Database backend service could not be started on port {DESKTOP_PORT}.\nPlease inspect data/server.log for details.",
                "VS Database Startup Failure",
                0x10
            )
        except Exception:
            pass
        sys.exit(1)

    # 5. Register UI attachment with backend
    attach_ui(DESKTOP_PORT, ui_instance_id, os.getpid(), force=True)

    # 6. Prepare window, icon, and URL
    bridge = DesktopBridge()
    icon_p = os.path.join(APP_DIR, "static", "app_icon.ico")
    if not os.path.exists(icon_p):
        icon_p = os.path.join(BUNDLE_DIR, "static", "app_icon.ico")

    extra_params = f"&ui_id={ui_instance_id}"
    if is_from_ext:
        extra_params += "&from_extension=1&skip_animation=1#save"
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
    bridge.set_window(window)

    # Track window HWND for heartbeat & bring_to_front
    cached_hwnd = [None]
    def get_active_hwnd():
        try:
            if hasattr(window, "native") and window.native:
                handle = getattr(window.native, "Handle", None)
                if handle:
                    hwnd = int(handle.ToInt64() if hasattr(handle, "ToInt64") else (handle.ToInt32() if hasattr(handle, "ToInt32") else handle))
                    if hwnd and ctypes.windll.user32.IsWindow(hwnd):
                        cached_hwnd[0] = hwnd
                        return hwnd
        except Exception:
            pass
        if cached_hwnd[0]:
            try:
                if ctypes.windll.user32.IsWindow(cached_hwnd[0]):
                    return cached_hwnd[0]
                else:
                    cached_hwnd[0] = None
            except Exception:
                pass
        try:
            h = ctypes.windll.user32.FindWindowW(None, "VS Database")
            if h and ctypes.windll.user32.IsWindow(h):
                cached_hwnd[0] = h
                return h
        except Exception:
            pass
        return None

    # Start Heartbeat Worker
    stop_heartbeat = threading.Event()
    def heartbeat_worker():
        while not stop_heartbeat.is_set():
            h = get_active_hwnd()
            send_heartbeat(DESKTOP_PORT, ui_instance_id, os.getpid(), h)
            stop_heartbeat.wait(2.0)

    hb_thread = threading.Thread(target=heartbeat_worker, daemon=True, name="UI-Heartbeat")
    hb_thread.start()

    # Event hooks for telemetry and clean shutdown
    t_first_win = [None]
    t_loaded = [None]

    def on_shown():
        t_first_win[0] = round((time.perf_counter() - launch_start_time) * 1000, 2)
        print(f"[Main Telemetry] First window visible: {t_first_win[0]} ms", flush=True)
        h = get_active_hwnd()
        if h:
            attach_ui(DESKTOP_PORT, ui_instance_id, os.getpid(), hwnd=h, force=True)
            send_heartbeat(DESKTOP_PORT, ui_instance_id, os.getpid(), h)

    def on_loaded():
        t_loaded[0] = round((time.perf_counter() - launch_start_time) * 1000, 2)
        print(f"[Main Telemetry] Dashboard loaded & usable: {t_loaded[0]} ms", flush=True)
        record_startup_telemetry(launch_mode, t_first_win[0] or 0.0, t_loaded[0] or 0.0)

    closed_handled = [False]
    def on_closed():
        if closed_handled[0]:
            return
        closed_handled[0] = True
        print("[Main] Window close event triggered.", flush=True)
        stop_heartbeat.set()
        detach_ui(DESKTOP_PORT, ui_instance_id)
        if is_backend_owner:
            print("[Main] Shutting down owned backend server...", flush=True)
            try:
                server.stop_server()
            except Exception:
                pass
        else:
            print("[Main] Preserving external/pre-existing backend for LAN clients.", flush=True)
        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:
            pass
        time.sleep(0.1)
        os._exit(0)

    window.events.shown += on_shown
    window.events.loaded += on_loaded
    window.events.closed += on_closed

    # 7. Launch native Microsoft WebView2 container with isolated profile
    profile_dir = os.path.join(APP_DIR, "data", "webview_profile")
    os.makedirs(profile_dir, exist_ok=True)
    print(f"[Main] Starting webview container (edgechromium) with storage_path={profile_dir}...")
    sys.stdout.flush()
    try:
        webview.start(
            gui="edgechromium",
            debug=False,
            icon=icon_p,
            private_mode=False,
            storage_path=profile_dir
        )
        print("[Main] webview.start finished cleanly", flush=True)
    except Exception as exc:
        print(f"[Main] webview.start error: {exc}", flush=True)
        import traceback
        traceback.print_exc()
    finally:
        on_closed()
        sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[Main Fatal Error] {exc}")
        import traceback
        traceback.print_exc()
        sys.stdout.flush()
