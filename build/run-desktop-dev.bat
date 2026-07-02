@echo off
REM MaxmaHere Windows ????/????????
REM ??? Tauri ????????????

setlocal
cd /d "%~dp0\.."

REM Step 0: Clean up stale processes on dev ports
echo [0/4] Cleaning stale processes on ports 8000, 5173 ...
powershell -NoProfile -ExecutionPolicy Bypass -File build\port-guard.ps1 -PortsStr "8000,5173"
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
echo [2/4] Starting Vite dev server...
start "MaxmaHere Vite" /min cmd /c "cd /d %CD%\web && npm run dev -- --host 127.0.0.1"

echo [INFO] Waiting for Vite...
powershell -NoProfile -ExecutionPolicy Bypass -File build\dev-tools.ps1 -WaitUrl http://127.0.0.1:5173 -TimeoutSec 45
if errorlevel 1 exit /b 1

echo.
echo [3/4] Cleaning ports before Tauri launch...
powershell -NoProfile -ExecutionPolicy Bypass -File build\port-guard.ps1 -PortsStr "8000"
echo.

echo [4/4] Starting Tauri dev window...
cd desktop\src-tauri
cargo tauri dev
