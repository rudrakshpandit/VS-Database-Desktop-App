@echo off
setlocal enabledelayedexpansion

set "PATH=C:\Users\rudra\.cargo\llvm_windres;C:\Users\rudra\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin;C:\Users\rudra\.cargo\bin;%PATH%"

cd /d "D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration"

echo ==============================================================================
echo STEP 1/2: Building Production VS Database Host Installer (NSIS)
echo ==============================================================================
call npx.cmd @tauri-apps/cli build --config src-tauri\tauri.host.conf.json
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Host installer build failed with code %ERRORLEVEL%!
    exit /b %ERRORLEVEL%
)

echo.
echo ==============================================================================
echo STEP 2/2: Building Production VS Database Client Installer (NSIS)
echo ==============================================================================
call npx.cmd @tauri-apps/cli build --config src-tauri\tauri.client.conf.json
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Client installer build failed with code %ERRORLEVEL%!
    exit /b %ERRORLEVEL%
)

echo.
echo ==============================================================================
echo ALL INSTALLERS GENERATED SUCCESSFULLY!
echo ==============================================================================
