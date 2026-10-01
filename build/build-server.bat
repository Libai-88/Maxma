@echo off
REM MaxmaHere Bun backend build.
REM Produces dist\bun-server\ : server.js (bundled) + bun.exe (runtime) +
REM minimal native node_modules (sharp/libvips). Replaces the old PyInstaller
REM chain (removed in stage 2.6).
REM
REM Usage: build\build-server.bat
REM Output: dist\bun-server\

setlocal enabledelayedexpansion

cd /d "%~dp0\.."

REM Port config for the pre-clean port guard
if "%MAXMA_API_PORT%"=="" set "MAXMA_API_PORT=8000"

powershell -NoProfile -ExecutionPolicy Bypass -File build\port-guard.ps1 -PortsStr "%MAXMA_API_PORT%" >nul 2>&1
if errorlevel 1 exit /b 1

set "OUT_DIR=dist\bun-server"
set "OUT_JS=%OUT_DIR%\server.js"
set "OUT_BUN=%OUT_DIR%\bun.exe"
set "BACKEND_DIR=bun-backend"
set "BUN_EXE=%CD%\bun-sidecar\bun.exe"

echo ============================================
echo   MaxmaHere Bun Backend Build
echo ============================================
echo.

REM Resolve a Bun binary for the build. Prefer the pinned bundled runtime so a
REM missing/mismatched global Bun cannot produce a partial build.
if not exist "%BUN_EXE%" (
    echo [INFO] Preparing pinned Bun runtime...
    powershell -NoProfile -ExecutionPolicy Bypass -File build\prepare-bun.ps1
    if errorlevel 1 (
        echo [ERROR] Bun runtime preparation failed
        exit /b 1
    )
)
if not exist "%BUN_EXE%" (
    echo [ERROR] Bundled Bun runtime is missing: %BUN_EXE%
    exit /b 1
)

REM Clean stale output
if exist "%OUT_DIR%\" (
    echo [INFO] Cleaning stale output: %OUT_DIR%
    rmdir /s /q "%OUT_DIR%"
    if errorlevel 1 exit /b 1
)

REM [1/4] Build the frontend (served by the backend at runtime)
echo [1/4] Building frontend...
if not exist "web\package-lock.json" (
    echo [ERROR] web\package-lock.json is required for a clean frontend install
    exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is required to install frontend dependencies
    exit /b 1
)
if not exist "web\node_modules" (
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
if exist "dist\" (
    echo [INFO] Pre-cleaning web\dist
    rmdir /s /q "dist"
    if errorlevel 1 exit /b 1
)
call npm run build 2>&1
if errorlevel 1 (
    echo [ERROR] Frontend build failed
    exit /b 1
)
cd ..

REM [2/4] Install Bun dependencies (build-time: backend + sidecar for bundling)
echo [2/4] Installing Bun dependencies (bundled runtime)...
pushd "%BACKEND_DIR%"
"%BUN_EXE%" install --frozen-lockfile
if errorlevel 1 (
    popd
    echo [ERROR] bun-backend dependency installation failed
    exit /b 1
)
popd
pushd bun-sidecar
"%BUN_EXE%" install --frozen-lockfile
if errorlevel 1 (
    popd
    echo [ERROR] bun-sidecar dependency installation failed
    exit /b 1
)
popd

REM [3/4] Bundle the backend into a single server.js
echo [3/4] Bundling backend (server.js)...
pushd "%BACKEND_DIR%"
"%BUN_EXE%" run build-server.mjs
if errorlevel 1 (
    popd
    echo [ERROR] Backend bundling failed
    exit /b 1
)
popd
if not exist "%OUT_JS%" (
    echo [ERROR] server.js was not produced: %OUT_JS%
    exit /b 1
)

REM [4/4] Stage the runtime: bun.exe + minimal native node_modules for sharp.
REM sharp's JS is inlined into server.js; only its native addon + libvips DLLs
REM must ship alongside (resolved at runtime from node_modules next to server.js).
echo [4/4] Staging runtime (bun.exe + sharp native modules)...
mkdir "%OUT_DIR%\node_modules" 2>nul
mkdir "%OUT_DIR%\node_modules\@img" 2>nul
copy /y "%BUN_EXE%" "%OUT_BUN%" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy bun.exe to output
    exit /b 1
)
xcopy /e /i /q "%BACKEND_DIR%\node_modules\sharp" "%OUT_DIR%\node_modules\sharp" >nul
if errorlevel 1 (
    echo [ERROR] Failed to stage sharp
    exit /b 1
)
xcopy /e /i /q "%BACKEND_DIR%\node_modules\@img\sharp-win32-x64" "%OUT_DIR%\node_modules\@img\sharp-win32-x64" >nul
if errorlevel 1 (
    echo [ERROR] Failed to stage sharp native addon
    exit /b 1
)
xcopy /e /i /q "%BACKEND_DIR%\node_modules\@img\colour" "%OUT_DIR%\node_modules\@img\colour" >nul
if errorlevel 1 (
    echo [ERROR] Failed to stage @img\colour
    exit /b 1
)
xcopy /e /i /q "%BACKEND_DIR%\node_modules\detect-libc" "%OUT_DIR%\node_modules\detect-libc" >nul
if errorlevel 1 (
    echo [ERROR] Failed to stage detect-libc
    exit /b 1
)
xcopy /e /i /q "%BACKEND_DIR%\node_modules\semver" "%OUT_DIR%\node_modules\semver" >nul
if errorlevel 1 (
    echo [ERROR] Failed to stage semver
    exit /b 1
)

echo.
echo ============================================
echo   Build complete
echo   Output: %OUT_DIR%
echo     server.js  (bundled backend)
echo     bun.exe    (runtime)
echo     node_modules\ (sharp native)
echo ============================================
for %%F in ("%OUT_JS%") do echo   server.js size: %%~zF bytes

endlocal & exit /b 0
