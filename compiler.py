"""
VS DATABASE • COMPILER STUDIO
Ultra-sleek Glassmorphic GUI Compiler for Building Standalone VS Database Executables.
Matches the dark/light glass design system of VS Database.
"""

import os
import sys
import time
import json
import shutil
import ctypes
import urllib.parse
import threading
import subprocess
from datetime import datetime
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

APP_DIR = os.path.dirname(os.path.abspath(__file__))
COMPILER_PORT = 8769
SPEC_FILE = os.path.join(APP_DIR, "VS_Database.spec")
ROOT_EXE = os.path.join(APP_DIR, "VS_Database.exe")
DIST_EXE = os.path.join(APP_DIR, "dist", "VS_Database.exe")


class CompilationState:
    def __init__(self):
        self.lock = threading.Lock()
        self.process = None
        self.is_running = False
        self.is_done = False
        self.success = False
        self.exit_code = None
        self.logs = []  # list of {"level": "...", "msg": "..."}
        self.stage = 1
        self.percent = 0
        self.status_text = "Idle"
        self.start_time = 0
        self.end_time = 0
        self.final_size_str = ""

    def add_log(self, level: str, msg: str):
        with self.lock:
            self.logs.append({"level": level, "msg": msg})

    def update_progress(self, stage: int, percent: int, text: str):
        with self.lock:
            self.stage = max(self.stage, stage)
            self.percent = max(self.percent, percent)
            self.status_text = text

    def get_snapshot(self, since: int = 0):
        with self.lock:
            new_logs = self.logs[since:]
            return {
                "logs": new_logs,
                "next_index": len(self.logs),
                "is_running": self.is_running,
                "is_done": self.is_done,
                "success": self.success,
                "exit_code": self.exit_code,
                "stage": self.stage,
                "percent": self.percent,
                "status_text": self.status_text,
                "exe_size": self.final_size_str,
            }


state = CompilationState()


def get_system_info():
    exe_size_str = "Not Found"
    exe_date_str = "—"
    if os.path.exists(ROOT_EXE):
        try:
            sz = os.path.getsize(ROOT_EXE) / (1024 * 1024)
            exe_size_str = f"{sz:.1f} MB"
            mtime = os.path.getmtime(ROOT_EXE)
            exe_date_str = datetime.fromtimestamp(mtime).strftime("%d %b, %H:%M")
        except Exception:
            pass

    pyinstaller_ver = "6.x"
    try:
        res = subprocess.run([sys.executable, "-m", "PyInstaller", "--version"], capture_output=True, text=True, timeout=5)
        if res.returncode == 0 and res.stdout.strip():
            pyinstaller_ver = res.stdout.strip()
    except Exception:
    setup_exe = os.path.join(APP_DIR, "VS_Database_Setup.exe")
    setup_size_str = "Not Found"
    setup_date_str = "—"
    if os.path.exists(setup_exe):
        try:
            sz = os.path.getsize(setup_exe) / (1024 * 1024)
            setup_size_str = f"{sz:.1f} MB"
            mtime = os.path.getmtime(setup_exe)
            setup_date_str = datetime.fromtimestamp(mtime).strftime("%d %b, %H:%M")
        except Exception:
            pass

    return {
        "python_ver": sys.version.split()[0],
        "pyinstaller_ver": pyinstaller_ver,
        "spec_exists": os.path.exists(SPEC_FILE),
        "exe_size": exe_size_str,
        "exe_date": exe_date_str,
        "setup_size": setup_size_str,
        "setup_date": setup_date_str,
        "root_dir": APP_DIR,
    }


