@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ========================================
echo   MaxmaHere - 一键安装
echo ========================================
echo.
echo 本脚本完成后端（Bun）、前端、Agent 引擎的依赖
echo 安装与 .env 初始化，全程无需手动敲命令。
echo.

REM ---------- 0. 运行环境检测 ----------
echo [0/4] 检查运行环境（Node.js / Bun）...
set RUNTIME_OK=1

where node >nul 2>&1
if errorlevel 1 (
    echo   [ERR] 未找到 Node.js，请先安装 Node.js 18+：
    echo         https://nodejs.org/
    set RUNTIME_OK=0
) else (
    for /f "delims=" %%v in ('node --version') do echo   [OK] Node.js %%v
    node -e "if(+process.versions.node.split('.')[0]<18)process.exit(1)" >nul 2>&1
    if errorlevel 1 (
        echo   [ERR] Node.js 版本过低，需要 18 及以上
        set RUNTIME_OK=0
    )
)

if not "%RUNTIME_OK%"=="1" (
    echo.
    echo 缺少的运行环境请先安装，然后重新运行本脚本。
    pause
    exit /b 1
)
echo.

REM ---------- 1. Bun 运行时（固定版本，不依赖全局安装）----------
echo [1/4] 准备 Bun 运行时（固定版本，下载 bun.exe）...
powershell -NoProfile -ExecutionPolicy Bypass -File build\prepare-bun.ps1
if errorlevel 1 (
    echo   [ERR] 下载 Bun 失败，请检查网络后重试
    pause
    exit /b 1
)
set "BUN=%CD%\bun-sidecar\bun.exe"
if not exist "%BUN%" (
    echo   [ERR] bun.exe 未就位
    pause
    exit /b 1
)
echo   [OK] Bun 运行时已准备

REM ---------- 2. 后端 + Agent 引擎依赖（Bun）----------
echo [2/4] 安装后端与 Agent 引擎依赖（bun-backend / bun-sidecar）...
pushd bun-backend
"%BUN%" install
if errorlevel 1 (
    popd
    echo   [ERR] bun-backend 依赖安装失败
    pause
    exit /b 1
)
popd
pushd bun-sidecar
"%BUN%" install
if errorlevel 1 (
    popd
    echo   [ERR] bun-sidecar 依赖安装失败
    pause
    exit /b 1
)
popd
echo   [OK] 后端与引擎依赖已安装
echo.

REM ---------- 3. 前端依赖 ----------
echo [3/4] 安装前端依赖（web）...
if exist "web\node_modules" (
    echo   [OK] 前端依赖已存在，跳过安装
) else (
    pushd web
    call npm ci
    if errorlevel 1 (
        popd
        echo   [ERR] 前端依赖安装失败
        pause
        exit /b 1
    )
    popd
)
echo   [OK] 前端依赖已安装
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
echo        （自动拉起 Bun 后端 + Vite 前端，并打开浏览器）
echo     2. 首次使用请在网页"提供商 /providers"页面
echo        填入 LLM 的 Base URL 与 API Key
echo ========================================
echo.
pause
