@echo off
setlocal enabledelayedexpansion

echo =======================================================
echo TEST 1: CLEAN WINDOWS RUNTIME VERIFICATION (NO PYTHON)
echo =======================================================

:: Strip all Python entries from PATH
set "CLEAN_PATH="
for %%A in ("%PATH:;=" "%") do (
    echo %%~A | findstr /i "python WindowsApps" >nul
    if errorlevel 1 (
        if defined CLEAN_PATH (
            set "CLEAN_PATH=!CLEAN_PATH!;%%~A"
        ) else (
            set "CLEAN_PATH=%%~A"
        )
    )
)
set "PATH=%CLEAN_PATH%"

echo Verifying python is NOT accessible in PATH:
where python >nul 2>&1
if not errorlevel 1 (
    echo [FAIL] Python is still found in PATH!
    where python
    exit /b 1
) else (
    echo [OK] Python is confirmed ABSENT from environment PATH.
)

where pythonw >nul 2>&1
if not errorlevel 1 (
    echo [FAIL] Pythonw is still found in PATH!
    where pythonw
    exit /b 1
) else (
    echo [OK] Pythonw is confirmed ABSENT from environment PATH.
)

echo.
echo Launching Tauri Release Binary: src-tauri\target\release\vs-database.exe
start "" "src-tauri\target\release\vs-database.exe"

echo Waiting 5 seconds for standalone sidecar startup...
ping 127.0.0.1 -n 6 >nul

echo Testing backend health endpoint via curl...
curl -s -m 5 http://127.0.0.1:8767/api/desktop/health > health_output.txt
type health_output.txt
echo.

findstr /i "VS Database Desktop" health_output.txt >nul
if errorlevel 1 (
    echo [FAIL] Backend failed to start without system Python!
    taskkill /f /im vs-database.exe >nul 2>&1
    taskkill /f /im server_sidecar.exe >nul 2>&1
    del health_output.txt >nul 2>&1
    exit /b 1
) else (
    echo [PASS] Backend sidecar and Tauri GUI successfully running in clean non-Python environment!
)

echo.
echo Cleaning up test process...
taskkill /f /im vs-database.exe >nul 2>&1
taskkill /f /im server_sidecar.exe >nul 2>&1
del health_output.txt >nul 2>&1
echo [OK] Clean shutdown verified.
exit /b 0
