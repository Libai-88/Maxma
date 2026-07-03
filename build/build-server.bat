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

REM Clean up stale backend before smoke test
powershell -NoProfile -ExecutionPolicy Bypass -File build\port-guard.ps1 -PortsStr "8000" >nul 2>&1

set "DIST_EXE=dist\maxma-server.exe"
set "TAURI_BIN_DIR=desktop\src-tauri\binaries"
set "TAURI_BIN_EXE=%TAURI_BIN_DIR%\maxma-server-x86_64-pc-windows-msvc.exe"
set "STALE_DIST_DIR=dist\maxma-server"
set "PYI_SITE_PACKAGES=D:\PythonLibraries\site-packages"
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

REM 检查并设置 PyInstaller
set "HAS_PYI=0"
%PYTHON_EXE% -c "import PyInstaller" 2>nul && set "HAS_PYI=1"
if "%HAS_PYI%"=="0" (
    if exist "%PYI_SITE_PACKAGES%\PyInstaller\__init__.py" (
        echo [INFO] 从系统库加载 PyInstaller：%PYI_SITE_PACKAGES%
        set "PYTHONPATH=%PYI_SITE_PACKAGES%;%PYTHONPATH%"
    ) else (
        echo [ERROR] 未找到 PyInstaller。
        echo   请确认 %PYI_SITE_PACKAGES% 下存在 PyInstaller
        echo   或运行：%PYTHON_EXE% -m pip install pyinstaller
        exit /b 1
    )
)

REM 清理旧产物（onedir 目录和 exe）
if exist "%STALE_DIST_DIR%\" (
    echo [INFO] 清理旧目录 %STALE_DIST_DIR%
    rmdir /s /q "%STALE_DIST_DIR%"
)
if exist "%DIST_EXE%" (
    del /f /q "%DIST_EXE%"
)

REM 构建前端
echo [1/4] 构建前端...
cd web
call npm run build 2>&1
if errorlevel 1 (
    echo [ERROR] 前端构建失败
    exit /b 1
)
cd ..

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
    if not exist "%TAURI_BIN_DIR%\" mkdir "%TAURI_BIN_DIR%"
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
