@echo off
chcp 65001 >nul
setlocal EnableExtensions

REM MaxmaHere Web launcher (WEB-HOST-001) — Bun backend serves web/dist.
REM For the portable distribution use MaxmaHere.bat inside the portable folder.
REM This entry point is for running the Web form directly from a repo checkout
REM (backend bundles the frontend from web/dist; build it first: cd web && npm run build).

set "SCRIPT_DIR=%~dp0"
set "MAXMA_SERVE_WEB=1"
if "%MAXMA_BUN_PORT%"=="" set "MAXMA_BUN_PORT=8000"

REM Resolve a Bun binary: global bun, then the pinned bundled runtime, then a
REM packaged bun.exe beside this script.
set "BUN=bun"
where bun >nul 2>&1
if errorlevel 1 (
    if exist "%SCRIPT_DIR%bun-sidecar\bun.exe" (
        set "BUN=%SCRIPT_DIR%bun-sidecar\bun.exe"
    ) else if exist "%SCRIPT_DIR%bun.exe" (
        set "BUN=%SCRIPT_DIR%bun.exe"
    ) else (
        echo [ERROR] Bun not found. Run install.bat, or use the portable MaxmaHere.bat.
        exit /b 1
    )
)

if not exist "%SCRIPT_DIR%web\dist\index.html" (
    echo [ERROR] Frontend not built. Run: cd web ^&^& npm run build
    exit /b 1
)

echo [INFO] Starting Bun backend (Web form) on :%MAXMA_BUN_PORT% ...
start "MaxmaHere backend" /D "%SCRIPT_DIR%bun-backend" "%BUN%" run src/server.ts

REM Wait for the health endpoint (whitelisted, no auth).
set "HEALTH_URL=http://127.0.0.1:%MAXMA_BUN_PORT%/api/health"
echo [INFO] Waiting for %HEALTH_URL% ...
set /a TRIES=0
:poll
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%HEALTH_URL%' -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto ready
set /a TRIES+=1
if %TRIES% geq 30 (
    echo [ERROR] Backend did not become ready within 60s. Check logs.
    exit /b 1
)
timeout /t 2 /nobreak >nul
goto poll

:ready
echo [INFO] Backend ready. Opening browser...
start "" "http://127.0.0.1:%MAXMA_BUN_PORT%/"
echo.
echo ========================================
echo   MaxmaHere Web is running
echo   URL: http://127.0.0.1:%MAXMA_BUN_PORT%/
echo ========================================
endlocal & exit /b 0
