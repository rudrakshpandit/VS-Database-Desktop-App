@echo off
title VS AI - Host PC Setup (RTX GPU Model Suite)
color 0B

echo ============================================================
echo   VS AI -- HOST PC AUTOMATED MODEL SETUP
echo   Target: NVIDIA RTX 3050 / RTX 3060 GPU
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
echo DOWNLOADING DEFAULT HOST AI SUITE (4 MODELS)
echo ============================================================
echo 1/4: Pulling Primary Host Model (Qwen 2.5 3B - Indian Tax & Law)...
ollama pull qwen2.5:3b

echo.
echo 2/4: Pulling LLaMA 3.2 3B (General Practice Reasoning)...
ollama pull llama3.2:3b

echo.
echo 3/4: Pulling LLaMA 3.2 1B (Ultra-fast Drafting)...
ollama pull llama3.2:1b

echo.
echo 4/4: Pulling Gemma 2 2B (Ledger & Math Logic)...
ollama pull gemma2:2b

echo.
echo ============================================================
echo SUCCESS! All Host Models are installed and ready.
echo ============================================================
echo Active default: qwen2.5:3b (Optimized for RTX 3050/3060)
echo.
pause
