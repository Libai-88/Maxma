@echo off
REM MaxmaHere server build
REM Build Python backend into dist/maxma-server.exe
REM
REM Usage: build\build-server.bat
REM Output: dist\maxma-server.exe

setlocal enabledelayedexpansion

cd /d "%~dp0\.."

call build\setup-dev-env.bat
if errorlevel 1 exit /b 1

REM 端口配置：优先读取环境变量，未设置则使用默认值
if "%MAXMA_API_PORT%"=="" set "MAXMA_API_PORT=8000"

REM Clean up stale backend before smoke test
powershell -NoProfile -ExecutionPolicy Bypass -File build\port-guard.ps1 -PortsStr "%MAXMA_API_PORT%" >nul 2>&1
if errorlevel 1 exit /b 1

set "DIST_EXE=dist\maxma-server.exe"
set "TAURI_BIN_DIR=desktop\src-tauri\binaries"
set "TAURI_BIN_EXE=%TAURI_BIN_DIR%\maxma-server-x86_64-pc-windows-msvc.exe"
set "STALE_DIST_DIR=dist\maxma-server"
set "PYTHON_EXE=.venv\Scripts\python.exe"
set "PYINSTALLER_CMD=%PYTHON_EXE% -m PyInstaller"

echo ============================================
echo   MaxmaHere Server Build
echo ============================================
echo.

REM 清理旧 venv 检查
if not exist ".venv\Scripts\activate.bat" (
    echo [ERROR] Python 虚拟环境不存在，请先运行 setup-dev-env.bat
    exit /b 1
)

REM 激活虚拟环境
call .venv\Scripts\activate.bat
if errorlevel 1 exit /b 1

REM 检查并安装 PyInstaller
set "HAS_PYI=0"
%PYTHON_EXE% -c "import PyInstaller" 2>nul && set "HAS_PYI=1"
if "%HAS_PYI%"=="0" (
    echo [INFO] PyInstaller 未安装，正在安装...
    REM 检查 uv 是否已安装（参考 setup-dev.bat 的防御性检查）
    where uv >nul 2>&1
    if errorlevel 1 (
        echo [ERR] 未找到 uv。请先安装 uv：
        echo       powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 ^| iex"
        exit /b 1
    )
    uv pip install pyinstaller
    if errorlevel 1 (
        echo [ERROR] PyInstaller 安装失败
        exit /b 1
    )
)

REM 清理旧产物（onedir 目录和 exe）
if exist "%STALE_DIST_DIR%\" (
    echo [INFO] 清理旧目录 %STALE_DIST_DIR%
    rmdir /s /q "%STALE_DIST_DIR%"
    if errorlevel 1 exit /b 1
)
if exist "%DIST_EXE%" (
    del /f /q "%DIST_EXE%"
    if errorlevel 1 exit /b 1
)

REM 构建前端
echo [1/4] 构建前端...
if not exist "web\node_modules" (
    echo [ERR] Frontend dependencies not found. Run:
    echo        cd web ^&^& npm install
    exit /b 1
)
cd web
call npm run build 2>&1
if errorlevel 1 (
    echo [ERROR] 前端构建失败
    exit /b 1
)
cd ..

REM 准备打包所需的 bun.exe（下载官方二进制，捆绑进产物供 agent 引擎使用）
echo [INFO] 准备捆绑的 Bun 运行时 (bun.exe)...
powershell -NoProfile -ExecutionPolicy Bypass -File build\prepare-bun.ps1
if errorlevel 1 (
    echo [ERROR] Bun 运行时准备失败
    exit /b 1
)
set "BUN_EXE=%CD%\bun-sidecar\bun.exe"
if not exist "%BUN_EXE%" (
    echo [ERROR] Bundled Bun runtime is missing: %BUN_EXE%
    exit /b 1
)
if not exist "bun-sidecar\package.json" (
    echo [ERROR] bun-sidecar package.json is missing
    exit /b 1
)
REM Use the pinned bundled runtime and lockfile so a missing global Bun cannot produce a partial build.
echo [INFO] Installing bun-sidecar dependencies with bundled Bun...
pushd bun-sidecar
"%BUN_EXE%" install --frozen-lockfile
if errorlevel 1 (
    popd
    echo [ERROR] bun-sidecar dependency installation failed
    exit /b 1
)
popd
if not exist "bun-sidecar\node_modules\" (
    echo [ERROR] bun-sidecar node_modules was not produced
    exit /b 1
)

REM 打包后端
echo [2/4] 打包后端...
%PYINSTALLER_CMD% build\maxma-server.spec --clean --noconfirm

if errorlevel 1 (
    echo [ERROR] PyInstaller 打包失败
    exit /b 1
)

echo [3/4] 运行冒烟测试...
powershell -NoProfile -ExecutionPolicy Bypass -File build\smoke-test-server.ps1
if errorlevel 1 (
    echo [ERROR] 冒烟测试未通过
    exit /b 1
)

REM 部署
echo [4/4] 部署到 Tauri binaries...
if exist "%DIST_EXE%" (
    if not exist "%TAURI_BIN_DIR%\" (
        mkdir "%TAURI_BIN_DIR%"
        if errorlevel 1 (
            echo [ERROR] Failed to create Tauri binaries directory
            exit /b 1
        )
    )
    copy /y "%DIST_EXE%" "%TAURI_BIN_EXE%" >nul
    if errorlevel 1 (
        echo [ERROR] 复制 exe 到 Tauri binaries 失败
        exit /b 1
    )

    echo.
    echo ============================================
    echo   打包完成
    echo   产物：%DIST_EXE%
    echo   Tauri sidecar：%TAURI_BIN_EXE%
    echo ============================================

    REM 显示文件大小
    for %%F in ("%DIST_EXE%") do (
        echo   文件大小：%%~zF bytes
    )
) else (
    echo [ERROR] 未找到产物 %DIST_EXE%
    exit /b 1
)
endlocal & exit /b 0