def run_compilation_worker(options: dict):
    global state
    target_mode = options.get("target", "app")  # "app" or "setup"
    is_setup = (target_mode == "setup")

    with state.lock:
        state.is_running = True
        state.is_done = False
        state.success = False
        state.exit_code = None
        state.logs = []
        state.stage = 1
        state.percent = 5
        state.status_text = "Building Setup Installer..." if is_setup else "Pre-flight checks..."
        state.start_time = time.time()
        state.final_size_str = ""

    clean_build = options.get("clean_build", True)
    auto_deploy = options.get("auto_deploy", True)
    backup_existing = options.get("backup_existing", True)

    try:
        # Pre-flight
        title = "Setup Installer (VS_Database_Setup.exe)" if is_setup else "Standalone App (VS_Database.exe)"
        state.add_log("STAGE", f"[Stage 1/5] Initializing Build for {title}")
        
        target_spec = os.path.join(APP_DIR, "VS_Database_Setup.spec") if is_setup else SPEC_FILE
        if not os.path.exists(target_spec):
            state.add_log("ERR", f"Specification file not found: {target_spec}")
            with state.lock:
                state.is_running = False
                state.is_done = True
                state.success = False
                state.exit_code = 1
            return

        if clean_build and not is_setup:
            state.add_log("INFO", "Purging previous build cache (build/ and dist/)...")
            build_dir = os.path.join(APP_DIR, "build")
            dist_dir = os.path.join(APP_DIR, "dist")
            if os.path.exists(build_dir):
                shutil.rmtree(build_dir, ignore_errors=True)
            if os.path.exists(dist_dir):
                shutil.rmtree(dist_dir, ignore_errors=True)

        if is_setup:
            state.update_progress(1, 15, "Invoking Setup Packager Engine...")
            cmd = [sys.executable, "build_setup.py"]
        else:
            if backup_existing and os.path.exists(ROOT_EXE):
                bak_path = os.path.join(APP_DIR, "VS_Database.exe.bak")
                state.add_log("INFO", f"Backing up existing binary to: {os.path.basename(bak_path)}")
                try:
                    shutil.copy2(ROOT_EXE, bak_path)
                except Exception as e:
                    state.add_log("WARN", f"Backup notice: {e}")

            state.update_progress(1, 15, "Spawning PyInstaller compiler...")
            cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", SPEC_FILE]

        state.add_log("INFO", f"Executing: {' '.join(cmd)}")

        creation_flags = 0
        if sys.platform == "win32":
            creation_flags = subprocess.CREATE_NO_WINDOW

        proc = subprocess.Popen(
            cmd,
            cwd=APP_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            creationflags=creation_flags
        )

        with state.lock:
            state.process = proc

        # Stream output
        for raw_line in iter(proc.stdout.readline, ''):
            if not raw_line:
                break
            line = raw_line.strip()
            if not line:
                continue

            # Classify level & stage
            level = "INFO"
            if "WARNING" in line:
                level = "WARN"
            elif "ERROR" in line or "Error:" in line or "CRITICAL" in line:
                level = "ERR"

            # Detect PyInstaller milestones
            if "Analyzing" in line or "Processing module" in line:
                state.update_progress(2, 25, "Analyzing Python AST & collecting modules...")
            elif "Looking for dynamic libraries" in line or "collecting submodules" in line:
                state.update_progress(2, 40, "Collecting native binaries & WebView2 runtimes...")
            elif "Building PYZ" in line or "ZlibArchive" in line:
                state.update_progress(3, 55, "Compressing pure Python bytecode into PYZ archive...")
                level = "STAGE"
            elif "Building PKG" in line or "Building EXE" in line:
                state.update_progress(4, 75, "Compiling CArchive bootloader & embedding manifest...")
                level = "STAGE"
            elif "Appending archive to EXE" in line or "Fixing EXE" in line:
                state.update_progress(4, 88, "Finalizing PE binary structure & icon assets...")

            state.add_log(level, line)

        proc.stdout.close()
        return_code = proc.wait()

        with state.lock:
            state.exit_code = return_code
            state.end_time = time.time()

        if return_code == 0:
            state.update_progress(5, 92, "Deploying binary to root directory...")
            state.add_log("STAGE", "[Stage 5/5] Root Deployment & Final Verification")

            if is_setup:
                built_exe = os.path.join(APP_DIR, "VS_Database_Setup.exe")
                if not os.path.exists(built_exe):
                    built_exe = os.path.join(APP_DIR, "dist", "VS_Database_Setup.exe")
                target_dest = os.path.join(APP_DIR, "VS_Database_Setup.exe")
            else:
                built_exe = DIST_EXE
                if not os.path.exists(built_exe):
                    built_exe = os.path.join(APP_DIR, "dist", "VS_Database", "VS_Database.exe")
                target_dest = ROOT_EXE

            if os.path.exists(built_exe):
                sz_mb = os.path.getsize(built_exe) / (1024 * 1024)
                sz_str = f"{sz_mb:.1f} MB"
                state.final_size_str = sz_str
                state.add_log("OK", f"Target executable generated: {built_exe} ({sz_str})")

                if auto_deploy and built_exe != target_dest:
                    try:
                        shutil.copy2(built_exe, target_dest)
                        state.add_log("OK", f"Deployed successfully to root: {target_dest}")
                    except Exception as dep_err:
                        state.add_log("WARN", f"Root copy notice: {dep_err}")

                with state.lock:
                    state.is_running = False
                    state.is_done = True
                    state.success = True
                    state.percent = 100
                    state.status_text = "Setup Build Succeeded!" if is_setup else "Build Succeeded!"
            else:
                state.add_log("ERR", f"Built executable not found: {built_exe}")
                with state.lock:
                    state.is_running = False
                    state.is_done = True
                    state.success = False
                    state.status_text = "Executable Missing"
        else:
            state.add_log("ERR", f"Compilation failed with process exit code {return_code}")
            with state.lock:
                state.is_running = False
                state.is_done = True
                state.success = False
                state.status_text = f"Failed (Exit Code: {return_code})"

    except Exception as exc:
        state.add_log("ERR", f"Exception during compilation: {exc}")
        import traceback
        state.add_log("ERR", traceback.format_exc())
        with state.lock:
            state.is_running = False
            state.is_done = True
            state.success = False
            state.status_text = "Build Error"


class CompilerRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    def log_message(self, format, *args):
        pass  # Suppress console spam

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/" or path == "/compiler":
            self.send_response(302)
            self.send_header("Location", "/static/compiler.html")
            self.end_headers()
            return

        if path == "/api/status":
            info = get_system_info()
            self._send_json(info)
            return

        if path == "/api/logs":
            query = urllib.parse.parse_qs(parsed.query)
            since = int(query.get("since", ["0"])[0])
            snapshot = state.get_snapshot(since)
            self._send_json(snapshot)
            return

        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        body_data = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            payload = json.loads(body_data.decode("utf-8")) if body_data else {}
        except Exception:
            payload = {}

        if path == "/api/compile":
            if not state.is_running:
                t = threading.Thread(target=run_compilation_worker, args=(payload,), daemon=True)
                t.start()
                self._send_json({"ok": True})
            else:
                self._send_json({"ok": False, "error": "Already compiling"})
            return

        if path == "/api/cancel":
            CompilerBridge.cancel_compile_internal()
            self._send_json({"ok": True})
            return

        if path == "/api/launch":
            CompilerBridge.launch_app_internal()
            self._send_json({"ok": True})
            return

        if path == "/api/open-folder":
            CompilerBridge.open_folder_internal()
            self._send_json({"ok": True})
            return

        self.send_error(404)

    def _send_json(self, data: dict):
        response_bytes = json.dumps(data).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(response_bytes)


class CompilerBridge:
    _window = None

    @classmethod
    def set_window(cls, window):
        cls._window = window

    def get_status(self):
        return get_system_info()

    def start_compile(self, options=None):
        opts = options or {}
        if not state.is_running:
            t = threading.Thread(target=run_compilation_worker, args=(opts,), daemon=True)
            t.start()
            return True
        return False

    def get_logs(self, since=0):
        return state.get_snapshot(int(since))

    def cancel_compile(self):
        CompilerBridge.cancel_compile_internal()
        return True

    def launch_app(self):
        CompilerBridge.launch_app_internal()
        return True

    def open_folder(self):
        CompilerBridge.open_folder_internal()
        return True

    def minimize(self):
        if self._window:
            self._window.minimize()

    def maximize(self):
        if self._window:
            self._window.toggle_fullscreen()

    def close(self):
        if self._window:
            self._window.destroy()

    @staticmethod
    def cancel_compile_internal():
        with state.lock:
            if state.process and state.is_running:
                try:
                    subprocess.run(["taskkill", "/F", "/T", "/PID", str(state.process.pid)], capture_output=True)
                except Exception:
                    try:
                        state.process.kill()
                    except Exception:
                        pass
                state.is_running = False
                state.is_done = True
                state.success = False
                state.status_text = "Aborted by user"

    @staticmethod
    def launch_app_internal():
        target = ROOT_EXE if os.path.exists(ROOT_EXE) else DIST_EXE
        if os.path.exists(target):
            try:
                subprocess.Popen([target], cwd=APP_DIR)
            except Exception as e:
                print(f"[Compiler] Error launching {target}: {e}")
        else:
            try:
                subprocess.Popen([sys.executable, "main_app.py"], cwd=APP_DIR)
            except Exception as e:
                print(f"[Compiler] Error launching main_app.py: {e}")

    @staticmethod
    def open_folder_internal():
        target = ROOT_EXE if os.path.exists(ROOT_EXE) else APP_DIR
        try:
            if os.path.exists(target) and os.path.isfile(target):
                subprocess.run(["explorer.exe", f"/select,{os.path.normpath(target)}"])
            else:
                subprocess.run(["explorer.exe", os.path.normpath(APP_DIR)])
        except Exception as e:
            print(f"[Compiler] Error opening explorer: {e}")


