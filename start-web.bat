@echo off
chcp 65001 >nul
setlocal EnableExtensions

REM MaxmaHere Web 形态启动器（WEB-HOST-001）。
REM Tauri 桌面壳构建链移除后的保底分发方式：
REM   1. 拉起后端（maxma-server.exe 或开发模式 .venv Python）
REM   2. 后端经 FastAPI 托管 web/dist（MAXMA_SERVE_WEB=1）
REM   3. 后端按 sidecar_manager 逻辑拉起 pi 引擎（maxma-engine.exe / bun run）
REM   4. 打开浏览器
REM
REM 前置：web/dist 已构建（cd web && npm run build）；
REM       便携包场景 maxma-server.exe 与本脚本同目录。

set "SCRIPT_DIR=%~dp0"
set "MAXMA_SERVE_WEB=1"

REM ── 定位后端可执行：便携包优先，回退开发模式 ──
set "SERVER_EXE=%SCRIPT_DIR%maxma-server.exe"
set "USE_DEV=0"
if exist "%SERVER_EXE%" (
    echo [INFO] Using packaged backend: %SERVER_EXE%
    start "" "%SERVER_EXE%"
    goto wait_backend
)

if exist "%SCRIPT_DIR%.venv\Scripts\python.exe" (
    set "USE_DEV=1"
    echo [INFO] Using dev backend (.venv): main.py
    start "MaxmaHere backend" /D "%SCRIPT_DIR%" "%SCRIPT_DIR%.venv\Scripts\python.exe" main.py
    goto wait_backend
)

echo [ERROR] Backend not found. Expected maxma-server.exe beside this script,
echo         or .venv\Scripts\python.exe in the repo root (dev mode).
exit /b 1

:wait_backend
REM ── 等待后端就绪（/api/health 白名单端点，免鉴权） ──
set "PORT=8000"
if defined MAXMA_PORT set "PORT=%MAXMA_PORT%"
set "HEALTH_URL=http://127.0.0.1:%PORT%/api/health"

echo [INFO] Waiting for backend at %HEALTH_URL% ...
set /a TRIES=0
:poll
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri '%HEALTH_URL%' -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&1
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
start "" "http://127.0.0.1:%PORT%/"
echo.
echo ========================================
echo   MaxmaHere Web is running
echo   URL: http://127.0.0.1:%PORT%/
echo   （pi 引擎由后端按 sidecar_manager 自动拉起）
echo ========================================
endlocal & exit /b 0
