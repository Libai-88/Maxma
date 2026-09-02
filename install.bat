@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ========================================
echo   MaxmaHere - 一键安装
echo ========================================
echo.
echo 本脚本会自动完成后端、前端、Agent 引擎的依赖
echo 安装与 .env 初始化，全程无需手动敲命令。
echo.

REM ---------- 0. 运行环境检测 ----------
echo [0/4] 检查运行环境（Python / Node / Bun）...
set RUNTIME_OK=1

where python >nul 2>&1
if errorlevel 1 (
    echo   [ERR] 未找到 Python，请先安装 Python 3.11+：
    echo         https://www.python.org/downloads/
    set RUNTIME_OK=0
) else (
    for /f "delims=" %%v in ('python --version 2^>^&1') do echo   [OK] %%v
)

where node >nul 2>&1
if errorlevel 1 (
    echo   [ERR] 未找到 Node.js，请先安装 Node.js 18+：
    echo         https://nodejs.org/
    set RUNTIME_OK=0
) else (
    for /f "delims=" %%v in ('node --version') do echo   [OK] Node.js %%v
)

where bun >nul 2>&1
if errorlevel 1 (
    echo   [ERR] 未找到 Bun，请先安装：
    echo         powershell -c "irm bun.sh/install.ps1 | iex"
    set RUNTIME_OK=0
) else (
    for /f "delims=" %%v in ('bun --version') do echo   [OK] Bun %%v
)

if not "%RUNTIME_OK%"=="1" (
    echo.
    echo 缺少的运行环境请先安装，然后重新运行本脚本。
    pause
    exit /b 1
)
echo.

REM ---------- 1. Python 虚拟环境 + 后端依赖 ----------
echo [1/4] 安装后端依赖（Python 虚拟环境）...
if not exist ".venv\Scripts\python.exe" (
    echo   正在创建 .venv ...
    python -m venv .venv
    if errorlevel 1 (
        echo   [ERR] 创建虚拟环境失败
        pause
        exit /b 1
    )
) else (
    echo   [OK] .venv 已存在，跳过创建
)

echo   正在安装 Python 依赖（约 200-400MB，请稍候）...
".venv\Scripts\python" -m pip install --upgrade pip >nul
".venv\Scripts\python" -m pip install -r requirements.txt
if errorlevel 1 (
    echo   [ERR] Python 依赖安装失败，请检查网络后重试
    pause
    exit /b 1
)
echo   [OK] 后端依赖已安装
echo.

REM ---------- 2. Agent 引擎（Bun sidecar）依赖 ----------
echo [2/4] 安装 Agent 引擎依赖（bun-sidecar）...
if exist "bun-sidecar\node_modules" (
    echo   [OK] sidecar 依赖已存在，跳过安装
) else (
    pushd bun-sidecar
    bun install
    if errorlevel 1 (
        popd
        echo   [ERR] sidecar 依赖安装失败
        pause
        exit /b 1
    )
    popd
    echo   [OK] sidecar 依赖已安装
)
echo.

REM ---------- 3. 前端（web 端）依赖 ----------
echo [3/4] 安装前端依赖（web）...
if exist "web\node_modules" (
    echo   [OK] 前端依赖已存在，跳过安装
) else (
    pushd web
    call npm install
    if errorlevel 1 (
        popd
        echo   [ERR] 前端依赖安装失败
        pause
        exit /b 1
    )
    popd
    echo   [OK] 前端依赖已安装
)
echo.

REM ---------- 4. 环境配置文件 ----------
echo [4/4] 初始化环境配置（.env）...
if exist ".env" (
    echo   [OK] .env 已存在，跳过
) else (
    if exist ".env.example" (
        copy /y ".env.example" ".env" >nul
        echo   [OK] 已从 .env.example 创建 .env
    ) else (
        echo   [!] 未找到 .env.example，请手动创建 .env
    )
)
echo.

echo ========================================
echo   安装完成！
echo.
echo   下一步：
echo     1. 双击运行 start.bat 启动
echo        （自动拉起后端 + 前端，并打开浏览器）
echo     2. 首次使用请在网页"提供商 /providers"页面
echo        填入 LLM 的 Base URL 与 API Key
echo ========================================
echo.
pause