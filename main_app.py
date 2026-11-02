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
if BUNDLE_DIR not in sys.path:
    sys.path.insert(0, BUNDLE_DIR)
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

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
if __name__ == "__main__" or getattr(sys, "frozen", False):
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

# If running frozen inside a workspace that has live .py modules, load the live disk versions first
if getattr(sys, "frozen", False):
    import importlib.util
    for _mod_name in (
        "staging_manager",
        "pdf_studio_engine",
        "vs_ai_doc_generator",
        "vs_ai_clarification",
        "vs_ai_rename",
        "vs_ai_engine",
        "server",
    ):
        _mod_path = os.path.join(APP_DIR, f"{_mod_name}.py")
        if os.path.isfile(_mod_path):
            try:
                _spec = importlib.util.spec_from_file_location(_mod_name, _mod_path)
                if _spec and _spec.loader:
                    _mod = importlib.util.module_from_spec(_spec)
                    sys.modules[_mod_name] = _mod
                    _spec.loader.exec_module(_mod)
            except Exception as _load_err:
                print(f"[Main] Notice loading live {_mod_name}.py: {_load_err}", flush=True)

try:
    import server
    print("[Main] imported server successfully", flush=True)
    import webview
    try:
        webview.settings["ALLOW_DOWNLOADS"] = True
    except Exception:
        pass
    print("[Main] imported webview successfully", flush=True)
except Exception as exc:
    print(f"[Main Import Error] {exc}", flush=True)
    import traceback
    traceback.print_exc()
    sys.stdout.flush()

import re
import socket
import json
import uuid
import sqlite3
import threading
from ctypes import wintypes
from datetime import datetime, timezone

DESKTOP_PORT = 8767
WINDOW_STATE_FILE = os.path.join(APP_DIR, "data", "window_state.json")
DEFAULT_WINDOW_WIDTH = 1360
DEFAULT_WINDOW_HEIGHT = 860
MIN_WINDOW_WIDTH = 1080
MIN_WINDOW_HEIGHT = 700


class _POINT(ctypes.Structure):
    _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]


class _RECT(ctypes.Structure):
    _fields_ = [
        ("left", wintypes.LONG),
        ("top", wintypes.LONG),
        ("right", wintypes.LONG),
        ("bottom", wintypes.LONG),
    ]


class _WINDOWPLACEMENT(ctypes.Structure):
    _fields_ = [
        ("length", wintypes.UINT),
        ("flags", wintypes.UINT),
        ("showCmd", wintypes.UINT),
        ("ptMinPosition", _POINT),
        ("ptMaxPosition", _POINT),
        ("rcNormalPosition", _RECT),
    ]


class _MONITORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("rcMonitor", _RECT),
        ("rcWork", _RECT),
        ("dwFlags", wintypes.DWORD),
    ]


def _get_primary_work_area() -> tuple[int, int, int, int]:
    """Returns (left, top, right, bottom) of the primary monitor usable work area."""
    if sys.platform == "win32":
        try:
            user32 = ctypes.windll.user32
            work_rc = _RECT()
            SPI_GETWORKAREA = 0x0030
            if user32.SystemParametersInfoW(SPI_GETWORKAREA, 0, ctypes.byref(work_rc), 0):
                if (work_rc.right - work_rc.left) >= 800 and (work_rc.bottom - work_rc.top) >= 600:
                    return (work_rc.left, work_rc.top, work_rc.right, work_rc.bottom)
            prim_w = int(user32.GetSystemMetrics(0)) or 1920
            prim_h = int(user32.GetSystemMetrics(1)) or 1080
            return (0, 0, prim_w, max(600, prim_h - 48))
        except Exception:
            pass
    return (0, 0, 1920, 1032)


