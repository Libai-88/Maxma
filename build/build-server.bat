@echo off
REM MaxmaHere server build
REM Build Python backend into dist/maxma-server.exe
REM
REM Usage: build\build-server.bat
REM Output: dist\maxma-server.exe

setlocal enabledelayedexpansion

cd /d "%~dp0\.."

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
set "PYINSTALLER_VERSION=6.21.0"
set "PYINSTALLER_HOOKS_VERSION=2026.6"
set "ALTGRAPH_VERSION=0.17.5"

echo ============================================
echo   MaxmaHere Server Build
echo ============================================
echo.

REM Create the locked Python environment on the first build. Existing local
REM environments are reused to keep the normal developer build fast.
if not exist ".venv\Scripts\python.exe" (
    echo [INFO] Creating Python virtual environment...
    where python >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Python 3.11 or newer is required to create .venv
        exit /b 1
    )
    python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)"
    if errorlevel 1 (
        echo [ERROR] Python 3.11 or newer is required
        exit /b 1
    )
    python -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create .venv
        exit /b 1
    )
    set "MAXMA_INSTALL_PYTHON_DEPS=1"
)

if /i "%MAXMA_CI%"=="1" set "MAXMA_INSTALL_PYTHON_DEPS=1"
if /i "%MAXMA_CI%"=="true" set "MAXMA_INSTALL_PYTHON_DEPS=1"

if "%MAXMA_INSTALL_PYTHON_DEPS%"=="1" (
    echo [INFO] Installing Python dependencies from requirements-lock.txt...
    %PYTHON_EXE% -m pip install --disable-pip-version-check -r requirements-lock.txt
    if errorlevel 1 (
        echo [ERROR] Locked Python dependency installation failed
        exit /b 1
    )
)

REM Check the activation script after creating or reusing the environment.
if not exist ".venv\Scripts\activate.bat" (
    echo [ERROR] Python virtual environment is incomplete: .venv\Scripts\activate.bat
    exit /b 1
)

REM Activate the virtual environment.
call .venv\Scripts\activate.bat
if errorlevel 1 exit /b 1

REM Install the exact build tool versions when missing or mismatched.
set "NEEDS_PYI=0"
%PYTHON_EXE% -c "import PyInstaller; raise SystemExit(0 if PyInstaller.__version__ == '%PYINSTALLER_VERSION%' else 1)" 2>nul
if errorlevel 1 set "NEEDS_PYI=1"
if "%NEEDS_PYI%"=="1" (
    echo [INFO] Installing pinned PyInstaller toolchain...
    %PYTHON_EXE% -m pip install --disable-pip-version-check --upgrade pyinstaller==%PYINSTALLER_VERSION% pyinstaller-hooks-contrib==%PYINSTALLER_HOOKS_VERSION% altgraph==%ALTGRAPH_VERSION%
    if errorlevel 1 (
        echo [ERROR] Pinned PyInstaller installation failed
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
set "NEEDS_NPM_INSTALL=0"
if not exist "web\node_modules" set "NEEDS_NPM_INSTALL=1"
if /i "%MAXMA_CI%"=="1" set "NEEDS_NPM_INSTALL=1"
if /i "%MAXMA_CI%"=="true" set "NEEDS_NPM_INSTALL=1"
if "%NEEDS_NPM_INSTALL%"=="1" (
    if not exist "web\package-lock.json" (
        echo [ERROR] web\package-lock.json is required for a clean frontend install
        exit /b 1
    )
    where npm >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] npm is required to install frontend dependencies
        exit /b 1
    )
    echo [INFO] Installing frontend dependencies with npm ci...
    pushd web
    call npm ci
    if errorlevel 1 (
        popd
        echo [ERROR] Frontend dependency installation failed
        exit /b 1
    )
    popd
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
powershell -NoProfile -ExecutionPolicy Bypass -File build\test-packaging-safety.ps1 -SkipArtifact
if errorlevel 1 (
    echo [ERROR] Packaging safety preflight failed
    exit /b 1
)
%PYINSTALLER_CMD% build\maxma-server.spec --clean --noconfirm

if errorlevel 1 (
    echo [ERROR] PyInstaller 打包失败
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File build\test-packaging-safety.ps1 -TocPath "build\maxma-server\PKG-00.toc"
if errorlevel 1 (
    echo [ERROR] Packaging safety artifact check failed
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
