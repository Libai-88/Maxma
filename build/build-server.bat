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

REM ??????
if not exist ".venv\Scripts\activate.bat" (
    echo [ERROR] ??????? .venv?????????
    exit /b 1
)

REM ??????
call .venv\Scripts\activate.bat

REM ?? PyInstaller
%PYTHON_EXE% -c "import PyInstaller" 2>nul
if errorlevel 1 (
    if exist "%PYI_SITE_PACKAGES%\PyInstaller\__init__.py" (
        echo [INFO] ???? PyInstaller ???%PYI_SITE_PACKAGES%
        set "PYTHONPATH=%PYI_SITE_PACKAGES%"
    ) else (
        echo [ERROR] ?????? PyInstaller?.venv ??????????
        exit /b 1
    )
)

REM ???????? onedir ??????
if exist "%STALE_DIST_DIR%\" (
    echo [INFO] ??????? %STALE_DIST_DIR%
    rmdir /s /q "%STALE_DIST_DIR%"
)
if exist "%DIST_EXE%" (
    del /f /q "%DIST_EXE%"
)

REM ?????
echo [1/4] ????...
cd web
call npm run build --silent 2>nul
if errorlevel 1 (
    echo [ERROR] ??????
    exit /b 1
)
cd ..

REM ?? PyInstaller
echo [2/4] ????...
%PYINSTALLER_CMD% build\maxma-server.spec --clean --noconfirm

if errorlevel 1 (
    echo [ERROR] PyInstaller ????
    exit /b 1
)

echo [3/4] ????????...
powershell -NoProfile -ExecutionPolicy Bypass -File build\smoke-test-server.ps1
if errorlevel 1 (
    echo [ERROR] ?????????
    exit /b 1
)

REM ????
echo [4/4] ????...
if exist "%DIST_EXE%" (
    if not exist "%TAURI_BIN_DIR%\" mkdir "%TAURI_BIN_DIR%"
    copy /y "%DIST_EXE%" "%TAURI_BIN_EXE%" >nul
    if errorlevel 1 (
        echo [ERROR] ??????? Tauri binaries ????
        exit /b 1
    )

    echo.
    echo ============================================
    echo   ?????
    echo   ???%DIST_EXE%
    echo   Tauri sidecar?%TAURI_BIN_EXE%
    echo ============================================
    
    REM ??????
    for %%F in ("%DIST_EXE%") do (
        echo   ?????%%~zF bytes
    )
) else (
    echo [ERROR] ????? %DIST_EXE%
    exit /b 1
)
