@echo off
REM MaxmaHere Windows 桌面构建脚本（生产打包）
REM 产物：desktop\src-tauri\target\release\bundle\nsis\*.exe

setlocal
cd /d "%~dp0\.."

call build\setup-dev-env.bat
if errorlevel 1 exit /b 1

echo [1/4] 构建 Python sidecar 可执行文件...
call build\build-server.bat
if errorlevel 1 exit /b 1

echo.
echo [2/4] 准备嵌入式运行时（Node.js + Python embeddable + uv）...
powershell -NoProfile -ExecutionPolicy Bypass -File build\prepare-runtime.ps1
if errorlevel 1 (
    echo [ERROR] 嵌入式运行时准备失败
    exit /b 1
)

echo.
echo [3/4] 准备资源（Playwright Chromium + ONNX 模型）...
powershell -NoProfile -ExecutionPolicy Bypass -File build\prepare-assets.ps1
if errorlevel 1 (
    echo [ERROR] 资源准备失败
    exit /b 1
)

echo.
echo [4/4] 构建 Tauri 安装包...
cd desktop\src-tauri
cargo tauri build
if errorlevel 1 (
    echo [ERROR] Tauri 构建失败
    exit /b 1
)

echo.
echo === 构建完成 ===
echo 产物目录：desktop\src-tauri\target\release\bundle\nsis
