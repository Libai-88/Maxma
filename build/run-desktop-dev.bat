@echo off
REM MaxmaHere Windows desktop dev — Tauri dev mode entry point

setlocal
cd /d "%~dp0\.."

REM 端口配置：优先读取环境变量，未设置则使用默认值
if "%MAXMA_API_PORT%"=="" set "MAXMA_API_PORT=8000"
if "%MAXMA_WEB_PORT%"=="" set "MAXMA_WEB_PORT=1420"

REM Step 0: Clean up stale processes on dev ports
echo [0/4] Cleaning stale processes on ports %MAXMA_API_PORT%, %MAXMA_WEB_PORT% ...
powershell -NoProfile -ExecutionPolicy Bypass -File build\port-guard.ps1 -PortsStr "%MAXMA_API_PORT%,%MAXMA_WEB_PORT%"
if errorlevel 1 (
    echo [ERROR] Failed to clean stale desktop dev ports.
    exit /b 1
)
echo.

call build\setup-dev-env.bat
if errorlevel 1 exit /b 1

echo ============================================
echo   MaxmaHere Desktop Dev
echo ============================================
echo.

echo [1/4] Building Python sidecar...
call build\build-server.bat
if errorlevel 1 exit /b 1

echo.
echo [2/4] Vite is started by Tauri beforeDevCommand.

echo.
echo [3/4] Cleaning ports before Tauri launch...
powershell -NoProfile -ExecutionPolicy Bypass -File build\port-guard.ps1 -PortsStr "%MAXMA_API_PORT%"
if errorlevel 1 (
    echo [ERROR] Failed to clean the API port before Tauri launch.
    exit /b 1
)
echo.

echo [4/4] Starting Tauri dev window...
cd desktop\src-tauri
cargo tauri dev