def start_http_server(port: int):
    server = ThreadingHTTPServer(("127.0.0.1", port), CompilerRequestHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server


def main():
    print(f"=== VS Database • Compiler Studio ===")
    print(f"Directory: {APP_DIR}")
    print(f"Python: {sys.version.split()[0]}")

    # Start HTTP server
    port = COMPILER_PORT
    try:
        start_http_server(port)
        print(f"Compiler Server running at http://127.0.0.1:{port}/static/compiler.html")
    except Exception as e:
        print(f"Server start notice: {e}")

    # Check for --browser flag
    if "--browser" in sys.argv:
        import webbrowser
        webbrowser.open(f"http://127.0.0.1:{port}/static/compiler.html")
        print("Opened in default browser. Press Ctrl+C to terminate.")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            sys.exit(0)

    # Launch PyWebView desktop container
    try:
        import webview
        bridge = CompilerBridge()
        icon_path = os.path.join(APP_DIR, "static", "app_icon.ico")

        window = webview.create_window(
            title="VS Database • Compiler Studio",
            url=f"http://127.0.0.1:{port}/static/compiler.html",
            js_api=bridge,
            width=1240,
            height=860,
            min_size=(980, 680),
            background_color="#eef2ff",
            frameless=True,
            shadow=True,
            easy_drag=False,
            zoomable=True
        )
        bridge.set_window(window)

        # Style override for frameless window
        def on_shown():
            try:
                hwnd = None
                if hasattr(window, "native") and window.native:
                    h = getattr(window.native, "Handle", None)
                    if h:
                        hwnd = int(h.ToInt64() if hasattr(h, "ToInt64") else (h.ToInt32() if hasattr(h, "ToInt32") else h))
                if not hwnd:
                    hwnd = ctypes.windll.user32.FindWindowW(None, "VS Database • Compiler Studio")
                if hwnd and ctypes.windll.user32.IsWindow(hwnd):
                    GWL_STYLE = -16
                    WS_CAPTION = 0x00C00000
                    style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_STYLE)
                    if style & WS_CAPTION:
                        style &= ~WS_CAPTION
                        ctypes.windll.user32.SetWindowLongW(hwnd, GWL_STYLE, style)
                    DWMWA_CAPTION_COLOR = 35
                    color_bg = ctypes.c_int(0x00FFF2EE)  # #eef2ff
                    ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, ctypes.byref(color_bg), 4)
                    SWP_NOMOVE = 0x0002
                    SWP_NOSIZE = 0x0001
                    SWP_NOZORDER = 0x0004
                    SWP_FRAMECHANGED = 0x0020
                    ctypes.windll.user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED)
            except Exception as e:
                pass

        window.events.shown += on_shown
        webview.start(gui="edgechromium", icon=icon_path if os.path.exists(icon_path) else None, debug=False)

    except Exception as exc:
        print(f"PyWebView error ({exc}), falling back to web browser...")
        import webbrowser
        webbrowser.open(f"http://127.0.0.1:{port}/static/compiler.html")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            sys.exit(0)


if __name__ == "__main__":
    main()
