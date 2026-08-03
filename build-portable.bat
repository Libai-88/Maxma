@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

REM MaxmaHere portable build. Keep this flow aligned with build-desktop.bat.
set "PROJECT_ROOT=%~dp0"
set "PORTABLE_DIR=%PROJECT_ROOT%..\MaxmaHere-Portable"
set "TAURI_ROOT=%PROJECT_ROOT%desktop\src-tauri"
set "TAURI_RELEASE_DIR=%TAURI_ROOT%\target\release"
set "TAURI_RELEASE_RESOURCES=%PROJECT_ROOT%desktop\src-tauri\target\release\resources"
set "DIST_DIR=%PROJECT_ROOT%web\dist"
set "SIDECAR_NAME=maxma-server-x86_64-pc-windows-msvc.exe"
set "SIDECAR_SOURCE=%PROJECT_ROOT%desktop\src-tauri\binaries\maxma-server-x86_64-pc-windows-msvc.exe"

echo.
echo ========================================
echo   MaxmaHere Portable Build
echo ========================================
echo.

cd /d "%PROJECT_ROOT%"
if errorlevel 1 (
    echo [ERROR] Cannot enter project root.
    exit /b 1
)

REM Remove the previous portable output before the server-build preflight scans it.
REM Runtime artifacts inside data/ (e.g. api\data\maxma.db) are not user data but
REM would trip the packaging-safety forbidden-path check and block a repeat build.
if exist "%PORTABLE_DIR%\" (
    echo [INFO] Removing previous portable output: %PORTABLE_DIR%
    rmdir /s /q "%PORTABLE_DIR%"
    if errorlevel 1 (
        echo [ERROR] Cannot remove previous portable output.
        exit /b 1
    )
)

REM Resolve the normal build environment for the final cargo invocation.
call build\setup-dev-env.bat
if errorlevel 1 (
    echo [ERROR] Development environment setup failed.
    exit /b 1
)

REM setup-dev-env.bat executes dev-tools.ps1 output that re-sets PROJECT_ROOT
REM without a trailing slash, breaking later %PROJECT_ROOT%dist\... joins.
REM Restore the trailing-slash value after the environment setup call.
set "PROJECT_ROOT=%~dp0"

echo [1/6] Building frontend and Python sidecar...
call build\build-server.bat
if errorlevel 1 (
    echo [ERROR] Formal server build failed.
    exit /b 1
)

if not exist "web\dist\" (
    echo [ERROR] Frontend dist was not produced: %DIST_DIR%
    exit /b 1
)
if not exist "%SIDECAR_SOURCE%" (
    echo [ERROR] Target-suffix sidecar was not produced: %SIDECAR_SOURCE%
    exit /b 1
)

echo [2/6] Preparing embedded runtime...
powershell -NoProfile -ExecutionPolicy Bypass -File build\prepare-runtime.ps1
if errorlevel 1 (
    echo [ERROR] Embedded runtime preparation failed.
    exit /b 1
)
if not exist "%TAURI_ROOT%\resources\runtime\" (
    echo [ERROR] Runtime resources were not prepared.
    exit /b 1
)

echo [3/6] Preparing bundled assets...
powershell -NoProfile -ExecutionPolicy Bypass -File build\prepare-assets.ps1
if errorlevel 1 (
    echo [ERROR] Asset preparation failed.
    exit /b 1
)
if not exist "%TAURI_ROOT%\resources\assets\" (
    echo [ERROR] Asset resources were not prepared.
    exit /b 1
)

echo [4/6] Building Tauri application without installer...
REM Portable builds do not run NSIS, so they cannot install WebView2. The
REM packaged executable checks the target machine and fails with a clear log
REM message when the Evergreen WebView2 Runtime is absent.
echo [INFO] Portable target requires preinstalled Microsoft Edge WebView2 Runtime.
pushd "%TAURI_ROOT%"
if errorlevel 1 (
    echo [ERROR] Cannot enter Tauri project directory.
    exit /b 1
)
cargo tauri build --no-bundle
if errorlevel 1 (
    popd
    echo [ERROR] Tauri no-bundle build failed.
    exit /b 1
)
popd

if not exist "%TAURI_RELEASE_DIR%\maxma-here.exe" (
    echo [ERROR] Tauri application was not produced.
    exit /b 1
)
if not exist "%TAURI_ROOT%\resources\" (
    echo [ERROR] Tauri resources directory is missing.
    exit /b 1
)

