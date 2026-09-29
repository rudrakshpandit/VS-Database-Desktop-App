"""
VS DATABASE • UNINSTALLER
Clean uninstallation tool for removing VS Database, shortcuts, and registry entries.
"""

import os
import sys
import time
import winreg
import shutil
import ctypes
import subprocess

APP_NAME = "VS Database"
REG_PATH = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\VSDatabase"


def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except Exception:
        return False


def remove_shortcuts():
    # Desktop shortcut
    try:
        desktop_dir = os.path.join(os.environ.get("USERPROFILE", ""), "Desktop")
        desktop_lnk = os.path.join(desktop_dir, f"{APP_NAME}.lnk")
        if os.path.exists(desktop_lnk):
            os.remove(desktop_lnk)
            print(f"Removed desktop shortcut: {desktop_lnk}")
    except Exception as e:
        print(f"Desktop shortcut removal notice: {e}")

    # Start Menu shortcut
    try:
        start_menu = os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs", APP_NAME)
        if os.path.exists(start_menu):
            shutil.rmtree(start_menu, ignore_errors=True)
            print(f"Removed start menu directory: {start_menu}")
    except Exception as e:
        print(f"Start menu shortcut removal notice: {e}")


def remove_registry():
    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, REG_PATH)
        print("Removed uninstaller registry keys.")
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"Registry removal notice: {e}")


def main():
    install_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Prompt user with Windows Dialog
    MB_YESNO = 0x00000004
    MB_ICONQUESTION = 0x00000020
    IDYES = 6

    res = ctypes.windll.user32.MessageBoxW(
        0,
        "Are you sure you want to uninstall VS Database and remove all application shortcuts from your computer?",
        "VS Database Uninstall",
        MB_YESNO | MB_ICONQUESTION
    )

    if res != IDYES:
        sys.exit(0)

    # Ask if user wants to keep client data files
    MB_ICONWARNING = 0x00000030
    keep_data_res = ctypes.windll.user32.MessageBoxW(
        0,
        "Do you want to KEEP your existing client databases and document vault files?\n\nClick 'Yes' to preserve your files, or 'No' to remove everything.",
        "Preserve Client Data",
        MB_YESNO | MB_ICONQUESTION
    )
    keep_data = (keep_data_res == IDYES)

    print("Removing shortcuts...")
    remove_shortcuts()

    print("Cleaning registry...")
    remove_registry()

    # Self-deleting batch runner
    data_dir = os.path.join(install_dir, "data")
    del_cmd = f'ping 127.0.0.1 -n 2 > nul & del /f /q "{os.path.join(install_dir, "VS_Database.exe")}" & del /f /q "{os.path.join(install_dir, "app_icon.ico")}"'
    if not keep_data:
        del_cmd += f' & rmdir /s /q "{install_dir}"'
    else:
        # Keep data folder, remove binaries
        del_cmd += f' & del /f /q "{os.path.join(install_dir, "uninstall.exe")}"'

    batch_path = os.path.join(os.environ.get("TEMP", "C:\\Temp"), "vs_db_uninstall.bat")
    with open(batch_path, "w") as f:
        f.write(f"@echo off\n{del_cmd}\ndel /f /q \"%~f0\"\n")

    subprocess.Popen(["cmd.exe", "/c", batch_path], creationflags=0x08000000)

    ctypes.windll.user32.MessageBoxW(
        0,
        "VS Database has been successfully uninstalled from your computer.",
        "Uninstall Complete",
        0x00000040  # MB_ICONINFORMATION
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
