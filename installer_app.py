"""
VS DATABASE • SETUP WIZARD RUNTIME
Glassmorphic installation wizard that installs VS Database, extracts the payload,
creates Windows Desktop & Start Menu shortcuts, and registers in Windows Apps & Features.
"""

import os
import sys
import time
import json
import shutil
import ctypes
import winreg
import zipfile
import threading
import subprocess
import urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

# Base directories
if getattr(sys, 'frozen', False):
    BUNDLE_DIR = sys._MEIPASS
    APP_DIR = os.path.dirname(sys.executable)
else:
    BUNDLE_DIR = os.path.dirname(os.path.abspath(__file__))
    APP_DIR = BUNDLE_DIR

STATIC_DIR = os.path.join(BUNDLE_DIR, "static")
if not os.path.exists(STATIC_DIR):
    STATIC_DIR = os.path.join(APP_DIR, "static")

PORT = 8771


class InstallState:
    def __init__(self):
        self.lock = threading.Lock()
        self.percent = 0
        self.status_text = "Ready"
        self.substep = ""
        self.is_done = False
        self.success = False
        self.error = ""
        self.installed_path = ""

    def update(self, percent: int, text: str, substep: str = ""):
        with self.lock:
            self.percent = percent
            self.status_text = text
            if substep:
                self.substep = substep

    def complete(self, success: bool, installed_path: str = "", error: str = ""):
        with self.lock:
            self.percent = 100 if success else self.percent
            self.status_text = "Installation Completed!" if success else "Failed"
            self.is_done = True
            self.success = success
            self.installed_path = installed_path
            self.error = error

    def snapshot(self):
        with self.lock:
            return {
                "percent": self.percent,
                "status_text": self.status_text,
                "substep": self.substep,
                "is_done": self.is_done,
                "success": self.success,
                "error": self.error,
                "installed_path": self.installed_path
            }


state = InstallState()


def get_default_install_dir():
    local_app_data = os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local"))
    return os.path.join(local_app_data, "Programs", "VS Database")


def get_free_space_str(path):
    try:
        drive = os.path.splitdrive(os.path.abspath(path))[0] or "C:"
        free_bytes = shutil.disk_usage(drive).free
        return f"{free_bytes / (1024**3):.1f} GB"
    except Exception:
        return "Sufficient"


def create_windows_shortcut(target_exe, shortcut_path, icon_path=None, description="VS Database"):
    """Creates a Windows shell shortcut (.lnk) using Windows Script Host COM."""
    os.makedirs(os.path.dirname(shortcut_path), exist_ok=True)
    ps_cmd = f"""
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut('{shortcut_path}')
$Shortcut.TargetPath = '{target_exe}'
$Shortcut.WorkingDirectory = '{os.path.dirname(target_exe)}'
$Shortcut.Description = '{description}'
"""
    if icon_path and os.path.exists(icon_path):
        ps_cmd += f"\n$Shortcut.IconLocation = '{icon_path}'"
    ps_cmd += "\n$Shortcut.Save()"

    creation_flags = 0x08000000 if sys.platform == "win32" else 0  # CREATE_NO_WINDOW
    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_cmd], creationflags=creation_flags, check=True)


def register_uninstall(install_dir, installed_exe, icon_path):
    """Registers the application in Windows Registry (Settings > Installed Apps)."""
    reg_key_path = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\VSDatabase"
    try:
        key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, reg_key_path)
        winreg.SetValueEx(key, "DisplayName", 0, winreg.REG_SZ, "VS Database")
        winreg.SetValueEx(key, "DisplayVersion", 0, winreg.REG_SZ, "2.5.0")
        winreg.SetValueEx(key, "Publisher", 0, winreg.REG_SZ, "VS Database Team")
        winreg.SetValueEx(key, "DisplayIcon", 0, winreg.REG_SZ, icon_path if os.path.exists(icon_path) else installed_exe)
        winreg.SetValueEx(key, "InstallLocation", 0, winreg.REG_SZ, install_dir)
        
        uninstall_exe = os.path.join(install_dir, "uninstall.exe")
        if os.path.exists(uninstall_exe):
            winreg.SetValueEx(key, "UninstallString", 0, winreg.REG_SZ, f'"{uninstall_exe}"')
        else:
            winreg.SetValueEx(key, "UninstallString", 0, winreg.REG_SZ, f'cmd.exe /c del /f /q "{installed_exe}"')
            
        try:
            sz_kb = int(os.path.getsize(installed_exe) / 1024)
            winreg.SetValueEx(key, "EstimatedSize", 0, winreg.REG_DWORD, sz_kb)
        except Exception:
            pass
        winreg.CloseKey(key)
    except Exception as e:
        print(f"[Installer Registry Warning] {e}")


