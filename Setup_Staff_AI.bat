@echo off
title VS AI - Staff PC Setup (Lightweight CPU Model Suite)
color 0A

echo ============================================================
echo   VS AI -- STAFF PC AUTOMATED MODEL SETUP
echo   Target: CPU Only (Zero GPU required, < 3GB RAM)
echo ============================================================
echo.

rem Check if Ollama is in PATH or standard install directory
where ollama >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" (
        set "PATH=%PATH%;%LOCALAPPDATA%\Programs\Ollama"
    )
)

where ollama >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [!] Ollama runtime was not found in active PATH.
    if exist "%~dp0AI\OllamaSetup.exe" (
        echo [*] Found bundled installer: %~dp0AI\OllamaSetup.exe
        echo [*] Installing Ollama... Please wait.
        start /wait "" "%~dp0AI\OllamaSetup.exe" /SILENT
        if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" (
            set "PATH=%PATH%;%LOCALAPPDATA%\Programs\Ollama"
        )
    ) else (
        echo [!] Downloading Ollama for Windows...
        powershell -Command Start-Process 'https://ollama.com/download/windows'
        echo Please complete the Ollama installation window, then re-run this script.
        pause
        exit /b 1
    )
)

where ollama >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [!] Ollama could not be found. Please ensure Ollama is installed and try again.
    pause
    exit /b 1
)

echo [*] Starting Ollama service if not already running...
start " /B ollama serve >nul 2>&1
timeout /t 2 /nobreak >nul

echo.
echo ============================================================
echo DOWNLOADING LIGHTWEIGHT STAFF AI SUITE (CPU OPTIMIZED)
echo ============================================================
echo 1/2: Pulling LLaMA 3.2 1B (Ultra-fast CPU Drafting - 1.3 GB)...
ollama pull llama3.2:1b

echo.
echo 2/2: Pulling Qwen 2.5 1.5B (Structured Tax & Table Reasoning - 1.0 GB)...
ollama pull qwen2.5:1.5b

echo.
echo ============================================================
echo SUCCESS! Staff CPU Models are installed and ready.
echo ============================================================
echo Active default: llama3.2:1b (Fast CPU Inference)
echo.
pause
