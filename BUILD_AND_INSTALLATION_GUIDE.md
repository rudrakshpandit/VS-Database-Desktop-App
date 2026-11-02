# VS Database 2.0 — Build and Installation Guide
## Tauri 2 Desktop Shell for Windows

---

## 1. Prerequisites & Toolchain Setup

To develop, compile, or build packages for **VS Database 2.0**, ensure the following tools are available on the Windows workstation:

1. **Rust Toolchain:**
   - Minimum Rust version: `1.85+` (tested on `rustc 1.99.1`).
   - Active toolchain: `stable-x86_64-pc-windows-gnu` or `stable-x86_64-pc-windows-msvc`.
   - Toolchain binaries in PATH: `C:\Users\rudra\.cargo\bin`.
2. **C / C++ Compiler & Assembler:**
   - MinGW toolchain: `BrechtSanders.WinLibs.POSIX.UCRT` or `MartinStorsjo.LLVM-MinGW.UCRT`.
   - Required tools in PATH: `gcc.exe`, `as.exe`, `dlltool.exe`, `llvm-windres.exe` (or `windres.exe`).
3. **Node.js & Tauri CLI:**
   - Node.js `v20.0+` (tested on `v24.16.0`).
   - Tauri CLI `v2.0+` (tested on `tauri-cli 2.12.4` via `npx @tauri-apps/cli`).
4. **Python Runtime (for Backend Sidecar):**
   - Python `3.12+` 64-bit (tested on Python `3.14`).
   - Required libraries: `pymupdf`, `openpyxl`, `python-docx`, `reportlab`, `pillow`, `pypdf`.
5. **Microsoft Edge WebView2 Runtime:**
   - Pre-installed on Windows 10 (20H2+) and Windows 11.

---

## 2. Development & Running Locally

### Step 1: Launch Python Backend Service (Headless)
In a PowerShell terminal:
```powershell
cd "D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration"
pythonw server.py
```
*Note: The Tauri desktop shell automatically spawns this process if it is not already running.*

### Step 2: Run Tauri Desktop Shell in Development Mode
In a PowerShell terminal:
```powershell
cd "D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration\src-tauri"
$env:PATH = "C:\Users\rudra\.cargo\llvm_windres;C:\Users\rudra\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin;C:\Users\rudra\.cargo\bin;" + $env:PATH
npx @tauri-apps/cli dev
```

---

## 3. Building Standalone Binary

To compile the standalone Windows executable:
```powershell
cd "D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration\src-tauri"
$env:PATH = "C:\Users\rudra\.cargo\llvm_windres;C:\Users\rudra\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin;C:\Users\rudra\.cargo\bin;" + $env:PATH
cargo build --release
```
The compiled release executable will be generated at:
`src-tauri/target/release/vs-database.exe`

---

## 4. Building Production Windows Installer (.msi / .exe)

To generate the single-click Windows setup bundle with Start Menu shortcuts and uninstaller:
```powershell
cd "D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration\src-tauri"
$env:PATH = "C:\Users\rudra\.cargo\llvm_windres;C:\Users\rudra\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin;C:\Users\rudra\.cargo\bin;" + $env:PATH
npx @tauri-apps/cli build
```
Installer outputs will be placed in:
`src-tauri/target/release/bundle/nsis/VS Database_2.0.0_x64-setup.exe`
`src-tauri/target/release/bundle/msi/VS Database_2.0.0_x64_en-US.msi`

---

## 5. Verification & Health Check

After launching the application:
1. Verify the window renders with the glassmorphic frame and hardware-accelerated drag header.
2. Confirm that backend health responds on `http://127.0.0.1:8767/api/desktop/health`:
   ```powershell
   Invoke-RestMethod http://127.0.0.1:8767/api/desktop/health
   ```
   Expected response:
   ```json
   { "ok": true, "status": "healthy", "service": "VS Database Desktop" }
   ```
3. Test keyboard shortcuts (F1, Ctrl+F, Esc) and verify that PDF studio, client management, and Tally integration functions operate normally.