def run_install_worker(options: dict):
    global state
    target_dir = os.path.abspath(options.get("install_path", get_default_install_dir()))
    create_desktop = options.get("create_desktop_shortcut", True)
    create_startmenu = options.get("create_startmenu_shortcut", True)
    register_uninst = options.get("register_uninstaller", True)

    try:
        state.update(10, "Preparing destination directory...", target_dir)
        os.makedirs(target_dir, exist_ok=True)
        time.sleep(0.3)

        # 1. Extract Payload or Copy Binary
        payload_zip = os.path.join(BUNDLE_DIR, "payload.zip")
        if not os.path.exists(payload_zip):
            payload_zip = os.path.join(APP_DIR, "payload.zip")

        installed_exe = os.path.join(target_dir, "VS_Database.exe")
        installed_icon = os.path.join(target_dir, "app_icon.ico")

        if os.path.exists(payload_zip):
            state.update(25, "Extracting application package...", "Unzipping payload.zip")
            with zipfile.ZipFile(payload_zip, 'r') as zf:
                file_list = zf.namelist()
                total = len(file_list)
                for idx, fname in enumerate(file_list):
                    zf.extract(fname, target_dir)
                    pct = 25 + int((idx / max(total, 1)) * 45)
                    state.update(pct, "Extracting application components...", fname)
                    time.sleep(0.01)
        else:
            # Fallback: Developer / local workspace copy
            state.update(35, "Deploying executable binary...", "Copying VS_Database.exe")
            src_exe = os.path.join(APP_DIR, "VS_Database.exe")
            if not os.path.exists(src_exe):
                src_exe = os.path.join(APP_DIR, "dist", "VS_Database.exe")

            if os.path.exists(src_exe):
                shutil.copy2(src_exe, installed_exe)
            else:
                raise FileNotFoundError("VS_Database.exe payload not found to install.")

            src_ico = os.path.join(STATIC_DIR, "app_icon.ico")
            if os.path.exists(src_ico):
                shutil.copy2(src_ico, installed_icon)

        state.update(72, "Deploying uninstaller module...", "Configuring uninstall.exe")
        # Ensure icon exists in target
        if not os.path.exists(installed_icon):
            src_ico = os.path.join(STATIC_DIR, "app_icon.ico")
            if os.path.exists(src_ico):
                shutil.copy2(src_ico, installed_icon)

        # Deploy uninstaller
        installed_uninst = os.path.join(target_dir, "uninstall.exe")
        src_uninst = os.path.join(BUNDLE_DIR, "uninstall.exe")
        if not os.path.exists(src_uninst):
            src_uninst = os.path.join(APP_DIR, "dist", "uninstall.exe")
        if os.path.exists(src_uninst):
            shutil.copy2(src_uninst, installed_uninst)

        # 2. Desktop Shortcut
        if create_desktop:
            state.update(82, "Creating Desktop shortcut...", "VS Database.lnk")
            desktop_dir = os.path.join(os.environ.get("USERPROFILE", ""), "Desktop")
            desktop_lnk = os.path.join(desktop_dir, "VS Database.lnk")
            create_windows_shortcut(installed_exe, desktop_lnk, installed_icon, "VS Database — Client Vault & Office Filing")
            time.sleep(0.3)

        # 3. Start Menu Shortcut
        if create_startmenu:
            state.update(90, "Creating Start Menu folder...", "Programs\\VS Database")
            startmenu_dir = os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs", "VS Database")
            startmenu_lnk = os.path.join(startmenu_dir, "VS Database.lnk")
            create_windows_shortcut(installed_exe, startmenu_lnk, installed_icon, "VS Database")
            time.sleep(0.3)

        # 4. Windows Registry
        if register_uninst:
            state.update(96, "Registering in Windows Apps & Features...", "Registry entries")
            register_uninstall(target_dir, installed_exe, installed_icon)
            time.sleep(0.2)

        state.complete(True, target_dir)

    except Exception as exc:
        print(f"[Installer Worker Error] {exc}")
        import traceback
        traceback.print_exc()
        state.complete(False, target_dir, str(exc))


class InstallerRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def log_message(self, format, *args):
        pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/" or path == "/installer":
            self.send_response(302)
            self.send_header("Location", "/installer.html")
            self.end_headers()
            return

        if path == "/api/default-paths":
            d = get_default_install_dir()
            self._send_json({
                "install_path": d,
                "free_space_str": get_free_space_str(d)
            })
            return

        if path == "/api/install/progress":
            self._send_json(state.snapshot())
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

        if path == "/api/install":
            t = threading.Thread(target=run_install_worker, args=(payload,), daemon=True)
            t.start()
            self._send_json({"ok": True})
            return

        if path == "/api/select-folder":
            chosen = InstallerBridge.select_folder_internal()
            self._send_json({"folder": chosen})
            return

        if path == "/api/launch-app":
            InstallerBridge.launch_app_internal()
            self._send_json({"ok": True})
            return

        if path == "/api/window/close":
            if InstallerBridge._window:
                InstallerBridge._window.destroy()
            self._send_json({"ok": True})
            return

        if path == "/api/window/minimize":
            if InstallerBridge._window:
                InstallerBridge._window.minimize()
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


class InstallerBridge:
    _window = None

    @classmethod
    def set_window(cls, window):
        cls._window = window

    def get_default_paths(self):
        d = get_default_install_dir()
        return {
            "install_path": d,
            "free_space_str": get_free_space_str(d)
        }

    def select_folder(self):
        return InstallerBridge.select_folder_internal()

    def start_installation(self, options=None):
        opts = options or {}
        t = threading.Thread(target=run_install_worker, args=(opts,), daemon=True)
        t.start()
        return True

    def get_install_progress(self):
        return state.snapshot()

    def launch_app(self):
        InstallerBridge.launch_app_internal()
        return True

    def minimize(self):
        if self._window:
            self._window.minimize()

    def close(self):
        if self._window:
            self._window.destroy()

    @staticmethod
    def select_folder_internal():
        try:
            if InstallerBridge._window:
                import webview
                res = InstallerBridge._window.create_file_dialog(webview.FileDialog.FOLDER)
                if res:
                    return res[0] if isinstance(res, (list, tuple)) else str(res)
        except Exception:
            pass
        return None

    @staticmethod
    def launch_app_internal():
        installed_path = state.installed_path or get_default_install_dir()
        target_exe = os.path.join(installed_path, "VS_Database.exe")
        if os.path.exists(target_exe):
            try:
                subprocess.Popen([target_exe], cwd=installed_path)
            except Exception as e:
                print(f"[Installer] Error launching installed app: {e}")


def start_server(port: int):
    server = ThreadingHTTPServer(("127.0.0.1", port), InstallerRequestHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server


def main():
    print("=== VS Database • Setup Wizard ===")
    port = PORT
    try:
        start_server(port)
    except Exception as e:
        print(f"Server start notice: {e}")

    if "--browser" in sys.argv:
        import webbrowser
        webbrowser.open(f"http://127.0.0.1:{port}/installer.html")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            sys.exit(0)

    try:
        import webview
        bridge = InstallerBridge()
        icon_path = os.path.join(STATIC_DIR, "app_icon.ico")

        window = webview.create_window(
            title="VS Database • Setup Wizard",
            url=f"http://127.0.0.1:{port}/installer.html",
            js_api=bridge,
            width=700,
            height=580,
            min_size=(660, 540),
            resizable=False,
            background_color="#eef2ff",
            frameless=True,
            shadow=True,
            easy_drag=False
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
                    hwnd = ctypes.windll.user32.FindWindowW(None, "VS Database • Setup Wizard")
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
            except Exception:
                pass

        window.events.shown += on_shown
        webview.start(gui="edgechromium", icon=icon_path if os.path.exists(icon_path) else None, debug=False)

    except Exception as exc:
        print(f"WebView launch notice ({exc}), opening browser fallback...")
        import webbrowser
        webbrowser.open(f"http://127.0.0.1:{port}/installer.html")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            sys.exit(0)


if __name__ == "__main__":
    main()
