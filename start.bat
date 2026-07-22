@echo off

cd /d "%~dp0"

REM Port configuration: API remains on 8000; Vite/Tauri use 1420.
if "%MAXMA_API_PORT%"=="" set "MAXMA_API_PORT=8000"
if "%MAXMA_WEB_PORT%"=="" set "MAXMA_WEB_PORT=1420"

echo ========================================
echo   MaxmaHere Startup
echo ========================================
echo.

REM Step 0: Clean up stale backend and frontend processes.
echo [0/5] Cleaning stale processes on ports %MAXMA_API_PORT%, %MAXMA_WEB_PORT%...
powershell -NoProfile -ExecutionPolicy Bypass -File build\port-guard.ps1 -PortsStr "%MAXMA_API_PORT%,%MAXMA_WEB_PORT%"
if errorlevel 1 (
    echo [ERR] Failed to clean stale processes.
    pause
    exit /b 1
)
echo.

if not exist "main.py" (
    echo [ERR] Run this script from the project root.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo [ERR] Virtual env not found. Run:
    echo        python -m venv .venv
    echo        .venv\Scripts\pip install -r requirements.txt
    pause
    exit /b 1
)

if not exist "web\node_modules" (
    echo [ERR] Frontend dependencies not found. Run:
    echo        cd web ^&^& npm install
    pause
    exit /b 1
)

echo [1/5] Starting backend (FastAPI :%MAXMA_API_PORT%) ...
start "MaxmaHere Backend" /d "%~dp0" cmd /k ".venv\Scripts\python main.py"

echo [2/5] Waiting for backend ...
set "READY=0"
for /L %%i in (1,1,30) do (
    curl -s http://localhost:%MAXMA_API_PORT%/api/health >nul 2>&1
    if not errorlevel 1 (
        set "READY=1"
        goto :backend_ready
    )
    ping -n 2 127.0.0.1 >nul
)
:backend_ready

if "%READY%"=="0" (
    echo [ERR] Backend startup timed out.
    exit /b 1
) else (
    echo        Backend ready.
)

echo [3/5] Starting frontend (Vite :%MAXMA_WEB_PORT%) ...
start "MaxmaHere Frontend" /d "%~dp0web" cmd /k "npm run dev -- --host 127.0.0.1 --port %MAXMA_WEB_PORT%"

echo [4/5] Waiting for frontend ...
set "READY=0"
for /L %%i in (1,1,20) do (
    curl -s http://localhost:%MAXMA_WEB_PORT% >nul 2>&1
    if not errorlevel 1 (
        set "READY=1"
        goto :frontend_ready
    )
    ping -n 2 127.0.0.1 >nul
)
:frontend_ready

if "%READY%"=="0" (
    echo [ERR] Frontend startup timed out.
    exit /b 1
) else (
    echo        Frontend ready.
)

echo [5/5] Opening browser...
start "" http://localhost:%MAXMA_WEB_PORT%

echo.
echo ========================================
echo   All services started
echo   Backend:  http://localhost:%MAXMA_API_PORT%
echo   Frontend: http://localhost:%MAXMA_WEB_PORT%
echo ========================================
echo.
echo Close the two server windows to stop.
echo.
pause
