@echo off
REM MaxmaHere Windows desktop build script (production packaging)
REM Output: desktop\src-tauri\target\release\bundle\nsis\*.exe

setlocal EnableExtensions
cd /d "%~dp0\.."

call build\setup-dev-env.bat
if errorlevel 1 exit /b 1

echo [1/4] Building Python sidecar executable...
call build\build-server.bat
if errorlevel 1 exit /b 1
if not exist "web\dist\" (
    echo [ERROR] Frontend dist was not produced
    exit /b 1
)
if not exist "desktop\src-tauri\binaries\maxma-server-x86_64-pc-windows-msvc.exe" (
    echo [ERROR] Target-suffix sidecar was not produced
    exit /b 1
)

echo.
echo [2/4] Preparing embedded runtime (Node.js + Python embeddable + uv)...
powershell -NoProfile -ExecutionPolicy Bypass -File build\prepare-runtime.ps1
if errorlevel 1 (
    echo [ERROR] Embedded runtime preparation failed
    exit /b 1
)
if not exist "desktop\src-tauri\resources\runtime\" (
    echo [ERROR] Embedded runtime resources are missing
    exit /b 1
)

echo.
echo [3/4] Preparing assets (Playwright Chromium + ONNX model)...
powershell -NoProfile -ExecutionPolicy Bypass -File build\prepare-assets.ps1
if errorlevel 1 (
    echo [ERROR] Assets preparation failed
    exit /b 1
)
if not exist "desktop\src-tauri\resources\assets\" (
    echo [ERROR] Asset resources are missing
    exit /b 1
)

echo.
echo [4/4] Building Tauri installer...
pushd desktop\src-tauri
if errorlevel 1 (
    echo [ERROR] Cannot enter Tauri project directory
    exit /b 1
)
cargo tauri build
if errorlevel 1 (
    popd
    echo [ERROR] Tauri build failed
    exit /b 1
)
popd
if not exist "desktop\src-tauri\target\release\maxma-here.exe" (
    echo [ERROR] Tauri application was not produced
    exit /b 1
)
if not exist "desktop\src-tauri\target\release\bundle\nsis\" (
    echo [ERROR] Tauri installer output is missing
    exit /b 1
)

echo.
echo === Build complete ===
echo Output: desktop\src-tauri\target\release\bundle\nsis
