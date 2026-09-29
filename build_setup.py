"""
VS DATABASE • SETUP BUILDER AUTOMATION
Packs VS_Database.exe, uninstaller, and assets into payload.zip,
then compiles VS_Database_Setup.exe using PyInstaller.
"""

import os
import sys
import time
import shutil
import zipfile
import subprocess

APP_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_EXE = os.path.join(APP_DIR, "VS_Database.exe")
PAYLOAD_ZIP = os.path.join(APP_DIR, "payload.zip")
SPEC_SETUP = os.path.join(APP_DIR, "VS_Database_Setup.spec")
DIST_SETUP_EXE = os.path.join(APP_DIR, "dist", "VS_Database_Setup.exe")
FINAL_SETUP_EXE = os.path.join(APP_DIR, "VS_Database_Setup.exe")


def step(msg):
    print(f"\n[BUILD SETUP] {msg}", flush=True)


def main():
    start_time = time.time()
    step("Validating source executable...")
    if not os.path.exists(ROOT_EXE):
        dist_candidate = os.path.join(APP_DIR, "dist", "VS_Database.exe")
        if os.path.exists(dist_candidate):
            shutil.copy2(dist_candidate, ROOT_EXE)
        else:
            print("ERROR: VS_Database.exe not found! Please compile VS_Database.exe first.")
            sys.exit(1)

    sz_mb = os.path.getsize(ROOT_EXE) / (1024 * 1024)
    print(f"  Found VS_Database.exe ({sz_mb:.1f} MB)")

    # 1. Build uninstaller if needed
    uninst_exe = os.path.join(APP_DIR, "dist", "uninstall.exe")
    if not os.path.exists(uninst_exe):
        step("Compiling standalone uninstaller (uninstall.exe)...")
        uninst_cmd = [
            sys.executable, "-m", "PyInstaller",
            "--onefile",
            "--noconfirm",
            "--windowed",
            "--icon=static/app_icon.ico",
            "--name=uninstall",
            "uninstall_app.py"
        ]
        res = subprocess.run(uninst_cmd, cwd=APP_DIR)
        if res.returncode != 0:
            print("Warning: Uninstaller build failed, will proceed without standalone uninstaller.")

    # 2. Package payload.zip
    step("Creating compressed software payload (payload.zip)...")
    with zipfile.ZipFile(PAYLOAD_ZIP, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        print("  Adding VS_Database.exe...")
        zf.write(ROOT_EXE, "VS_Database.exe")

        ico_path = os.path.join(APP_DIR, "static", "app_icon.ico")
        if os.path.exists(ico_path):
            print("  Adding app_icon.ico...")
            zf.write(ico_path, "app_icon.ico")

        if os.path.exists(uninst_exe):
            print("  Adding uninstall.exe...")
            zf.write(uninst_exe, "uninstall.exe")

    payload_sz = os.path.getsize(PAYLOAD_ZIP) / (1024 * 1024)
    print(f"  Payload package created: {payload_sz:.1f} MB")

    # 3. Compile VS_Database_Setup.exe
    step("Compiling Glassmorphic Setup Wizard (VS_Database_Setup.exe)...")
    setup_cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        SPEC_SETUP
    ]
    res = subprocess.run(setup_cmd, cwd=APP_DIR)
    if res.returncode != 0:
        print(f"ERROR: Setup compilation failed with code {res.returncode}")
        sys.exit(res.returncode)

    # 4. Deploy to root
    step("Deploying final setup file to root directory...")
    if os.path.exists(DIST_SETUP_EXE):
        shutil.copy2(DIST_SETUP_EXE, FINAL_SETUP_EXE)
        final_sz = os.path.getsize(FINAL_SETUP_EXE) / (1024 * 1024)
        elapsed = time.time() - start_time
        print("\n" + "="*56)
        print("[SUCCESS] VS_DATABASE_SETUP.EXE GENERATED SUCCESSFULLY!")
        print(f"  Target File : {FINAL_SETUP_EXE}")
        print(f"  Setup Size  : {final_sz:.1f} MB")
        print(f"  Total Time  : {elapsed:.1f} seconds")
        print("="*56 + "\n")
    else:
        print(f"ERROR: {DIST_SETUP_EXE} was not generated.")
        sys.exit(1)


if __name__ == "__main__":
    main()
