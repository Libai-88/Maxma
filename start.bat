@echo off
chcp 65001 >nul
setlocal EnableExtensions

REM MaxmaHere development launcher (Bun backend + Vite frontend).
REM Backend: bun-backend (Hono, default :8000). Frontend: web (Vite, :5173).

cd /d "%~dp0"

set "PI_CODING_AGENT_DIR=%~dp0data\pi"

if "%MAXMA_BUN_PORT%"=="" set "MAXMA_BUN_PORT=8000"
if "%MAXMA_WEB_PORT%"=="" set "MAXMA_WEB_PORT=5173"

echo ========================================
echo   MaxmaHere Development
echo ========================================
echo.

echo [0/4] Cleaning stale processes on ports %MAXMA_BUN_PORT%, %MAXMA_WEB_PORT%...
powershell -NoProfile -ExecutionPolicy Bypass -File build\port-guard.ps1 -PortsStr "%MAXMA_BUN_PORT%,%MAXMA_WEB_PORT%"
if errorlevel 1 (
    echo [ERR] Failed to clean stale processes.
    pause
    exit /b 1
)
echo.

REM Resolve a Bun binary: global bun first, then the pinned bundled runtime.
set "BUN=bun"
where bun >nul 2>&1
if errorlevel 1 (
    if exist "bun-sidecar\bun.exe" (
        set "BUN=%CD%\bun-sidecar\bun.exe"
    ) else (
        echo [ERR] Bun not found. Run install.bat to prepare the toolchain.
        pause
        exit /b 1
    )
)

if not exist "bun-backend\node_modules" (
    echo [ERR] Backend deps missing. Run install.bat first.
    pause
    exit /b 1
)
if not exist "web\node_modules" (
    echo [ERR] Frontend deps missing. Run install.bat first.
    pause
    exit /b 1
)

echo [1/4] Starting backend (Bun :%MAXMA_BUN_PORT%)...
start "MaxmaHere Backend" /d "%~dp0bun-backend" cmd /k ""%BUN%" run src/server.ts"

echo [2/4] Waiting for backend...
set "READY=0"
for /L %%i in (1,1,30) do (
    curl -s http://localhost:%MAXMA_BUN_PORT%/api/health >nul 2>&1
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

echo [3/4] Starting frontend (Vite :%MAXMA_WEB_PORT%)...
start "MaxmaHere Frontend" /d "%~dp0web" cmd /k "npm run dev -- --host 127.0.0.1 --port %MAXMA_WEB_PORT%"

echo [4/4] Waiting for frontend...
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

start "" http://localhost:%MAXMA_WEB_PORT%

echo.
echo ========================================
echo   All services started
echo   Backend:  http://localhost:%MAXMA_BUN_PORT%
echo   Frontend: http://localhost:%MAXMA_WEB_PORT%
echo ========================================
echo.
echo Close the two server windows to stop.
echo.
pause
