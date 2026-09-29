@echo off
title Build VS Database Setup Installer
cd /d "%~dp0"
python build_setup.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo An error occurred building the setup installer.
    pause
) else (
    echo.
    echo Setup build completed! Press any key to exit.
    pause > nul
)