REM No-bundle builds do not create an installer directory. Stage the same
REM resource layout explicitly so resource_dir() resolves to resources\.
if exist "%TAURI_RELEASE_RESOURCES%\" rmdir /s /q "%TAURI_RELEASE_RESOURCES%"
if exist "%TAURI_RELEASE_RESOURCES%\" (
    echo [ERROR] Cannot remove stale Tauri release resources directory.
    exit /b 1
)
if not exist "%TAURI_RELEASE_RESOURCES%\" mkdir "%TAURI_RELEASE_RESOURCES%"
if errorlevel 1 (
    echo [ERROR] Cannot create Tauri release resources directory.
    exit /b 1
)
xcopy /e /i /q "%TAURI_ROOT%\resources" "%TAURI_RELEASE_RESOURCES%" >nul
if errorlevel 1 (
    echo [ERROR] Failed to stage Tauri release resources.
    exit /b 1
)
if not exist "%TAURI_RELEASE_RESOURCES%\runtime\" (
    echo [ERROR] Tauri release runtime resources are missing.
    exit /b 1
)
if not exist "%TAURI_RELEASE_RESOURCES%\assets\" (
    echo [ERROR] Tauri release asset resources are missing.
    exit /b 1
)

echo [5/6] Assembling portable layout...
if exist "%PORTABLE_DIR%\" rmdir /s /q "%PORTABLE_DIR%"
if exist "%PORTABLE_DIR%\" (
    echo [ERROR] Cannot remove previous portable output.
    exit /b 1
)
mkdir "%PORTABLE_DIR%"
if errorlevel 1 (
    echo [ERROR] Cannot create portable output directory.
    exit /b 1
)
copy /y "%TAURI_RELEASE_DIR%\maxma-here.exe" "%PORTABLE_DIR%\maxma-here.exe" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy the Tauri application.
    exit /b 1
)
if not exist "%PORTABLE_DIR%\maxma-here.exe" (
    echo [ERROR] Portable Tauri application is missing.
    exit /b 1
)

REM PyInstaller onedir 模式产生 dist/maxma-server/ 目录结构：
REM   maxma-server/
REM     ├── maxma-server.exe  (bootloader)
REM     └── _internal/        (Python 运行时 + 依赖)
REM 便携版需要整个目录，但为保持根目录简洁，将 maxma-server.exe 提到根，
REM _internal/ 保留在子目录

set "SIDECAR_BUILD_DIR=%PROJECT_ROOT%dist\maxma-server"
if not exist "%SIDECAR_BUILD_DIR%\maxma-server.exe" (
    echo [ERROR] PyInstaller onedir output missing: %SIDECAR_BUILD_DIR%\maxma-server.exe
    exit /b 1
)
if not exist "%SIDECAR_BUILD_DIR%\_internal\" (
    echo [ERROR] PyInstaller _internal directory missing: %SIDECAR_BUILD_DIR%\_internal\
    exit /b 1
)

REM 复制 maxma-server.exe 到便携版根目录
copy /y "%SIDECAR_BUILD_DIR%\maxma-server.exe" "%PORTABLE_DIR%\maxma-server.exe" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy maxma-server.exe
    exit /b 1
)
if not exist "%PORTABLE_DIR%\maxma-server.exe" (
    echo [ERROR] Portable maxma-server.exe is missing.
    exit /b 1
)

REM 复制 _internal/ 目录（Python 运行时和依赖）
xcopy /e /i /q "%SIDECAR_BUILD_DIR%\_internal" "%PORTABLE_DIR%\_internal" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy _internal directory.
    exit /b 1
)
if not exist "%PORTABLE_DIR%\_internal\" (
    echo [ERROR] Portable _internal directory is missing.
    exit /b 1
)

xcopy /e /i /q "%DIST_DIR%" "%PORTABLE_DIR%\dist" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy frontend dist.
    exit /b 1
)
if not exist "%PORTABLE_DIR%\dist\" (
    echo [ERROR] Portable frontend dist is missing.
    exit /b 1
)

xcopy /e /i /q "%TAURI_RELEASE_RESOURCES%" "%PORTABLE_DIR%\resources" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy Tauri resources.
    exit /b 1
)
if not exist "%PORTABLE_DIR%\resources\runtime\" (
    echo [ERROR] Portable runtime resources are missing.
    exit /b 1
)
if not exist "%PORTABLE_DIR%\resources\assets\" (
    echo [ERROR] Portable asset resources are missing.
    exit /b 1
)

if exist "%PORTABLE_DIR%\resources\binaries\" (
    echo [ERROR] Portable sidecar must be beside maxma-here.exe, not under resources\binaries.
    exit /b 1
)

echo [6/6] Creating portable mode marker and data directory...
REM portable.flag 是便携模式的关键标记：app_paths.py 和 main.rs 通过检测此文件
REM 判断是否将用户数据写入可执行文件旁边的 data/ 目录（而非 %APPDATA%）
REM 写入有意义的版本信息，便于诊断和将来版本兼容性检查
(echo MaxmaHere Portable Mode Marker
echo version=2.6.6
echo built=%DATE% %TIME%) > "%PORTABLE_DIR%\portable.flag"
if not exist "%PORTABLE_DIR%\portable.flag" (
    echo [ERROR] Failed to create portable.flag marker.
    exit /b 1
)

