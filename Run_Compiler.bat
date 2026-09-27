@echo off
title VS Database Compiler Studio
cd /d "%~dp0"
python compiler.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo An error occurred running compiler.py.
    pause
)
