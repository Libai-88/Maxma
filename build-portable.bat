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

REM Resolve the normal build environment for the final cargo invocation.
call build\setup-dev-env.bat
if errorlevel 1 (
    echo [ERROR] Development environment setup failed.
    exit /b 1
)

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

mkdir "%PORTABLE_DIR%\resources\binaries"
if errorlevel 1 (
    echo [ERROR] Cannot create portable resource binaries directory.
    exit /b 1
)
copy /y "%SIDECAR_SOURCE%" "%PORTABLE_DIR%\resources\binaries\%SIDECAR_NAME%" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy the target-suffix sidecar.
    exit /b 1
)
if not exist "%PORTABLE_DIR%\resources\binaries\%SIDECAR_NAME%" (
    echo [ERROR] Portable target-suffix sidecar is missing from resource_dir.
    exit /b 1
)

echo [6/6] Migrating user configuration...
set "APPDATA_DIR=%APPDATA%\MaxmaHere"
if not exist "%APPDATA_DIR%\" mkdir "%APPDATA_DIR%"
if errorlevel 1 exit /b 1
if not exist "%APPDATA_DIR%\api\data\" mkdir "%APPDATA_DIR%\api\data"
if errorlevel 1 exit /b 1
if not exist "%APPDATA_DIR%\config\personas\" mkdir "%APPDATA_DIR%\config\personas"
if errorlevel 1 exit /b 1

if exist "%PROJECT_ROOT%api\data\providers.yaml" (
    copy /y "%PROJECT_ROOT%api\data\providers.yaml" "%APPDATA_DIR%\api\data\providers.yaml" >nul
    if errorlevel 1 exit /b 1
)
if exist "%PROJECT_ROOT%api\data\mcp_servers.yaml" (
    copy /y "%PROJECT_ROOT%api\data\mcp_servers.yaml" "%APPDATA_DIR%\api\data\mcp_servers.yaml" >nul
    if errorlevel 1 exit /b 1
)
if exist "%PROJECT_ROOT%api\data\maxma.db" (
    copy /y "%PROJECT_ROOT%api\data\maxma.db" "%APPDATA_DIR%\api\data\maxma.db" >nul
    if errorlevel 1 exit /b 1
)
if exist "%PROJECT_ROOT%config\personas\SOUL.md" (
    copy /y "%PROJECT_ROOT%config\personas\*.md" "%APPDATA_DIR%\config\personas\" >nul
    if errorlevel 1 exit /b 1
    if exist "%PROJECT_ROOT%config\personas\*.yaml" (
        copy /y "%PROJECT_ROOT%config\personas\*.yaml" "%APPDATA_DIR%\config\personas\" >nul
        if errorlevel 1 exit /b 1
    )
)

echo.
echo ========================================
echo   Portable build complete
echo   Output: %PORTABLE_DIR%
echo ========================================
explorer "%PORTABLE_DIR%"
pause