def validate_window_bounds(x: int | None, y: int | None, width: int | None, height: int | None) -> dict:
    """Validates and clamps normal window dimensions and position against connected monitors and work areas."""
    try:
        raw_w = int(width) if width is not None else DEFAULT_WINDOW_WIDTH
        w = max(MIN_WINDOW_WIDTH, raw_w) if raw_w > 0 else DEFAULT_WINDOW_WIDTH
    except Exception:
        w = DEFAULT_WINDOW_WIDTH
    try:
        raw_h = int(height) if height is not None else DEFAULT_WINDOW_HEIGHT
        h = max(MIN_WINDOW_HEIGHT, raw_h) if raw_h > 0 else DEFAULT_WINDOW_HEIGHT
    except Exception:
        h = DEFAULT_WINDOW_HEIGHT

    pos_x = None
    pos_y = None
    if x is not None and y is not None:
        try:
            pos_x = int(x)
            pos_y = int(y)
        except Exception:
            pos_x = None
            pos_y = None

    if sys.platform == "win32":
        try:
            user32 = ctypes.windll.user32
            work_l, work_t, work_r, work_b = _get_primary_work_area()

            if pos_x is not None and pos_y is not None:
                # Reject Win32 minimized sentinel coordinates (-32000, -32000) or absurd off-screen values
                if pos_x <= -16000 or pos_y <= -16000 or pos_x >= 32000 or pos_y >= 32000:
                    pos_x, pos_y = None, None
                else:
                    # Require the top-left titlebar region of the window to intersect an active monitor
                    probe = _RECT(
                        pos_x + 40,
                        pos_y + 16,
                        pos_x + min(w, 360) - 40,
                        pos_y + 96,
                    )
                    MONITOR_DEFAULTTONULL = 0
                    hmon = user32.MonitorFromRect(ctypes.byref(probe), MONITOR_DEFAULTTONULL)
                    if not hmon:
                        pos_x, pos_y = None, None
                    else:
                        mi = _MONITORINFO()
                        mi.cbSize = ctypes.sizeof(_MONITORINFO)
                        if user32.GetMonitorInfoW(hmon, ctypes.byref(mi)):
                            work_l = int(mi.rcWork.left)
                            work_t = int(mi.rcWork.top)
                            work_r = int(mi.rcWork.right)
                            work_b = int(mi.rcWork.bottom)

            avail_w = max(MIN_WINDOW_WIDTH, work_r - work_l)
            avail_h = max(MIN_WINDOW_HEIGHT, work_b - work_t)
            w = min(w, avail_w)
            h = min(h, avail_h)

            if pos_x is not None and pos_y is not None:
                # Clamp so the titlebar and window body stay within the monitor's usable work area
                pos_x = max(work_l, min(pos_x, work_r - w))
                pos_y = max(work_t, min(pos_y, work_b - h))
            else:
                # Center within the primary monitor's usable work area
                pos_x = work_l + max(0, (avail_w - w) // 2)
                pos_y = work_t + max(0, (avail_h - h) // 2)
        except Exception as exc:
            print(f"[WindowState] Bounds validation notice: {exc}", flush=True)

    return {"width": w, "height": h, "x": pos_x, "y": pos_y}


def load_window_state() -> dict:
    """Loads persisted desktop window state, falling back safely if missing or corrupt."""
    work_l, work_t, work_r, work_b = _get_primary_work_area()
    avail_w = max(MIN_WINDOW_WIDTH, work_r - work_l)
    avail_h = max(MIN_WINDOW_HEIGHT, work_b - work_t)
    def_w = min(DEFAULT_WINDOW_WIDTH, max(MIN_WINDOW_WIDTH, avail_w - 40))
    def_h = min(DEFAULT_WINDOW_HEIGHT, max(MIN_WINDOW_HEIGHT, avail_h - 40))
    default_state = {
        "width": def_w,
        "height": def_h,
        "x": work_l + max(0, (avail_w - def_w) // 2),
        "y": work_t + max(0, (avail_h - def_h) // 2),
        "maximized": False,
    }
    if not os.path.exists(WINDOW_STATE_FILE):
        return dict(default_state)
    try:
        with open(WINDOW_STATE_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            return dict(default_state)
        raw_w = raw.get("width")
        raw_h = raw.get("height")
        if raw_w is not None and int(raw_w) <= 0:
            raw_w = def_w
        if raw_h is not None and int(raw_h) <= 0:
            raw_h = def_h
        bounds = validate_window_bounds(
            raw.get("x"),
            raw.get("y"),
            raw_w,
            raw_h,
        )
        return {
            "width": bounds["width"],
            "height": bounds["height"],
            "x": bounds["x"],
            "y": bounds["y"],
            "maximized": bool(raw.get("maximized", False)),
        }
    except Exception as exc:
        print(f"[WindowState] Failed to load window state ({exc}), using defaults.", flush=True)
        return dict(default_state)


def _get_monitor_work_area_for_hwnd(hwnd: int | None) -> tuple[int, int, int, int]:
    """Returns (left, top, right, bottom) of the monitor work area (excluding Windows Taskbar) for the given HWND."""
    if sys.platform == "win32" and hwnd:
        try:
            user32 = ctypes.windll.user32
            MONITOR_DEFAULTTONEAREST = 2
            hmon = user32.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)
            if hmon:
                mi = _MONITORINFO()
                mi.cbSize = ctypes.sizeof(_MONITORINFO)
                if user32.GetMonitorInfoW(hmon, ctypes.byref(mi)):
                    wl, wt, wr, wb = int(mi.rcWork.left), int(mi.rcWork.top), int(mi.rcWork.right), int(mi.rcWork.bottom)
                    ml, mt, mr, mb = int(mi.rcMonitor.left), int(mi.rcMonitor.top), int(mi.rcMonitor.right), int(mi.rcMonitor.bottom)
                    # If taskbar is auto-hide and rcWork equals rcMonitor, leave a 2px bottom margin so Windows Taskbar unhides on hover and never treats window as exclusive fullscreen
                    if wl == ml and wt == mt and wr == mr and wb == mb:
                        wb = max(wt + MIN_WINDOW_HEIGHT, mb - 2)
                    if (wr - wl) >= 800 and (wb - wt) >= 600:
                        return (wl, wt, wr, wb)
        except Exception:
            pass
    return _get_primary_work_area()


def maximize_window_to_work_area(hwnd: int | None, window=None) -> dict:
    """
    Maximizes a frameless window strictly to the monitor's usable work area (rcWork)
    so the Windows Taskbar remains visible at all times (like MS Word / standard Windows apps).
    """
    wl, wt, wr, wb = _get_monitor_work_area_for_hwnd(hwnd)
    ww = max(MIN_WINDOW_WIDTH, wr - wl)
    wh = max(MIN_WINDOW_HEIGHT, wb - wt)
    if sys.platform == "win32" and hwnd:
        try:
            user32 = ctypes.windll.user32
            if user32.IsIconic(hwnd) or user32.IsZoomed(hwnd):
                user32.ShowWindow(hwnd, 9)  # SW_RESTORE clears WS_MAXIMIZE so Windows Shell never hides the taskbar
            SWP_NOZORDER = 0x0004
            SWP_SHOWWINDOW = 0x0040
            SWP_FRAMECHANGED = 0x0020
            user32.SetWindowPos(hwnd, 0, wl, wt, ww, wh, SWP_NOZORDER | SWP_SHOWWINDOW | SWP_FRAMECHANGED)
        except Exception as exc:
            print(f"[WindowState] maximize_window_to_work_area notice: {exc}", flush=True)
    return {"x": wl, "y": wt, "width": ww, "height": wh, "taskbar_preserved": True}


def capture_and_save_window_state(
    hwnd: int | None = None,
    fallback_maximized: bool | None = None,
    explicit_maximized: bool | None = None,
) -> dict:
    """Captures live Win32 window placement (preserving normal bounds when maximized/minimized) and persists to disk."""
    current = load_window_state()
    if fallback_maximized is not None:
        current["maximized"] = bool(fallback_maximized)

    if sys.platform == "win32" and hwnd:
        try:
            user32 = ctypes.windll.user32
            if user32.IsWindow(hwnd):
                is_iconic = bool(user32.IsIconic(hwnd))
                is_zoomed = bool(user32.IsZoomed(hwnd))

                wp = _WINDOWPLACEMENT()
                wp.length = ctypes.sizeof(_WINDOWPLACEMENT)
                has_wp = bool(user32.GetWindowPlacement(hwnd, ctypes.byref(wp)))

                # Check if frameless window covers the monitor usable work area (rcWork)
                covers_work_area = False
                if not is_iconic:
                    rc_check = _RECT()
                    if user32.GetWindowRect(hwnd, ctypes.byref(rc_check)):
                        wl, wt, wr, wb = _get_monitor_work_area_for_hwnd(hwnd)
                        ww = wr - wl
                        wh = wb - wt
                        cw = rc_check.right - rc_check.left
                        ch = rc_check.bottom - rc_check.top
                        if cw >= ww - 8 and ch >= wh - 8 and abs(rc_check.left - wl) <= 8 and abs(rc_check.top - wt) <= 8:
                            covers_work_area = True

                if explicit_maximized is not None:
                    current["maximized"] = bool(explicit_maximized)
                elif is_zoomed or (has_wp and wp.showCmd == 3) or covers_work_area:
                    current["maximized"] = True
                elif is_iconic:
                    # Never persist minimized as window state; preserve whether it restores to maximized
                    WPF_RESTORETOMAXIMIZED = 0x0002
                    if has_wp and (wp.flags & WPF_RESTORETOMAXIMIZED):
                        current["maximized"] = True
                else:
                    current["maximized"] = False

                # Extract normal (unmaximized) coordinates ONLY when in normal unmaximized, unminimized state
                if not is_zoomed and not is_iconic and not current["maximized"] and not covers_work_area:
                    rc = _RECT()
                    if user32.GetWindowRect(hwnd, ctypes.byref(rc)):
                        nw = rc.right - rc.left
                        nh = rc.bottom - rc.top
                        if nw >= MIN_WINDOW_WIDTH and nh >= MIN_WINDOW_HEIGHT and rc.left > -16000 and rc.top > -16000:
                            bounds = validate_window_bounds(rc.left, rc.top, nw, nh)
                            current.update(bounds)
                elif has_wp and not is_zoomed and not current["maximized"]:
                    nrc = wp.rcNormalPosition
                    nw = nrc.right - nrc.left
                    nh = nrc.bottom - nrc.top
                    if nw >= MIN_WINDOW_WIDTH and nh >= MIN_WINDOW_HEIGHT and nrc.left > -16000 and nrc.top > -16000:
                        bounds = validate_window_bounds(nrc.left, nrc.top, nw, nh)
                        current.update(bounds)
        except Exception as exc:
            print(f"[WindowState] Capture notice: {exc}", flush=True)

    if explicit_maximized is not None:
        current["maximized"] = bool(explicit_maximized)

    current["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        os.makedirs(os.path.dirname(WINDOW_STATE_FILE), exist_ok=True)
        tmp_path = WINDOW_STATE_FILE + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=2)
        os.replace(tmp_path, WINDOW_STATE_FILE)
    except Exception as exc:
        print(f"[WindowState] Save error: {exc}", flush=True)
    return current


def resolve_ai_artifact_source(source_filename: str = "", artifact_id: int | str | None = None) -> tuple[str | None, str | None]:
    """Resolves a generated VS AI artifact's real file path and display filename from the database or disk."""
    from pathlib import Path

    clean_name = os.path.basename(str(source_filename or "").strip())
    art_id_str = str(artifact_id or "").strip()

    # 1. Check ai_artifacts table by artifact_id or filename
    db_candidates = [
        os.path.join(APP_DIR, "data", "vs_database_desktop.db"),
        os.path.join(BUNDLE_DIR, "data", "vs_database_desktop.db"),
    ]
    for db_p in db_candidates:
        if not os.path.exists(db_p):
            continue
        try:
            with sqlite3.connect(db_p, timeout=5.0) as conn:
                conn.row_factory = sqlite3.Row
                row = None
                if art_id_str:
                    row = conn.execute(
                        "SELECT filename, storage_path FROM ai_artifacts WHERE artifact_id = ?",
                        (art_id_str,),
                    ).fetchone()
                if not row and clean_name:
                    row = conn.execute(
                        "SELECT filename, storage_path FROM ai_artifacts WHERE filename = ? ORDER BY created_at DESC LIMIT 1",
                        (clean_name,),
                    ).fetchone()
                if row:
                    fp = str(row["storage_path"] or "").strip()
                    fn = str(row["filename"] or clean_name).strip()
                    if fp and os.path.exists(fp) and os.path.getsize(fp) > 0:
                        return fp, fn
                    if fn and not clean_name:
                        clean_name = os.path.basename(fn)
        except Exception as exc:
            print(f"[ArtifactResolve] DB lookup notice: {exc}", flush=True)

    # 2. Check data/ai_artifacts/<artifact_id> directly if artifact_id is provided
    if art_id_str:
        for base_dir in (APP_DIR, BUNDLE_DIR):
            art_dir = Path(base_dir) / "data" / "ai_artifacts" / art_id_str
            if art_dir.is_dir():
                for child in art_dir.iterdir():
                    if child.is_file() and child.stat().st_size > 0:
                        return str(child.resolve()), child.name

    if not clean_name:
        return None, None

    # 3. Check data/ai_exports and data/ai_artifacts directories
    search_paths = [
        os.path.join(APP_DIR, "data", "ai_exports", clean_name),
        os.path.join(BUNDLE_DIR, "data", "ai_exports", clean_name),
    ]
    for sp in search_paths:
        if os.path.exists(sp) and os.path.getsize(sp) > 0:
            return sp, clean_name

    for base_dir in (APP_DIR, BUNDLE_DIR):
        art_root = Path(base_dir) / "data" / "ai_artifacts"
        if art_root.exists():
            matches = sorted(art_root.glob(f"*/{clean_name}"), key=lambda p: p.stat().st_mtime, reverse=True)
            for m in matches:
                if m.is_file() and m.stat().st_size > 0:
                    return str(m.resolve()), clean_name

    return None, clean_name


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
        self._window = None
        self._is_maximized = False
        self._force_close = False
        self._closing_saved = False
        self._get_hwnd_fn = None

    def set_window(self, window, get_hwnd_fn=None):
        self._window = window
        self._get_hwnd_fn = get_hwnd_fn

    def minimize_window(self):
        if self._window:
            hwnd = self._get_hwnd_fn() if self._get_hwnd_fn else None
            capture_and_save_window_state(
                hwnd,
                fallback_maximized=self._is_maximized,
                explicit_maximized=self._is_maximized,
            )
            self._window.minimize()
            return {"ok": True}
        return {"ok": False}

    def maximize_window(self):
        if self._window:
            hwnd = self._get_hwnd_fn() if self._get_hwnd_fn else None
            if self._is_maximized:
                saved_norm = load_window_state()
                try:
                    self._window.restore()
                except Exception:
                    pass
                if sys.platform == "win32" and hwnd:
                    try:
                        ctypes.windll.user32.ShowWindow(hwnd, 9)  # SW_RESTORE
                        if saved_norm.get("x") is not None and saved_norm.get("y") is not None:
                            ctypes.windll.user32.SetWindowPos(
                                hwnd,
                                0,
                                int(saved_norm["x"]),
                                int(saved_norm["y"]),
                                int(saved_norm["width"]),
                                int(saved_norm["height"]),
                                0x0004,
                            )
                    except Exception:
                        pass
                self._is_maximized = False
                capture_and_save_window_state(hwnd, fallback_maximized=False, explicit_maximized=False)
            else:
                # Save normal bounds right before maximizing
                capture_and_save_window_state(hwnd, fallback_maximized=False, explicit_maximized=False)
                if sys.platform == "win32" and hwnd:
                    maximize_window_to_work_area(hwnd, self._window)
                else:
                    self._window.maximize()
                self._is_maximized = True
                capture_and_save_window_state(hwnd, fallback_maximized=True, explicit_maximized=True)
            return {"ok": True, "maximized": self._is_maximized}
        return {"ok": False}

    def is_maximized(self):
        hwnd = self._get_hwnd_fn() if self._get_hwnd_fn else None
        if sys.platform == "win32" and hwnd:
            try:
                user32 = ctypes.windll.user32
                if user32.IsWindow(hwnd) and not user32.IsIconic(hwnd):
                    if user32.IsZoomed(hwnd):
                        self._is_maximized = True
                    else:
                        rc_check = _RECT()
                        if user32.GetWindowRect(hwnd, ctypes.byref(rc_check)):
                            wl, wt, wr, wb = _get_monitor_work_area_for_hwnd(hwnd)
                            ww = wr - wl
                            wh = wb - wt
                            cw = rc_check.right - rc_check.left
                            ch = rc_check.bottom - rc_check.top
                            if cw >= ww - 8 and ch >= wh - 8 and abs(rc_check.left - wl) <= 8 and abs(rc_check.top - wt) <= 8:
                                self._is_maximized = True
            except Exception:
                pass
        return {"ok": True, "maximized": self._is_maximized}

    def get_window_state(self):
        return {"ok": True, "state": load_window_state()}

    def start_drag(self):
        try:
            hwnd = self._get_hwnd_fn() if self._get_hwnd_fn else None
            if hwnd:
                WM_NCLBUTTONDOWN = 0xA1
                HTCAPTION = 0x2
                ctypes.windll.user32.ReleaseCapture()
                ctypes.windll.user32.SendMessageW(hwnd, WM_NCLBUTTONDOWN, HTCAPTION, 0)
                if not ctypes.windll.user32.IsZoomed(hwnd):
                    self._is_maximized = False
                capture_and_save_window_state(
                    hwnd,
                    fallback_maximized=self._is_maximized,
                    explicit_maximized=self._is_maximized,
                )
                return {"ok": True}
        except Exception as e:
            print(f"[DesktopBridge] Drag error: {e}", flush=True)
        return {"ok": False}

    def start_resize(self, edge: str):
        """Interactive 8-way edge/corner resize for frameless Win32 desktop window."""
        if self._is_maximized:
            return {"ok": False, "maximized": True}
        hwnd = self._get_hwnd_fn() if self._get_hwnd_fn else None
        if not hwnd or sys.platform != "win32":
            return {"ok": False}
        edge_clean = str(edge or "").lower().strip()
        try:
            user32 = ctypes.windll.user32
            pt0 = _POINT()
            rc0 = _RECT()
            if not user32.GetCursorPos(ctypes.byref(pt0)) or not user32.GetWindowRect(hwnd, ctypes.byref(rc0)):
                return {"ok": False}
            user32.ReleaseCapture()
            VK_LBUTTON = 0x01
            SWP_NOZORDER = 0x0004
            SWP_NOACTIVATE = 0x0010
            orig_l, orig_t, orig_r, orig_b = rc0.left, rc0.top, rc0.right, rc0.bottom
            while user32.GetAsyncKeyState(VK_LBUTTON) & 0x8000:
                pt = _POINT()
                if not user32.GetCursorPos(ctypes.byref(pt)):
                    break
                dx = pt.x - pt0.x
                dy = pt.y - pt0.y
                nl, nt, nr, nb = orig_l, orig_t, orig_r, orig_b
                if "e" in edge_clean:
                    nr = max(nl + MIN_WINDOW_WIDTH, orig_r + dx)
                if "s" in edge_clean:
                    nb = max(nt + MIN_WINDOW_HEIGHT, orig_b + dy)
                if "w" in edge_clean:
                    nl = min(nr - MIN_WINDOW_WIDTH, orig_l + dx)
                if "n" in edge_clean:
                    nt = min(nb - MIN_WINDOW_HEIGHT, orig_t + dy)
                user32.SetWindowPos(hwnd, 0, nl, nt, nr - nl, nb - nt, SWP_NOZORDER | SWP_NOACTIVATE)
                time.sleep(0.008)
            self._is_maximized = False
            capture_and_save_window_state(hwnd, fallback_maximized=False, explicit_maximized=False)
            return {"ok": True}
        except Exception as exc:
            print(f"[DesktopBridge] Resize error: {exc}", flush=True)
            return {"ok": False}

    def close_window(self):
        """Request close dialog from UI."""
        if self._window:
            hwnd = self._get_hwnd_fn() if self._get_hwnd_fn else None
            capture_and_save_window_state(
                hwnd,
                fallback_maximized=self._is_maximized,
                explicit_maximized=self._is_maximized,
            )
            def trigger():
                try:
                    self._window.evaluate_js("if (window.showExitConfirmModal) window.showExitConfirmModal();")
                except Exception:
                    pass
            threading.Thread(target=trigger, daemon=True).start()
            return {"ok": True}
        return {"ok": False}

    def confirm_close(self):
        """User confirmed closing the app in the exit confirmation modal."""
        self._force_close = True
        hwnd = self._get_hwnd_fn() if self._get_hwnd_fn else None
        capture_and_save_window_state(
            hwnd,
            fallback_maximized=self._is_maximized,
            explicit_maximized=self._is_maximized,
        )
        self._closing_saved = True
        if self._window:
            def do_destroy():
                time.sleep(0.05)
                try:
                    self._window.destroy()
                except Exception:
                    pass
            threading.Thread(target=do_destroy, daemon=True).start()
            return {"ok": True}
        return {"ok": False}

    def open_local_folder(self, folder_path: str):
        try:
            return {"ok": True, "path": server.open_in_file_manager(folder_path)}
        except Exception as exc:
            return {"error": str(exc)}

    def save_file_to_location(self, source_filename: str, default_name: str = None, artifact_id: int | str = None):
        """Opens native Windows Save File Dialog and saves the generated artifact (PDF, DOCX, XLSX, etc.)."""
        if not self._window:
            return {"ok": False, "error": "Window not initialized"}
        try:
            import shutil
            source_path, resolved_name = resolve_ai_artifact_source(source_filename, artifact_id)
            if not source_path or not os.path.exists(source_path):
                return {"ok": False, "error": f"Generated file could not be found on disk: {source_filename or artifact_id}"}

            ext = os.path.splitext(source_path)[1].lower()
            if not ext and default_name:
                ext = os.path.splitext(default_name)[1].lower()
            if not ext:
                ext = ".pdf"

            raw_base = os.path.splitext(default_name or resolved_name or source_filename)[0]
            base = re.sub(r'(\.(docx|xlsx|pdf|txt|csv))+$', '', raw_base, flags=re.I).strip()
            base = re.sub(r'[<>:"/\\|?*]', '_', base).strip() or f"VS_AI_Document_{int(time.time())}"
            target_filename = f"{base}{ext}"

            if ext == ".docx":
                file_types = ("Word Documents (*.docx)", "All Files (*.*)")
            elif ext == ".xlsx":
                file_types = ("Excel Workbooks (*.xlsx)", "All Files (*.*)")
            elif ext == ".txt":
                file_types = ("Text Documents (*.txt)", "All Files (*.*)")
            elif ext == ".csv":
                file_types = ("CSV Spreadsheets (*.csv)", "All Files (*.*)")
            else:
                file_types = ("PDF Documents (*.pdf)", "All Files (*.*)")

            downloads_dir = os.path.join(os.path.expanduser("~"), "Downloads")
            if not os.path.isdir(downloads_dir):
                downloads_dir = os.path.expanduser("~")

            res = self._window.create_file_dialog(
                webview.FileDialog.SAVE,
                directory=downloads_dir,
                save_filename=target_filename,
                file_types=file_types
            )
            if not res:
                return {"ok": False, "cancelled": True}

            dest_path = res[0] if isinstance(res, (list, tuple)) else str(res)
            if not dest_path:
                return {"ok": False, "cancelled": True}

            dest_ext = os.path.splitext(dest_path)[1].lower()
            if not dest_ext:
                dest_path += ext
            elif dest_ext != ext and dest_path.lower().endswith(f"{ext}.pdf"):
                dest_path = dest_path[:-4]

            os.makedirs(os.path.dirname(os.path.abspath(dest_path)), exist_ok=True)
            shutil.copy2(source_path, dest_path)
            if not os.path.exists(dest_path) or os.path.getsize(dest_path) == 0:
                return {"ok": False, "error": "Saved file was empty or could not be verified on disk."}

            return {
                "ok": True,
                "path": dest_path,
                "filename": os.path.basename(dest_path),
                "size_bytes": os.path.getsize(dest_path),
            }
        except Exception as exc:
            print(f"[DesktopBridge] save_file_to_location error: {exc}", flush=True)
            return {"ok": False, "error": str(exc)}

    def select_folder_and_save(self, source_filename: str, default_name: str = None, artifact_id: int | str = None):
        """Opens native Windows Folder picker and saves the file into that directory."""
        if not self._window:
            return {"ok": False, "error": "Window not initialized"}
        try:
            import shutil
            source_path, resolved_name = resolve_ai_artifact_source(source_filename, artifact_id)
            if not source_path or not os.path.exists(source_path):
                return {"ok": False, "error": f"Source file not found: {source_filename}"}

            ext = os.path.splitext(source_path)[1].lower()
            if not ext and default_name:
                ext = os.path.splitext(default_name)[1].lower()
            if not ext:
                ext = ".pdf"

            raw_base = os.path.splitext(default_name or resolved_name or source_filename)[0]
            base = re.sub(r'(\.(docx|xlsx|pdf|txt|csv))+$', '', raw_base, flags=re.I).strip()
            base = re.sub(r'[<>:"/\\|?*]', '_', base).strip() or f"VS_AI_Document_{int(time.time())}"
            target_filename = f"{base}{ext}"

            res = self._window.create_file_dialog(webview.FileDialog.FOLDER)
            if not res or len(res) == 0:
                return {"ok": False, "cancelled": True}

            folder_dir = res[0] if isinstance(res, (list, tuple)) else str(res)
            dest_path = os.path.join(folder_dir, target_filename)
            shutil.copy2(source_path, dest_path)
            return {"ok": True, "path": dest_path, "filename": target_filename}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

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
    is_hung = bool(hasattr(user32, "IsHungAppWindow") and existing_hwnd and user32.IsHungAppWindow(existing_hwnd))
    window_alive = bool(existing_hwnd and user32.IsWindow(existing_hwnd) and user32.IsWindowVisible(existing_hwnd) and not is_hung)

    print(f"[Main] State check: is_duplicate={is_duplicate}, server_running={server_running}, window_alive={window_alive}, is_hung={is_hung} on port {DESKTOP_PORT}", flush=True)

    # An active instance exists ONLY if the backend is running AND (window is alive or UI is attached)
    active_instance_exists = server_running and (window_alive or (is_duplicate and state.get("ui", {}).get("attached")))

    if active_instance_exists:
        print(f"[Main] Existing active application detected (window_alive={window_alive}). Routing target_route={target_route}", flush=True)
        if target_route:
            try:
                payload = json.dumps({"route": target_route}).encode("utf-8")
                req = urllib.request.Request(
                    f"http://127.0.0.1:{DESKTOP_PORT}/api/desktop/navigate",
                    data=payload,
                    headers={"Content-Type": "application/json"}
                )
                urllib.request.urlopen(req, timeout=0.8)
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
                urllib.request.urlopen(req, timeout=0.8)
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

    # If mutex indicated duplicate or stale window existed but backend is NOT running,
    # clean up any stale headless zombie processes immediately using fast taskkill
    if not server_running and (is_duplicate or existing_hwnd or is_hung):
        print("[Main] Stale zombie/mutex detected with no running backend. Cleaning up stale processes...", flush=True)
        try:
            my_pid = os.getpid()
            import subprocess
            subprocess.run(
                f'taskkill /F /FI "PID ne {my_pid}" /IM VS_Database.exe',
                shell=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=1.5
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

    # Fast bounded readiness poll (immediate check first, then micro-sleep)
    ready = False
    for i in range(50):
        if is_server_healthy(DESKTOP_PORT):
            ready = True
            print(f"[Main] Backend verified healthy on port {DESKTOP_PORT} (probe {i})", flush=True)
            sys.stdout.flush()
            break
        time.sleep(0.03 if i < 15 else 0.08)

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
    saved_win_state = load_window_state()
    bridge._is_maximized = bool(saved_win_state.get("maximized", False))
    window_state_ready = threading.Event()

    icon_p = os.path.join(APP_DIR, "static", "app_icon.ico")
    if not os.path.exists(icon_p):
        icon_p = os.path.join(BUNDLE_DIR, "static", "app_icon.ico")

    extra_params = f"&ui_id={ui_instance_id}"
    if is_from_ext:
        extra_params += "&from_extension=1&skip_animation=1#save"
    target_url = f"http://127.0.0.1:{DESKTOP_PORT}/?desktop_app=1{extra_params}"
    print(f"[Main] Creating WebView2 window: {target_url} with restored state={saved_win_state}", flush=True)

    dpi_scale = 1.0
    if sys.platform == "win32":
        try:
            sys_dpi = ctypes.windll.user32.GetDpiForSystem()
            if sys_dpi and sys_dpi > 0:
                dpi_scale = float(sys_dpi) / 96.0
        except Exception:
            dpi_scale = 1.0

    init_w = int(round(saved_win_state.get("width", DEFAULT_WINDOW_WIDTH) / dpi_scale))
    init_h = int(round(saved_win_state.get("height", DEFAULT_WINDOW_HEIGHT) / dpi_scale))
    min_w_log = int(round(MIN_WINDOW_WIDTH / dpi_scale))
    min_h_log = int(round(MIN_WINDOW_HEIGHT / dpi_scale))

    win_kwargs = dict(
        title="VS Database",
        url=target_url,
        js_api=bridge,
        width=max(min_w_log, init_w),
        height=max(min_h_log, init_h),
        min_size=(min_w_log, min_h_log),
        background_color="#eef2ff",
        frameless=True,
        easy_drag=False,
        shadow=True,
        text_select=True,
        zoomable=True,
    )
    if saved_win_state.get("x") is not None and saved_win_state.get("y") is not None:
        win_kwargs["x"] = int(round(saved_win_state["x"] / dpi_scale))
        win_kwargs["y"] = int(round(saved_win_state["y"] / dpi_scale))

    window = webview.create_window(**win_kwargs)

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

    bridge.set_window(window, get_hwnd_fn=get_active_hwnd)

    # Start Heartbeat Worker (also periodically persists window bounds once window_state_ready is set)
    stop_heartbeat = threading.Event()
    def heartbeat_worker():
        tick = 0
        while not stop_heartbeat.is_set():
            h = get_active_hwnd()
            send_heartbeat(DESKTOP_PORT, ui_instance_id, os.getpid(), h)
            tick += 1
            if h and tick % 2 == 0 and window_state_ready.is_set():
                capture_and_save_window_state(h, fallback_maximized=bridge._is_maximized)
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
            try:
                # Force remove any OS caption bar (black bar)
                GWL_STYLE = -16
                WS_CAPTION = 0x00C00000
                style = ctypes.windll.user32.GetWindowLongW(h, GWL_STYLE)
                if style & WS_CAPTION:
                    style &= ~WS_CAPTION
                    ctypes.windll.user32.SetWindowLongW(h, GWL_STYLE, style)
                # Force DWM Light Mode & theme-matched caption color
                DWMWA_USE_IMMERSIVE_DARK_MODE = 20
                DWMWA_CAPTION_COLOR = 35
                val_false = ctypes.c_int(0)
                color_bg = ctypes.c_int(0x00FFF2EE)  # #eef2ff
                ctypes.windll.dwmapi.DwmSetWindowAttribute(h, DWMWA_USE_IMMERSIVE_DARK_MODE, ctypes.byref(val_false), 4)
                ctypes.windll.dwmapi.DwmSetWindowAttribute(h, DWMWA_CAPTION_COLOR, ctypes.byref(color_bg), 4)
                SWP_NOMOVE = 0x0002
                SWP_NOSIZE = 0x0001
                SWP_NOZORDER = 0x0004
                SWP_FRAMECHANGED = 0x0020
                ctypes.windll.user32.SetWindowPos(h, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED)

                # Ensure window is never left in a minimized/iconic state on startup
                if ctypes.windll.user32.IsIconic(h):
                    ctypes.windll.user32.ShowWindow(h, 9)  # SW_RESTORE

                # Restore normal geometry first so restore-from-maximize knows normal bounds
                if saved_win_state.get("x") is not None and saved_win_state.get("y") is not None:
                    ctypes.windll.user32.SetWindowPos(
                        h,
                        0,
                        int(saved_win_state["x"]),
                        int(saved_win_state["y"]),
                        int(saved_win_state["width"]),
                        int(saved_win_state["height"]),
                        SWP_NOZORDER,
                    )
                else:
                    ctypes.windll.user32.SetWindowPos(
                        h,
                        0,
                        0,
                        0,
                        int(saved_win_state["width"]),
                        int(saved_win_state["height"]),
                        SWP_NOMOVE | SWP_NOZORDER,
                    )

                if saved_win_state.get("maximized"):
                    bridge._is_maximized = True
                    maximize_window_to_work_area(h, window)
                    capture_and_save_window_state(h, fallback_maximized=True, explicit_maximized=True)
                else:
                    bridge._is_maximized = False
                    capture_and_save_window_state(h, fallback_maximized=False, explicit_maximized=False)
            except Exception as e:
                print(f"[Main] Window style override error: {e}", flush=True)

        def mark_ready():
            time.sleep(0.15)
            window_state_ready.set()
        threading.Thread(target=mark_ready, daemon=True).start()

    def on_loaded():
        t_loaded[0] = round((time.perf_counter() - launch_start_time) * 1000, 2)
        print(f"[Main Telemetry] Dashboard loaded & usable: {t_loaded[0]} ms", flush=True)
        record_startup_telemetry(launch_mode, t_first_win[0] or 0.0, t_loaded[0] or 0.0)
        if bridge._is_maximized:
            try:
                window.evaluate_js("if (window.onWindowMaximizedState) window.onWindowMaximizedState(true);")
            except Exception:
                pass

    def on_closing():
        h = get_active_hwnd()
        if not bridge._closing_saved:
            capture_and_save_window_state(
                h,
                fallback_maximized=bridge._is_maximized,
                explicit_maximized=bridge._is_maximized,
            )
        if os.environ.get("VS_AUTO_CONFIRM_CLOSE") == "1":
            bridge._force_close = True
            bridge._closing_saved = True
            return True
        if not bridge._force_close:
            if sys.platform == "win32" and h:
                try:
                    if ctypes.windll.user32.IsIconic(h):
                        # Restore to work-area maximized if it was maximized prior to minimizing, otherwise normal
                        ctypes.windll.user32.ShowWindow(h, 9)
                        if bridge._is_maximized:
                            maximize_window_to_work_area(h, window)
                        ctypes.windll.user32.SetForegroundWindow(h)
                except Exception:
                    pass
            def trigger_modal():
                try:
                    window.evaluate_js("if (window.showExitConfirmModal) window.showExitConfirmModal();")
                except Exception:
                    pass
            threading.Thread(target=trigger_modal, daemon=True).start()
            return False  # Cancels the OS close!
        bridge._closing_saved = True
        return True

    def on_maximized():
        if not window_state_ready.is_set():
            return
        bridge._is_maximized = True
        h = get_active_hwnd()
        if h:
            maximize_window_to_work_area(h, window)
        capture_and_save_window_state(h, fallback_maximized=True, explicit_maximized=True)
        def notify_max():
            try:
                window.evaluate_js("if (window.onWindowMaximizedState) window.onWindowMaximizedState(true);")
            except Exception:
                pass
        threading.Thread(target=notify_max, daemon=True).start()

    def on_restored():
        if not window_state_ready.is_set():
            return
        bridge._is_maximized = False
        h = get_active_hwnd()
        capture_and_save_window_state(h, fallback_maximized=False, explicit_maximized=False)
        def notify_restore():
            try:
                window.evaluate_js("if (window.onWindowMaximizedState) window.onWindowMaximizedState(false);")
            except Exception:
                pass
        threading.Thread(target=notify_restore, daemon=True).start()

    def on_resized(width, height):
        if not window_state_ready.is_set():
            return
        h = get_active_hwnd()
        capture_and_save_window_state(h, fallback_maximized=bridge._is_maximized)

    def on_moved(x, y):
        if not window_state_ready.is_set():
            return
        h = get_active_hwnd()
        capture_and_save_window_state(h, fallback_maximized=bridge._is_maximized)

    closed_handled = [False]
    def on_closed():
        if closed_handled[0]:
            return
        closed_handled[0] = True
        print("[Main] Window close event triggered.", flush=True)
        if not bridge._closing_saved:
            h = get_active_hwnd()
            capture_and_save_window_state(
                h,
                fallback_maximized=bridge._is_maximized,
                explicit_maximized=bridge._is_maximized,
            )
            bridge._closing_saved = True
        stop_heartbeat.set()
        detach_ui(DESKTOP_PORT, ui_instance_id)

        def cleanup_and_exit():
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
            time.sleep(0.15)
            os._exit(0)

        threading.Thread(target=cleanup_and_exit, daemon=True).start()

    window.events.shown += on_shown
    window.events.loaded += on_loaded
    window.events.closing += on_closing
    window.events.closed += on_closed
    window.events.maximized += on_maximized
    window.events.restored += on_restored
    window.events.resized += on_resized
    window.events.moved += on_moved

    # 7. Launch native Microsoft WebView2 container with isolated profile
    profile_dir = os.path.join(APP_DIR, "data", "webview_profile")
    os.makedirs(profile_dir, exist_ok=True)

    def cleanup_webview_cache(p_dir: str):
        """Safely prunes bloated EdgeChromium render/shader/disk caches while preserving user profile, localStorage, and credentials."""
        try:
            import shutil
            cache_dirs = [
                os.path.join(p_dir, "EBWebView", "Default", "Cache"),
                os.path.join(p_dir, "EBWebView", "Default", "Code Cache"),
                os.path.join(p_dir, "EBWebView", "Default", "GPUCache"),
                os.path.join(p_dir, "EBWebView", "Default", "DawnCache"),
                os.path.join(p_dir, "EBWebView", "Default", "Service Worker", "CacheStorage"),
                os.path.join(p_dir, "EBWebView", "Crashpad"),
            ]
            for cdir in cache_dirs:
                if os.path.isdir(cdir):
                    shutil.rmtree(cdir, ignore_errors=True)
        except Exception as exc:
            print(f"[Main] Notice during webview cache pruning: {exc}", flush=True)

    cleanup_webview_cache(profile_dir)
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