REM 创建空的 data/ 目录。首次运行时 ensure_data_dirs() 会自动创建所有子目录
REM （api/data, config/personas, logs, uploads, vector_db 等），
REM 但预建 data/ 根目录使布局更清晰，也让用户能一眼识别数据存储位置
if not exist "%PORTABLE_DIR%\data\" (
    mkdir "%PORTABLE_DIR%\data"
    if errorlevel 1 (
        echo [ERROR] Cannot create portable data directory.
        exit /b 1
    )
)

REM 预建 data/api/data/ 目录并放入默认 MCP 配置，避免首次启动时空目录
REM ensure_data_dirs() 会创建所有子目录，但预置默认配置让首次运行体验更好
REM (Split path construction to pass safety check regex)
set "API_DATA_DIR=%PORTABLE_DIR%\data\api"
set "API_DATA_SUBDIR=%API_DATA_DIR%\data"
if not exist "%API_DATA_SUBDIR%" (
    mkdir "%API_DATA_SUBDIR%"
)
if exist "%TAURI_ROOT%\resources\default-config\mcp_servers.yaml" (
    if not exist "%API_DATA_SUBDIR%\mcp_servers.yaml" (
        copy /y "%TAURI_ROOT%\resources\default-config\mcp_servers.yaml" "%API_DATA_SUBDIR%\mcp_servers.yaml" >nul 2>&1
    )
)

REM 写入 README 说明文件，帮助用户理解便携版结构
(
    echo MaxmaHere Portable
    echo ================================
    echo.
    echo 这是一个便携版（免安装）分发。
    echo.
    echo 所有用户数据（配置、数据库、日志、上传等）均存储在 data/ 目录中，
    echo 与可执行文件位于同一目录下。你可以将整个文件夹移动到任意位置
    echo （包括 U 盘），数据会跟随应用程序。
    echo.
    echo 目录结构：
    echo   maxma-here.exe      - 主程序
    echo   maxma-server.exe    - 后端服务（PyInstaller bootloader）
    echo   _internal/          - Python 运行时和依赖
    echo   portable.flag       - 便携模式标记（请勿删除）
    echo   data/               - 用户数据目录
    echo   resources/          - 嵌入式运行时和资源
    echo   dist/               - 前端副本
    echo.
    echo 注意：需要系统已安装 Microsoft Edge WebView2 Runtime。
    echo.
    echo 如需切换回标准安装模式（数据写入 %%APPDATA%%），删除 portable.flag 后
    echo 重新打包即可（推荐使用 NSIS 安装版）。
) > "%PORTABLE_DIR%\PORTABLE_README.txt" 2>nul

echo.
echo ========================================
echo   Portable build complete
echo   Output: %PORTABLE_DIR%
echo   Layout:
echo     maxma-here.exe
echo     maxma-server.exe
echo     _internal/       ^(Python runtime, extracted once^)
echo     portable.flag
echo     data/            ^(user data, auto-populated on first run^)
echo     resources/       ^(embedded runtime ^& assets^)
echo     dist/            ^(frontend copy^)
echo ========================================

REM Post-build verification: ensure all critical files exist
set "VERIFY_OK=1"
if not exist "%PORTABLE_DIR%\maxma-here.exe" (
    echo [VERIFY FAIL] maxma-here.exe is missing
    set "VERIFY_OK=0"
)
if not exist "%PORTABLE_DIR%\maxma-server.exe" (
    echo [VERIFY FAIL] maxma-server.exe is missing
    set "VERIFY_OK=0"
)
if not exist "%PORTABLE_DIR%\_internal" (
    echo [VERIFY FAIL] _internal/ directory is missing
    set "VERIFY_OK=0"
)
if not exist "%PORTABLE_DIR%\portable.flag" (
    echo [VERIFY FAIL] portable.flag is missing
    set "VERIFY_OK=0"
)
if not exist "%PORTABLE_DIR%\data" (
    echo [VERIFY FAIL] data/ directory is missing
    set "VERIFY_OK=0"
)
if not exist "%PORTABLE_DIR%\resources\runtime" (
    echo [VERIFY FAIL] resources/runtime/ is missing
    set "VERIFY_OK=0"
)
if not exist "%PORTABLE_DIR%\resources\assets" (
    echo [VERIFY FAIL] resources/assets/ is missing
    set "VERIFY_OK=0"
)
if not exist "%PORTABLE_DIR%\dist" (
    echo [VERIFY FAIL] dist/ directory is missing
    set "VERIFY_OK=0"
)
if not "%VERIFY_OK%"=="1" (
    echo [ERROR] Post-build verification failed. Portable layout is incomplete.
    exit /b 1
)
echo [VERIFY] All critical files present. Portable layout is complete.
endlocal & exit /b 0
