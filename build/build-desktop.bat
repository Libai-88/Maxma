@echo off
REM MaxmaHere Windows desktop build script (production packaging)
REM Output: desktop\src-tauri\target\release\bundle\nsis\*.exe

setlocal
cd /d "%~dp0\.."

call build\setup-dev-env.bat
if errorlevel 1 exit /b 1

echo [1/4] Building Python sidecar executable...
call build\build-server.bat
if errorlevel 1 exit /b 1

echo.
echo [2/4] Preparing embedded runtime (Node.js + Python embeddable + uv)...
powershell -NoProfile -ExecutionPolicy Bypass -File build\prepare-runtime.ps1
if errorlevel 1 (
    echo [ERROR] Embedded runtime preparation failed
    exit /b 1
)

echo.
echo [3/4] Preparing assets (Playwright Chromium + ONNX model)...
powershell -NoProfile -ExecutionPolicy Bypass -File build\prepare-assets.ps1
if errorlevel 1 (
    echo [ERROR] Assets preparation failed
    exit /b 1
)

echo.
echo [4/4] Building Tauri installer...
cd desktop\src-tauri
cargo tauri build
if errorlevel 1 (
    echo [ERROR] Tauri build failed
    exit /b 1
)

echo.
echo === Build complete ===
echo Output: desktop\src-tauri\target\release\bundle\nsis
